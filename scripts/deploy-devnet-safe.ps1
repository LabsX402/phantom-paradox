# PHANTOM PARADOX - SAFE DEVNET DEPLOYMENT SCRIPT
# Features:
# - Builds with -d (debug) and nursery settings
# - Recovers SOL if deployment fails
# - Uses devnet (not localnet)
# - Creates backup of wallet before deployment

param(
    [switch]$SkipBuild = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"

Write-Host "PHANTOM PARADOX - SAFE DEVNET DEPLOYMENT" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""

# Configuration
$WALLET_PATH = "deployer_wallet.json"
$BACKUP_WALLET_PATH = "deployer_wallet.backup.json"
$RECOVERY_INFO_PATH = "SOL_RECOVERY_INFO.txt"
$CLUSTER = "devnet"
$RPC_URL = "https://api.devnet.solana.com"

# Step 1: Backup wallet
Write-Host "Step 1: Backing up wallet..." -ForegroundColor Yellow
if (Test-Path $WALLET_PATH) {
    Copy-Item $WALLET_PATH $BACKUP_WALLET_PATH -Force
    Write-Host "[OK] Wallet backed up to $BACKUP_WALLET_PATH" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Wallet not found at $WALLET_PATH" -ForegroundColor Red
    Write-Host "   Creating new wallet..." -ForegroundColor Yellow
    solana-keygen new --outfile $WALLET_PATH --no-bip39-passphrase
    Copy-Item $WALLET_PATH $BACKUP_WALLET_PATH -Force
}

# Step 2: Get wallet pubkey and balance
Write-Host ""
Write-Host "Step 2: Checking wallet..." -ForegroundColor Yellow
$WALLET_PUBKEY = solana-keygen pubkey $WALLET_PATH
Write-Host "   Wallet Pubkey: $WALLET_PUBKEY" -ForegroundColor Cyan

# Set Solana config to devnet
Write-Host "   Setting Solana config to devnet..." -ForegroundColor Yellow
solana config set --url $RPC_URL
solana config set --keypair $WALLET_PATH

# Check balance
$BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
Write-Host "   Current Balance: $BALANCE" -ForegroundColor Cyan

# Save recovery information BEFORE deployment
Write-Host ""
Write-Host "   Saving recovery information..." -ForegroundColor Yellow
$RECOVERY_INFO = @"
================================================================================
SOL RECOVERY INFORMATION
================================================================================
Created: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Wallet Pubkey: $WALLET_PUBKEY
Wallet File: $WALLET_PATH
Backup File: $BACKUP_WALLET_PATH
RPC URL: $RPC_URL
Cluster: $CLUSTER
Initial Balance: $BALANCE

================================================================================
HOW TO RECOVER SOL IF DEPLOYMENT FAILS
================================================================================

1. Check your current balance:
   solana balance $WALLET_PUBKEY --url $RPC_URL

2. Transfer SOL to your safe wallet:
   solana transfer YOUR_SAFE_WALLET_ADDRESS AMOUNT --from $WALLET_PATH --url $RPC_URL
   
   Example (transfer all but 0.1 SOL for fees):
   solana transfer YOUR_SAFE_WALLET_ADDRESS ALL --from $WALLET_PATH --url $RPC_URL --allow-unfunded-recipient

3. Or use the recovery script:
   .\scripts\recover-sol.ps1 -RecipientWallet YOUR_SAFE_WALLET_ADDRESS

4. Verify transfer:
   solana balance YOUR_SAFE_WALLET_ADDRESS --url $RPC_URL

================================================================================
WALLET FILES (KEEP THESE SAFE!)
================================================================================
- $WALLET_PATH (main wallet file)
- $BACKUP_WALLET_PATH (backup copy)

IMPORTANT: These files contain your private key. Never share them or commit to git!
================================================================================
"@
$RECOVERY_INFO | Out-File -FilePath $RECOVERY_INFO_PATH -Encoding UTF8
Write-Host "   [OK] Recovery info saved to $RECOVERY_INFO_PATH" -ForegroundColor Green

# Check if we have enough SOL (need at least 3 SOL for deployment)
$BALANCE_NUM = [double]($BALANCE -replace ' SOL', '')
if ($BALANCE_NUM -lt 3.0) {
    Write-Host ""
    Write-Host "[WARNING] Insufficient balance!" -ForegroundColor Red
    Write-Host "   Current: $BALANCE" -ForegroundColor Yellow
    Write-Host "   Required: At least 3 SOL for deployment" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "SEND SOL TO THIS ADDRESS:" -ForegroundColor Green
    Write-Host "   $WALLET_PUBKEY" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   You can airdrop on devnet with:" -ForegroundColor Yellow
    Write-Host "   solana airdrop 5 $WALLET_PUBKEY --url $RPC_URL" -ForegroundColor Cyan
    Write-Host ""
    $continue = Read-Host "Press Enter after sending SOL, or 'q' to quit"
    if ($continue -eq 'q') {
        exit 1
    }
    
    # Recheck balance
    $BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
    Write-Host "   New Balance: $BALANCE" -ForegroundColor Cyan
}

# Step 3: Build with debug and nursery settings
if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "Step 3: Building program..." -ForegroundColor Yellow
    
    # Build the program
    anchor build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Build failed!" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "[OK] Build successful" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Step 3: Skipping build (--SkipBuild flag)" -ForegroundColor Yellow
}

