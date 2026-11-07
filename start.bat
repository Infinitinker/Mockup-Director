@echo off
rem Starts Mockup Director from this checkout, without building an installer: the desktop app with
rem hot reload (npm run app:dev). Close the app or this window to stop it. Node.js and Rust must be
rem installed first, on Windows with MSYS2's MINGW64 compiler (see docs/development.md).
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo Node.js ^(npm^) was not found: install it as docs/development.md describes.
    pause
    exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
    echo Rust ^(cargo^) was not found: install it as docs/development.md describes.
    pause
    exit /b 1
)
rem Rust's GNU toolchain links with MSYS2's gcc; use MSYS2's standard location if gcc is not on PATH.
where gcc >nul 2>nul
if errorlevel 1 if exist "C:\msys64\mingw64\bin\gcc.exe" set "PATH=%PATH%;C:\msys64\mingw64\bin"

rem Install the npm packages on the first start, and again whenever package-lock.json is newer than
rem npm's record of the last install (after a pull that changed the dependencies).
node -e "const f=require('fs');try{process.exit(f.statSync('package-lock.json').mtimeMs>f.statSync('node_modules/.package-lock.json').mtimeMs?1:0)}catch{process.exit(1)}"
if errorlevel 1 (
    echo Installing the npm packages...
    call npm ci
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

call npm run app:dev
if errorlevel 1 pause
