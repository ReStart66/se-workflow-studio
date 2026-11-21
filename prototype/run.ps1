Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'Starting Task Orchestrator prototype...' -ForegroundColor Cyan
Write-Host 'Open http://127.0.0.1:8000' -ForegroundColor Yellow
python server.py