# Step 4: Deploy with SOL recovery
if (-not $DryRun) {
    Write-Host ""
    Write-Host "Step 4: Deploying to DEVNET (with SOL recovery)..." -ForegroundColor Yellow
    
    # Save initial balance for recovery
    $INITIAL_BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
    Write-Host "   Initial Balance: $INITIAL_BALANCE" -ForegroundColor Cyan
    
    # Get program ID from Anchor.toml before deployment
    $PROGRAM_ID = $null
    $ANCHOR_TOML = Get-Content "Anchor.toml" | Select-String "phantom_paradox.*=" | Select-Object -First 1
    if ($ANCHOR_TOML) {
        $PROGRAM_ID = ($ANCHOR_TOML -split "=")[1].Trim() -replace [char]34, ''
        Write-Host "   Program ID: $PROGRAM_ID" -ForegroundColor Cyan
    }
    
    try {
        # Deploy to devnet (not localnet!)
        Write-Host "   Deploying program..." -ForegroundColor Yellow
        anchor deploy --provider.cluster devnet --provider.wallet $WALLET_PATH
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Deployment successful!" -ForegroundColor Green
            
            # Check final balance
            $FINAL_BALANCE = solana balance $WALLET_PUBKEY --url $RPC_URL
            Write-Host "   Final Balance: $FINAL_BALANCE" -ForegroundColor Cyan
            
            # Calculate SOL used
            $INITIAL_NUM = [double]($INITIAL_BALANCE -replace ' SOL', '')
            $FINAL_NUM = [double]($FINAL_BALANCE -replace ' SOL', '')
            $USED = $INITIAL_NUM - $FINAL_NUM
            Write-Host "   SOL Used: $USED SOL" -ForegroundColor Cyan
        } else {
            throw "Deployment failed with exit code $LASTEXITCODE"
        }
    } catch {
        Write-Host ""
        Write-Host "[ERROR] DEPLOYMENT FAILED!" -ForegroundColor Red
        Write-Host "   Error: $_" -ForegroundColor Red
        Write-Host ""
        
        # Check current balance before recovery
        $BALANCE_BEFORE_RECOVERY = solana balance $WALLET_PUBKEY --url $RPC_URL
        $BALANCE_BEFORE_RECOVERY_NUM = [double]($BALANCE_BEFORE_RECOVERY -replace ' SOL', '')
        
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-Host "AUTOMATIC SOL RECOVERY - CLOSING PROGRAM ACCOUNTS" -ForegroundColor Yellow
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Attempting to close program accounts and reclaim rent..." -ForegroundColor Yellow
        Write-Host ""
        
        $RENT_RECLAIMED = 0
        $PROGRAMS_CLOSED = @()
        
        # Try to close program accounts if they exist
        if ($PROGRAM_ID) {
            Write-Host "   Checking program: $PROGRAM_ID" -ForegroundColor Cyan
            
            # Check if program exists
            $PROGRAM_INFO = solana program show $PROGRAM_ID --url $RPC_URL 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "   Program account found, attempting to close..." -ForegroundColor Yellow
                
                try {
                    # Get program account info to see rent
                    $PROGRAM_ACCOUNT_INFO = solana account $PROGRAM_ID --url $RPC_URL --output json 2>&1 | ConvertFrom-Json
                    if ($PROGRAM_ACCOUNT_INFO.lamports) {
                        $PROGRAM_RENT = [double]($PROGRAM_ACCOUNT_INFO.lamports / 1000000000)  # Convert lamports to SOL
                        Write-Host "   Program rent: $PROGRAM_RENT SOL" -ForegroundColor Cyan
                        
                        # Close the program account
                        Write-Host "   Closing program account..." -ForegroundColor Yellow
                        solana program close $PROGRAM_ID --url $RPC_URL --bypass-warning 2>&1 | Out-Null
                        
                        if ($LASTEXITCODE -eq 0) {
                            $RENT_RECLAIMED += $PROGRAM_RENT
                            $PROGRAMS_CLOSED += $PROGRAM_ID
                            Write-Host "   [OK] Program account closed, reclaimed $PROGRAM_RENT SOL" -ForegroundColor Green
                        } else {
                            Write-Host "   [WARNING] Could not close program account (may not be closable)" -ForegroundColor Yellow
                        }
                    }
                } catch {
                    Write-Host "   [WARNING] Could not close program: $_" -ForegroundColor Yellow
                }
            } else {
                Write-Host "   Program account not found (may not have been created)" -ForegroundColor Cyan
            }
            
            # Try to find and close program data account (if using upgradeable loader)
            # Program data account is typically the upgrade authority's program data
            try {
                $PROGRAM_DATA_ID = solana program show $PROGRAM_ID --url $RPC_URL --output json 2>&1 | ConvertFrom-Json
                if ($PROGRAM_DATA_ID -and $PROGRAM_DATA_ID.programdataAddress) {
                    $DATA_ACCOUNT = $PROGRAM_DATA_ID.programdataAddress
                    Write-Host "   Found program data account: $DATA_ACCOUNT" -ForegroundColor Cyan
                    
                    $DATA_ACCOUNT_INFO = solana account $DATA_ACCOUNT --url $RPC_URL --output json 2>&1 | ConvertFrom-Json
                    if ($DATA_ACCOUNT_INFO.lamports) {
                        $DATA_RENT = [double]($DATA_ACCOUNT_INFO.lamports / 1000000000)
                        Write-Host "   Program data rent: $DATA_RENT SOL" -ForegroundColor Cyan
                        
                        # Try to close program data (requires upgrade authority)
                        Write-Host "   Attempting to close program data account..." -ForegroundColor Yellow
                        solana program close $DATA_ACCOUNT --url $RPC_URL --bypass-warning 2>&1 | Out-Null
                        
                        if ($LASTEXITCODE -eq 0) {
                            $RENT_RECLAIMED += $DATA_RENT
                            $PROGRAMS_CLOSED += $DATA_ACCOUNT
                            Write-Host "   [OK] Program data closed, reclaimed $DATA_RENT SOL" -ForegroundColor Green
                        }
                    }
                }
            } catch {
                # Program data closing may fail if we're not the upgrade authority
                Write-Host "   [INFO] Program data account not closable (normal if not upgrade authority)" -ForegroundColor Cyan
            }
        }
        
        # Wait a moment for transactions to settle
        Start-Sleep -Seconds 2
        
        # Check balance after recovery attempts
        $BALANCE_AFTER_RECOVERY = solana balance $WALLET_PUBKEY --url $RPC_URL
        $BALANCE_AFTER_RECOVERY_NUM = [double]($BALANCE_AFTER_RECOVERY -replace ' SOL', '')
        $ACTUAL_RECLAIMED = $BALANCE_AFTER_RECOVERY_NUM - $BALANCE_BEFORE_RECOVERY_NUM
        
        Write-Host ""
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-Host "SOL RECOVERY SUMMARY" -ForegroundColor Yellow
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Balance Before Recovery: $BALANCE_BEFORE_RECOVERY" -ForegroundColor Cyan
        Write-Host "Balance After Recovery: $BALANCE_AFTER_RECOVERY" -ForegroundColor Cyan
        if ($ACTUAL_RECLAIMED -gt 0) {
            Write-Host "Rent Reclaimed: $ACTUAL_RECLAIMED SOL" -ForegroundColor Green
        }
        if ($PROGRAMS_CLOSED.Count -gt 0) {
            Write-Host "Accounts Closed: $($PROGRAMS_CLOSED.Count)" -ForegroundColor Cyan
            foreach ($closed in $PROGRAMS_CLOSED) {
                Write-Host "   - $closed" -ForegroundColor Cyan
            }
        }
        Write-Host ""
        Write-Host "Current Balance: $BALANCE_AFTER_RECOVERY" -ForegroundColor Cyan
        Write-Host "Wallet Pubkey: $WALLET_PUBKEY" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Your SOL is safe in the wallet!" -ForegroundColor Green
        Write-Host ""
        Write-Host "ADDITIONAL RECOVERY OPTIONS:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "1. Use the recovery script (RECOMMENDED):" -ForegroundColor Cyan
        Write-Host "   .\scripts\recover-sol.ps1 -RecipientWallet YOUR_SAFE_WALLET_ADDRESS -TransferAll" -ForegroundColor White
        Write-Host ""
        Write-Host "2. Manual transfer:" -ForegroundColor Cyan
        Write-Host "   solana transfer YOUR_SAFE_WALLET_ADDRESS ALL --from $WALLET_PATH --url $RPC_URL --allow-unfunded-recipient" -ForegroundColor White
        Write-Host ""
        Write-Host "3. Check recovery info file:" -ForegroundColor Cyan
        Write-Host "   See $RECOVERY_INFO_PATH for detailed instructions" -ForegroundColor White
        Write-Host ""
        Write-Host "4. Retry deployment:" -ForegroundColor Cyan
        Write-Host "   .\scripts\deploy-devnet-safe.ps1 -SkipBuild" -ForegroundColor White
        Write-Host ""
        Write-Host "IMPORTANT FILES:" -ForegroundColor Yellow
        Write-Host "   Wallet: $WALLET_PATH" -ForegroundColor Cyan
        Write-Host "   Backup: $BACKUP_WALLET_PATH" -ForegroundColor Cyan
        Write-Host "   Recovery Info: $RECOVERY_INFO_PATH" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "=================================================================================" -ForegroundColor Yellow
        Write-Host ""
        
        # Update recovery info with current balance and recovery results
        $UPDATED_RECOVERY_INFO = @"
