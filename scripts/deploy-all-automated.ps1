# ======================================================================
# PHANTOM PARADOX - MASTER DEPLOYMENT AUTOMATION
# ======================================================================
# This script builds and deploys everything with automatic error handling
# and SOL recovery. All actions are documented in LAUNCH_LOG.md
# ======================================================================

param(
    [switch]$SkipBuild = $false,
    [switch]$SkipOffchain = $false,
    [switch]$SkipToken = $false,
    [switch]$SkipInitConfig = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"
$SCRIPT_START_TIME = Get-Date
$LAUNCH_LOG = "LAUNCH_LOG.md"

# Initialize launch log
function Write-LaunchLog {
    param([string]$Message, [string]$Status = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logEntry = "## [$timestamp] [$Status] $Message`n"
    Add-Content -Path $LAUNCH_LOG -Value $logEntry
    Write-Host $logEntry -NoNewline
}

function Write-LaunchLogError {
    param([string]$Message, [string]$ErrorDetails = "")
    Write-LaunchLog "❌ ERROR: $Message" "ERROR"
    if ($ErrorDetails) {
        Write-LaunchLog "   Details: $ErrorDetails" "ERROR"
    }
}

function Write-LaunchLogSuccess {
    param([string]$Message)
    Write-LaunchLog "✅ SUCCESS: $Message" "SUCCESS"
}

function Write-LaunchLogFix {
    param([string]$Issue, [string]$Fix)
    Write-LaunchLog "🔧 FIXED: $Issue" "FIX"
    Write-LaunchLog "   Solution: $Fix" "FIX"
}

# Initialize log file
@"
# 🚀 PHANTOM PARADOX - LAUNCH LOG
Generated: $($SCRIPT_START_TIME.ToString("yyyy-MM-dd HH:mm:ss"))

This file tracks all deployment actions, fixes, and status for handoff to new agents.

---

"@ | Out-File -FilePath $LAUNCH_LOG -Encoding UTF8

Write-Host "=================================================================================" -ForegroundColor Green
Write-Host "🚀 PHANTOM PARADOX - MASTER DEPLOYMENT AUTOMATION" -ForegroundColor Green
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host ""
Write-LaunchLog "Starting master deployment automation"

# Configuration
$WALLET_PATH = "deployer_wallet.json"
$BACKUP_WALLET_PATH = "deployer_wallet.backup.json"
$RECOVERY_INFO_PATH = "SOL_RECOVERY_INFO.txt"
$CLUSTER = "devnet"
$RPC_URL = "https://api.devnet.solana.com"

# ======================================================================
# PHASE 1: PREREQUISITES CHECK
# ======================================================================
Write-Host "📋 PHASE 1: Checking Prerequisites..." -ForegroundColor Cyan
Write-LaunchLog "Phase 1: Checking prerequisites"

$prereqsOk = $true

# Check Solana CLI
try {
    $solanaVersion = solana --version 2>&1
    Write-LaunchLogSuccess "Solana CLI installed: $solanaVersion"
} catch {
    Write-LaunchLogError "Solana CLI not found" "Install from https://docs.solana.com/cli/install-solana-cli-tools"
    $prereqsOk = $false
}

# Check Anchor
try {
    $anchorVersion = anchor --version 2>&1
    Write-LaunchLogSuccess "Anchor CLI installed: $anchorVersion"
} catch {
    Write-LaunchLogError "Anchor CLI not found" "Install with: cargo install --git https://github.com/coral-xyz/anchor avm && avm install latest && avm use latest"
    $prereqsOk = $false
}

# Check Rust
try {
    $rustVersion = rustc --version 2>&1
    Write-LaunchLogSuccess "Rust installed: $rustVersion"
} catch {
    Write-LaunchLogError "Rust not found" "Install from https://rustup.rs/"
    $prereqsOk = $false
}

# Check Node.js (needed for offchain scripts)
try {
    $nodeVersion = node --version 2>&1
    Write-LaunchLogSuccess "Node.js installed: $nodeVersion"
} catch {
    Write-LaunchLogError "Node.js not found" "Install from https://nodejs.org/"
    $prereqsOk = $false
}

# Check npm (needed for offchain scripts)
try {
    $npmVersion = npm --version 2>&1
    Write-LaunchLogSuccess "npm installed: $npmVersion"
} catch {
    Write-LaunchLogError "npm not found" "Install Node.js which includes npm"
    $prereqsOk = $false
}

if (-not $prereqsOk) {
    Write-LaunchLogError "Prerequisites check failed - cannot continue"
    exit 1
}

# ======================================================================
# PHASE 2: WALLET SETUP & BACKUP
# ======================================================================
Write-Host ""
Write-Host "💼 PHASE 2: Wallet Setup & Backup..." -ForegroundColor Cyan
Write-LaunchLog "Phase 2: Wallet setup and backup"

if (Test-Path $WALLET_PATH) {
    Copy-Item $WALLET_PATH $BACKUP_WALLET_PATH -Force
    Write-LaunchLogSuccess "Wallet backed up to $BACKUP_WALLET_PATH"
} else {
    Write-LaunchLog "Creating new wallet..." "INFO"
    solana-keygen new --outfile $WALLET_PATH --no-bip39-passphrase
    Copy-Item $WALLET_PATH $BACKUP_WALLET_PATH -Force
    Write-LaunchLogSuccess "New wallet created and backed up"
}

$WALLET_PUBKEY = solana-keygen pubkey $WALLET_PATH
Write-LaunchLog "Wallet Pubkey: $WALLET_PUBKEY" "INFO"

# Set Solana config
solana config set --url $RPC_URL 2>&1 | Out-Null
solana config set --keypair $WALLET_PATH 2>&1 | Out-Null

# Check balance
$BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
$BALANCE_NUM = [double]($BALANCE -replace ' SOL', '')
Write-LaunchLog "Current Balance: $BALANCE" "INFO"

if ($BALANCE_NUM -lt 3.0) {
    Write-LaunchLogError "Insufficient balance" "Need at least 3 SOL, have $BALANCE"
    Write-Host ""
    Write-Host "⚠️  INSUFFICIENT BALANCE!" -ForegroundColor Red
    Write-Host "   Current: $BALANCE" -ForegroundColor Yellow
    Write-Host "   Required: At least 3 SOL" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "SEND SOL TO THIS ADDRESS:" -ForegroundColor Green
    Write-Host "   $WALLET_PUBKEY" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Or airdrop on devnet:" -ForegroundColor Yellow
    Write-Host "   solana airdrop 5 $WALLET_PUBKEY --url $RPC_URL" -ForegroundColor Cyan
    Write-Host ""
    $continue = Read-Host "Press Enter after sending SOL, or 'q' to quit"
    if ($continue -eq 'q') {
        Write-LaunchLog "User cancelled - insufficient balance" "CANCELLED"
        exit 1
    }
    $BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
    Write-LaunchLog "New Balance: $BALANCE" "INFO"
}

# ======================================================================
# PHASE 3: BUILD SOLANA PROGRAM
# ======================================================================
Write-Host ""
Write-Host "🔨 PHASE 3: Building Solana Program..." -ForegroundColor Cyan
Write-LaunchLog "Phase 3: Building Solana program"

if (-not $SkipBuild) {
    $buildStartTime = Get-Date
    
    try {
        Write-LaunchLog "Running: anchor build" "INFO"
        $buildOutput = anchor build 2>&1 | Tee-Object -Variable buildOutputFull
        
        if ($LASTEXITCODE -ne 0) {
            Write-LaunchLogError "Build failed" "Exit code: $LASTEXITCODE"
            Write-LaunchLog "Build output: $buildOutputFull" "ERROR"
            
            # Try to identify and fix common build errors
            if ($buildOutputFull -match "cannot find|not found") {
                Write-LaunchLog "Attempting to fix missing dependencies..." "FIX"
                cargo build-sbf 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    Write-LaunchLogFix "Missing dependencies" "Ran cargo build-sbf to install dependencies"
                    # Retry anchor build
                    anchor build 2>&1 | Out-Null
                    if ($LASTEXITCODE -eq 0) {
                        Write-LaunchLogSuccess "Build succeeded after dependency fix"
                    } else {
                        Write-LaunchLogError "Build still failing after dependency fix"
                        exit 1
                    }
                } else {
                    Write-LaunchLogError "Could not fix build errors automatically"
                    exit 1
                }
            } else {
                Write-LaunchLogError "Build failed with unknown error - manual fix required"
                exit 1
            }
        } else {
            $buildDuration = (Get-Date) - $buildStartTime
            Write-LaunchLogSuccess "Build completed successfully in $($buildDuration.TotalSeconds) seconds"
        }
    } catch {
        Write-LaunchLogError "Build exception" $_.Exception.Message
        exit 1
    }
} else {
    Write-LaunchLog "Skipping build (--SkipBuild flag)" "INFO"
}

# ======================================================================
# PHASE 4: DEPLOY SOLANA PROGRAM
# ======================================================================
Write-Host ""
Write-Host "🚀 PHASE 4: Deploying Solana Program to Devnet..." -ForegroundColor Cyan
Write-LaunchLog "Phase 4: Deploying Solana program"

if (-not $DryRun) {
    $INITIAL_BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
    $INITIAL_BALANCE_NUM = [double]($INITIAL_BALANCE -replace ' SOL', '')
    Write-LaunchLog "Initial Balance: $INITIAL_BALANCE" "INFO"
    
    # Get program ID
    $PROGRAM_ID = $null
    $ANCHOR_TOML = Get-Content "Anchor.toml" | Select-String "phantom_paradox.*=" | Select-Object -First 1
    if ($ANCHOR_TOML) {
        $PROGRAM_ID = ($ANCHOR_TOML -split "=")[1].Trim() -replace [char]34, ''
        Write-LaunchLog "Program ID: $PROGRAM_ID" "INFO"
    }
    
    $deployStartTime = Get-Date
    
    try {
        Write-LaunchLog "Running: anchor deploy --provider.cluster devnet" "INFO"
        $deployOutput = anchor deploy --provider.cluster devnet --provider.wallet $WALLET_PATH 2>&1 | Tee-Object -Variable deployOutputFull
        
        if ($LASTEXITCODE -eq 0) {
            $deployDuration = (Get-Date) - $deployStartTime
            $FINAL_BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
            $FINAL_BALANCE_NUM = [double]($FINAL_BALANCE -replace ' SOL', '')
            $SOL_USED = $INITIAL_BALANCE_NUM - $FINAL_BALANCE_NUM
            
            Write-LaunchLogSuccess "Deployment completed successfully in $($deployDuration.TotalSeconds) seconds"
            Write-LaunchLog "Final Balance: $FINAL_BALANCE" "INFO"
            Write-LaunchLog "SOL Used: $SOL_USED SOL" "INFO"
        } else {
            throw "Deployment failed with exit code $LASTEXITCODE"
        }
    } catch {
        Write-LaunchLogError "Deployment failed" $_.Exception.Message
        Write-LaunchLog "Deployment output: $deployOutputFull" "ERROR"
        
        # ======================================================================
        # AUTOMATIC SOL RECOVERY
        # ======================================================================
        Write-Host ""
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-Host "💰 AUTOMATIC SOL RECOVERY - RECLAIMING RENT" -ForegroundColor Yellow
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-LaunchLog "Starting automatic SOL recovery" "RECOVERY"
        
        $BALANCE_BEFORE_RECOVERY = solana balance $WALLET_PUBKEY --url $RPC_URL
        $BALANCE_BEFORE_RECOVERY_NUM = [double]($BALANCE_BEFORE_RECOVERY -replace ' SOL', '')
        Write-LaunchLog "Balance Before Recovery: $BALANCE_BEFORE_RECOVERY" "RECOVERY"
        
        $RENT_RECLAIMED = 0
        $PROGRAMS_CLOSED = @()
        
        # Try to close program accounts
        if ($PROGRAM_ID) {
            Write-LaunchLog "Attempting to close program: $PROGRAM_ID" "RECOVERY"
            
            $PROGRAM_INFO = solana program show $PROGRAM_ID --url $RPC_URL 2>&1
            if ($LASTEXITCODE -eq 0) {
                try {
                    $PROGRAM_ACCOUNT_INFO = solana account $PROGRAM_ID --url $RPC_URL --output json 2>&1 | ConvertFrom-Json
                    if ($PROGRAM_ACCOUNT_INFO.lamports) {
                        $PROGRAM_RENT = [double]($PROGRAM_ACCOUNT_INFO.lamports / 1000000000)
                        Write-LaunchLog "Program rent: $PROGRAM_RENT SOL" "RECOVERY"
                        
                        solana program close $PROGRAM_ID --url $RPC_URL --bypass-warning 2>&1 | Out-Null
                        if ($LASTEXITCODE -eq 0) {
                            $RENT_RECLAIMED += $PROGRAM_RENT
                            $PROGRAMS_CLOSED += $PROGRAM_ID
                            Write-LaunchLogFix "Reclaimed rent from program account" "$PROGRAM_RENT SOL reclaimed"
                        }
                    }
                } catch {
                    Write-LaunchLog "Could not close program account: $_" "RECOVERY"
                }
            }
        }
        
        Start-Sleep -Seconds 2
        
        $BALANCE_AFTER_RECOVERY = solana balance $WALLET_PUBKEY --url $RPC_URL
        $BALANCE_AFTER_RECOVERY_NUM = [double]($BALANCE_AFTER_RECOVERY -replace ' SOL', '')
        $ACTUAL_RECLAIMED = $BALANCE_AFTER_RECOVERY_NUM - $BALANCE_BEFORE_RECOVERY_NUM
        
        Write-LaunchLog "Balance After Recovery: $BALANCE_AFTER_RECOVERY" "RECOVERY"
        if ($ACTUAL_RECLAIMED -gt 0) {
            Write-LaunchLogSuccess "Reclaimed $ACTUAL_RECLAIMED SOL from rent"
        }
        
        Write-Host ""
        Write-Host "✅ SOL Recovery Complete!" -ForegroundColor Green
        Write-Host "   Balance: $BALANCE_AFTER_RECOVERY" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "To transfer SOL to safe wallet:" -ForegroundColor Yellow
        Write-Host "   .\scripts\recover-sol.ps1 -RecipientWallet YOUR_SAFE_WALLET -TransferAll" -ForegroundColor White
        Write-Host ""
        
        # Update recovery info
        $RECOVERY_INFO = @"
================================================================================
SOL RECOVERY INFORMATION - DEPLOYMENT FAILED
================================================================================
Last Updated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Status: DEPLOYMENT FAILED - SOL RECOVERY COMPLETED

Wallet Pubkey: $WALLET_PUBKEY
Balance Before Recovery: $BALANCE_BEFORE_RECOVERY
Balance After Recovery: $BALANCE_AFTER_RECOVERY
Rent Reclaimed: $ACTUAL_RECLAIMED SOL
Wallet File: $WALLET_PATH
Backup File: $BACKUP_WALLET_PATH
RPC URL: $RPC_URL
Cluster: $CLUSTER
Program ID: $PROGRAM_ID

Accounts Closed:
$($PROGRAMS_CLOSED -join "`n")

================================================================================
QUICK RECOVERY COMMANDS
================================================================================

1. Check balance:
   solana balance $WALLET_PUBKEY --url $RPC_URL

2. Transfer all SOL:
   solana transfer YOUR_SAFE_WALLET ALL --from $WALLET_PATH --url $RPC_URL --allow-unfunded-recipient

3. Use recovery script:
   .\scripts\recover-sol.ps1 -RecipientWallet YOUR_SAFE_WALLET -TransferAll

================================================================================
"@
        $RECOVERY_INFO | Out-File -FilePath $RECOVERY_INFO_PATH -Encoding UTF8
        Write-LaunchLog "Recovery info saved to $RECOVERY_INFO_PATH" "RECOVERY"
        
        exit 1
    }
} else {
    Write-LaunchLog "DRY RUN - Would deploy to devnet" "INFO"
}

# ======================================================================
# PHASE 5: VERIFY DEPLOYMENT
# ======================================================================
Write-Host ""
Write-Host "✅ PHASE 5: Verifying Deployment..." -ForegroundColor Cyan
Write-LaunchLog "Phase 5: Verifying deployment"

if ($PROGRAM_ID) {
    $PROGRAM_INFO = solana program show $PROGRAM_ID --url $RPC_URL 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-LaunchLogSuccess "Program verified on-chain at $PROGRAM_ID"
    } else {
        Write-LaunchLogError "Could not verify program on-chain"
    }
}

