from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.database import get_db
from app.models.schema import Assessment, Signal
from app.models.schemas_api import AssessmentResponse, AssessmentCreate, AssessmentUpdate

router = APIRouter()

@router.post("/", response_model=AssessmentResponse)
def create_assessment(assessment: AssessmentCreate, db: Session = Depends(get_db)):
    # Verify signal exists
    signal = db.query(Signal).filter(Signal.id == assessment.signal_id).first()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")
    
    db_assessment = Assessment(**assessment.model_dump())
    db.add(db_assessment)
    db.commit()
    db.refresh(db_assessment)
    return db_assessment

@router.get("/{assessment_id}", response_model=AssessmentResponse)
def get_assessment(assessment_id: str, db: Session = Depends(get_db)):
    assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return assessment

@router.patch("/{assessment_id}", response_model=AssessmentResponse)
def update_assessment(assessment_id: str, update: AssessmentUpdate, db: Session = Depends(get_db)):
    db_assessment = db.query(Assessment).filter(Assessment.id == assessment_id).first()
    if not db_assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_assessment, key, value)
    
    db.commit()
    db.refresh(db_assessment)
    return db_assessment
