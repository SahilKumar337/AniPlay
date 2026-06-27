@echo off
title Kill AniLab Background Server
echo.
echo  🛑 Stopping AniLab background servers...
echo.
taskkill /f /im node.exe >nul 2>&1
echo  ✓ Success: AniLab frontend & proxy servers stopped!
echo.
pause