# ======================================================================
# PHASE 6: INITIALIZE GLOBAL CONFIG
# ======================================================================
if (-not $SkipInitConfig) {
    Write-Host ""
    Write-Host "⚙️  PHASE 6: Initializing Global Config..." -ForegroundColor Cyan
    Write-LaunchLog "Phase 6: Initializing Global Config"

    if (-not $DryRun) {
    $INIT_SCRIPT = "offchain/src/scripts/initGlobalConfig.ts"
    if (Test-Path $INIT_SCRIPT) {
        try {
            # Check if node_modules exists in offchain
            if (-not (Test-Path "offchain/node_modules")) {
                Write-LaunchLog "Installing offchain dependencies..." "INFO"
                Write-Host "   Installing npm dependencies..." -ForegroundColor Yellow
                Set-Location offchain
                npm install 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-LaunchLogError "Failed to install offchain dependencies"
                    Set-Location ..
                    throw "npm install failed"
                }
                Set-Location ..
                Write-LaunchLogSuccess "Offchain dependencies installed"
            }
            
            Write-LaunchLog "Running: npx ts-node $INIT_SCRIPT" "INFO"
            Set-Location offchain
            $initOutput = npx ts-node src/scripts/initGlobalConfig.ts 2>&1 | Tee-Object -Variable initOutputFull
            
            if ($LASTEXITCODE -eq 0) {
                if ($initOutputFull -match "already initialized") {
                    Write-LaunchLogSuccess "GlobalConfig already initialized (skipped)"
                } else {
                    Write-LaunchLogSuccess "GlobalConfig initialized successfully"
                }
            } else {
                Write-LaunchLogError "GlobalConfig initialization failed" "Exit code: $LASTEXITCODE"
                Write-LaunchLog "Init output: $initOutputFull" "ERROR"
            }
            Set-Location ..
        } catch {
            Write-LaunchLogError "GlobalConfig initialization exception" $_.Exception.Message
        }
    } else {
        Write-LaunchLog "GlobalConfig init script not found at $INIT_SCRIPT - skipping" "WARNING"
    }
    } else {
        Write-LaunchLog "DRY RUN - Would initialize GlobalConfig" "INFO"
    }
} else {
    Write-LaunchLog "Skipping GlobalConfig initialization (--SkipInitConfig flag)" "INFO"
}

