/* ============================================
   FitBuddy — Mini-Games: Breather, Reflex, Hamster, Catcher
   With Web Audio API Retro Sound Effects
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── DOM References (resolved lazily) ────
const $ = (id) => document.getElementById(id);

// ──── Active Game State ────
let activeGame   = null;   // 'breather' | 'reflex' | 'hamster' | 'catcher' | null
let gameTimers   = [];     // All setTimeout / setInterval IDs for cleanup
let gameCleanup  = null;   // Custom cleanup callback for current game

/** Register a timer so it can be cleared on game exit */
function addTimer(id) { gameTimers.push(id); return id; }

/** Clear all running game timers */
function clearAllTimers() {
  gameTimers.forEach(id => { clearTimeout(id); clearInterval(id); });
  gameTimers = [];
}

// ──── Web Audio API Synthesizer (Zero-dependency Sound Effects) ────
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Play a synthesizer note.
 * @param {number} freq - frequency in Hz
 * @param {string} type - oscillator type ('sine', 'square', 'sawtooth', 'triangle')
 * @param {number} duration - duration in seconds
 * @param {number} volume - volume multiplier
 */
function playTone(freq, type, duration, volume = 0.1) {
  try {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    
    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    // Linear decay to prevent clicking sounds
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.warn('Audio Context failed to play tone:', e);
  }
}

// Sound effects:
const sound = {
  click: () => playTone(600, 'sine', 0.08, 0.08),
  hit: () => {
    // Pleasant high-pitched chime
    playTone(880, 'triangle', 0.12, 0.12);
  },
  miss: () => {
    // Low-pitched buzz
    playTone(150, 'sawtooth', 0.2, 0.08);
  },
  levelUp: () => {
    // Happy upward arpeggio
    setTimeout(() => playTone(523.25, 'sine', 0.15, 0.12), 0); // C5
    setTimeout(() => playTone(659.25, 'sine', 0.15, 0.12), 80); // E5
    setTimeout(() => playTone(783.99, 'sine', 0.15, 0.12), 160); // G5
    setTimeout(() => playTone(1046.50, 'sine', 0.25, 0.15), 240); // C6
  },
  start: () => {
    // Game start sound
    playTone(440, 'triangle', 0.08, 0.08);
    setTimeout(() => playTone(554.37, 'triangle', 0.08, 0.08), 80);
    setTimeout(() => playTone(659.25, 'triangle', 0.2, 0.12), 160);
  },
  gameOver: () => {
    // Downward sad sound
    playTone(392, 'sawtooth', 0.15, 0.08);
    setTimeout(() => playTone(349.23, 'sawtooth', 0.15, 0.08), 120);
    setTimeout(() => playTone(311.13, 'sawtooth', 0.35, 0.12), 240);
  }
};

// ──── Overlay Management ────

function openOverlay() {
  const overlay = $('game-overlay');
  if (overlay) overlay.classList.add('visible');
}

function closeOverlay() {
  const overlay = $('game-overlay');
  if (overlay) overlay.classList.remove('visible');
}

/** Full teardown: stop timers, clear canvas, close overlay */
function stopGame() {
  clearAllTimers();
  if (gameCleanup) { gameCleanup(); gameCleanup = null; }
  activeGame = null;

  const canvas = $('game-canvas');
  if (canvas) canvas.innerHTML = '';
  const timer = $('game-timer');
  if (timer) timer.textContent = '';
  const score = $('game-score');
  if (score) score.textContent = '';
  const instruction = $('game-instruction');
  if (instruction) instruction.textContent = '';

  const postgameModal = $('postgame-modal');
  if (postgameModal) postgameModal.classList.remove('visible');

  closeOverlay();
}

// ──── Post-Game Flow ────

/** Called when any game finishes naturally */
function onGameComplete(gameName, score) {
  clearAllTimers();
  if (gameCleanup) { gameCleanup(); gameCleanup = null; }

  // Award completion XP
  EventBus.emit('xp:gained', { amount: 25, reason: `Completed ${gameName}` });
  EventBus.emit('game:completed', { game: gameName, score });

  const modal    = $('postgame-modal');
  const title    = $('postgame-title');
  const subtitle = $('postgame-subtitle');

  // Show refined postgame feedback for negative moods
  if (State.isStressedOrExhausted) {
    const moodLabel = State.today.mood === 'sad' ? 'feeling down' :
                      State.today.mood === 'exhausted' ? 'feeling tired' : 'feeling stressed';
    if (title) title.textContent = `Well Done! 🎉`;
    if (subtitle) subtitle.textContent = `You were ${moodLabel} earlier. Did this game help you feel better?`;
    if (modal) modal.classList.add('visible');
  } else {
    // For happy/neutral moods, just show a quick celebration
    closeOverlay();
    activeGame = null;
    showToast(`Great ${gameName}! You scored ${score}! 🎮`, '🎉', 3000);
  }
}

