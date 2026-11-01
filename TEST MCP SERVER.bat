@echo off
REM Double-click to test the MCP server that lets an AI assistant use OpenStage Author.
REM It starts the real server and talks to it the way an assistant does: refused while MCP is off, a course built in a scratch folder,
REM nothing written outside that folder. It needs Node.js, and Python for the checks that publish and translate.
REM Nothing here touches your own projects or your settings, and it makes no sound.

setlocal
cd /d "%~dp0mcp"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not defined OPENSTAGE_PYTHON (
  where python >nul 2>nul
  if not errorlevel 1 set OPENSTAGE_PYTHON=python
)

echo Testing the MCP server...
echo.
node --test test/protocol.test.ts test/files.test.ts test/settings.test.ts test/tools.test.ts test/server.test.ts
set RESULT=%ERRORLEVEL%
echo.
if %RESULT%==0 (
  echo All the checks passed.
) else (
  echo Something did not pass. Scroll up to see what.
)
echo.
pause
exit /b %RESULT%
