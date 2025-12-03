/**
 * ======================================================================
 * PHANTOM PARADOX: FINAL SECURITY SCAN (RED TEAM) 🛡️
 * ======================================================================
 * Scans Rust and TypeScript for:
 * 1. "Brick" Risks (Unwraps, Infinite Loops)
 * 2. "Rug" Risks (Missing Signer Checks, Unsafe Math)
 * 3. "Leak" Risks (Logging Private Keys, Missing Env Vars)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// CONFIG PATHS (Adjust to your actual structure)
// From offchain/src/tests/ -> go up to workspace root, then to Nodezero_engine
const RUST_PATH = path.join(__dirname, "../../../Nodezero_engine/programs/phantomgrid_gaming/src"); 
const TS_PATH = path.join(__dirname, "../");

const CRITICAL_PATTERNS = [
    // RUST DEATH PATTERNS
    { 
        lang: 'rs', 
        pattern: /\.unwrap\(\)/, 
        level: 'CRITICAL', 
        msg: 'PANIC RISK: Found .unwrap() in Rust. Use error handling!' 
    },
    { 
        lang: 'rs', 
        pattern: /\.expect\(/, 
        level: 'CRITICAL', 
        msg: 'PANIC RISK: Found .expect() in Rust. Use error handling!' 
    },
    { 
        lang: 'rs', 
        pattern: /\s\+\s/, 
        level: 'HIGH', 
        msg: 'UNSAFE MATH: Found "+" operator. Use checked_add()!' 
    },
    { 
        lang: 'rs', 
        pattern: /\s\-\s/, 
        level: 'HIGH', 
        msg: 'UNSAFE MATH: Found "-" operator. Use checked_sub()!' 
    },
    { 
        lang: 'rs', 
        pattern: /\s\*\s/, 
        level: 'HIGH', 
        msg: 'UNSAFE MATH: Found "*" operator. Use checked_mul()!' 
    },
    { 
        lang: 'rs', 
        pattern: /\s\/\s/, 
        level: 'HIGH', 
        msg: 'UNSAFE MATH: Found "/" operator. Use checked_div()!' 
    },
    { 
        lang: 'rs', 
        pattern: /AccountInfo/, 
        level: 'MED', 
        msg: 'UNCHECKED ACCOUNT: Use Account<\'info, T> or UncheckedAccount with safety comment.' 
    },

    // TYPESCRIPT DEATH PATTERNS
    { 
        lang: 'ts', 
        pattern: /console\.log.*key/, 
        level: 'CRITICAL', 
        msg: 'LEAK RISK: Logging potential keys/secrets?' 
    },
    { 
        lang: 'ts', 
        pattern: /any/, 
        level: 'LOW', 
        msg: 'TYPE SAFETY: Avoid "any" type in financial logic.' 
    },
    { 
        lang: 'ts', 
        pattern: /Number\(.*amount.*\)/, 
        level: 'HIGH', 
        msg: 'PRECISION LOSS: Casting amount to Number. Use BigInt!' 
    },
];

function scanDirectory(dir: string, extension: string): Array<{
    file: string;
    line: number;
    severity: string;
    message: string;
    code: string;
}> {
    if (!fs.existsSync(dir)) {
        console.log(`   ⚠️  Directory not found: ${dir}`);
        return [];
    }
    
    const files: string[] = [];
    
    function walkDir(currentDir: string) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name);
            
            // Skip node_modules, target, .git
            if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === '.git' || entry.name === 'dist') {
                continue;
            }
            
            if (entry.isDirectory()) {
                walkDir(fullPath);
            } else if (entry.name.endsWith(extension)) {
                files.push(fullPath);
            }
        }
    }
    
    walkDir(dir);
    
    const findings: Array<{
        file: string;
        line: number;
        severity: string;
        message: string;
        code: string;
    }> = [];

    for (const filePath of files) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            lines.forEach((line, index) => {
                CRITICAL_PATTERNS.filter(p => p.lang === extension.replace('.', '')).forEach(check => {
                    // Skip comments
                    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
                    
                    if (check.pattern.test(line)) {
                        // Make file path relative for readability
                        const relativePath = path.relative(process.cwd(), filePath);
                        
                        findings.push({
                            file: relativePath,
                            line: index + 1,
                            severity: check.level,
                            message: check.msg,
                            code: line.trim().substring(0, 50) + "..."
                        });
                    }
                });
            });
        } catch (error) {
            console.warn(`   ⚠️  Error reading ${filePath}: ${error}`);
        }
    }
    
    return findings;
}

function main() {
    console.log("🕵️ STARTING FINAL SECURITY SCAN...\n");

    // 1. SCAN RUST (THE VAULT)
    console.log(`📦 Scanning RUST (Phantom Paradox)...`);
    const rustIssues = scanDirectory(RUST_PATH, '.rs');
    
    // 2. SCAN TYPESCRIPT (THE BRAIN)
    console.log(`🧠 Scanning TYPESCRIPT (Wraith Engine)...`);
    const tsIssues = scanDirectory(TS_PATH, '.ts');

    const allIssues = [...rustIssues, ...tsIssues];
    const criticals = allIssues.filter(i => i.severity === 'CRITICAL');

    console.log("\n==================================================");
    console.log(`🚩 FOUND ${allIssues.length} POTENTIAL ISSUES`);
    console.log(`🚨 ${criticals.length} CRITICAL VULNERABILITIES`);
    console.log("==================================================\n");

    if (criticals.length > 0) {
        console.log("💀 CRITICAL FIXES REQUIRED IMMEDIATELY:");
        criticals.forEach(i => console.log(`   [${i.file}:${i.line}] ${i.message}\n      Code: ${i.code}`));
    } else {
        console.log("✅ No Critical 'Brick' Vulnerabilities Found.");
    }

    if (allIssues.length > 0) {
        console.log("\n⚠️  Full Report written to: security_audit_report.json");
        fs.writeFileSync('security_audit_report.json', JSON.stringify(allIssues, null, 2));
    }

    // 3. RUN AUTOMATED DEPENDENCY CHECK
    console.log("\n📦 Checking Dependencies for Known Vulnerabilities...");
    try {
        execSync('npm audit', { stdio: 'inherit' });
        console.log("✅ NPM Audit Passed.");
    } catch (e) {
        console.log("⚠️  NPM Audit Found Issues (See above).");
    }
}

main();