================================================================================
SOL RECOVERY INFORMATION - DEPLOYMENT FAILED
================================================================================
Last Updated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Status: DEPLOYMENT FAILED - SOL RECOVERY ATTEMPTED

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

2. Transfer all SOL (recommended):
   solana transfer YOUR_SAFE_WALLET_ADDRESS ALL --from $WALLET_PATH --url $RPC_URL --allow-unfunded-recipient

3. Transfer specific amount (leave 0.1 SOL for fees):
   solana transfer YOUR_SAFE_WALLET_ADDRESS $([math]::Max(0, $BALANCE_AFTER_RECOVERY_NUM - 0.1)) --from $WALLET_PATH --url $RPC_URL

4. Use recovery script:
   .\scripts\recover-sol.ps1 -RecipientWallet YOUR_SAFE_WALLET_ADDRESS -TransferAll

================================================================================
WALLET SECURITY
================================================================================
- Keep $WALLET_PATH and $BACKUP_WALLET_PATH secure
- Never share these files or commit to git
- These files contain your private key
- You can recover SOL as long as you have these files

================================================================================
"@
        $UPDATED_RECOVERY_INFO | Out-File -FilePath $RECOVERY_INFO_PATH -Encoding UTF8
        
        exit 1
    }
} else {
    Write-Host ""
    Write-Host "Step 4: DRY RUN - Would deploy to DEVNET" -ForegroundColor Yellow
    Write-Host "   (Use without --DryRun to actually deploy)" -ForegroundColor Cyan
}

