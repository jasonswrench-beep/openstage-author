@echo off
setlocal
chcp 65001 >nul
title OpenStage Presenter add-on - test the engine host
cd /d "%~dp0"

echo.
echo ============================================================
echo   OpenStage Presenter: test the engine host
echo ============================================================
echo.
echo This runs the program's own tests (listening to made-up sounds and
echo choosing mouth shapes, reading audio files, answering requests) and the
echo rules check (licences of what it is built from, no FFmpeg, no em dashes).
echo A full log is saved here as test-log.txt.
echo.

call "%~dp0..\capture\rust-setup.bat"
if errorlevel 1 goto no_rust

if exist "test-log.txt" del "test-log.txt"
call "%~dp0..\capture\cargo-run.bat" "test-log.txt" test
if errorlevel 1 goto failed
findstr /c:"test result:" "test-log.txt"

python "%~dp0tools\check_rules.py"
if errorlevel 1 goto failed

echo.
echo ------------------------------------------------------------
echo Everything passed.
echo ------------------------------------------------------------
echo.
pause
exit /b 0

:no_rust
echo.
echo Rust was not found on this computer. See capture\README.md.
echo.
pause
exit /b 1

:failed
echo.
echo Something did not pass. The lines above, and test-log.txt in this folder, say what.
echo.
pause
exit /b 1
