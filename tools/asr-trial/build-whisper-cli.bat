@echo off
REM Builds whisper-cli.exe from the whisper.cpp source, for the speech recognition trial (docs/decisions/0002-speech-recognition.md).
REM Uses the CMake, Ninja and C++ compiler that come with Visual Studio 2026 Professional; change the two paths below for another edition.
REM The source is in %TRIAL%\source\whisper.cpp (git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git). CPU only: no graphics card code is built.
REM -DGGML_NATIVE=ON (the default) makes a program for THIS computer's processor; a program to give to other people needs a generic build.

if "%TRIAL%"=="" set "TRIAL=D:\Whisper-Trial"
set "VS=C:\Program Files\Microsoft Visual Studio\18\Professional"
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
set "PATH=%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%VS%\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%PATH%"
cmake -S "%TRIAL%\source\whisper.cpp" -B "%TRIAL%\build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DGGML_CUDA=OFF -DGGML_VULKAN=OFF -DWHISPER_SDL2=OFF -DBUILD_SHARED_LIBS=OFF
if errorlevel 1 exit /b 1
cmake --build "%TRIAL%\build" --target whisper-cli -j 16
