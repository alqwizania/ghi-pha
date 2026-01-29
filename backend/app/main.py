from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.database import engine, Base

# Create tables (for local development, ideally use Alembic for production)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Global Health Intelligence (GHI) System")

# CORS Configuration for Frontend (e.g., Cloudflare Pages)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust to specific domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"status": "GHI System API is running"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

# Future routers
from app.api.v1 import signals, assessments, escalations
# from app.api.v1 import auth
# app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(signals.router, prefix="/api/v1/signals", tags=["Signals"])
app.include_router(assessments.router, prefix="/api/v1/assessments", tags=["Assessments"])
app.include_router(escalations.router, prefix="/api/v1/escalations", tags=["Escalations"])
