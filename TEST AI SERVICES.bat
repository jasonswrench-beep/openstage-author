@echo off
REM Double-click to try the AI services for real, with your own keys.
REM It asks before each service, says what it sends and that it costs a small amount,
REM never shows or saves your key, and keeps what it makes in dist\live-test.
REM Free checks (publishing sends nothing, the example plugin works) run first.

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

set PYTHONIOENCODING=utf-8
"%PY%" tools\live_test.py
set RESULT=%ERRORLEVEL%
echo.
if "%RESULT%"=="0" (
  echo Finished. Everything that was tried worked.
) else (
  echo Finished, but something did not work. Open dist\live-test\live-test-results.txt
  echo and send it back, and say what you saw.
)
echo.
pause
exit /b %RESULT%
