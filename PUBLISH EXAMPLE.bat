@echo off
REM Double-click to publish examples\minimal.osproj as a web page and open it.
REM Output goes to dist\minimal\ (not saved to version control).
REM The first run generates narration audio, which can take a minute.

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org
  echo then close this window and run it again.
  echo.
  pause
  exit /b 1
)
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH". Then run this again.
  echo.
  pause
  exit /b 1
)

python -c "import jsonschema" >nul 2>nul
if errorlevel 1 (
  echo Installing the jsonschema Python package for your user account...
  python -m pip install --user jsonschema
  echo.
)

REM Narration needs Kokoro, which lives in the Audiobook Studio Python on this PC.
REM If it is not found, the course still publishes, with transcripts but no audio.
if not defined OPENSTAGE_KOKORO_PYTHON (
  if exist "D:\Claude Audio Test\.venv\Scripts\python.exe" set "OPENSTAGE_KOKORO_PYTHON=D:\Claude Audio Test\.venv\Scripts\python.exe"
)

echo === Python tests ===
python tools\test_validate.py
if errorlevel 1 goto :failed
python tools\test_narrate.py
if errorlevel 1 goto :failed
python tools\test_migrate.py
if errorlevel 1 goto :failed
echo.

pushd player
if not exist node_modules (
  echo First run: installing the player's build tools. This takes a minute.
  call npm install
  echo.
)

echo === Player checks ===
call npm run typecheck
if errorlevel 1 goto :failed
call npm test
if errorlevel 1 goto :failed

echo.
echo === Publishing ===
node publish.ts ..\examples\minimal.osproj ..\dist\minimal
if errorlevel 1 goto :failed
popd

echo.
echo The SCORM 1.2 package is dist\minimal-scorm12.zip (upload this to an LMS).
echo Use TEST WITH STAND-IN LMS.bat to try tracking and resume without an LMS.
echo.
echo Opening the published course in your browser.
start "" "%~dp0dist\minimal\index.html"
echo.
pause
exit /b 0

:failed
popd
echo.
echo Something failed. Scroll up to see what.
echo.
pause
exit /b 1