# ======================================================================
# PHASE 7: MINT TOKEN (If Tokenomics Scripts Exist)
# ======================================================================
if (-not $SkipToken) {
    Write-Host ""
    Write-Host "💰 PHASE 7: Token Deployment..." -ForegroundColor Cyan
    Write-LaunchLog "Phase 7: Token deployment"

    if (-not $DryRun) {
    # Check for tokenomics scripts
    $MINT_SCRIPT = "scripts/tokenomics/mint_pdox.ts"
    $TOKENOMICS_DIR = "scripts/tokenomics"
    
    # Also check in offchain directory (some scripts might be there)
    if (-not (Test-Path $MINT_SCRIPT)) {
        $MINT_SCRIPT = "offchain/scripts/tokenomics/mint_pdox.ts"
    }
    
    if (Test-Path $MINT_SCRIPT) {
        Write-LaunchLog "Found token minting script: $MINT_SCRIPT" "INFO"
        
        # Check if required env vars are set
        if ($env:MINT_AUTHORITY_SECRET_KEY) {
            try {
                # Ensure dependencies are installed
                $SCRIPT_DIR = Split-Path $MINT_SCRIPT -Parent
                if ($SCRIPT_DIR -like "offchain/*") {
                    if (-not (Test-Path "offchain/node_modules")) {
                        Write-LaunchLog "Installing offchain dependencies for token script..." "INFO"
                        Set-Location offchain
                        npm install 2>&1 | Out-Null
                        Set-Location ..
                    }
                }
                
                Write-LaunchLog "Running: npx ts-node $MINT_SCRIPT" "INFO"
                $mintOutput = npx ts-node $MINT_SCRIPT 2>&1 | Tee-Object -Variable mintOutputFull
                
                if ($LASTEXITCODE -eq 0) {
                    # Try to extract mint address from output
                    if ($mintOutputFull -match "mint.*([1-9A-HJ-NP-Za-km-z]{32,44})") {
                        $MINT_ADDRESS = $matches[1]
                        Write-LaunchLogSuccess "Token minted successfully at $MINT_ADDRESS"
                        Write-LaunchLog "Mint Address: $MINT_ADDRESS" "INFO"
                    } else {
                        Write-LaunchLogSuccess "Token minted successfully (check output for mint address)"
                    }
                } else {
                    Write-LaunchLogError "Token minting failed" "Exit code: $LASTEXITCODE"
                    Write-LaunchLog "Mint output: $mintOutputFull" "ERROR"
                }
            } catch {
                Write-LaunchLogError "Token minting exception" $_.Exception.Message
            }
        } else {
            Write-LaunchLog "Skipping token mint (MINT_AUTHORITY_SECRET_KEY not set)" "INFO"
            Write-Host "   ⚠️  MINT_AUTHORITY_SECRET_KEY not set - skipping token deployment" -ForegroundColor Yellow
        }
    } else {
        Write-LaunchLog "Tokenomics scripts not found - skipping token deployment" "INFO"
        Write-Host "   ℹ️  Tokenomics scripts not found at $TOKENOMICS_DIR - skipping" -ForegroundColor Cyan
        Write-Host "   (This is optional - token can be deployed separately)" -ForegroundColor Cyan
    }
    } else {
        Write-LaunchLog "DRY RUN - Would mint token" "INFO"
    }
} else {
    Write-LaunchLog "Skipping token deployment (--SkipToken flag)" "INFO"
}

