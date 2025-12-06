/**
 * P-SHELL - Paradox Shell v0.1
 * "Subzero Nexus" Reality Editor
 * 
 * Features:
 * - Reality Slider (Hot → Chill → Subzero modes)
 * - Nexus HUD (stats overlay)
 * - Entropy-based visual system
 * - Mod System skeleton
 * 
 * Philosophy: Web0 at subzero temps freezes the hot mess of Web2/3 
 * into pure, invertible truth.
 */

const PShell = {
  // Reality level: 0.0 (Subzero) to 1.0 (Hot)
  realityLevel: 1.0,
  
  // Entropy: 0-100 (data health, drives visuals)
  entropy: 100,
  
  // HUD stats
  stats: {
    fps: 60,
    ping: 0,
    threats: 0,
    modsActive: 0
  },
  
  // Installed mods
  mods: [],
  
  // DOM references
  container: null,
  hudEl: null,
  sliderEl: null,

  // ========================================
  // INITIALIZATION
  // ========================================
  
  init() {
    console.log('🧊 P-Shell: Initializing Subzero Nexus...');
    
    // Create HUD
    this.createHUD();
    
    // Create Reality Slider
    this.createRealitySlider();
    
    // Start stats loop
    this.startStatsLoop();
    
    // Apply initial reality level
    this.setRealityLevel(this.realityLevel);
    
    // Register keyboard shortcuts
    this.registerShortcuts();
    
    // Listen for Nulla state changes to update entropy
    this.hookNulla();
    
    console.log('🧊 P-Shell: Subzero Nexus online');
    return this;
  },

  // ========================================
  // NEXUS HUD (Stats Overlay)
  // ========================================
  
  createHUD() {
    const hud = document.createElement('div');
    hud.id = 'pshell-hud';
    hud.innerHTML = `
      <div class="hud-title">⚡ NEXUS</div>
      <div class="hud-stats">
        <div class="hud-stat">
          <span class="stat-label">FPS</span>
          <span class="stat-value" id="hud-fps">60</span>
        </div>
        <div class="hud-stat">
          <span class="stat-label">PING</span>
          <span class="stat-value" id="hud-ping">--</span>
        </div>
        <div class="hud-stat">
          <span class="stat-label">ENTROPY</span>
          <span class="stat-value" id="hud-entropy">100%</span>
        </div>
        <div class="hud-stat">
          <span class="stat-label">THREATS</span>
          <span class="stat-value" id="hud-threats">0</span>
        </div>
      </div>
      <div class="hud-mode" id="hud-mode">HOT</div>
    `;
    
    document.body.appendChild(hud);
    this.hudEl = hud;
  },
  
  updateHUD() {
    const fpsEl = document.getElementById('hud-fps');
    const pingEl = document.getElementById('hud-ping');
    const entropyEl = document.getElementById('hud-entropy');
    const threatsEl = document.getElementById('hud-threats');
    const modeEl = document.getElementById('hud-mode');
    
    if (fpsEl) fpsEl.textContent = this.stats.fps;
    if (pingEl) pingEl.textContent = this.stats.ping > 0 ? `${this.stats.ping}ms` : '--';
    if (entropyEl) {
      entropyEl.textContent = `${this.entropy}%`;
      entropyEl.style.color = this.entropy > 70 ? '#00ff88' : 
                              this.entropy > 30 ? '#ffaa00' : '#ff4444';
    }
    if (threatsEl) {
      threatsEl.textContent = this.stats.threats;
      threatsEl.style.color = this.stats.threats > 0 ? '#ff4444' : '#00ff88';
    }
    if (modeEl) {
      const mode = this.realityLevel <= 0.1 ? 'SUBZERO' :
                   this.realityLevel <= 0.5 ? 'CHILL' : 'HOT';
      modeEl.textContent = mode;
      modeEl.className = `hud-mode mode-${mode.toLowerCase()}`;
    }
  },

  // ========================================
  // REALITY SLIDER
  // ========================================
  
  createRealitySlider() {
    const slider = document.createElement('div');
    slider.id = 'pshell-reality-slider';
    slider.innerHTML = `
      <div class="slider-label">
        <span class="label-hot">🔥 HOT</span>
        <span class="label-chill">❄️ CHILL</span>
        <span class="label-subzero">🧊 SUBZERO</span>
      </div>
      <div class="slider-track">
        <input type="range" id="reality-slider" min="0" max="100" value="100" />
        <div class="slider-fill" id="slider-fill"></div>
      </div>
      <div class="slider-temp" id="slider-temp">100%</div>
    `;
    
    document.body.appendChild(slider);
    this.sliderEl = slider;
    
    // Bind slider events
    const input = document.getElementById('reality-slider');
    input.addEventListener('input', (e) => {
      this.setRealityLevel(e.target.value / 100);
    });
    
    // Double-click to toggle extremes
    input.addEventListener('dblclick', () => {
      const newLevel = this.realityLevel > 0.5 ? 0 : 1;
      this.setRealityLevel(newLevel);
      input.value = newLevel * 100;
    });
  },
  
  setRealityLevel(level) {
    this.realityLevel = Math.max(0, Math.min(1, level));
    
    // Update slider visuals
    const fill = document.getElementById('slider-fill');
    const temp = document.getElementById('slider-temp');
    const slider = document.getElementById('reality-slider');
    
    if (fill) {
      fill.style.width = `${this.realityLevel * 100}%`;
      // Color gradient: Subzero (cyan) → Chill (blue) → Hot (orange)
      const hue = this.realityLevel * 30; // 0 = cyan(180), 30 = orange
      fill.style.background = this.realityLevel <= 0.1 ? 
        'linear-gradient(90deg, #00ffff, #0088ff)' :
        this.realityLevel <= 0.5 ?
        'linear-gradient(90deg, #0088ff, #8855ff)' :
        'linear-gradient(90deg, #ff9500, #ff4444)';
    }
    if (temp) temp.textContent = `${Math.round(this.realityLevel * 100)}%`;
    if (slider) slider.value = this.realityLevel * 100;
    
    // Apply visual mode
    this.applyRealityMode();
    
    // Update HUD
    this.updateHUD();
    
    // Notify mods
    this.broadcastRealityChange();
  },
  
  applyRealityMode() {
    const body = document.body;
    
    // Remove all mode classes
    body.classList.remove('pshell-hot', 'pshell-chill', 'pshell-subzero');
    
    if (this.realityLevel <= 0.1) {
      // SUBZERO MODE - Full invert, terminal aesthetic
      body.classList.add('pshell-subzero');
      this.enterSubzeroMode();
    } else if (this.realityLevel <= 0.5) {
      // CHILL MODE - Privacy focused, muted colors
      body.classList.add('pshell-chill');
      this.enterChillMode();
    } else {
      // HOT MODE - Normal browsing
      body.classList.add('pshell-hot');
      this.enterHotMode();
    }
  },
  
  enterSubzeroMode() {
    console.log('🧊 P-Shell: Entering SUBZERO mode');
    
    // Tell Nulla
    if (window.Nulla) {
      Nulla.setMood('glitch');
      Nulla.addMessage('nulla', 
        '🧊 SUBZERO MODE ACTIVATED<br>Reality inverted. Truth remains. Only signal survives.',
        'glitch'
      );
    }
    
    // Inject subzero styles if not already present
    if (!document.getElementById('pshell-subzero-styles')) {
      this.injectSubzeroStyles();
    }
  },
  
  enterChillMode() {
    console.log('❄️ P-Shell: Entering CHILL mode');
    
    if (window.Nulla) {
      Nulla.setMood('scanning');
      Nulla.addMessage('nulla', 
        '❄️ Chill mode engaged. Trackers frozen. Privacy shield up.',
        'scanning'
      );
    }
  },
  
  enterHotMode() {
    console.log('🔥 P-Shell: Entering HOT mode');
    
    if (window.Nulla) {
      Nulla.setMood('safe');
    }
  },
  
  injectSubzeroStyles() {
    const style = document.createElement('style');
    style.id = 'pshell-subzero-styles';
    style.textContent = `
      /* SUBZERO MODE - Terminal Reality */
      .pshell-subzero {
        filter: invert(1) hue-rotate(180deg) !important;
        background: #000 !important;
      }
      
      .pshell-subzero * {
        font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
        text-shadow: 0 0 2px currentColor !important;
      }
      
      .pshell-subzero img {
        filter: invert(1) hue-rotate(180deg) grayscale(50%) !important;
      }
      
      /* Exempt Nulla and HUD from inversion */
      .pshell-subzero #nulla-app,
      .pshell-subzero #pshell-hud,
      .pshell-subzero #pshell-reality-slider {
        filter: invert(1) hue-rotate(180deg) !important;
      }
      
      /* Matrix rain effect */
      .pshell-subzero::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: 
          repeating-linear-gradient(
            0deg,
            rgba(0, 255, 0, 0.03) 0px,
            rgba(0, 255, 0, 0.03) 1px,
            transparent 1px,
            transparent 2px
          );
        pointer-events: none;
        z-index: 99998;
        animation: pshell-scanlines 0.1s linear infinite;
      }
      
      @keyframes pshell-scanlines {
        0% { transform: translateY(0); }
        100% { transform: translateY(2px); }
      }
      
      /* CHILL MODE - Privacy frost */
      .pshell-chill {
        filter: saturate(0.7) contrast(0.95) !important;
      }
      
      .pshell-chill::before {
        content: '';
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 100, 255, 0.03);
        pointer-events: none;
        z-index: 99998;
      }
    `;
    document.head.appendChild(style);
  },

  // ========================================
  // ENTROPY SYSTEM
  // ========================================
  
  setEntropy(value) {
    this.entropy = Math.max(0, Math.min(100, value));
    this.updateHUD();
    
    // Apply entropy-based effects to Nulla
    this.applyEntropyEffects();
  },
  
  applyEntropyEffects() {
    const nullaChar = document.querySelector('#nulla-char') || 
                      document.querySelector('.nulla-character');
    if (!nullaChar) return;
    
    // Low entropy = more glitch
    if (this.entropy < 30) {
      nullaChar.style.filter = `
        brightness(${0.5 + this.entropy/60})
        saturate(${this.entropy/100})
        contrast(${1 + (100 - this.entropy)/200})
      `;
      nullaChar.style.animation = 'pshell-entropy-glitch 0.3s infinite';
    } else if (this.entropy < 70) {
      nullaChar.style.filter = `saturate(${0.5 + this.entropy/200})`;
      nullaChar.style.animation = '';
    } else {
      nullaChar.style.filter = '';
      nullaChar.style.animation = '';
    }
  },

  // ========================================
  // STATS LOOP
  // ========================================
  
  startStatsLoop() {
    let lastTime = performance.now();
    let frames = 0;
    
    const loop = () => {
      frames++;
      const now = performance.now();
      
      if (now - lastTime >= 1000) {
        this.stats.fps = frames;
        frames = 0;
        lastTime = now;
        this.updateHUD();
      }
      
      requestAnimationFrame(loop);
    };
    
    requestAnimationFrame(loop);
    
    // Ping check every 10s
    setInterval(() => this.checkPing(), 10000);
    this.checkPing();
  },
  
  async checkPing() {
    try {
      const start = performance.now();
      await fetch('https://api.mainnet-beta.solana.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' })
      });
      this.stats.ping = Math.round(performance.now() - start);
    } catch {
      this.stats.ping = 0;
    }
    this.updateHUD();
  },

  // ========================================
  // KEYBOARD SHORTCUTS
  // ========================================
  
  registerShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+Shift+0 = Toggle Subzero
      if (e.ctrlKey && e.shiftKey && e.key === '0') {
        e.preventDefault();
        this.setRealityLevel(this.realityLevel <= 0.1 ? 1 : 0);
      }
      
      // Ctrl+Shift+H = Toggle HUD
      if (e.ctrlKey && e.shiftKey && e.key === 'H') {
        e.preventDefault();
        this.toggleHUD();
      }
      
      // Ctrl+Shift+S = Toggle Slider
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        this.toggleSlider();
      }
    });
  },
  
  toggleHUD() {
    if (this.hudEl) {
      this.hudEl.style.display = 
        this.hudEl.style.display === 'none' ? 'block' : 'none';
    }
  },
  
  toggleSlider() {
    if (this.sliderEl) {
      this.sliderEl.style.display = 
        this.sliderEl.style.display === 'none' ? 'block' : 'none';
    }
  },

  // ========================================
  // NULLA INTEGRATION
  // ========================================
  
  hookNulla() {
    // Watch for Nulla state changes
    const checkNulla = setInterval(() => {
      if (window.Nulla && Nulla.state) {
        clearInterval(checkNulla);
        
        // Update entropy based on Nulla's state
        const updateEntropy = () => {
          if (!Nulla.state) return;
          
          // Calculate entropy from various factors
          let e = 100;
          
          // Network health
          const latency = Nulla.state.userProfile?.networkStats?.mainnet?.lastLatency || 0;
          if (latency > 500) e -= 20;
          else if (latency > 200) e -= 10;
          
          // Knowledge health
          const kbCount = Nulla.state.knowledgeBase?.length || 0;
          e += Math.min(10, kbCount); // More knowledge = more entropy
          
          // Evolution bonus
          e += (Nulla.state.evolution?.stage || 1) * 2;
          
          // Cap at 100
          this.setEntropy(Math.min(100, Math.max(0, e)));
        };
        
        // Update on first load
        updateEntropy();
        
        // Hook into Nulla's save
        const originalSave = Nulla.saveState?.bind(Nulla);
        if (originalSave) {
          Nulla.saveState = async function() {
            await originalSave();
            updateEntropy();
          };
        }
      }
    }, 500);
  },

  // ========================================
  // MOD SYSTEM (Foundation)
  // ========================================
  
  /**
   * Register a mod
   * @param {Object} mod - Mod definition
   * @param {string} mod.id - Unique identifier
   * @param {string} mod.name - Display name
   * @param {string[]} mod.matches - URL patterns to match
   * @param {Function} mod.onLoad - Called when page loads
   * @param {Function} mod.onRealityChange - Called when reality level changes
   */
  registerMod(mod) {
    if (!mod.id || !mod.name) {
      console.error('P-Shell: Mod missing required fields');
      return false;
    }
    
    // Check if already registered
    if (this.mods.find(m => m.id === mod.id)) {
      console.warn(`P-Shell: Mod ${mod.id} already registered`);
      return false;
    }
    
    this.mods.push({
      ...mod,
      enabled: true,
      loadedAt: Date.now()
    });
    
    this.stats.modsActive = this.mods.filter(m => m.enabled).length;
    this.updateHUD();
    
    console.log(`🔌 P-Shell: Mod "${mod.name}" registered`);
    
    // Call onLoad if matches current page
    if (this.matchesCurrentPage(mod.matches)) {
      try {
        mod.onLoad?.({ page: this.getPageAPI() });
      } catch (e) {
        console.error(`P-Shell: Mod ${mod.id} onLoad error:`, e);
      }
    }
    
    return true;
  },
  
  matchesCurrentPage(patterns) {
    if (!patterns || patterns.length === 0 || patterns.includes('*')) {
      return true;
    }
    
    const url = window.location.href;
    return patterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(url);
      }
      return url.includes(pattern);
    });
  },
  
  broadcastRealityChange() {
    this.mods.forEach(mod => {
      if (mod.enabled && mod.onRealityChange) {
        try {
          mod.onRealityChange(this.realityLevel);
        } catch (e) {
          console.error(`P-Shell: Mod ${mod.id} onRealityChange error:`, e);
        }
      }
    });
  },
  
  // Simple page API for mods
  getPageAPI() {
    return {
      query: (sel) => document.querySelector(sel),
      queryAll: (sel) => document.querySelectorAll(sel),
      remove: (sel) => document.querySelectorAll(sel).forEach(el => el.remove()),
      injectCSS: (css) => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        return style;
      },
      location: () => ({
        href: window.location.href,
        origin: window.location.origin,
        path: window.location.pathname
      }),
      text: (sel) => document.querySelector(sel)?.textContent || ''
    };
  },

  // ========================================
  // UTILITY
  // ========================================
  
  // Export current state
  exportState() {
    return {
      realityLevel: this.realityLevel,
      entropy: this.entropy,
      mods: this.mods.map(m => ({ id: m.id, name: m.name, enabled: m.enabled })),
      timestamp: Date.now()
    };
  }
};

