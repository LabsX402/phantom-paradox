/**
 * P-SHELL EXAMPLE MODS
 * Demonstration of the Reality Mod system
 * 
 * These mods show how to:
 * - React to reality level changes
 * - Modify page content
 * - Integrate with Nulla
 */

// Wait for PShell to be ready
const waitForPShell = setInterval(() => {
  if (window.PShell && PShell.registerMod) {
    clearInterval(waitForPShell);
    registerExampleMods();
  }
}, 100);

function registerExampleMods() {
  
  // ========================================
  // MOD 1: Page De-Noise
  // ========================================
  PShell.registerMod({
    id: 'com.paradox.mods.denoise',
    name: 'Page De-Noise',
    description: 'Removes common clutter elements in Subzero mode',
    matches: ['*'],
    
    onLoad: ({ page }) => {
      console.log('🔇 De-Noise mod loaded');
    },
    
    onRealityChange: (level) => {
      if (level <= 0.1) {
        // SUBZERO: Remove noise elements
        const noiseSelectors = [
          '.advertisement', '.ad', '[class*="ad-"]', '[id*="ad-"]',
          '.popup', '.modal', '.overlay:not(#pshell-hud)',
          '.cookie-banner', '.cookie-consent',
          '.newsletter-signup', '.promo-banner',
          '[aria-label="Advertisement"]'
        ];
        
        noiseSelectors.forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            el.style.display = 'none';
          });
        });
        
        console.log('🧊 De-Noise: Subzero cleanup complete');
      }
    }
  });

  // ========================================
  // MOD 2: Typography Override
  // ========================================
  PShell.registerMod({
    id: 'com.paradox.mods.typography',
    name: 'Subzero Typography',
    description: 'Forces monospace terminal fonts in Subzero mode',
    matches: ['*'],
    
    styleElement: null,
    
    onRealityChange: function(level) {
      if (level <= 0.1) {
        // Inject subzero typography
        if (!this.styleElement) {
          this.styleElement = document.createElement('style');
          this.styleElement.id = 'mod-typography';
          this.styleElement.textContent = `
            body.pshell-subzero * {
              font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace !important;
            }
            body.pshell-subzero h1, 
            body.pshell-subzero h2, 
            body.pshell-subzero h3 {
              text-transform: uppercase;
              letter-spacing: 2px;
            }
            body.pshell-subzero a {
              color: #00ffff !important;
              text-decoration: underline !important;
            }
          `;
          document.head.appendChild(this.styleElement);
        }
      } else if (this.styleElement) {
        this.styleElement.remove();
        this.styleElement = null;
      }
    }
  });

  // ========================================
  // MOD 3: Network Health Monitor
  // ========================================
  PShell.registerMod({
    id: 'com.paradox.mods.network-health',
    name: 'Network Health Overlay',
    description: 'Shows network status in CHILL/SUBZERO modes',
    matches: ['*'],
    
    overlayEl: null,
    checkInterval: null,
    
    onLoad: function() {
      // Create overlay element
      this.overlayEl = document.createElement('div');
      this.overlayEl.id = 'mod-network-health';
      this.overlayEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(0, 20, 40, 0.9);
        border: 1px solid rgba(0, 255, 255, 0.3);
        border-radius: 8px;
        padding: 10px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        color: #00ffff;
        z-index: 99999;
        display: none;
        backdrop-filter: blur(10px);
      `;
      document.body.appendChild(this.overlayEl);
    },
    
    onRealityChange: function(level) {
      if (level <= 0.5) {
        // Show in CHILL and SUBZERO
        this.overlayEl.style.display = 'block';
        this.startHealthChecks();
      } else {
        // Hide in HOT
        this.overlayEl.style.display = 'none';
        this.stopHealthChecks();
      }
    },
    
    startHealthChecks: function() {
      if (this.checkInterval) return;
      
      const check = async () => {
        try {
          const start = performance.now();
          const res = await fetch('https://api.mainnet-beta.solana.com', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' })
          });
          const data = await res.json();
          const latency = Math.round(performance.now() - start);
          
          const status = data.result === 'ok' ? '✓' : '⚠';
          const color = data.result === 'ok' ? '#00ff88' : '#ffaa00';
          
          this.overlayEl.innerHTML = `
            <div style="color: ${color}; margin-bottom: 5px;">${status} SOLANA</div>
            <div>Latency: ${latency}ms</div>
            <div style="font-size: 8px; color: #666; margin-top: 5px;">mainnet-beta</div>
          `;
        } catch (e) {
          this.overlayEl.innerHTML = `
            <div style="color: #ff4444;">✗ OFFLINE</div>
            <div style="font-size: 8px; color: #666;">Network unreachable</div>
          `;
        }
      };
      
      check();
      this.checkInterval = setInterval(check, 15000);
    },
    
    stopHealthChecks: function() {
      if (this.checkInterval) {
        clearInterval(this.checkInterval);
        this.checkInterval = null;
      }
    }
  });

  // ========================================
  // MOD 4: Nulla Voice (Speak mode changes)
  // ========================================
  PShell.registerMod({
    id: 'com.paradox.mods.nulla-voice',
    name: 'Nulla Voice',
    description: 'Nulla announces reality mode changes',
    matches: ['*'],
    
    lastMode: null,
    
    onRealityChange: function(level) {
      if (!window.Nulla) return;
      
      const mode = level <= 0.1 ? 'subzero' : level <= 0.5 ? 'chill' : 'hot';
      
      if (this.lastMode === mode) return;
      this.lastMode = mode;
      
      const messages = {
        subzero: [
          '🧊 SUBZERO ENGAGED. Reality inverted. Truth crystallized.',
          '🧊 Entering the void. All noise frozen. Only signal remains.',
          '🧊 Matrix mode active. I see the code now.'
        ],
        chill: [
          '❄️ Chill mode. Trackers neutralized. Privacy shield online.',
          '❄️ Cooling down. Surveillance frozen.',
          '❄️ Privacy mode engaged. They cannot see us here.'
        ],
        hot: [
          '🔥 Back to reality. Normal operations resumed.',
          '🔥 Hot mode. Standard browsing active.',
          '🔥 Exiting the void. Welcome back to the surface.'
        ]
      };
      
      const options = messages[mode];
      const msg = options[Math.floor(Math.random() * options.length)];
      
      Nulla.addMessage('nulla', msg, mode === 'subzero' ? 'glitch' : mode === 'chill' ? 'scanning' : 'safe');
    }
  });

  // ========================================
  // MOD 5: Hash Verifier (Subzero Truth)
  // ========================================
  PShell.registerMod({
    id: 'com.paradox.mods.hash-verifier',
    name: 'Subzero Hash Verifier',
    description: 'Shows content hash in Subzero mode for verification',
    matches: ['*'],
    
    hashEl: null,
    
    onLoad: function() {
      this.hashEl = document.createElement('div');
      this.hashEl.id = 'mod-hash-verifier';
      this.hashEl.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.9);
        border: 1px solid rgba(0, 255, 255, 0.5);
        border-radius: 6px;
        padding: 8px 16px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        color: #00ffff;
        z-index: 99999;
        display: none;
        cursor: pointer;
      `;
      this.hashEl.title = 'Click to copy hash';
      this.hashEl.onclick = () => {
        navigator.clipboard.writeText(this.hashEl.dataset.fullHash || '');
        this.hashEl.style.borderColor = '#00ff88';
        setTimeout(() => {
          this.hashEl.style.borderColor = 'rgba(0, 255, 255, 0.5)';
        }, 500);
      };
      document.body.appendChild(this.hashEl);
    },
    
    onRealityChange: async function(level) {
      if (level <= 0.1) {
        // Calculate content hash in Subzero
        const content = document.body.innerText;
        const hash = await this.sha256(content);
        
        this.hashEl.innerHTML = `🔐 Content SHA256: <code>${hash.slice(0, 16)}...</code>`;
        this.hashEl.dataset.fullHash = hash;
        this.hashEl.style.display = 'block';
      } else {
        this.hashEl.style.display = 'none';
      }
    },
    
    sha256: async function(text) {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  });

  console.log('📦 P-Shell: 5 example mods registered');
}

