@echo off
REM Double-click to run the validator tests and validate the example projects.
REM minimal.osproj should report no errors. broken.osproj is meant to fail.

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on this PC.
  echo.
  echo Install it from https://www.python.org/downloads/ and tick
  echo "Add python.exe to PATH" on the first screen of the installer.
  echo.
  pause
  exit /b 1
)

python -c "import jsonschema" >nul 2>nul
if errorlevel 1 (
  echo The validator needs a small Python package called jsonschema.
  echo Installing it for your user account only. Nothing else is changed.
  echo.
  python -m pip install --user jsonschema
  echo.
)

echo === Validator tests ===
python tools\test_validate.py
python tools\test_migrate.py
echo.
echo === minimal.osproj (should have no errors) ===
python tools\validate.py examples\minimal.osproj
echo.
echo === branching.osproj (should have no errors) ===
python tools\validate.py examples\branching.osproj
echo.
echo === interactions.osproj (should have no errors) ===
python tools\validate.py examples\interactions.osproj
echo.
echo === lms-test-lesson.osproj (should have no errors) ===
python tools\validate.py examples\lms-test-lesson.osproj
echo.
echo === broken.osproj (should have errors) ===
python tools\validate.py examples\broken.osproj
echo.
pause
