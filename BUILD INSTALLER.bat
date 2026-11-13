@echo off
REM Double-click to build the OpenStage Author installer (one setup .exe, in dist\installer).
REM Add the word  trial  after the name to build a copy that installs under its own name, for trying the installer without touching the real program.
REM The first run downloads Python, Node and the installer maker. It needs the recorder (OPEN EDITOR.bat builds it) and the speech recogniser (BUILD SPEECH RECOGNISER.bat).

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)
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
if not exist "%~dp0editor\node_modules" (
  pushd editor
  call npm ci
  popd
)
if not exist "%~dp0player\node_modules" (
  pushd player
  call npm ci
  popd
)

if /i "%~1"=="trial" (
  python tools\build_installer.py --trial
) else (
  python tools\build_installer.py
)
if errorlevel 1 (
  echo.
  echo Something failed. Scroll up to see what.
  echo.
  pause
  exit /b 1
)
echo.
pause
exit /b 0
