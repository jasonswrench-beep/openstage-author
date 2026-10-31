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

REM Narration is made by Kokoro, a speech engine that is installed separately (see docs/narration-setup.md).
REM Where it is on this computer is written once in local-settings.bat (local-settings.example.bat shows how). If it is not there, the course still publishes, with transcripts but no audio.
if exist "%~dp0local-settings.bat" call "%~dp0local-settings.bat"

echo === Python tests ===
python tools\test_validate.py
if errorlevel 1 goto :failed
python tools\test_narrate.py
if errorlevel 1 goto :failed
python tools\test_engines.py
if errorlevel 1 goto :failed
python tools\test_todo.py
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
echo The packages are dist\minimal-scorm12.zip, dist\minimal-scorm2004.zip and dist\minimal-xapi.zip
echo (upload the one your LMS or learning record store asks for).
echo Use TEST WITH STAND-IN LMS.bat to try SCORM tracking and resume without an LMS,
echo and TEST WITH STAND-IN LRS.bat to try xAPI.
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
