@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE="
where node.exe >nul 2>nul && set "NODE_EXE=node.exe"
if not defined NODE_EXE if exist "D:\node\node.exe" set "NODE_EXE=D:\node\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE_EXE (
  echo Node.js was not found. Install Node.js 24+ or put node.exe on PATH.
  exit /b 1
)

"%NODE_EXE%" "scripts\launch.cjs"
exit /b %errorlevel%
