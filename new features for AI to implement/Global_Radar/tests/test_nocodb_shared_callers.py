import asyncio
import os
import sys
from typing import Any, cast

# Ensure project root is on sys.path
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)

from tools.deduplication import DeduplicationService
from workflows.reclassify_workflow import _patch_record


class FakeNocoDBClient:
    def __init__(self, records=None, patch_result=True):
        self.records = records or []
        self.patch_result = patch_result
        self.query_calls = []
        self.patch_calls = []

    async def query_findings(self, **kwargs):
        self.query_calls.append(kwargs)
        return self.records

    async def patch_records(self, records):
        self.patch_calls.append(records)
        return self.patch_result


def test_check_hash_exists_uses_shared_client(monkeypatch) -> None:
    async def _run() -> None:
        service = DeduplicationService()
        fake_client = FakeNocoDBClient(records=[{"id": 7, "content_hash": "abc123"}])
        monkeypatch.setattr(service, "_get_nocodb_client", lambda: fake_client)

        result = await service.check_hash_exists("abc123")

        assert result == {"id": 7, "content_hash": "abc123"}
        assert fake_client.query_calls == [
            {"where": "(content_hash,eq,abc123)", "limit": 1}
        ]

    asyncio.run(_run())


def test_check_similar_headlines_uses_shared_client(monkeypatch) -> None:
    async def _run() -> None:
        service = DeduplicationService()
        fake_client = FakeNocoDBClient(
            records=[
                {"id": 3, "headline": "Mpox outbreak spreads in DRC"},
                {"id": 4, "headline": "Cholera cases rise in Mozambique"},
            ]
        )
        monkeypatch.setattr(service, "_get_nocodb_client", lambda: fake_client)

        result = await service.check_similar_headlines(
            headline="Mpox outbreak spreads in the DRC",
            disease="Mpox",
        )

        assert result is not None
        assert result["id"] == 3
        assert result["_similarity_score"] >= service.similarity_threshold
        assert fake_client.query_calls == [
            {
                "where": "(disease,eq,Mpox)",
                "limit": 50,
                "sort": "-publication_date",
            }
        ]

    asyncio.run(_run())


def test_reclassify_patch_record_uses_shared_client() -> None:
    async def _run() -> None:
        fake_client = FakeNocoDBClient(patch_result=True)

        result = await _patch_record(
            cast(Any, fake_client),
            42,
            {"disease": "Mpox", "risk": "high"},
        )

        assert result is True
        assert fake_client.patch_calls == [
            [{"id": 42, "disease": "Mpox", "risk": "high"}]
        ]

    asyncio.run(_run())