function initPostgameModal() {
  const modal = $('postgame-modal');
  const yesBtn = $('postgame-yes');
  const noBtn  = $('postgame-no');
  const subtitle = $('postgame-subtitle');

  if (yesBtn) {
    yesBtn.addEventListener('click', () => {
      // Show a refined encouraging response
      if (subtitle) {
        subtitle.innerHTML = `<div style="color: var(--green); font-size: 18px; font-weight: 700; margin-bottom: 8px;">That's wonderful to hear! 🌟</div>
          <div style="font-size: 13px; color: var(--text-2); line-height: 1.5;">
            Great job taking care of your mental health. Remember, a quick break or game can work wonders when you're feeling low. 
            You earned <strong style="color: var(--orange);">+10 XP</strong> bonus for feeling better! 
            <br><br>💡 <em>Tip: Try a light walk or stretch to keep the momentum going.</em>
          </div>`;
      }

      // Update mood to happy since they feel refreshed
      State.set('today.mood', 'happy');
      EventBus.emit('mood:changed', { mood: 'happy' });

      // Bonus XP for positive feedback
      EventBus.emit('xp:gained', { amount: 10, reason: 'Feeling great after game' });

      // Auto-close after a moment so user can read the message
      setTimeout(() => {
        if (modal) modal.classList.remove('visible');
        closeOverlay();
        activeGame = null;
      }, 4000);
    });
  }

  if (noBtn) {
    noBtn.addEventListener('click', () => {
      // Show a refined supportive response
      if (subtitle) {
        subtitle.innerHTML = `<div style="color: var(--blue); font-size: 18px; font-weight: 700; margin-bottom: 8px;">That's okay, take your time 💙</div>
          <div style="font-size: 13px; color: var(--text-2); line-height: 1.5;">
            It's completely fine. Here are some things that might help:
            <br>🧘 <strong>Try the Zen Breather</strong> for deep calming breaths
            <br>🎮 <strong>Play another mini game</strong> — sometimes a second round helps!
            <br>😴 <strong>Take a short rest</strong> — close your eyes for 5 minutes
            <br>🚶 <strong>Go for a light walk</strong> — fresh air works wonders
            <br><br><em>Remember: your well-being matters most. 🌿</em>
          </div>`;
      }

      // Auto-close after reading time
      setTimeout(() => {
        if (modal) modal.classList.remove('visible');
        closeOverlay();
        activeGame = null;
      }, 6000);
    });
  }
}

// ═══════════════════════════════════════════
//  GAME 1: Zen Breather
// ═══════════════════════════════════════════

function startBreather() {
  activeGame = 'breather';
  sound.start();
  openOverlay();

  const canvas   = $('game-canvas');
  const timerEl  = $('game-timer');
  const scoreEl  = $('game-score');
  const timerLoc = $('game-instruction');

  if (timerLoc) timerLoc.textContent = 'Follow the circle. Breathe naturally.';
  if (scoreEl)    scoreEl.textContent    = 'Breathe deeply...';

  // Create the breathing circle
  canvas.innerHTML = `
    <div class="breather-circle">
      <span class="breather-text">Get Ready</span>
    </div>
  `;

  const circle = canvas.querySelector('.breather-circle');
  const text   = canvas.querySelector('.breather-text');

  const phases   = ['inhale', 'hold', 'exhale'];
  const labels   = ['Inhale...', 'Hold...', 'Exhale...'];
  const PHASE_MS = 4000; // 4 seconds per phase
  const TOTAL_CYCLES = 3;

  let currentCycle = 0;
  let currentPhase = 0;

  function setPhase(phaseIndex) {
    sound.click();
    // Remove all phase classes
    circle.classList.remove('inhale', 'hold', 'exhale');
    // Add current phase class
    circle.classList.add(phases[phaseIndex]);
    text.textContent = labels[phaseIndex];
  }

  function advancePhase() {
    currentPhase++;
    if (currentPhase >= 3) {
      currentPhase = 0;
      currentCycle++;
      if (timerEl) timerEl.textContent = `Cycle ${currentCycle} / ${TOTAL_CYCLES}`;

      if (currentCycle >= TOTAL_CYCLES) {
        text.textContent = '🙏 Namaste';
        circle.classList.remove('inhale', 'hold', 'exhale');
        sound.levelUp();
        onGameComplete('Zen Breather', TOTAL_CYCLES);
        return;
      }
    }
    setPhase(currentPhase);
  }

  if (timerEl) timerEl.textContent = `Cycle 0 / ${TOTAL_CYCLES}`;
  setPhase(0);

  addTimer(setInterval(advancePhase, PHASE_MS));
}

