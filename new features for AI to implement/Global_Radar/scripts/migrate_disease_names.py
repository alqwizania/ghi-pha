#!/usr/bin/env python3
"""
One-time migration script: Normalize disease names in NocoDB.

Scans all existing records in the Findings table and updates any disease
names that differ from their canonical form (as defined in diseases.json).

This script is SELF-CONTAINED — it does not import from the SehaRadar
application modules to avoid circular import issues.

Usage:
    # Dry-run (default) — shows what would change without writing:
    docker exec seha-radar python scripts/migrate_disease_names.py

    # Apply changes:
    docker exec seha-radar python scripts/migrate_disease_names.py --apply

    # Show per-record details:
    docker exec seha-radar python scripts/migrate_disease_names.py --verbose

    # Combine:
    docker exec seha-radar python scripts/migrate_disease_names.py --apply --verbose
"""

import asyncio
import argparse
import json
import os
import sys
from typing import Dict, List, Optional

import httpx


# ---------------------------------------------------------------------------
# NocoDB configuration — reads the same env vars as the main application
# ---------------------------------------------------------------------------
def _get_nocodb_config() -> dict:
    base_url = os.getenv(
        "NOCODB_API_URL", os.getenv("NC_PUBLIC_URL", "http://nocodb:8080")
    )
    base_url = base_url.replace("/api/v1", "").rstrip("/")
    return {
        "base_url": base_url,
        "api_token": os.getenv("NOCODB_API_TOKEN", ""),
        "table_id": os.getenv("NOCODB_TABLE_ID", "m0s3bmpa8qzp4eh"),
    }


# ---------------------------------------------------------------------------
# Self-contained normalize_disease_name (mirrors epi_triad_analyzer.py)
# ---------------------------------------------------------------------------
def _load_diseases_json() -> dict:
    """Load config/diseases.json from the app root."""
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "config", "diseases.json"),
        "/app/config/diseases.json",
    ]
    for path in candidates:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError(f"diseases.json not found in {candidates}")


def _build_alias_map(config: dict) -> Dict[str, str]:
    alias_map: Dict[str, str] = {}
    for disease in config.get("diseases", []):
        canonical = disease["name"]
        alias_map[canonical.lower()] = canonical
        for alias in disease.get("aliases", []):
            alias_map[alias.lower()] = canonical
        for kw in disease.get("keywords_en", []):
            alias_map[kw.lower()] = canonical
    return alias_map


def normalize_disease_name(raw_name: str, alias_map: Dict[str, str]) -> str:
    if not raw_name or raw_name.strip().lower() in (
        "news",
        "unknown",
        "unknown disease",
        "none",
        "null",
        "",
    ):
        return "news"

    cleaned = raw_name.strip()
    lookup = cleaned.lower()

    # 1. Exact match
    if lookup in alias_map:
        return alias_map[lookup]

    # 2. Suffix stripping
    suffixes = [
        " virus infection",
        " virus disease",
        " hemorrhagic fever",
        " haemorrhagic fever",
        " disease",
        " virus",
        " infection",
        " outbreak",
        " fever",
    ]
    for suffix in suffixes:
        if lookup.endswith(suffix):
            stripped = lookup[: -len(suffix)].strip()
            if stripped in alias_map:
                return alias_map[stripped]

    # 3. Containment check (longest aliases first)
    for alias, canonical in sorted(alias_map.items(), key=lambda x: -len(x[0])):
        if len(alias) >= 3 and (alias in lookup or lookup in alias):
            return canonical

    return cleaned


# ---------------------------------------------------------------------------
# Migration logic
# ---------------------------------------------------------------------------
async def migrate(apply: bool = False, verbose: bool = False) -> None:
    """
    Fetch all records from NocoDB, normalize their disease names,
    and PATCH any that changed.
    """
    cfg = _get_nocodb_config()
    headers = {"xc-token": cfg["api_token"], "Content-Type": "application/json"}
    records_url = f"{cfg['base_url']}/api/v2/tables/{cfg['table_id']}/records"

    # Load normalization data
    diseases_config = _load_diseases_json()
    alias_map = _build_alias_map(diseases_config)

    print("=" * 70)
    print(f"  SehaRadar — Disease Name Migration {'(APPLY)' if apply else '(DRY-RUN)'}")
    print("=" * 70)
    print(f"  NocoDB URL:  {cfg['base_url']}")
    print(f"  Table ID:    {cfg['table_id']}")
    print(f"  Alias map:   {len(alias_map)} entries")

    # Fetch ALL records in pages of 200
    page_size = 200
    offset = 0
    all_records: List[dict] = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            params = {"limit": page_size, "offset": offset}
            resp = await client.get(records_url, headers=headers, params=params)
            resp.raise_for_status()
            page = resp.json().get("list", [])
            if not page:
                break
            all_records.extend(page)
            print(f"  📥 Fetched page {offset // page_size + 1}: {len(page)} records")
            if len(page) < page_size:
                break
            offset += page_size

    print(f"\n📊 Total records fetched: {len(all_records)}")

    # Build change list
    changes: List[dict] = []
    unchanged = 0

    for record in all_records:
        record_id = record.get("Id") or record.get("id")
        old_name = record.get("disease", "")
        if not old_name:
            continue

        new_name = normalize_disease_name(old_name, alias_map)

        if new_name != old_name:
            changes.append({"id": record_id, "old": old_name, "new": new_name})
            if verbose:
                print(f"  🔄 #{record_id}: '{old_name}' → '{new_name}'")
        else:
            unchanged += 1

    print(f"\n📋 Summary:")
    print(f"   Unchanged:  {unchanged}")
    print(f"   To update:  {len(changes)}")

    if not changes:
        print("\n✅ Nothing to migrate — all disease names are already canonical.")
        return

    # Group changes by old→new for summary
    change_summary: Dict[str, dict] = {}
    for c in changes:
        key = c["old"]
        if key not in change_summary:
            change_summary[key] = {"new": c["new"], "count": 0}
        change_summary[key]["count"] += 1

    print(f"\n   Disease name changes:")
    for old, info in sorted(change_summary.items(), key=lambda x: -x[1]["count"]):
        print(f"     '{old}' → '{info['new']}'  ({info['count']} records)")

    if not apply:
        print(f"\n⚠️  DRY-RUN mode — no changes written. Re-run with --apply to commit.")
        return

    # Apply changes via NocoDB PATCH in batches of 50
    batch_size = 50
    updated = 0
    errors = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        for i in range(0, len(changes), batch_size):
            batch = changes[i : i + batch_size]
            patch_payload = [{"id": c["id"], "disease": c["new"]} for c in batch]

            try:
                response = await client.patch(
                    records_url, headers=headers, json=patch_payload
                )
                response.raise_for_status()
                updated += len(batch)
                print(
                    f"  ✅ Batch {i // batch_size + 1}: "
                    f"updated {len(batch)} records "
                    f"({updated}/{len(changes)} total)"
                )
            except Exception as e:
                errors += len(batch)
                print(f"  ❌ Batch {i // batch_size + 1} failed: {e}")

    print(f"\n{'=' * 70}")
    print(f"  Migration complete:  {updated} updated, {errors} errors")
    print(f"{'=' * 70}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Normalize disease names in NocoDB to canonical forms from diseases.json"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write changes to NocoDB (default is dry-run)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print per-record change details",
    )
    args = parser.parse_args()

    asyncio.run(migrate(apply=args.apply, verbose=args.verbose))


if __name__ == "__main__":
    main()
