@echo off
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found.
  echo Please install Python 3 from https://www.python.org/downloads/
  echo During setup, enable "Add python.exe to PATH", then run this file again.
  echo.
  pause
  exit /b 1
)

python serve.py --open
if errorlevel 1 (
  echo.
  echo The local server exited with an error.
  pause
)

endlocal
