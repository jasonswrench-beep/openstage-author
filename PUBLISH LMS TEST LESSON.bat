@echo off
REM Double-click to rebuild everything for the real LMS test, in one folder: dist\lms-test-pack
REM It holds the Brightspace test lesson (examples\lms-test-lesson.osproj) and the question-types course as SCORM 1.2, SCORM 2004 and xAPI packages (six zips),
REM with LMS-START-HERE.md, the test plans and the results sheet. Open LMS-START-HERE.md first.
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

echo === Publishing the test lesson (SCORM 1.2, SCORM 2004, xAPI) ===
echo Making narration audio can take a few minutes the first time.
node publish.ts ..\examples\lms-test-lesson.osproj ..\dist\lms-test-lesson --targets=scorm12,scorm2004,xapi
if errorlevel 1 goto :failed

echo.
echo === Publishing the question-types course (SCORM 1.2, SCORM 2004, xAPI) ===
node publish.ts ..\examples\question-types.osproj ..\dist\question-types --targets=scorm12,scorm2004,xapi
if errorlevel 1 goto :failed

echo.
echo === Putting the test pack together ===
node tools\lms-pack.mjs
if errorlevel 1 goto :failed
popd

echo.
echo Done. Everything for the LMS test is in dist\lms-test-pack. Start with LMS-START-HERE.md.
echo Opening the folder.
start "" explorer "%~dp0dist\lms-test-pack"
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
