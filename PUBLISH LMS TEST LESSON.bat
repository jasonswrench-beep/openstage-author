@echo off
REM Double-click to rebuild the Brightspace test lesson (examples\lms-test-lesson.osproj) as a SCORM 1.2 package.
REM The package is dist\lms-test-lesson-scorm12.zip. Upload that to your LMS. Read
REM examples\lms-test-lesson.osproj\LMS-TEST-PLAN.md for what to try and what to look for.
REM Narration audio is made with Kokoro if it can be found, and audio already made is reused.

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
REM Where it is on this computer is written once in local-settings.bat (local-settings.example.bat shows how). If it is not there, the course still publishes, with transcripts but no new audio.
if exist "%~dp0local-settings.bat" call "%~dp0local-settings.bat"

pushd player
if not exist node_modules (
  echo First run: installing the player's build tools. This takes a minute.
  call npm install
  echo.
)

echo === Publishing the test lesson ===
echo Making narration audio can take a few minutes the first time.
node publish.ts ..\examples\lms-test-lesson.osproj ..\dist\lms-test-lesson
if errorlevel 1 goto :failed
popd

echo.
echo Done. The SCORM 1.2 package is dist\lms-test-lesson-scorm12.zip
echo Opening the dist folder.
start "" explorer "%~dp0dist"
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
