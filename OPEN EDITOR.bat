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
    call npm ci
    popd
    echo.
  )
)

REM Narration is made by Kokoro, a speech engine that is installed separately (see docs/narration-setup.md).
REM Where it is on this computer is written once in local-settings.bat (local-settings.example.bat shows how). If it is not there, Publish still works: the course has transcripts but no new audio.
if exist "%~dp0local-settings.bat" call "%~dp0local-settings.bat"

set "EXE=%~dp0editor\src-tauri\target\release\openstage-editor.exe"

REM A program built before the editor's files last changed is out of date: it opens without the newest buttons and fixes.
REM If any of the editor's files is newer than the program, build it again.
if exist "%EXE%" (
  powershell -NoProfile -Command "$e=(Get-Item -LiteralPath $env:EXE).LastWriteTime; $n=(Get-ChildItem editor\src,editor\web,editor\src-tauri\src,editor\src-tauri\tauri.conf.json,player\src -Recurse -File | Measure-Object -Property LastWriteTime -Maximum).Maximum; if ($n -gt $e) { exit 1 }"
  if not errorlevel 1 goto :run
  echo The editor has changed since it was last built, so it is being built again. This takes a minute or two.
  echo.
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

echo First run: building the editor. This takes a few minutes.
pushd editor
if not exist node_modules call npm ci
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
call :build_recorder
start "" "%EXE%"
exit /b 0

:failed
popd
echo.
echo Something failed. Scroll up to see what.
echo.
pause
exit /b 1

:build_recorder
REM OpenScreen, the screen recorder, is a separate program that the editor starts. It is built from the capture folder,
REM and the editor looks for it in capture\target\release. The editor opens whether or not this works.
if not exist "%~dp0capture\Cargo.toml" exit /b 0
set "REC=%~dp0capture\target\release\openstage-capture.exe"
if exist "%REC%" (
  powershell -NoProfile -Command "$e=(Get-Item -LiteralPath $env:REC).LastWriteTime; $n=(Get-ChildItem capture\crates,capture\Cargo.toml,capture\Cargo.lock -Recurse -File | Measure-Object -Property LastWriteTime -Maximum).Maximum; if ($n -gt $e) { exit 1 }"
  if not errorlevel 1 exit /b 0
  echo The screen recorder has changed since it was last built, so it is being built again. This takes a few minutes.
) else (
  echo Building the screen recorder for the first time. This takes a few minutes.
)
echo.
call "%~dp0capture\rust-setup.bat"
if errorlevel 1 (
  echo Rust was not found, so the screen recorder was not built. The editor opens anyway, and recording will say the recorder is not installed.
  echo.
  exit /b 0
)
if exist "%~dp0capture\build-log.txt" del "%~dp0capture\build-log.txt"
pushd "%~dp0capture"
call "%~dp0capture\cargo-run.bat" "%~dp0capture\build-log.txt" build --release -p openstage-capture-cli
set "REC_RESULT=%errorlevel%"
popd
if not "%REC_RESULT%"=="0" (
  echo The screen recorder could not be built, so recording is not available this time. The editor opens anyway.
  echo What went wrong is written in capture\build-log.txt.
  echo.
)
exit /b 0
