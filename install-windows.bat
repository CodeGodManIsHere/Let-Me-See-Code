@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Let Me See Code - Windows setup

set "REPOSITORY=https://github.com/CodeGodManIsHere/Let-Me-See-Code.git"
set "INSTALL_DIR=%LOCALAPPDATA%\Let-Me-See-Code"

echo.
echo  Let Me See Code - Windows setup
echo  --------------------------------
echo.

where git.exe >nul 2>&1
if errorlevel 1 goto :missing_git

if exist "%INSTALL_DIR%\.git" goto :update
if exist "%INSTALL_DIR%" goto :occupied

echo [1/4] Downloading the extension...
git.exe clone --depth 1 "%REPOSITORY%" "%INSTALL_DIR%"
if errorlevel 1 goto :clone_failed
goto :verify

:update
echo [1/4] Updating the existing copy...
git.exe -C "%INSTALL_DIR%" pull --ff-only
if errorlevel 1 goto :update_failed

:verify
echo [2/4] Checking the extension files...
if not exist "%INSTALL_DIR%\manifest.json" goto :manifest_missing

echo [3/4] Copying the extension folder to the clipboard...
<nul set /p="%INSTALL_DIR%" | clip.exe

echo [4/4] Opening Chrome and the extension folder...
call :open_chrome
start "" explorer.exe /select,"%INSTALL_DIR%\manifest.json"

echo.
echo  Chrome requires one manual confirmation for unpacked extensions:
echo.
echo    1. Turn on Developer mode
echo    2. Click Load unpacked
echo    3. Paste the copied folder path and choose Select Folder
echo.
echo  Folder copied to clipboard:
echo  %INSTALL_DIR%
echo.
pause
exit /b 0

:open_chrome
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "chrome://extensions"
  exit /b 0
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "chrome://extensions"
  exit /b 0
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "chrome://extensions"
  exit /b 0
)
start "" "chrome://extensions"
exit /b 0

:missing_git
echo ERROR: Git for Windows is not installed or is not available on PATH.
echo Install it from https://git-scm.com/download/win and run this file again.
goto :failed

:occupied
echo ERROR: This folder already exists but is not a Git checkout:
echo %INSTALL_DIR%
echo Move or rename that folder, then run this file again.
goto :failed

:clone_failed
echo ERROR: The repository could not be downloaded.
echo Check the internet connection and repository address, then retry.
goto :failed

:update_failed
echo ERROR: The existing copy could not be updated safely.
echo Local changes may be present in %INSTALL_DIR%.
goto :failed

:manifest_missing
echo ERROR: manifest.json was not found at the repository root.
echo The downloaded repository is not currently loadable as an extension.

:failed
echo.
pause
exit /b 1
