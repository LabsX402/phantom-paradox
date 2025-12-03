# ═══════════════════════════════════════════════════════════════════════════
#  PDOX TRADING BOT LAUNCHER
#  Runs the trading bot in the background without blocking the terminal
# ═══════════════════════════════════════════════════════════════════════════

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $scriptDir "trading_bot.log"
$pidFile = Join-Path $scriptDir "trading_bot.pid"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🤖 PDOX TRADING BOT - Background Launcher" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Check if node is available
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js not found! Please install Node.js first." -ForegroundColor Red
    exit 1
}

# Check if already running
if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile
    $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "⚠️  Bot is already running (PID: $existingPid)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Options:" -ForegroundColor Cyan
        Write-Host "  • View logs:  Get-Content '$logFile' -Tail 50 -Wait" -ForegroundColor Gray
        Write-Host "  • Stop bot:   Stop-Process -Id $existingPid" -ForegroundColor Gray
        Write-Host ""
        exit 0
    } else {
        Remove-Item $pidFile -Force
    }
}

# Clear old log
if (Test-Path $logFile) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupLog = Join-Path $scriptDir "trading_bot_$timestamp.log"
    Move-Item $logFile $backupLog -Force
    Write-Host "📦 Previous log backed up to: trading_bot_$timestamp.log" -ForegroundColor DarkGray
}

Write-Host "📁 Working directory: $scriptDir" -ForegroundColor DarkGray
Write-Host "📝 Log file: $logFile" -ForegroundColor DarkGray
Write-Host ""

# Start the bot in background
$job = Start-Job -ScriptBlock {
    param($dir, $log)
    Set-Location $dir
    & node real_trading_bot.js 2>&1 | Tee-Object -FilePath $log
} -ArgumentList $scriptDir, $logFile

# Give it a moment to start
Start-Sleep -Seconds 2

# Check if job started successfully
if ($job.State -eq "Running") {
    # Get the actual process (the node process spawned by the job)
    $job.Id | Out-File $pidFile -Force
    
    Write-Host "✅ Trading bot started successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
    Write-Host "  Job ID: $($job.Id)" -ForegroundColor Cyan
    Write-Host "  Status: Running in background" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "📊 Useful commands:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  View live logs:" -ForegroundColor White
    Write-Host "    Get-Content '$logFile' -Tail 30 -Wait" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Check job status:" -ForegroundColor White
    Write-Host "    Get-Job -Id $($job.Id)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Stop the bot:" -ForegroundColor White
    Write-Host "    Stop-Job -Id $($job.Id); Remove-Job -Id $($job.Id)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  View all jobs:" -ForegroundColor White
    Write-Host "    Get-Job" -ForegroundColor Gray
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
    Write-Host "  🚀 Bot is now generating trades on Devnet!" -ForegroundColor Green
    Write-Host "  📈 View trades: https://solscan.io/?cluster=devnet" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor DarkGray
} else {
    Write-Host "❌ Failed to start trading bot!" -ForegroundColor Red
    $job | Receive-Job
    Remove-Job -Job $job
    exit 1
}

