/**
 * ALYA QUANTUM CONTROL ROOM — GAME ENGINE
 * Motor do Jogo de Painel Futurista com Web Audio API e Canvas Particle Engine.
 */

// ── Web Audio API Sound Engine ──
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  }

  playClick() {
    if (!this.enabled) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.05);
  }

  playPulse() {
    if (!this.enabled) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, this.ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.15);
  }

  playFix() {
    if (!this.enabled) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(523.25, this.ctx.currentTime); // C5
    osc.frequency.setValueAtTime(659.25, this.ctx.currentTime + 0.08); // E5
    osc.frequency.setValueAtTime(783.99, this.ctx.currentTime + 0.16); // G5
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.25);
  }

  playAlarm() {
    if (!this.enabled) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 0.2);
    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.2);
  }
}

const sounds = new SoundEngine();

// ── Particle Background Canvas Engine ──
const canvas = document.getElementById('canvas-bg');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * canvas.height;
    this.vx = (Math.random() - 0.5) * 0.8;
    this.vy = (Math.random() - 0.5) * 0.8;
    this.radius = Math.random() * 2 + 1;
    this.alpha = Math.random() * 0.5 + 0.2;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    if (this.x < 0 || this.x > canvas.width) this.vx *= -1;
    if (this.y < 0 || this.y > canvas.height) this.vy *= -1;
  }

  draw() {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 240, 255, ${this.alpha})`;
    ctx.shadowBlur = 8;
    ctx.shadowColor = '#00f0ff';
    ctx.fill();
  }
}

for (let i = 0; i < 45; i++) {
  particles.push(new Particle());
}

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => {
    p.update();
    p.draw();
  });
  requestAnimationFrame(animateParticles);
}
animateParticles();

// ── Main Game State ──
const state = {
  score: 0,
  energy: 1000,
  threatLvl: 1.0,
  health: 100,
  temp: 42,
  power: {
    brain: 25,
    shields: 25,
    firewall: 25,
    coolant: 25
  },
  threats: [
    { id: 0, name: 'Ataque DDoS', active: false, severity: 1.2 },
    { id: 1, name: 'Sobrecarga Quântica', active: false, severity: 2.0 },
    { id: 2, name: 'Injeção Malware', active: false, severity: 1.5 },
    { id: 3, name: 'Flutuação de Fase', active: false, severity: 1.8 }
  ],
  upgrades: {
    cryo: { level: 0, cost: 150 },
    shield: { level: 0, cost: 300 },
    gen: { level: 0, cost: 500 }
  },
  gameOver: false
};

// ── UI Elements ──
const scoreVal = document.getElementById('score-val');
const energyVal = document.getElementById('energy-val');
const threatLvlVal = document.getElementById('threat-lvl-val');
const healthVal = document.getElementById('health-val');
const coreTempVal = document.getElementById('core-temp-val');
const reactorCoreBtn = document.getElementById('reactor-core-btn');
const logTerminal = document.getElementById('log-terminal');
const activeBreachesCount = document.getElementById('active-breaches-count');
const soundBtn = document.getElementById('sound-btn');
const modal = document.getElementById('gameover-modal');
const restartBtn = document.getElementById('restart-btn');
const finalScore = document.getElementById('final-score');

// Slider Inputs
const sliders = {
  brain: document.getElementById('pwr-brain'),
  shields: document.getElementById('pwr-shields'),
  firewall: document.getElementById('pwr-firewall'),
  coolant: document.getElementById('pwr-coolant')
};

// Log Writer
function addLog(text, type = 'info') {
  const div = document.createElement('div');
  div.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString();
  div.textContent = `[${time}] ${text}`;
  logTerminal.prepend(div);
  if (logTerminal.children.length > 25) {
    logTerminal.removeChild(logTerminal.lastChild);
  }
}

// ── Core Interactions ──

// Reactor Core Tap (Generates Energy & Increases Temp)
reactorCoreBtn.addEventListener('click', () => {
  if (state.gameOver) return;
  sounds.playPulse();
  const genBonus = 1 + (state.upgrades.gen.level * 0.5);
  const addEnergy = Math.floor(15 * genBonus);
  state.energy += addEnergy;
  state.temp = Math.min(120, state.temp + 1.5);
  state.score += 10;
  updateUI();
});

// Power Sliders
Object.keys(sliders).forEach(key => {
  sliders[key].addEventListener('input', (e) => {
    sounds.playClick();
    state.power[key] = parseInt(e.target.value);
    document.getElementById(`pwr-${key}-val`).textContent = `${state.power[key]}%`;
  });
});

// Threat Repair Buttons
[0, 1, 2, 3].forEach(id => {
  const btn = document.getElementById(`btn-fix-${id}`);
  btn.addEventListener('click', () => {
    if (state.gameOver) return;
    if (state.threats[id].active) {
      sounds.playFix();
      state.threats[id].active = false;
      document.getElementById(`threat-${id}`).classList.remove('active');
      state.score += 50;
      addLog(`[AMEAÇA RESOLVIDA] Protocolo de contenção ${state.threats[id].name} executado!`, 'success');
      updateUI();
    }
  });
});

// Upgrades
document.getElementById('upg1-btn').addEventListener('click', () => {
  buyUpgrade('cryo', 150, 'Resfriamento Crio');
});
document.getElementById('upg2-btn').addEventListener('click', () => {
  buyUpgrade('shield', 300, 'Auto-Escudo AI');
});
document.getElementById('upg3-btn').addEventListener('click', () => {
  buyUpgrade('gen', 500, 'Gerador Quântico');
});

function buyUpgrade(key, baseCost, name) {
  const upg = state.upgrades[key];
  if (state.energy >= upg.cost) {
    sounds.playFix();
    state.energy -= upg.cost;
    upg.level++;
    upg.cost = Math.floor(upg.cost * 1.6);
    addLog(`[UPGRADE] ${name} atualizado para Nível ${upg.level}!`, 'success');
    updateUI();
  } else {
    sounds.playAlarm();
    addLog(`[ERRO] Energia insuficiente para ${name}.`, 'alert');
  }
}

// Sound Toggle
soundBtn.addEventListener('click', () => {
  sounds.enabled = !sounds.enabled;
  soundBtn.textContent = `🔊 SOM: ${sounds.enabled ? 'LIGADO' : 'DESLIGADO'}`;
});

// ── Game Loop Engine ──
setInterval(() => {
  if (state.gameOver) return;

  // 1. Thermal Dissipation based on Coolant Power
  const coolantEff = state.power.coolant / 100;
  const cryoBonus = state.upgrades.cryo.level * 0.8;
  state.temp = Math.max(35, state.temp - (0.8 * coolantEff + cryoBonus));

  // Overheat Damage
  if (state.temp > 85) {
    sounds.playAlarm();
    const dmg = (state.temp - 85) * 0.15;
    state.health = Math.max(0, state.health - dmg);
    addLog(`[ALERTA DE TEMPERATURA] Reator em ${Math.floor(state.temp)}°C! Danificando estruturas!`, 'alert');
  }

  // 2. Active Threats Damage
  let activeCount = 0;
  state.threats.forEach(t => {
    if (t.active) {
      activeCount++;
      const shieldDef = (state.power.shields + state.power.firewall) / 200;
      const autoShieldBonus = state.upgrades.shield.level * 0.15;
      const netDmg = Math.max(0.2, (t.severity * 0.8) - (shieldDef + autoShieldBonus));
      state.health = Math.max(0, state.health - netDmg);
    }
  });

  // 3. Random Threat Breach Spawner
  if (Math.random() < 0.12 * state.threatLvl) {
    const inactive = state.threats.filter(t => !t.active);
    if (inactive.length > 0) {
      const target = inactive[Math.floor(Math.random() * inactive.length)];
      target.active = true;
      document.getElementById(`threat-${target.id}`).classList.add('active');
      sounds.playAlarm();
      addLog(`[AMEAÇA CIBERNÉTICA] Invasão detectada: ${target.name}!`, 'alert');
    }
  }

  // 4. Passive Energy Generation from Brain
  state.energy += Math.floor(2 + (state.power.brain / 25));
  state.score += 1;
  state.threatLvl += 0.005;

  // Check Game Over
  if (state.health <= 0) {
    triggerGameOver();
  }

  updateUI();
}, 1000);

function updateUI() {
  scoreVal.textContent = String(Math.floor(state.score)).padStart(4, '0');
  energyVal.textContent = `${Math.floor(state.energy)} W`;
  threatLvlVal.textContent = `${state.threatLvl.toFixed(1)}x`;
  healthVal.textContent = `${Math.ceil(state.health)}%`;
  coreTempVal.textContent = `${Math.floor(state.temp)}°C`;

  // Active Breaches Counter
  const activeCount = state.threats.filter(t => t.active).length;
  activeBreachesCount.textContent = `${activeCount} AMEAÇAS`;

  // Upgrades Costs
  document.getElementById('upg1-cost').textContent = `${state.upgrades.cryo.cost} Energia (Nv ${state.upgrades.cryo.level})`;
  document.getElementById('upg2-cost').textContent = `${state.upgrades.shield.cost} Energia (Nv ${state.upgrades.shield.level})`;
  document.getElementById('upg3-cost').textContent = `${state.upgrades.gen.cost} Energia (Nv ${state.upgrades.gen.level})`;

  // Disable upgrade buttons if insufficient energy
  document.getElementById('upg1-btn').disabled = state.energy < state.upgrades.cryo.cost;
  document.getElementById('upg2-btn').disabled = state.energy < state.upgrades.shield.cost;
  document.getElementById('upg3-btn').disabled = state.energy < state.upgrades.gen.cost;
}

function triggerGameOver() {
  state.gameOver = true;
  sounds.playAlarm();
  finalScore.textContent = `Pontuação Final: ${Math.floor(state.score)}`;
  modal.classList.add('show');
}

restartBtn.addEventListener('click', () => {
  state.score = 0;
  state.energy = 1000;
  state.threatLvl = 1.0;
  state.health = 100;
  state.temp = 42;
  state.threats.forEach(t => {
    t.active = false;
    document.getElementById(`threat-${t.id}`).classList.remove('active');
  });
  state.upgrades.cryo.level = 0; state.upgrades.cryo.cost = 150;
  state.upgrades.shield.level = 0; state.upgrades.shield.cost = 300;
  state.upgrades.gen.level = 0; state.upgrades.gen.cost = 500;
  state.gameOver = false;
  modal.classList.remove('show');
  addLog('[REINICIALIZAÇÃO] Reator recarregado com sucesso.', 'info');
  updateUI();
});