// ═══════════════════════════════════════════
//  GAME 2: Reflex Dash
// ═══════════════════════════════════════════

function startReflex() {
  activeGame = 'reflex';
  sound.start();
  openOverlay();

  const canvas      = $('game-canvas');
  const timerEl     = $('game-timer');
  const scoreEl     = $('game-score');
  const instructEl  = $('game-instruction');

  if (instructEl) instructEl.textContent = 'Tap the targets as fast as you can!';

  // Create the play area
  canvas.innerHTML = '<div class="reflex-area"></div>';
  const area = canvas.querySelector('.reflex-area');

  let score       = 0;
  let timeLeft    = 30;
  let spawnRate   = 1200;

  if (scoreEl) scoreEl.textContent = 'Score: 0';
  if (timerEl) timerEl.textContent = '30s';

  // ── Miss sound if clicking background ──
  area.addEventListener('pointerdown', () => {
    if (activeGame === 'reflex') sound.miss();
  });

  const countdown = addTimer(setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = `${timeLeft}s`;

    spawnRate = Math.max(800, 1200 - (30 - timeLeft) * 13);

    if (timeLeft <= 0) {
      sound.gameOver();
      onGameComplete('Reflex Dash', score);
    }
  }, 1000));

  function spawnTarget() {
    if (activeGame !== 'reflex') return;

    const target = document.createElement('div');
    target.classList.add('reflex-target');

    const elapsed  = 30 - timeLeft;
    const size     = Math.max(35, 50 - elapsed * 0.5);
    target.style.width  = `${size}px`;
    target.style.height = `${size}px`;

    const areaRect = area.getBoundingClientRect();
    const maxX     = Math.max(0, areaRect.width - size);
    const maxY     = Math.max(0, areaRect.height - size);
    target.style.left = `${Math.random() * maxX}px`;
    target.style.top  = `${Math.random() * maxY}px`;

    target.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      score++;
      sound.hit();
      if (scoreEl) scoreEl.textContent = `Score: ${score}`;

      const pop = document.createElement('div');
      pop.classList.add('reflex-pop');
      pop.style.left = target.style.left;
      pop.style.top  = target.style.top;
      pop.textContent = '+1';
      area.appendChild(pop);
      setTimeout(() => pop.remove(), 400);

      target.remove();
    });

    area.appendChild(target);

    addTimer(setTimeout(() => {
      if (target.parentNode) target.remove();
    }, 1500));

    if (activeGame === 'reflex' && timeLeft > 0) {
      addTimer(setTimeout(spawnTarget, spawnRate));
    }
  }

  addTimer(setTimeout(spawnTarget, 500));

  gameCleanup = () => {
    if (area) area.innerHTML = '';
  };
}

// ═══════════════════════════════════════════
//  GAME 3: Hamster Smash
// ═══════════════════════════════════════════

