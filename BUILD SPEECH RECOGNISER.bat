@echo off
REM Double-click to build the speech recogniser that the captions window uses to write captions from a recorded voice.
REM It is a separate program, whisper.cpp (MIT licence), and it is not part of the editor. Nothing is sent anywhere when it runs.
REM This needs git and Visual Studio's C++ tools with CMake. It downloads the program's source (about 20 MB) from github.com once, and builds it into the "speech" folder.
REM The speech models themselves (148 MB and 488 MB) are NOT downloaded here: the captions window offers them, and asks first.

setlocal
cd /d "%~dp0"

set "TAG=v1.9.5"
set "COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037"
set "SRC=%~dp0speech\source\whisper.cpp"
set "BUILD=%~dp0speech\build"
set "OUT=%~dp0speech"

echo This builds the speech recogniser (whisper.cpp %TAG%) into the "speech" folder.
echo.
if exist "%OUT%\whisper-cli.exe" (
  echo It is already built: %OUT%\whisper-cli.exe
  echo To build it again, delete the "speech" folder first.
  echo.
  pause
  exit /b 0
)

where git >nul 2>nul
if errorlevel 1 (
  echo git was not found. Install it from https://git-scm.com/download/win and run this again.
  echo.
  pause
  exit /b 1
)

REM Visual Studio's C++ tools, found the way Microsoft's own tools find them.
set "VSROOT="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSROOT=%%i"
)
if not defined VSROOT (
  echo Visual Studio's C++ tools were not found. In the Visual Studio Installer, add "Desktop development with C++"
  echo and "C++ CMake tools for Windows", then run this again.
  echo.
  pause
  exit /b 1
)
call "%VSROOT%\VC\Auxiliary\Build\vcvars64.bat" >nul 2>nul
if errorlevel 1 (
  echo Visual Studio's C++ tools could not be started. Open the Visual Studio Installer and repair it, then run this again.
  echo.
  pause
  exit /b 1
)
set "VSCMAKE=%VSROOT%\Common7\IDE\CommonExtensions\Microsoft\CMake"
set "PATH=%VSCMAKE%\CMake\bin;%VSCMAKE%\Ninja;%PATH%"
where cmake >nul 2>nul
if errorlevel 1 (
  echo CMake was not found. In the Visual Studio Installer, add "C++ CMake tools for Windows", then run this again.
  echo.
  pause
  exit /b 1
)
where ninja >nul 2>nul
if errorlevel 1 (
  echo Ninja was not found. In the Visual Studio Installer, add "C++ CMake tools for Windows", then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "%SRC%\CMakeLists.txt" (
  echo Downloading the source of whisper.cpp %TAG% from https://github.com/ggml-org/whisper.cpp ...
  git clone --depth 1 --branch %TAG% https://github.com/ggml-org/whisper.cpp.git "%SRC%"
  if errorlevel 1 (
    echo The download did not work. Check the internet connection and run this again.
    echo.
    pause
    exit /b 1
  )
)

REM It must be exactly the version that was tested.
set "GOT="
for /f %%h in ('git -C "%SRC%" rev-parse HEAD') do set "GOT=%%h"
if /i not "%GOT%"=="%COMMIT%" (
  echo The source in "%SRC%" is not the version that was tested ^(%TAG%, %COMMIT%^). It is %GOT%.
  echo Delete the "speech\source" folder and run this again.
  echo.
  pause
  exit /b 1
)

echo.
echo Building. This takes a few minutes.
echo.
REM Any computer: the processor-specific parts are separate files, and the one that suits the computer is chosen when it runs.
REM Only the processor is used (no graphics card), and the C++ runtime is built in, so nothing else has to be installed.
cmake -S "%SRC%" -B "%BUILD%" -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DWHISPER_SDL2=OFF -DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_NATIVE=OFF -DGGML_CPU_ALL_VARIANTS=ON -DGGML_OPENMP=OFF -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DCMAKE_POLICY_DEFAULT_CMP0091=NEW
if errorlevel 1 goto :failed
cmake --build "%BUILD%" --target whisper-cli -j 8
if errorlevel 1 goto :failed

copy /y "%BUILD%\bin\*.exe" "%OUT%\" >nul
copy /y "%BUILD%\bin\*.dll" "%OUT%\" >nul
if not exist "%OUT%\whisper-cli.exe" goto :failed
copy /y "%SRC%\LICENSE" "%OUT%\whisper.cpp-LICENSE.txt" >nul

echo.
echo Done. The speech recogniser is in %OUT%
echo Open OpenStage Author, then "Write captions..." on a video: it can listen to the voice and write the captions.
echo The first time, the captions window asks before it downloads a speech model.
echo.
pause
exit /b 0

:failed
echo.
echo The build did not work. The messages above say why. If they do not help, ask for help with the last lines of them.
echo.
pause
exit /b 1
