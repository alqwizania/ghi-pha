from workflows.unified_scan_workflow import UnifiedScanWorkflow


def test_parse_quality_gate_blocks_known_section_headers() -> None:
    workflow = UnifiedScanWorkflow()

    issue = workflow._get_parse_quality_issue(
        {"headline": "International Outbreaks"},
        source_name="CDC",
    )

    assert issue is not None


def test_parse_quality_gate_keeps_specific_travel_notice() -> None:
    workflow = UnifiedScanWorkflow()

    issue = workflow._get_parse_quality_issue(
        {"headline": "Level 2 - Chikungunya in Seychelles"},
        source_name="CDC_TRAVEL",
    )

    assert issue is None


def test_analysis_quality_gate_blocks_placeholder_summary_for_news() -> None:
    workflow = UnifiedScanWorkflow()

    issue = workflow._get_analysis_quality_issue(
        {
            "headline": "Travel Health Notices",
            "disease": "news",
            "short_description_en": (
                "According to CDC_TRAVEL, there were unknown confirmed and "
                "unknown suspected cases and unknown deaths in location not specified "
                "during an unspecified period."
            ),
        },
        source_name="CDC_TRAVEL",
    )

    assert issue is not None


def test_analysis_quality_gate_keeps_descriptive_finding() -> None:
    workflow = UnifiedScanWorkflow()

    issue = workflow._get_analysis_quality_issue(
        {
            "headline": "Mpox outbreak in Galicia linked to non-sexual exposure",
            "disease": "Mpox",
            "short_description_en": (
                "According to PROMED, 14 new mpox cases were reported in Galicia, "
                "Spain, and contact tracing was initiated."
            ),
        },
        source_name="PROMED",
    )

    assert issue is None
