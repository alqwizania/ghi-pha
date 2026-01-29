# Global Health Intelligence (GHI) System - Beacon-Focused Specification
## WHO Beacon-Powered Intelligence System for Public Health Authority

**Version:** 2.0  
**Date:** January 2026  
**Data Source:** WHO Beacon (https://beaconbio.org)  
**Database:** PostgreSQL (Neon)

---

## Executive Summary

The GHI system is a streamlined intelligence platform that automatically ingests disease outbreak events from WHO Beacon and provides a structured workflow for signal triage, risk assessment, and escalation to the director.

### Core Workflow

```
WHO Beacon Disease Events
          ↓
[1. Dashboard View] ← Overview & Metrics
          ↓
[2. Signals Triage View] → Accept/Reject signals
          ↓ (Accepted signals only)
[3. Assessment View] → IHR Annex 2 / RRA Assessment
          ↓
      Archive OR Escalate
          ↓
[4. Escalation View] → Director review & action
```

### Key Features

- **Automated Beacon Integration**: Polls WHO Beacon every 15 minutes for new disease events
- **Smart Priority Scoring**: Automatic 0-100 scoring based on disease, CFR, geography, and volume
- **Professional Triage Interface**: Card-based signal review with accept/reject workflow
- **Dual Assessment Types**: IHR Annex 2 Decision Instrument and WHO Rapid Risk Assessment
- **Director Escalation Queue**: Structured review and action tracking for escalated signals
- **Real-time Dashboard**: Executive metrics with geographic visualization

### Technology Stack

```yaml
Data Source: WHO Beacon API (beaconbio.org)
Backend: Python 3.11 + FastAPI
Frontend: React 18 + TypeScript + Tailwind CSS
Database: PostgreSQL 16 (Neon) with PostGIS
Caching: Redis (Upstash)
Queue: Celery + RabbitMQ
Real-time: WebSocket for live updates
Deployment: Docker + AWS/Azure
```

---

## System Architecture

### Component Diagram

```
┌──────────────────────────────────────────────────────┐
│              WHO Beacon                               │
│      https://beaconbio.org/en/events                 │
└───────────────────┬──────────────────────────────────┘
                    │ Automated polling (every 15 min)
                    ↓
┌──────────────────────────────────────────────────────┐
│           GHI Backend (FastAPI)                      │
│  ┌──────────┐  ┌─────────┐  ┌──────────────┐       │
│  │ Beacon   │→ │ Priority│→ │ Notification │       │
│  │Collector │  │ Scorer  │  │   Service    │       │
│  └──────────┘  └─────────┘  └──────────────┘       │
└───────────────────┬──────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│      PostgreSQL Database (Neon)                      │
│                                                       │
│  Tables: signals, assessments, escalations,          │
│          users, notifications, audit_log             │
└───────────────────┬──────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────────────────┐
│         React Frontend (4 Views)                      │
│  [Dashboard] [Triage] [Assessment] [Escalation]     │
└──────────────────────────────────────────────────────┘
```

### User Roles

| Role | Permissions | Description |
|------|-------------|-------------|
| **Analyst** | View Dashboard, Triage signals, Create assessments, Archive/Escalate | Front-line intelligence analyst |
| **Senior Analyst** | All Analyst permissions + Review assessments, Override decisions | Experienced analyst with review authority |
| **Director** | View Dashboard, Review escalations, Approve/Reject escalated signals, Take action | Executive decision-maker |
| **Admin** | All permissions + User management, System configuration | System administrator |

---

## Database Schema (PostgreSQL)

### Complete Schema with 6 Core Tables

```sql
-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================
-- 1. SIGNALS TABLE (from WHO Beacon)
-- ============================================
CREATE TABLE signals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Beacon Source Data
    beacon_event_id VARCHAR(255) UNIQUE,
    source_url TEXT NOT NULL,
    raw_data JSONB NOT NULL,
    
    -- Event Information
    disease VARCHAR(255) NOT NULL,
    country VARCHAR(100) NOT NULL,
    location VARCHAR(255),
    coordinates GEOMETRY(Point, 4326),
    
    -- Epidemiological Data
    date_reported DATE NOT NULL,
    date_onset DATE,
    cases INTEGER DEFAULT 0,
    deaths INTEGER DEFAULT 0,
    case_fatality_rate DECIMAL(5,2),
    
    -- Status & Description
    description TEXT,
    outbreak_status VARCHAR(50),
    
    -- Triage Status
    triage_status VARCHAR(50) DEFAULT 'Pending Triage',
    triaged_by UUID,
    triaged_at TIMESTAMP WITH TIME ZONE,
    triage_notes TEXT,
    rejection_reason TEXT,
    
    -- Priority Scoring
    priority_score DECIMAL(5,2),
    gcc_relevant BOOLEAN DEFAULT FALSE,
    saudi_risk_level VARCHAR(20),
    
    -- Workflow
    current_status VARCHAR(50) DEFAULT 'New',
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_beacon_sync TIMESTAMP WITH TIME ZONE,
    
    -- Search
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', 
            coalesce(disease, '') || ' ' || 
            coalesce(country, '') || ' ' || 
            coalesce(description, '')
        )
    ) STORED
);

CREATE INDEX idx_signals_triage_status ON signals(triage_status);
CREATE INDEX idx_signals_current_status ON signals(current_status);
CREATE INDEX idx_signals_disease ON signals(disease);
CREATE INDEX idx_signals_country ON signals(country);
CREATE INDEX idx_signals_date ON signals(date_reported DESC);
CREATE INDEX idx_signals_priority ON signals(priority_score DESC);
CREATE INDEX idx_signals_search ON signals USING GIN(search_vector);
CREATE INDEX idx_signals_location ON signals USING GIST(coordinates);

-- ============================================
-- 2. ASSESSMENTS TABLE
-- ============================================
CREATE TABLE assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signal_id UUID NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
    
    -- Assessment Type
    assessment_type VARCHAR(50) NOT NULL,
    
    -- IHR Annex 2 Questions
    ihr_question_1 BOOLEAN,
    ihr_question_1_notes TEXT,
    ihr_question_2 BOOLEAN,
    ihr_question_2_notes TEXT,
    ihr_question_3 BOOLEAN,
    ihr_question_3_notes TEXT,
    ihr_question_4 BOOLEAN,
    ihr_question_4_notes TEXT,
    ihr_decision VARCHAR(50),
    
    -- RRA Assessment
    rra_hazard_assessment JSONB,
    rra_exposure_assessment JSONB,
    rra_context_assessment JSONB,
    rra_overall_risk VARCHAR(20),
    rra_confidence_level VARCHAR(20),
    rra_key_uncertainties TEXT[],
    rra_recommendations TEXT[],
    
    -- Assessment Status
    status VARCHAR(50) DEFAULT 'Draft',
    assigned_to UUID NOT NULL,
    reviewed_by UUID,
    
    -- Outcome
    outcome_decision VARCHAR(50),
    outcome_justification TEXT,
    
    -- Timeline
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_assessment_signal ON assessments(signal_id);
CREATE INDEX idx_assessment_type ON assessments(assessment_type);
CREATE INDEX idx_assessment_status ON assessments(status);

-- ============================================
-- 3. ESCALATIONS TABLE
-- ============================================
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signal_id UUID NOT NULL REFERENCES signals(id),
    assessment_id UUID NOT NULL REFERENCES assessments(id),
    
    -- Escalation Details
    escalation_level VARCHAR(50) DEFAULT 'Director',
    priority VARCHAR(20) NOT NULL,
    escalation_reason TEXT NOT NULL,
    recommended_actions TEXT[],
    
    -- Director Review
    director_status VARCHAR(50) DEFAULT 'Pending Review',
    director_decision TEXT,
    director_notes TEXT,
    actions_taken TEXT[],
    
    reviewed_by UUID,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    
    -- Timeline
    escalated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    escalated_by UUID NOT NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_escalation_signal ON escalations(signal_id);
CREATE INDEX idx_escalation_status ON escalations(director_status);
CREATE INDEX idx_escalation_priority ON escalations(priority);

-- ============================================
-- 4. USERS TABLE
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    
    role VARCHAR(50) NOT NULL,
    department VARCHAR(100),
    position VARCHAR(255),
    
    phone VARCHAR(50),
    mobile VARCHAR(50),
    
    password_hash VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP WITH TIME ZONE,
    
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

-- ============================================
-- 5. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    recipient_id UUID NOT NULL,
    
    notification_type VARCHAR(100) NOT NULL,
    title VARCHAR(500) NOT NULL,
    message TEXT NOT NULL,
    action_url TEXT,
    
    signal_id UUID,
    assessment_id UUID,
    escalation_id UUID,
    
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    
    priority VARCHAR(20) DEFAULT 'Normal',
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_notif_recipient ON notifications(recipient_id, read);
CREATE INDEX idx_notif_type ON notifications(notification_type);

-- ============================================
-- 6. AUDIT LOG TABLE
-- ============================================
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    action_type VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    
    user_id UUID,
    user_role VARCHAR(50),
    
    description TEXT,
    old_value JSONB,
    new_value JSONB,
    
    ip_address INET,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp DESC);

-- ============================================
-- SAMPLE DATA
-- ============================================
INSERT INTO users (username, email, full_name, role, password_hash)
VALUES 
    ('admin', 'admin@pha.gov.sa', 'System Admin', 'Admin', 
     '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5/JFp7OQHQQW2'),
    ('analyst', 'analyst@pha.gov.sa', 'Ahmed Al-Otaibi', 'Analyst',
     '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5/JFp7OQHQQW2'),
    ('director', 'director@pha.gov.sa', 'Dr. Fatima Al-Rashid', 'Director',
     '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5/JFp7OQHQQW2');
```

---

## The Four Views

### View 1: Dashboard

**Purpose**: Executive overview with key metrics, trends, and geographic distribution

**Key Metrics**:
- Total signals (all time)
- Pending triage count
- Under assessment count
- Escalated signals count
- 30-day trend chart
- Top countries affected
- Top diseases
- Recent activity feed
- My pending tasks

**UI Layout**:

```
┌──────────────────────────────────────────────────────────┐
│  GHI Dashboard                            [User ▾]        │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │
│  │ Total  │ │Pending │ │ Under  │ │Escalate│           │
│  │ 247    │ │   18   │ │   12   │ │    3   │           │
│  └────────┘ └────────┘ └────────┘ └────────┘           │
│                                                           │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │ Signals (30d)    │  │ Top Countries    │             │
│  │ [Line Chart]     │  │ 1. Nigeria   45  │             │
│  │                  │  │ 2. India     32  │             │
│  └──────────────────┘  └──────────────────┘             │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │  World Map - Signal Distribution                 │    │
│  │  [Interactive map with markers]                  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  ┌───────────────────┐  ┌──────────────────┐            │
│  │ Recent Signals    │  │ My Tasks         │            │
│  │ • Ebola - DRC     │  │ ☐ 5 Assessments │            │
│  │ • Cholera - Yemen │  │ ☐ 2 Reviews     │            │
│  └───────────────────┘  └──────────────────┘            │
└──────────────────────────────────────────────────────────┘
```

---

### View 2: Signals Triage

**Purpose**: Review pending Beacon signals and accept/reject

**Features**:
- Professional card display
- Priority-based sorting
- Filtering (priority, country, disease)
- Quick actions (Accept/Reject)
- Batch selection
- Direct link to Beacon source

**UI Design**:

```
┌──────────────────────────────────────────────────────────┐
│  Signals Triage                  [Filters ▾] [Search 🔍]  │
├──────────────────────────────────────────────────────────┤
│  Status: [Pending ▾]  Priority: [All ▾]  Country: [All ▾]│
│  18 signals pending triage                                │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔴 CRITICAL              From: WHO Beacon       │    │
│  │ Ebola Virus Disease                      NEW    │    │
│  │ Democratic Republic of the Congo - North Kivu   │    │
│  │                                                   │    │
│  │ Cases: 12  Deaths: 5  CFR: 41.7%                │    │
│  │ Reported: 2026-01-20  |  Priority: 89/100       │    │
│  │                                                   │    │
│  │ Health authorities report cluster of cases...    │    │
│  │                                                   │    │
│  │ [🗑️ Reject]  [✓ Accept]  [👁️ View Beacon]      │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🟠 HIGH                  From: WHO Beacon       │    │
│  │ Cholera                                  NEW    │    │
│  │ Yemen - Taiz Governorate                        │    │
│  │ [Actions...]                                     │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

### View 3: Assessment

**Purpose**: Conduct IHR Annex 2 or RRA assessments

#### A. IHR Annex 2 Form

```
┌──────────────────────────────────────────────────────────┐
│  Assessment - IHR Annex 2 Decision Instrument            │
├──────────────────────────────────────────────────────────┤
│  Signal: Ebola - DRC | Cases: 12 | Deaths: 5             │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Question 1                                       │    │
│  │ Is the public health impact serious?            │    │
│  │  ○ Yes   ○ No   ○ Unknown                       │    │
│  │  Notes: [text area]                             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  [Questions 2-4 similar structure]                       │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔴 DECISION: NOTIFY WHO under IHR (2005)       │    │
│  │ (2 or more YES answers)                         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  [📁 Archive]  [⚠️ Escalate to Director]                │
│  [Save Draft]  [Submit Assessment]                       │
└──────────────────────────────────────────────────────────┘
```

#### B. RRA Form (Tabbed Interface)

```
┌──────────────────────────────────────────────────────────┐
│  Assessment - Rapid Risk Assessment                      │
├──────────────────────────────────────────────────────────┤
│  [Hazard]  [Exposure]  [Context]  [Summary] ← Tabs      │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ HAZARD ASSESSMENT                                │    │
│  │ Pathogen Characteristics: [textarea]             │    │
│  │ Severity: CFR [2.0]% Hospitalization [30]%      │    │
│  │ Transmissibility: ☑Water ☑Food ☐Person-person  │    │
│  │ Countermeasures: ☑ORS ☑Antibiotics ☑Vaccine    │    │
│  │ Evidence Quality: ○High ●Moderate ○Low          │    │
│  └─────────────────────────────────────────────────┘    │
│  [Next: Exposure →]                                      │
└──────────────────────────────────────────────────────────┘
```

---

### View 4: Escalation (Director View)

**Purpose**: Director reviews and acts on escalated signals

```
┌──────────────────────────────────────────────────────────┐
│  Escalations - Director Review    Dr. Fatima Al-Rashid   │
├──────────────────────────────────────────────────────────┤
│  Priority: [All ▾]  Status: [Pending ▾]                  │
│  3 escalations requiring review                           │
│                                                           │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔴 CRITICAL         Escalated: 2 hours ago      │    │
│  │ MERS-CoV - Saudi Arabia - Riyadh                │    │
│  │                                                   │    │
│  │ SIGNAL: Cases 8 (5 HCW) | Deaths 2 | CFR 25%   │    │
│  │                                                   │    │
│  │ RRA ASSESSMENT: Very High Risk                   │    │
│  │ • Nosocomial transmission confirmed             │    │
│  │ • 5 healthcare worker infections                │    │
│  │ • Dromedary camel exposure                      │    │
│  │                                                   │    │
│  │ Recommendations:                                 │    │
│  │ • Activate hospital outbreak protocol           │    │
│  │ • Enhanced IPC measures                         │    │
│  │ • WHO notification under IHR                    │    │
│  │                                                   │    │
│  │ ┌───────────────────────────────────────────┐  │    │
│  │ │ DIRECTOR DECISION                          │  │    │
│  │ │ ○ Approve & Take Action                   │  │    │
│  │ │ ○ Request More Info                       │  │    │
│  │ │ ○ Reject                                  │  │    │
│  │ │                                            │  │    │
│  │ │ Actions to Take:                          │  │    │
│  │ │ ☐ Activate EOC                           │  │    │
│  │ │ ☐ Notify WHO                             │  │    │
│  │ │ ☐ Issue national alert                   │  │    │
│  │ │ ☐ Convene expert committee               │  │    │
│  │ │                                            │  │    │
│  │ │ Notes: [textarea]                         │  │    │
│  │ │ [Submit Decision]                         │  │    │
│  │ └───────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## Backend Implementation (FastAPI)

### Project Structure

```
backend/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── api/v1/
│   │   ├── auth.py
│   │   ├── signals.py
│   │   ├── assessments.py
│   │   ├── escalations.py
│   │   └── dashboard.py
│   ├── models/
│   │   ├── signal.py
│   │   ├── assessment.py
│   │   └── user.py
│   ├── services/
│   │   ├── beacon_collector.py
│   │   └── priority_scorer.py
│   └── workers/
│       └── tasks.py
├── requirements.txt
└── Dockerfile
```

### Key Service: Beacon Collector

```python
# app/services/beacon_collector.py

from typing import List, Dict
import httpx
from bs4 import BeautifulSoup
from app.models.signal import Signal
from sqlalchemy.orm import Session

class BeaconCollector:
    """Collect events from WHO Beacon"""
    
    def __init__(self, db: Session):
        self.db = db
        self.base_url = "https://beaconbio.org/en"
    
    async def fetch_events(self) -> List[Dict]:
        """Scrape recent events from Beacon"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/events")
            soup = BeautifulSoup(response.text, 'html.parser')
            
            events = []
            # Parse event cards (adjust selectors based on actual HTML)
            for card in soup.select('.event-card'):
                events.append({
                    'disease': card.select_one('.disease').text,
                    'country': card.select_one('.country').text,
                    'cases': int(card.select_one('.cases').text),
                    'deaths': int(card.select_one('.deaths').text),
                    'description': card.select_one('.desc').text,
                    'url': self.base_url + card.select_one('a')['href']
                })
            
            return events
    
    def process_events(self, events: List[Dict]) -> List[Signal]:
        """Convert Beacon events to signals"""
        signals = []
        for event in events:
            if not self._is_duplicate(event):
                signal = Signal(**event)
                signal.priority_score = self._calculate_priority(signal)
                signals.append(signal)
        return signals
```

---

## Frontend Implementation (React + TypeScript)

### Key Components

```typescript
// src/components/SignalCard.tsx
interface SignalCardProps {
  signal: Signal;
  onAccept: () => void;
  onReject: (reason: string) => void;
}

export const SignalCard: React.FC<SignalCardProps> = ({
  signal, onAccept, onReject
}) => {
  return (
    <div className="border rounded-lg p-6">
      <div className="flex justify-between">
        <h3>{signal.disease}</h3>
        <Badge>{signal.saudi_risk_level}</Badge>
      </div>
      
      <p>{signal.country} - {signal.location}</p>
      
      <div className="flex gap-4">
        <span>Cases: {signal.cases}</span>
        <span>Deaths: {signal.deaths}</span>
        <span>CFR: {signal.case_fatality_rate}%</span>
      </div>
      
      <p className="text-gray-700">{signal.description}</p>
      
      <div className="flex gap-3 mt-4">
        <Button onClick={() => onReject('...')}>Reject</Button>
        <Button onClick={onAccept}>Accept</Button>
        <Button onClick={() => window.open(signal.source_url)}>
          View Beacon
        </Button>
      </div>
    </div>
  );
};
```

---

## API Endpoints

```python
# GET /api/signals/pending-triage
# Get signals awaiting triage

# POST /api/signals/{id}/triage
# Accept or reject signal
# Body: {"action": "accept"|"reject", "notes": "..."}

# POST /api/assessments
# Create new assessment
# Body: {"signal_id": "...", "assessment_type": "IHR Annex 2"|"RRA"}

# PATCH /api/assessments/{id}
# Update assessment (save progress)

# POST /api/assessments/{id}/complete
# Complete assessment and archive or escalate
# Body: {"outcome": "archive"|"escalate", "justification": "..."}

# GET /api/escalations/pending
# Get escalations for director review

# POST /api/escalations/{id}/decision
# Director decision on escalation
# Body: {"decision": "approve"|"reject", "actions": [...], "notes": "..."}
```

---

## Deployment

```yaml
# docker-compose.yml
services:
  web:
    build: ./frontend
    ports: ["3000:3000"]
  
  api:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      - DATABASE_URL=${NEON_DATABASE_URL}
  
  worker:
    build: ./backend
    command: celery -A app.workers worker
```

```bash
# .env
NEON_DATABASE_URL=postgresql://...@neon.tech/ghi
BEACON_POLL_INTERVAL=15  # minutes
```

---

## Development Phases

1. **Week 1-2**: Database setup + Beacon collector
2. **Week 3-4**: Backend APIs + Authentication
3. **Week 5-6**: Frontend Views (Dashboard + Triage)
4. **Week 7-8**: Assessment forms (IHR + RRA)
5. **Week 9-10**: Escalation workflow + Director view
6. **Week 11-12**: Testing + Deployment

---

## Success Metrics

- Beacon sync time: < 5 minutes
- Signal triage time: < 10 minutes per signal
- Assessment completion: < 4 hours
- Director escalation review: < 2 hours
- System uptime: 99.9%

---

**Ready for Development!**

This focused specification provides everything needed to build a production-ready GHI system powered by WHO Beacon.