// ========================================
// STYLES
// ========================================

const pshellStyles = document.createElement('style');
pshellStyles.id = 'pshell-core-styles';
pshellStyles.textContent = `
  /* NEXUS HUD */
  #pshell-hud {
    position: fixed;
    top: 20px;
    left: 20px;
    background: linear-gradient(135deg, rgba(0, 10, 20, 0.95), rgba(0, 20, 40, 0.9));
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 12px;
    padding: 12px 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #fff;
    z-index: 99999;
    backdrop-filter: blur(10px);
    box-shadow: 
      0 0 20px rgba(0, 255, 255, 0.1),
      inset 0 0 30px rgba(0, 255, 255, 0.02);
    min-width: 140px;
    animation: pshell-hud-glow 3s ease-in-out infinite;
  }
  
  @keyframes pshell-hud-glow {
    0%, 100% { box-shadow: 0 0 20px rgba(0, 255, 255, 0.1); }
    50% { box-shadow: 0 0 30px rgba(0, 255, 255, 0.2); }
  }
  
  .hud-title {
    color: #00ffff;
    font-weight: bold;
    text-align: center;
    margin-bottom: 10px;
    font-size: 12px;
    letter-spacing: 2px;
    text-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
  }
  
  .hud-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  
  .hud-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  
  .stat-label {
    font-size: 8px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  
  .stat-value {
    font-size: 14px;
    font-weight: bold;
    color: #00ff88;
  }
  
  .hud-mode {
    text-align: center;
    margin-top: 10px;
    padding: 6px;
    border-radius: 4px;
    font-weight: bold;
    font-size: 10px;
    letter-spacing: 2px;
  }
  
  .mode-hot {
    background: linear-gradient(90deg, rgba(255, 100, 0, 0.3), rgba(255, 50, 50, 0.3));
    color: #ff6600;
    border: 1px solid rgba(255, 100, 0, 0.5);
  }
  
  .mode-chill {
    background: linear-gradient(90deg, rgba(0, 100, 255, 0.3), rgba(100, 50, 255, 0.3));
    color: #00aaff;
    border: 1px solid rgba(0, 150, 255, 0.5);
  }
  
  .mode-subzero {
    background: linear-gradient(90deg, rgba(0, 255, 255, 0.3), rgba(0, 200, 255, 0.3));
    color: #00ffff;
    border: 1px solid rgba(0, 255, 255, 0.5);
    animation: pshell-subzero-pulse 1s infinite;
  }
  
  @keyframes pshell-subzero-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
  
  /* REALITY SLIDER */
  #pshell-reality-slider {
    position: fixed;
    bottom: 100px;
    left: 20px;
    background: linear-gradient(135deg, rgba(0, 10, 20, 0.95), rgba(0, 20, 40, 0.9));
    border: 1px solid rgba(0, 255, 255, 0.3);
    border-radius: 12px;
    padding: 15px;
    font-family: 'JetBrains Mono', monospace;
    z-index: 99999;
    backdrop-filter: blur(10px);
    width: 200px;
  }
  
  .slider-label {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: #666;
    margin-bottom: 8px;
  }
  
  .label-hot { color: #ff6600; }
  .label-chill { color: #00aaff; }
  .label-subzero { color: #00ffff; }
  
  .slider-track {
    position: relative;
    height: 8px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 4px;
    overflow: hidden;
  }
  
  .slider-track input {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    z-index: 2;
  }
  
  .slider-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: linear-gradient(90deg, #00ffff, #ff6600);
    border-radius: 4px;
    transition: width 0.2s ease, background 0.3s ease;
    z-index: 1;
  }
  
  .slider-temp {
    text-align: center;
    margin-top: 8px;
    font-size: 18px;
    font-weight: bold;
    color: #00ffff;
    text-shadow: 0 0 10px rgba(0, 255, 255, 0.5);
  }
  
  /* Entropy glitch animation */
  @keyframes pshell-entropy-glitch {
    0% { transform: translate(0); }
    25% { transform: translate(-2px, 1px); }
    50% { transform: translate(2px, -1px); }
    75% { transform: translate(-1px, -1px); }
    100% { transform: translate(0); }
  }
  
  /* Hide controls on mobile by default */
  @media (max-width: 768px) {
    #pshell-hud {
      top: auto;
      bottom: 10px;
      left: 10px;
      transform: scale(0.9);
      transform-origin: bottom left;
    }
    
    #pshell-reality-slider {
      display: none;
    }
  }
`;

// ========================================
// AUTO-INIT
// ========================================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(pshellStyles);
    PShell.init();
  });
} else {
  document.head.appendChild(pshellStyles);
  PShell.init();
}

// Expose globally
window.PShell = PShell;

