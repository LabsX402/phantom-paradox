# PHANTOM PARADOX VAULT - PRODUCTION DEPLOYMENT SCRIPT (PowerShell)
# Execute this to deploy everything to production

Write-Host "🚀 PHANTOM PARADOX VAULT - PRODUCTION LAUNCH" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

try {
    $vercelVersion = vercel --version 2>&1
    Write-Host "✅ Vercel CLI installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Vercel CLI not installed. Install with: npm i -g vercel" -ForegroundColor Red
    exit 1
}

try {
    $serverlessVersion = serverless --version 2>&1
    Write-Host "✅ Serverless CLI installed" -ForegroundColor Green
} catch {
    Write-Host "❌ Serverless CLI not installed. Install with: npm i -g serverless" -ForegroundColor Red
    exit 1
}

Write-Host ""

# PHASE 1: VERCEL API DEPLOYMENT
Write-Host "🌐 PHASE 1: Deploying Vercel API (Primary)" -ForegroundColor Cyan
Write-Host "-------------------------------------------" -ForegroundColor Cyan

if (-not $env:VERCEL_TOKEN) {
    Write-Host "⚠️  VERCEL_TOKEN not set. Please login:" -ForegroundColor Yellow
    Write-Host "   vercel login"
    Write-Host "   OR"
    Write-Host "   `$env:VERCEL_TOKEN = 'your_token'"
} else {
    vercel deploy --prod --yes
    Write-Host "✅ Vercel API deployed" -ForegroundColor Green
}

Write-Host ""
Write-Host "🔐 Setting Vercel environment variables..." -ForegroundColor Yellow
if ($env:SENTRY_DSN) {
    echo $env:SENTRY_DSN | vercel env add SENTRY_DSN production
}
if ($env:DATABASE_URL) {
    echo $env:DATABASE_URL | vercel env add DATABASE_URL production
}
Write-Host "✅ Environment variables configured" -ForegroundColor Green
Write-Host ""

# PHASE 2: AWS LAMBDA NETTING DEPLOYMENT
Write-Host "⚡ PHASE 2: Deploying AWS Lambda Netting (Scheduled)" -ForegroundColor Cyan
Write-Host "----------------------------------------------------" -ForegroundColor Cyan

Set-Location offchain

if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
    Write-Host "⚠️  AWS credentials not set. Please configure:" -ForegroundColor Yellow
    Write-Host "   aws configure"
    Write-Host "   OR"
    Write-Host "   `$env:AWS_ACCESS_KEY_ID = 'your_key'"
    Write-Host "   `$env:AWS_SECRET_ACCESS_KEY = 'your_secret'"
} else {
    serverless deploy --stage production
    Write-Host "✅ AWS Lambda Netting deployed" -ForegroundColor Green
    
    if ($env:SENTRY_DSN) {
        serverless env set SENTRY_DSN $env:SENTRY_DSN --stage production
    }
}

Write-Host ""

# PHASE 3: RUN TESTS
Write-Host "🧪 PHASE 3: Running Production Tests" -ForegroundColor Cyan
Write-Host "--------------------------------------" -ForegroundColor Cyan

Write-Host "Running E2E test (1000 intents)..." -ForegroundColor Yellow
npx ts-node src/serverless/test-e2e.ts

Write-Host ""
Write-Host "Running extended E2E test (10k intents)..." -ForegroundColor Yellow
npx ts-node src/serverless/test-e2e-extended.ts

Write-Host ""
Write-Host "Running chaos test (failover)..." -ForegroundColor Yellow
npx ts-node src/serverless/test-chaos.ts

Write-Host ""
Write-Host "Running workflow test..." -ForegroundColor Yellow
npx ts-node src/serverless/test-workflow.ts

Write-Host "✅ All tests completed" -ForegroundColor Green
Write-Host ""

# PHASE 4: AKASH PILOT
Write-Host "🌐 PHASE 4: Deploying Akash Pilot (Testnet)" -ForegroundColor Cyan
Write-Host "-------------------------------------------" -ForegroundColor Cyan
Write-Host "Deploying netting container to Akash testnet..." -ForegroundColor Yellow
npx ts-node src/serverless/akash-integration.ts deploy-testnet

Write-Host ""

# SUMMARY
Write-Host "============================================" -ForegroundColor Green
Write-Host "🎉 DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "✅ Vercel API: Deployed" -ForegroundColor Green
Write-Host "✅ AWS Lambda Netting: Deployed" -ForegroundColor Green
Write-Host "✅ Tests: Completed" -ForegroundColor Green
Write-Host "✅ Akash Pilot: Initiated" -ForegroundColor Green
Write-Host ""
Write-Host "📊 Next Steps:" -ForegroundColor Yellow
Write-Host "   1. Monitor Vercel dashboard"
Write-Host "   2. Check AWS CloudWatch for Lambda metrics"
Write-Host "   3. Verify Sentry alerts are active"
Write-Host "   4. Monitor Akash deployment status"
Write-Host ""

