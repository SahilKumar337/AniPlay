@echo off
echo =========================================================
echo   🚀 Starting Python FastAPI Anime Proxy Server on Port 4000
echo =========================================================
cd /d "%~dp0my-anime-api"
python -m uvicorn app.main:app --port 4000 --reload
pause
