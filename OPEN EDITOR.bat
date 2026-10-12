@echo off
REM Double-click to open the OpenStage editor.
REM The first run builds it, which takes a few minutes. After that it opens at once.

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. The editor uses it to check your course for problems.
  echo Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
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

REM Preview and Publish run the player's build tool, which needs its packages. Install them once.
where node >nul 2>nul
if not errorlevel 1 (
  if not exist "%~dp0player\node_modules" (
    echo Installing the build tools that Preview and Publish use. This takes a minute.
    pushd "%~dp0player"
    call npm install
    popd
    echo.
  )
)

REM Narration is made by Kokoro, which lives in the Audiobook Studio Python on this PC.
REM If it is not found, Publish still works: the course has transcripts but no new audio.
if not defined OPENSTAGE_KOKORO_PYTHON (
  if exist "D:\Claude Audio Test\.venv\Scripts\python.exe" set "OPENSTAGE_KOKORO_PYTHON=D:\Claude Audio Test\.venv\Scripts\python.exe"
)

set "EXE=%~dp0editor\src-tauri\target\release\openstage-editor.exe"

if exist "%EXE%" goto :run

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org, then run this again.
  echo.
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo Rust was not found. Install it from https://rustup.rs, restart this window, then run this again.
  echo.
  pause
  exit /b 1
)

echo First run: building the editor. This takes a few minutes.
pushd editor
if not exist node_modules call npm install
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
call npx tauri build --no-bundle
if errorlevel 1 goto :failed
popd

:run
if not exist "%EXE%" (
  echo The editor was not built. Scroll up to see why.
  pause
  exit /b 1
)
start "" "%EXE%"
exit /b 0

:failed
popd
echo.
echo Something failed. Scroll up to see what.
echo.
pause
exit /b 1
