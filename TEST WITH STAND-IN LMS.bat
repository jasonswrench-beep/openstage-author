@echo off
REM Double-click to try the published example in a stand-in SCORM LMS (1.2, or 2004 by the link on the page).
REM Run PUBLISH EXAMPLE.bat first. Close this window when you are finished.
REM For xAPI, use TEST WITH STAND-IN LRS.bat instead.
REM Note: this is a test aid. The real tests are in Moodle, Canvas and Brightspace.

setlocal
cd /d "%~dp0"

if not exist "dist\minimal\_scorm-test.html" (
  echo Nothing published yet. Run PUBLISH EXAMPLE.bat first.
  echo.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo.
  pause
  exit /b 1
)

echo Starting a local web server on port 8765. Close this window to stop it.
start "" "http://127.0.0.1:8765/minimal/_scorm-test.html"
cd dist
python -m http.server 8765 --bind 127.0.0.1