function startHamster() {
  activeGame = 'hamster';
  sound.start();
  openOverlay();

  const canvas      = $('game-canvas');
  const timerEl     = $('game-timer');
  const scoreEl     = $('game-score');
  const instructEl  = $('game-instruction');

  if (instructEl) instructEl.textContent = 'Smash the hamsters! 🔨';

  canvas.innerHTML = '<div class="hamster-grid"></div>';
  const grid = canvas.querySelector('.hamster-grid');

  const holes = [];
  for (let i = 0; i < 9; i++) {
    const hole = document.createElement('div');
    hole.classList.add('hamster-hole');
    hole.dataset.index = i;
    grid.appendChild(hole);
    holes.push(hole);
  }

  let hits        = 0;
  let misses      = 0;
  let combo       = 0;
  let timeLeft    = 30;
  let activeHole  = null;
  let popRate     = 1200;

  if (scoreEl) scoreEl.textContent = 'Hits: 0 | Misses: 0';
  if (timerEl) timerEl.textContent = '30s';

  grid.addEventListener('pointerdown', (e) => {
    const hole = e.target.closest('.hamster-hole');
    if (!hole) return;

    if (hole.classList.contains('active')) {
      hits++;
      combo++;
      sound.hit();
      hole.classList.remove('active');
      hole.textContent = '';
      hole.classList.add('hit-flash');
      setTimeout(() => hole.classList.remove('hit-flash'), 300);

      if (combo >= 3) {
        showToast(`🔥 ${combo}x Combo!`, '🐹', 1500);
      }
    } else {
      misses++;
      combo = 0;
      sound.miss();
    }

    if (scoreEl) scoreEl.textContent = `Hits: ${hits} | Misses: ${misses}`;
  });

  const countdown = addTimer(setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = `${timeLeft}s`;

    popRate = Math.max(700, 1200 - (30 - timeLeft) * 17);

    if (timeLeft <= 0) {
      sound.gameOver();
      onGameComplete('Hamster Smash', hits);
    }
  }, 1000));

  function popHamster() {
    if (activeGame !== 'hamster') return;

    if (activeHole !== null) {
      holes[activeHole].classList.remove('active');
      holes[activeHole].textContent = '';
    }

    let next;
    do { next = Math.floor(Math.random() * 9); } while (next === activeHole);
    activeHole = next;

    holes[activeHole].classList.add('active');
    holes[activeHole].textContent = '🐹';

    const hideDelay = popRate;
    addTimer(setTimeout(() => {
      if (activeGame === 'hamster' && holes[activeHole]) {
        holes[activeHole].classList.remove('active');
        holes[activeHole].textContent = '';
        combo = 0;
      }
    }, hideDelay));

    if (activeGame === 'hamster' && timeLeft > 0) {
      addTimer(setTimeout(popHamster, popRate));
    }
  }

  addTimer(setTimeout(popHamster, 600));

  gameCleanup = () => {
    grid.innerHTML = '';
  };
}

// ═══════════════════════════════════════════
//  GAME 4: Food Catcher
// ═══════════════════════════════════════════

