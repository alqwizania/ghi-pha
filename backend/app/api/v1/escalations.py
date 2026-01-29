from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.schema import Escalation, Signal, Assessment
from app.models.schemas_api import EscalationResponse, EscalationCreate, EscalationUpdate

router = APIRouter()

@router.post("/", response_model=EscalationResponse)
def create_escalation(escalation: EscalationCreate, db: Session = Depends(get_db)):
    # Verify assessment exists
    assessment = db.query(Assessment).filter(Assessment.id == escalation.assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    
    db_escalation = Escalation(**escalation.model_dump())
    db.add(db_escalation)
    db.commit()
    db.refresh(db_escalation)
    return db_escalation

@router.get("/pending", response_model=List[EscalationResponse])
def get_pending_escalations(db: Session = Depends(get_db)):
    return db.query(Escalation).filter(Escalation.director_status == "Pending Review").all()

@router.patch("/{escalation_id}/decision", response_model=EscalationResponse)
def director_decision(escalation_id: str, update: EscalationUpdate, db: Session = Depends(get_db)):
    db_escalation = db.query(Escalation).filter(Escalation.id == escalation_id).first()
    if not db_escalation:
        raise HTTPException(status_code=404, detail="Escalation not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_escalation, key, value)
    
    db.commit()
    db.refresh(db_escalation)
    return db_escalation
