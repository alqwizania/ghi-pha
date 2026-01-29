from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.schema import Signal
from app.models.schemas_api import SignalResponse, SignalUpdate
from app.services.beacon_collector import BeaconCollector

router = APIRouter()

@router.get("/", response_model=List[SignalResponse])
def get_signals(status: str = None, db: Session = Depends(get_db)):
    query = db.query(Signal)
    if status:
        query = query.filter(Signal.triage_status == status)
    return query.order_by(Signal.priority_score.desc()).all()

@router.get("/{signal_id}", response_model=SignalResponse)
def get_signal(signal_id: str, db: Session = Depends(get_db)):
    signal = db.query(Signal).filter(Signal.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    return signal

@router.post("/{signal_id}/triage")
def triage_signal(signal_id: str, update: SignalUpdate, db: Session = Depends(get_db)):
    signal = db.query(Signal).filter(Signal.id == signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    
    if update.triage_status:
        signal.triage_status = update.triage_status
    if update.triage_notes:
        signal.triage_notes = update.triage_notes
    if update.rejection_reason:
        signal.rejection_reason = update.rejection_reason
    if update.current_status:
        signal.current_status = update.current_status
    
    db.commit()
    return {"message": f"Signal {signal_id} triaged successfully"}

@router.post("/poll-beacon")
async def poll_beacon(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Manually trigger a Beacon poll in the background"""
    collector = BeaconCollector(db)
    background_tasks.add_task(collector.fetch_and_process)
    return {"message": "Beacon sync started in background"}