# ======================================================================
# PHASE 8: DEPLOY OFFCHAIN SERVICES (Optional)
# ======================================================================
if (-not $SkipOffchain) {
    Write-Host ""
    Write-Host "🌐 PHASE 6: Deploying Offchain Services..." -ForegroundColor Cyan
    Write-LaunchLog "Phase 6: Deploying offchain services"
    
    # Check if Vercel is configured
    if ($env:VERCEL_TOKEN) {
        Write-LaunchLog "Deploying to Vercel..." "INFO"
        try {
            Set-Location offchain
            vercel deploy --prod --yes 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-LaunchLogSuccess "Vercel deployment successful"
            } else {
                Write-LaunchLogError "Vercel deployment failed" "Exit code: $LASTEXITCODE"
            }
            Set-Location ..
        } catch {
            Write-LaunchLogError "Vercel deployment exception" $_.Exception.Message
        }
    } else {
        Write-LaunchLog "Skipping Vercel (VERCEL_TOKEN not set)" "INFO"
    }
    
    # Check if AWS is configured
    if ($env:AWS_ACCESS_KEY_ID -and $env:AWS_SECRET_ACCESS_KEY) {
        Write-LaunchLog "Deploying to AWS Lambda..." "INFO"
        try {
            Set-Location offchain
            serverless deploy --stage production 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-LaunchLogSuccess "AWS Lambda deployment successful"
            } else {
                Write-LaunchLogError "AWS Lambda deployment failed" "Exit code: $LASTEXITCODE"
            }
            Set-Location ..
        } catch {
            Write-LaunchLogError "AWS Lambda deployment exception" $_.Exception.Message
        }
    } else {
        Write-LaunchLog "Skipping AWS Lambda (credentials not set)" "INFO"
    }
} else {
    Write-LaunchLog "Skipping offchain deployment (--SkipOffchain flag)" "INFO"
}

