#!/usr/bin/env python3
"""Test script for new DabDar v4.0 Phase 1 API endpoints."""

import requests
import json

BASE_URL = "http://localhost:8080"


def test_endpoint(name, url, method="GET", expected_keys=None):
    """Test an API endpoint."""
    print(f"\n{'=' * 80}")
    print(f"Testing: {name}")
    print(f"URL: {url}")
    print(f"{'=' * 80}")

    try:
        if method == "GET":
            response = requests.get(url, timeout=10)
        elif method == "POST":
            response = requests.post(url, timeout=10)

        print(f"Status: {response.status_code}")

        if response.status_code == 200:
            data = response.json()
            print(f"✅ SUCCESS")

            if expected_keys:
                for key in expected_keys:
                    if key in data:
                        print(f"  ✓ {key}: {type(data[key]).__name__}")
                        if isinstance(data[key], (list, dict)):
                            if isinstance(data[key], list):
                                print(f"    Length: {len(data[key])}")
                            elif isinstance(data[key], dict):
                                print(f"    Keys: {list(data[key].keys())[:5]}")
                    else:
                        print(f"  ✗ Missing key: {key}")

            # Show sample of response
            print(f"\nSample response:")
            print(json.dumps(data, indent=2)[:500] + "...")
        else:
            print(f"❌ FAILED: {response.text[:200]}")
    except Exception as e:
        print(f"❌ ERROR: {e}")


def main():
    """Test all Phase 1 endpoints."""
    print("\n" + "=" * 80)
    print("DabDar v4.0 Phase 1 - API Endpoint Tests")
    print("=" * 80)

    # Test 1: Status endpoint (check version)
    test_endpoint(
        "Server Status",
        f"{BASE_URL}/status",
        expected_keys=["status", "version", "statistics"],
    )

    # Test 2: Get all sources
    test_endpoint(
        "Get All Sources",
        f"{BASE_URL}/api/sources",
        expected_keys=["sources", "count", "statistics"],
    )

    # Test 3: Get specific source
    test_endpoint(
        "Get WHO Source",
        f"{BASE_URL}/api/sources/WHO",
        expected_keys=["id", "name", "type", "watch_uuid", "enabled"],
    )

    # Test 4: Get enabled sources only
    test_endpoint(
        "Get Enabled Sources",
        f"{BASE_URL}/api/sources?enabled_only=true",
        expected_keys=["sources", "count"],
    )

    # Test 5: Filter by type
    test_endpoint(
        "Get ChangeDetection Sources",
        f"{BASE_URL}/api/sources?source_type=changedetection",
        expected_keys=["sources", "count"],
    )

    # Test 6: Reload sources
    test_endpoint(
        "Reload Sources (Hot-Reload)",
        f"{BASE_URL}/api/sources/reload",
        method="POST",
        expected_keys=["status", "statistics", "valid_agencies"],
    )

    print("\n" + "=" * 80)
    print("✅ All API tests completed!")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    main()
