#!/usr/bin/env python3
"""
Update source UUIDs in sources.json from ChangeDetection.io watch list
SehaRadar v1.0
"""

import json
import sys
from pathlib import Path


def main():
    # Read the watch mapping file
    mapping_file = Path("/tmp/seharadar_new_watches.txt")
    if not mapping_file.exists():
        print("❌ Mapping file not found. Run add_new_sources.sh first!")
        sys.exit(1)

    # Parse the mapping file (format: title|uuid|url)
    uuid_map = {}
    with open(mapping_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split("|")
            if len(parts) == 3:
                title, uuid, url = parts
                uuid_map[url] = uuid

    print(f"📋 Loaded {len(uuid_map)} watch UUIDs from mapping file")

    # Read sources.json
    sources_file = Path(__file__).parent.parent / "config" / "sources.json"
    if not sources_file.exists():
        print(f"❌ Sources file not found: {sources_file}")
        sys.exit(1)

    with open(sources_file) as f:
        config = json.load(f)

    # Update UUIDs for sources with "PENDING"
    updated_count = 0
    for source in config["sources"]:
        if source.get("watch_uuid") == "PENDING" and source.get("url") in uuid_map:
            old_uuid = source["watch_uuid"]
            new_uuid = uuid_map[source["url"]]
            source["watch_uuid"] = new_uuid
            updated_count += 1
            print(f"✅ Updated {source['id']}: {old_uuid} → {new_uuid}")

    if updated_count == 0:
        print("⚠️  No sources were updated. All UUIDs may already be set.")
        return

    # Update metadata
    config["metadata"]["notes"] = f"Last updated: {Path(__file__).name}"

    # Write back to sources.json
    with open(sources_file, "w") as f:
        json.dump(config, f, indent=2)

    print(f"\n✅ Updated {updated_count} sources in {sources_file}")
    print("\n📋 Summary:")
    print(f"   Total sources: {config['metadata']['total_sources']}")
    print(f"   Active sources: {config['metadata']['active_sources']}")
    print(f"   Updated this run: {updated_count}")

    # Check for remaining PENDING
    pending_count = sum(
        1 for s in config["sources"] if s.get("watch_uuid") == "PENDING"
    )
    if pending_count > 0:
        print(f"\n⚠️  {pending_count} sources still have PENDING UUIDs")
        for source in config["sources"]:
            if source.get("watch_uuid") == "PENDING":
                print(f"   - {source['id']}: {source['url']}")
    else:
        print("\n🎉 All sources have valid UUIDs!")


if __name__ == "__main__":
    main()
