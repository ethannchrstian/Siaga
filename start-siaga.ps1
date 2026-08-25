param(
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDirectory = Join-Path $ProjectRoot "backend"
$FrontendDirectory = Join-Path $ProjectRoot "frontend"
$RuntimeDirectory = Join-Path $ProjectRoot ".runtime"
$BackendUrl = "http://127.0.0.1:8000/health"
$FrontendUrl = "http://127.0.0.1:5173"

New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

function Test-SiagaUrl {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    }
    catch {
        return $false
    }
}

function Wait-ForSiagaUrl {
    param(
        [string]$Url,
        [string]$ServiceName,
        [string]$ErrorLog
    )

    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-SiagaUrl -Url $Url) {
            Write-Host "  $ServiceName ready" -ForegroundColor Green
            return
        }
        Start-Sleep -Milliseconds 500
    }

    $details = ""
    if (Test-Path $ErrorLog) {
        $details = (Get-Content $ErrorLog -Tail 15) -join [Environment]::NewLine
    }
    throw "$ServiceName did not become ready.`n$details"
}

Write-Host "Starting SIAGA..." -ForegroundColor Cyan

if (Test-SiagaUrl -Url $BackendUrl) {
    Write-Host "  Backend already running" -ForegroundColor DarkGreen
}
else {
    $backendPython = Join-Path $BackendDirectory "venv\Scripts\python.exe"
    if (-not (Test-Path $backendPython)) {
        throw "Backend environment was not found at $backendPython"
    }

    $backendErrorLog = Join-Path $RuntimeDirectory "backend-error.log"
    Start-Process `
        -FilePath $backendPython `
        -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000") `
        -WorkingDirectory $BackendDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeDirectory "backend.log") `
        -RedirectStandardError $backendErrorLog | Out-Null

    Wait-ForSiagaUrl -Url $BackendUrl -ServiceName "Backend" -ErrorLog $backendErrorLog
}

if (Test-SiagaUrl -Url $FrontendUrl) {
    Write-Host "  Interface already running" -ForegroundColor DarkGreen
}
else {
    $npmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if (-not $npmCommand) {
        throw "npm was not found. Install Node.js or add npm to PATH."
    }

    $frontendErrorLog = Join-Path $RuntimeDirectory "frontend-error.log"
    Start-Process `
        -FilePath $npmCommand.Source `
        -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1") `
        -WorkingDirectory $FrontendDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $RuntimeDirectory "frontend.log") `
        -RedirectStandardError $frontendErrorLog | Out-Null

    Wait-ForSiagaUrl -Url $FrontendUrl -ServiceName "Interface" -ErrorLog $frontendErrorLog
}

if (-not $NoBrowser) {
    Start-Process "http://localhost:5173"
}

Write-Host "SIAGA is ready at http://localhost:5173" -ForegroundColor Green