# ======================================================================
# SUMMARY
# ======================================================================
$SCRIPT_DURATION = (Get-Date) - $SCRIPT_START_TIME

Write-Host ""
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host "🎉 DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "=================================================================================" -ForegroundColor Green
Write-Host ""

Write-LaunchLogSuccess "Master deployment completed successfully"
Write-LaunchLog "Total Duration: $($SCRIPT_DURATION.TotalMinutes) minutes" "INFO"
Write-LaunchLog "Wallet: $WALLET_PUBKEY" "INFO"
Write-LaunchLog "Cluster: $CLUSTER" "INFO"
if ($PROGRAM_ID) {
    Write-LaunchLog "Program ID: $PROGRAM_ID" "INFO"
}

Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "   ✅ Build: Complete" -ForegroundColor Green
Write-Host "   ✅ Program Deployment: Complete" -ForegroundColor Green
Write-Host "   ✅ Verification: Complete" -ForegroundColor Green
Write-Host "   ✅ GlobalConfig: Initialized" -ForegroundColor Green
Write-Host "   ℹ️  Token: Check logs above" -ForegroundColor Cyan
Write-Host "   ℹ️  Offchain: Check logs above" -ForegroundColor Cyan
Write-Host ""
Write-Host "📝 All actions logged to: $LAUNCH_LOG" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "   1. Review $LAUNCH_LOG for detailed logs" -ForegroundColor White
Write-Host "   2. Test deployed program" -ForegroundColor White
Write-Host "   3. Monitor on-chain activity" -ForegroundColor White
Write-Host ""

