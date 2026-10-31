@echo off
REM Double-click to try the published example against a stand-in xAPI learning record store (LRS).
REM Run PUBLISH EXAMPLE.bat first. Close this window when you are finished.
REM The course and the store run on two different ports on this computer, as they would on two different sites.
REM Note: this is a test aid. The real test is against a real LRS (a SCORM Cloud trial, Learning Locker, or a school's own).

setlocal
cd /d "%~dp0"

if not exist "dist\minimal\index.html" (
  echo Nothing published yet. Run PUBLISH EXAMPLE.bat first.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo Starting the stand-in LRS: the course on port 8765, the store on port 8766. Close this window to stop them.
start "" "http://127.0.0.1:8765/_xapi-test.html"
cd player
node stand-in-xapi.ts ..\dist --course minimal --port 8765 --lrs-port 8766
