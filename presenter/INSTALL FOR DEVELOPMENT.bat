@echo off
setlocal
chcp 65001 >nul
title OpenStage Presenter add-on - install for development
cd /d "%~dp0"

echo.
echo ============================================================
echo   OpenStage Presenter: build the add-on and put it where
echo   OpenStage Author looks for add-ons
echo ============================================================
echo.
echo This builds openstage-presenter.exe from the source code in this folder
echo and copies it, with addon.json, to
echo   %LOCALAPPDATA%\OpenStage\addons\presenter
echo Nothing else on the computer is changed and no administrator rights are
echo needed. The first build can take a minute or two. A full log is saved
echo here as build-log.txt.
echo.

call "%~dp0..\capture\rust-setup.bat"
if errorlevel 1 goto no_rust

if exist "build-log.txt" del "build-log.txt"
call "%~dp0..\capture\cargo-run.bat" "build-log.txt" build --release
if errorlevel 1 goto failed

set "DEST=%LOCALAPPDATA%\OpenStage\addons\presenter"
if not exist "%DEST%" mkdir "%DEST%"
copy /y "%~dp0target\release\openstage-presenter.exe" "%DEST%\" >nul
if errorlevel 1 goto failed
copy /y "%~dp0addon.json" "%DEST%\" >nul
if errorlevel 1 goto failed

echo.
echo ------------------------------------------------------------
echo The add-on is installed in:
echo   %DEST%
echo.
echo It is not signed yet, so OpenStage Author shows Insert, Presenter only
echo while the setting OPENSTAGE_DEV_ADDONS=1 is on, and only in an editor
echo built for development (OPEN EDITOR.bat builds one). The script
echo   OPEN EDITOR WITH PRESENTER.bat
echo in this folder opens the editor with that setting on.
echo ------------------------------------------------------------
echo.
pause
exit /b 0

:no_rust
echo.
echo Rust was not found on this computer, and the add-on is built with it.
echo See capture\README.md for how to set it up, then run this again.
echo.
pause
exit /b 1

:failed
echo.
echo The build did not work. The log build-log.txt in this folder says why.
echo.
pause
exit /b 1
