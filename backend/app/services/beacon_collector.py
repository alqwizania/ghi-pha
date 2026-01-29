import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session
from app.models.schema import Signal
import datetime
import json
import logging

logger = logging.getLogger(__name__)

class BeaconCollector:
    def __init__(self, db: Session):
        self.db = db
        self.base_url = "https://beaconbio.org"

    def poll_beacon(self):
        """Poll WHO Beacon for new events"""
        logger.info("Polling WHO Beacon...")
        events = self._scrape_events()
        
        new_count = 0
        for event in events:
            # Check if event already exists
            existing = self.db.query(Signal).filter(Signal.beacon_event_id == event['beacon_event_id']).first()
            if not existing:
                self._create_signal(event)
                new_count += 1
        
        self.db.commit()
        logger.info(f"Poll complete. Found {new_count} new signals.")
        return new_count

    def _scrape_events(self):
        """
        Scrape events from beaconbio.org
        Note: Currently returns mock data for development
        """
        # In a real implementation, we would use httpx.get(self.base_url) 
        # and parse with BeautifulSoup.
        return [
            {
                "beacon_event_id": "EVT-2026-001",
                "source_url": "https://beaconbio.org/event/2026-001",
                "disease": "Ebola Virus Disease",
                "country": "DRC",
                "location": "North Kivu",
                "date_reported": datetime.date.today(),
                "cases": 12,
                "deaths": 5,
                "description": "Cluster of suspected Ebola cases reported in North Kivu province.",
                "raw_data": {"source": "WHO Beacon", "scraped_at": str(datetime.datetime.now())}
            },
            {
                "beacon_event_id": "EVT-2026-002",
                "source_url": "https://beaconbio.org/event/2026-002",
                "disease": "MERS-CoV",
                "country": "Saudi Arabia",
                "location": "Riyadh",
                "date_reported": datetime.date.today(),
                "cases": 8,
                "deaths": 2,
                "description": "Healthcare-associated cluster of MERS-CoV infections.",
                "raw_data": {"source": "WHO Beacon", "scraped_at": str(datetime.datetime.now())}
            }
        ]

    def _create_signal(self, event_data: dict):
        """Create a new Signal record in the database"""
        # Calculate mock priority score (0-10)
        # Severity = (Deaths / Cases) * 10
        severity = (event_data['deaths'] / event_data['cases'] * 10) if event_data['cases'] > 0 else 0
        
        signal = Signal(
            **event_data,
            priority_score=round(severity, 2),
            triage_status="Pending Triage",
            current_status="New"
        )
        self.db.add(signal)
