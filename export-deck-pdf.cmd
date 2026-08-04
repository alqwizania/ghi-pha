@echo off
REM ---------------------------------------------------------------------------
REM Re-export the executive deck to PDF.
REM
REM The deck shows one slide at a time, so printing it unchanged yields a single
REM page. The @media print block in the HTML turns every slide back into its own
REM 16:9 page; this just drives a headless browser over it.
REM
REM Run this after any edit to GHI_Documentation_Slideshow.html so the PDF and
REM the HTML never drift apart.
REM ---------------------------------------------------------------------------
setlocal
set "DECK=%~dp0GHI_Documentation_Slideshow.html"
set "OUT=%~dp0GHI_Executive_Deck.pdf"

set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%BROWSER%" (
  echo Could not find Chrome or Edge. Open the deck and use Ctrl+P instead.
  exit /b 1
)

echo Exporting to %OUT% ...
"%BROWSER%" --headless --disable-gpu --no-sandbox ^
  --run-all-compositor-stages-before-draw --virtual-time-budget=6000 ^
  --print-to-pdf-no-header --print-to-pdf="%OUT%" "file:///%DECK:\=/%"

if exist "%OUT%" (echo Done.) else (echo Export failed.)
endlocal
