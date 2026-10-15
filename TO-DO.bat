@echo off
REM Double-click to open the to-do list as check boxes you can tick, in your web browser.
REM The list is made from ROADMAP.md each time, so it is always today's. Your ticks are remembered by the browser.
REM Close this window to stop it.

setlocal
cd /d "%~dp0"

set "PY=python"
if defined OPENSTAGE_PYTHON set "PY=%OPENSTAGE_PYTHON%"

"%PY%" --version >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH". Then run this again.
  echo.
  pause
  exit /b 1
)

"%PY%" tools\make_todo.py
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
echo Opening the to-do list in your browser. Close this window when you are done with it.
REM A web address, not the file itself, so it opens in the browser rather than whatever program .html files use.
start "" "http://127.0.0.1:8766/"
cd dist\todo
"%PY%" -m http.server 8766 --bind 127.0.0.1
