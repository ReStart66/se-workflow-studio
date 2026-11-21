@echo off
cd /d "%~dp0prototype"
echo Starting Task Orchestrator prototype...
start "" http://127.0.0.1:8000
python server.py
pause
