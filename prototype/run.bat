@echo off
cd /d "%~dp0"
echo Starting Task Orchestrator prototype...
echo Open http://127.0.0.1:8000
python server.py
pause