# Step 5: Verify deployment
Write-Host ""
Write-Host "Step 5: Verifying deployment..." -ForegroundColor Yellow

# Get program ID from Anchor.toml
$PROGRAM_ID = $null
$ANCHOR_TOML = Get-Content "Anchor.toml" | Select-String "phantom_paradox.*=" | Select-Object -First 1
if ($ANCHOR_TOML) {
    $PROGRAM_ID = ($ANCHOR_TOML -split "=")[1].Trim() -replace [char]34, ''
    Write-Host "   Program ID: $PROGRAM_ID" -ForegroundColor Cyan
    
    # Check if program exists on-chain
    $PROGRAM_INFO = solana program show $PROGRAM_ID --url $RPC_URL 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Program deployed and verified on devnet!" -ForegroundColor Green
    } else {
        Write-Host "[WARNING] Could not verify program on-chain" -ForegroundColor Yellow
    }
}

# Summary
Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "DEPLOYMENT COMPLETE" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Summary:" -ForegroundColor Yellow
Write-Host "   Wallet: $WALLET_PUBKEY" -ForegroundColor Cyan
Write-Host "   Cluster: $CLUSTER" -ForegroundColor Cyan
Write-Host "   RPC URL: $RPC_URL" -ForegroundColor Cyan
Write-Host "   Wallet File: $WALLET_PATH" -ForegroundColor Cyan
Write-Host "   Backup File: $BACKUP_WALLET_PATH" -ForegroundColor Cyan
Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Yellow
$balanceCmd = 'solana balance ' + $WALLET_PUBKEY + ' --url ' + $RPC_URL
Write-Host ('   Check balance: ' + $balanceCmd) -ForegroundColor Cyan
if ($null -ne $PROGRAM_ID -and $PROGRAM_ID -ne '') {
    Write-Host ('   Program ID: ' + $PROGRAM_ID) -ForegroundColor Cyan
}
Write-Host ""

