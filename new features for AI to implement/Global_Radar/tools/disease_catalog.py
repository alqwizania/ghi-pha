# Stub module for backwards compatibility
# The disease_catalog module was removed as part of the visualization layer removal


def has_icon_metadata(disease_name: str) -> bool:
    """Stub - always returns False since visualization layer was removed."""
    return False


async def add_discovered_disease(disease_name: str) -> None:
    """Stub - does nothing since visualization layer was removed."""
    pass
