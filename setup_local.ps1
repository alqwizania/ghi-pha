# GHI System Local Setup Script (Windows PowerShell)

Write-Host "--- Initializing GHI System Local Test ---" -ForegroundColor Cyan

# 1. Backend Setup
Write-Host "`n[1/3] Setting up Backend..." -ForegroundColor Yellow
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Write-Host "Backend dependencies installed." -ForegroundColor Green
cd ..

# 2. Frontend Setup
Write-Host "`n[2/3] Setting up Frontend..." -ForegroundColor Yellow
cd frontend
npm install
Write-Host "Frontend dependencies installed." -ForegroundColor Green
cd ..

# 3. How to Run
Write-Host "`n[3/3] Setup Complete!" -ForegroundColor Green
Write-Host "`nTo run the system, you will need TWO terminal windows:" -ForegroundColor Cyan

Write-Host "`nWINDOW 1 (Backend):" -ForegroundColor White
Write-Host "cd backend"
Write-Host ".\venv\Scripts\Activate.ps1"
Write-Host "python -m uvicorn app.main:app --reload"

Write-Host "`nWINDOW 2 (Frontend):" -ForegroundColor White
Write-Host "cd frontend"
Write-Host "npm run dev"

Write-Host "`nNote: The backend will automatically create 'ghi_system.db' (SQLite) if no DATABASE_URL is provided." -ForegroundColor Gray
