from sqlalchemy import Column, String, Integer, Numeric, Boolean, DateTime, Date, ForeignKey, Text, JSON, UUID
from sqlalchemy.orm import relationship
import uuid
import datetime
from app.database import Base

class Signal(Base):
    __tablename__ = "signals"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    beacon_event_id = Column(String(255), unique=True)
    source_url = Column(Text, nullable=False)
    raw_data = Column(JSON, nullable=False)
    
    disease = Column(String(255), nullable=False)
    country = Column(String(100), nullable=False)
    location = Column(String(255))
    
    date_reported = Column(Date, nullable=False)
    date_onset = Column(Date)
    cases = Column(Integer, default=0)
    deaths = Column(Integer, default=0)
    case_fatality_rate = Column(Numeric(5, 2))
    
    description = Column(Text)
    outbreak_status = Column(String(50))
    
    triage_status = Column(String(50), default="Pending Triage")
    triaged_by = Column(UUID(as_uuid=True))
    triaged_at = Column(DateTime(timezone=True))
    triage_notes = Column(Text)
    rejection_reason = Column(Text)
    
    priority_score = Column(Numeric(5, 2))
    gcc_relevant = Column(Boolean, default=False)
    saudi_risk_level = Column(String(20))
    
    current_status = Column(String(50), default="New")
    
    created_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    last_beacon_sync = Column(DateTime(timezone=True))

    assessments = relationship("Assessment", back_populates="signal")
    escalations = relationship("Escalation", back_populates="signal")

class Assessment(Base):
    __tablename__ = "assessments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signal_id = Column(UUID(as_uuid=True), ForeignKey("signals.id", ondelete="CASCADE"), nullable=False)
    
    assessment_type = Column(String(50), nullable=False)
    
    # IHR Annex 2
    ihr_question_1 = Column(Boolean)
    ihr_question_1_notes = Column(Text)
    ihr_question_2 = Column(Boolean)
    ihr_question_2_notes = Column(Text)
    ihr_question_3 = Column(Boolean)
    ihr_question_3_notes = Column(Text)
    ihr_question_4 = Column(Boolean)
    ihr_question_4_notes = Column(Text)
    ihr_decision = Column(String(50))
    
    # RRA
    rra_hazard_assessment = Column(JSON)
    rra_exposure_assessment = Column(JSON)
    rra_context_assessment = Column(JSON)
    rra_overall_risk = Column(String(20))
    rra_confidence_level = Column(String(20))
    rra_key_uncertainties = Column(JSON)
    rra_recommendations = Column(JSON)
    
    status = Column(String(50), default="Draft")
    assigned_to = Column(UUID(as_uuid=True), nullable=False)
    reviewed_by = Column(UUID(as_uuid=True))
    
    outcome_decision = Column(String(50))
    outcome_justification = Column(Text)
    
    created_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow)
    started_at = Column(DateTime(timezone=True))
    completed_at = Column(DateTime(timezone=True))
    updated_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    signal = relationship("Signal", back_populates="assessments")
    escalations = relationship("Escalation", back_populates="assessment")

class Escalation(Base):
    __tablename__ = "escalations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    signal_id = Column(UUID(as_uuid=True), ForeignKey("signals.id"), nullable=False)
    assessment_id = Column(UUID(as_uuid=True), ForeignKey("assessments.id"), nullable=False)
    
    escalation_level = Column(String(50), default="Director")
    priority = Column(String(20), nullable=False)
    escalation_reason = Column(Text, nullable=False)
    recommended_actions = Column(JSON)
    
    director_status = Column(String(50), default="Pending Review")
    director_decision = Column(Text)
    director_notes = Column(Text)
    actions_taken = Column(JSON)
    
    reviewed_by = Column(UUID(as_uuid=True))
    reviewed_at = Column(DateTime(timezone=True))
    
    escalated_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow)
    escalated_by = Column(UUID(as_uuid=True), nullable=False)
    resolved_at = Column(DateTime(timezone=True))
    
    created_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    signal = relationship("Signal", back_populates="escalations")
    assessment = relationship("Assessment", back_populates="escalations")