function startCatcher() {
  activeGame = 'catcher';
  sound.start();
  openOverlay();

  const canvas = $('game-canvas');
  const timer  = $('game-timer');
  const scoreEl = $('game-score');
  const instruction = $('game-instruction');

  if (instruction) instruction.textContent = 'Move mouse or drag to catch healthy foods 🍏, avoid cheat foods 🍔!';
  if (scoreEl) scoreEl.textContent = 'Score: 0';
  if (timer) timer.textContent = '30s';

  // Setup game area inside canvas
  const area = document.createElement('div');
  area.className = 'catcher-area';
  area.style.position = 'relative';
  area.style.width = '100%';
  area.style.height = '100%';
  area.style.overflow = 'hidden';
  area.style.background = 'rgba(0, 0, 0, 0.2)';
  area.style.borderRadius = '12px';
  area.style.touchAction = 'none'; // prevents scrolling page during touch drag
  canvas.appendChild(area);

  // Basket element at bottom
  const basket = document.createElement('div');
  basket.className = 'basket';
  basket.textContent = '🧺';
  basket.style.position = 'absolute';
  basket.style.bottom = '15px';
  basket.style.left = '50%';
  basket.style.transform = 'translateX(-50%)';
  basket.style.fontSize = '35px';
  basket.style.width = '60px';
  basket.style.height = '40px';
  basket.style.textAlign = 'center';
  basket.style.cursor = 'none';
  area.appendChild(basket);

  let score = 0;
  let timeLeft = 30;

  // Move basket with mouse or touch
  function moveBasket(clientX) {
    const rect = area.getBoundingClientRect();
    let x = clientX - rect.left - 30; // center the 60px wide basket
    if (x < 0) x = 0;
    if (x > rect.width - 60) x = rect.width - 60;
    basket.style.left = `${x}px`;
  }

  const onPointerMove = (e) => moveBasket(e.clientX);
  area.addEventListener('pointermove', onPointerMove);

  const healthyItems = ['🍏', '🍌', '🥗', '🥛', '🥑', '🥦', '🍓'];
  const cheatItems   = ['🍕', '🍔', '🍟', '🍩', '🥤', '🍰', '🌭'];
  
  let activeFalling = []; // list of active falling elements

  // Spawn an item
  function spawnItem() {
    if (activeGame !== 'catcher' || timeLeft <= 0) return;

    const isHealthy = Math.random() < 0.6; // 60% healthy
    const text = isHealthy 
      ? healthyItems[Math.floor(Math.random() * healthyItems.length)]
      : cheatItems[Math.floor(Math.random() * cheatItems.length)];

    const item = document.createElement('div');
    item.className = 'falling-item';
    item.textContent = text;
    item.style.position = 'absolute';
    item.style.fontSize = '28px';
    
    const rect = area.getBoundingClientRect();
    const spawnWidth = rect.width > 0 ? rect.width - 30 : 250;
    const x = Math.random() * spawnWidth;
    item.style.left = `${x}px`;
    item.style.top = '-40px';
    area.appendChild(item);

    const fallSpeed = 3 + Math.random() * 3;
    const fallingObj = {
      el: item,
      x,
      y: -40,
      isHealthy,
      speed: fallSpeed
    };

    activeFalling.push(fallingObj);

    // Schedule next spawn
    const spawnDelay = 700 + Math.random() * 600;
    addTimer(setTimeout(spawnItem, spawnDelay));
  }

  // Animation Loop (requestAnimationFrame)
  let animationId = null;
  function updatePhysics() {
    if (activeGame !== 'catcher' || timeLeft <= 0) return;

    const basketRect = basket.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();

    activeFalling = activeFalling.filter(item => {
      item.y += item.speed;
      item.el.style.top = `${item.y}px`;

      // Check collision
      const itemRect = item.el.getBoundingClientRect();
      const collided = (
        itemRect.bottom >= basketRect.top &&
        itemRect.top <= basketRect.bottom &&
        itemRect.right >= basketRect.left &&
        itemRect.left <= basketRect.right
      );

      if (collided) {
        if (item.isHealthy) {
          score += 10;
          sound.hit();
          basket.style.transform = 'translateX(-50%) scale(1.2)';
          setTimeout(() => basket.style.transform = 'translateX(-50%) scale(1)', 100);
        } else {
          score = Math.max(0, score - 5);
          sound.miss();
          area.style.background = 'rgba(255, 0, 0, 0.15)';
          setTimeout(() => area.style.background = 'rgba(0, 0, 0, 0.2)', 150);
        }

        if (scoreEl) scoreEl.textContent = `Score: ${score}`;
        item.el.remove();
        return false;
      }

      // Check boundary fall
      if (item.y > areaRect.height) {
        if (item.isHealthy) {
          score = Math.max(0, score - 2);
          if (scoreEl) scoreEl.textContent = `Score: ${score}`;
        }
        item.el.remove();
        return false;
      }

      return true;
    });

    animationId = requestAnimationFrame(updatePhysics);
  }

  spawnItem();
  updatePhysics();

  const gameInterval = setInterval(() => {
    timeLeft--;
    if (timer) timer.textContent = `${timeLeft}s`;

    if (timeLeft <= 0) {
      clearInterval(gameInterval);
      cancelAnimationFrame(animationId);
      sound.gameOver();
      onGameComplete('Food Catcher', score);
    }
  }, 1000);
  addTimer(gameInterval);

  gameCleanup = () => {
    cancelAnimationFrame(animationId);
    area.removeEventListener('pointermove', onPointerMove);
    area.innerHTML = '';
  };
}

// ═══════════════════════════════════════════
//  Game Card Click Router
// ═══════════════════════════════════════════

const GAME_STARTERS = {
  breather: startBreather,
  reflex:   startReflex,
  hamster:  startHamster,
  catcher:  startCatcher
};

function initGameCards() {
  document.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => {
      const game = card.dataset.game;
      if (!game || !GAME_STARTERS[game]) return;
      if (activeGame) stopGame(); // clean up any running game
      GAME_STARTERS[game]();
    });
  });
}

function initCloseButton() {
  const closeBtn = $('game-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', stopGame);
  }
}

// ──── Module Init ────

export function initGames() {
  initGameCards();
  initCloseButton();
  initPostgameModal();

  console.log('🎮 Games module initialized with sound effects and Food Catcher');
}
