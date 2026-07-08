/* ============================================
   FitBuddy — Mini-Games: Breather, Reflex, Hamster
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── DOM References (resolved lazily) ────
const $ = (id) => document.getElementById(id);

// ──── Active Game State ────
let activeGame   = null;   // 'breather' | 'reflex' | 'hamster' | null
let gameTimers   = [];     // All setTimeout / setInterval IDs for cleanup
let gameCleanup  = null;   // Custom cleanup callback for current game

/** Register a timer so it can be cleared on game exit */
function addTimer(id) { gameTimers.push(id); return id; }

/** Clear all running game timers */
function clearAllTimers() {
  gameTimers.forEach(id => { clearTimeout(id); clearInterval(id); });
  gameTimers = [];
}

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

  // Show the postgame modal
  const modal    = $('postgame-modal');
  const title    = $('postgame-title');
  const subtitle = $('postgame-subtitle');

  if (title) title.textContent = `Great ${gameName}!`;
  if (subtitle) subtitle.textContent = 'Are you feeling better now?';
  if (modal) modal.classList.add('visible');
}

function initPostgameModal() {
  const modal = $('postgame-modal');
  const yesBtn = $('postgame-yes');
  const noBtn  = $('postgame-no');

  if (yesBtn) {
    yesBtn.addEventListener('click', () => {
      if (modal) modal.classList.remove('visible');
      closeOverlay();
      activeGame = null;

      // Bonus XP for positive feedback
      EventBus.emit('xp:gained', { amount: 10, reason: 'Feeling great after game' });

      // If user was stressed, suggest a workout
      if (State.isStressedOrExhausted) {
        showToast('Glad you feel better! Try a quick workout now 💪', '🏃', 3500);
      }
    });
  }

  if (noBtn) {
    noBtn.addEventListener('click', () => {
      if (modal) modal.classList.remove('visible');
      closeOverlay();
      activeGame = null;
      showToast('Try another game — you\'ve got this! 🎮', '💪', 3000);
    });
  }
}

// ═══════════════════════════════════════════
//  GAME 1: Zen Breather
// ═══════════════════════════════════════════

function startBreather() {
  activeGame = 'breather';
  openOverlay();

  const canvas      = $('game-canvas');
  const timerEl     = $('game-timer');
  const scoreEl     = $('game-score');
  const instructEl  = $('game-instruction');

  if (instructEl) instructEl.textContent = 'Follow the circle. Breathe naturally.';
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
    // Remove all phase classes
    circle.classList.remove('inhale', 'hold', 'exhale');
    // Add current phase class
    circle.classList.add(phases[phaseIndex]);
    text.textContent = labels[phaseIndex];
  }

  function advancePhase() {
    currentPhase++;
    if (currentPhase >= 3) {
      // Completed one full cycle
      currentPhase = 0;
      currentCycle++;
      if (timerEl) timerEl.textContent = `Cycle ${currentCycle} / ${TOTAL_CYCLES}`;

      if (currentCycle >= TOTAL_CYCLES) {
        // Game complete
        text.textContent = '🙏 Namaste';
        circle.classList.remove('inhale', 'hold', 'exhale');
        onGameComplete('Zen Breather', TOTAL_CYCLES);
        return;
      }
    }
    setPhase(currentPhase);
  }

  // Start first phase
  if (timerEl) timerEl.textContent = `Cycle 0 / ${TOTAL_CYCLES}`;
  setPhase(0);

  // Advance every 4 seconds
  addTimer(setInterval(advancePhase, PHASE_MS));
}

// ═══════════════════════════════════════════
//  GAME 2: Reflex Dash
// ═══════════════════════════════════════════

function startReflex() {
  activeGame = 'reflex';
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
  let spawnRate   = 1200; // ms between spawns, shrinks over time

  if (scoreEl) scoreEl.textContent = 'Score: 0';
  if (timerEl) timerEl.textContent = '30s';

  // ── Countdown ──
  const countdown = addTimer(setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = `${timeLeft}s`;

    // Speed up spawns as time passes
    spawnRate = Math.max(800, 1200 - (30 - timeLeft) * 13);

    if (timeLeft <= 0) {
      onGameComplete('Reflex Dash', score);
    }
  }, 1000));

  // ── Spawn Targets ──
  function spawnTarget() {
    if (activeGame !== 'reflex') return;

    const target = document.createElement('div');
    target.classList.add('reflex-target');

    // Size shrinks from 50px → 35px over 30s
    const elapsed  = 30 - timeLeft;
    const size     = Math.max(35, 50 - elapsed * 0.5);
    target.style.width  = `${size}px`;
    target.style.height = `${size}px`;

    // Random position within the area (leave margin for target size)
    const areaRect = area.getBoundingClientRect();
    const maxX     = Math.max(0, areaRect.width - size);
    const maxY     = Math.max(0, areaRect.height - size);
    target.style.left = `${Math.random() * maxX}px`;
    target.style.top  = `${Math.random() * maxY}px`;

    // Click handler → score
    target.addEventListener('click', (e) => {
      e.stopPropagation();
      score++;
      if (scoreEl) scoreEl.textContent = `Score: ${score}`;

      // Pop animation at click position
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

    // Auto-remove missed targets after 1.5s
    addTimer(setTimeout(() => {
      if (target.parentNode) target.remove();
    }, 1500));

    // Schedule next spawn (variable rate)
    if (activeGame === 'reflex' && timeLeft > 0) {
      addTimer(setTimeout(spawnTarget, spawnRate));
    }
  }

  // Kick off first spawn
  addTimer(setTimeout(spawnTarget, 500));

  // Cleanup: remove leftover targets
  gameCleanup = () => {
    if (area) area.innerHTML = '';
  };
}

// ═══════════════════════════════════════════
//  GAME 3: Hamster Smash
// ═══════════════════════════════════════════

function startHamster() {
  activeGame = 'hamster';
  openOverlay();

  const canvas      = $('game-canvas');
  const timerEl     = $('game-timer');
  const scoreEl     = $('game-score');
  const instructEl  = $('game-instruction');

  if (instructEl) instructEl.textContent = 'Smash the hamsters! 🔨';

  // Build the 3×3 grid
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
  let popRate     = 1200; // ms between hamster pops, speeds up

  if (scoreEl) scoreEl.textContent = 'Hits: 0 | Misses: 0';
  if (timerEl) timerEl.textContent = '30s';

  // ── Click handler (delegated on grid) ──
  grid.addEventListener('click', (e) => {
    const hole = e.target.closest('.hamster-hole');
    if (!hole) return;

    if (hole.classList.contains('active')) {
      // HIT!
      hits++;
      combo++;
      hole.classList.remove('active');
      hole.textContent = '';
      hole.classList.add('hit-flash');
      setTimeout(() => hole.classList.remove('hit-flash'), 300);

      // Combo system: 3+ consecutive hits
      if (combo >= 3) {
        showToast(`🔥 ${combo}x Combo!`, '🐹', 1500);
      }
    } else {
      // MISS
      misses++;
      combo = 0;
    }

    if (scoreEl) scoreEl.textContent = `Hits: ${hits} | Misses: ${misses}`;
  });

  // ── Countdown ──
  const countdown = addTimer(setInterval(() => {
    timeLeft--;
    if (timerEl) timerEl.textContent = `${timeLeft}s`;

    // Speed up hamster pops over time
    popRate = Math.max(700, 1200 - (30 - timeLeft) * 17);

    if (timeLeft <= 0) {
      onGameComplete('Hamster Smash', hits);
    }
  }, 1000));

  // ── Pop Hamsters ──
  function popHamster() {
    if (activeGame !== 'hamster') return;

    // Clear previous hamster
    if (activeHole !== null) {
      holes[activeHole].classList.remove('active');
      holes[activeHole].textContent = '';
    }

    // Pick a random hole (avoid same hole twice)
    let next;
    do { next = Math.floor(Math.random() * 9); } while (next === activeHole);
    activeHole = next;

    holes[activeHole].classList.add('active');
    holes[activeHole].textContent = '🐹';

    // Auto-hide hamster after pop duration
    const hideDelay = popRate; // matches spawn rate
    addTimer(setTimeout(() => {
      if (activeGame === 'hamster' && holes[activeHole]) {
        holes[activeHole].classList.remove('active');
        holes[activeHole].textContent = '';
        // Missed this hamster → break combo
        combo = 0;
      }
    }, hideDelay));

    // Schedule next pop
    if (activeGame === 'hamster' && timeLeft > 0) {
      addTimer(setTimeout(popHamster, popRate));
    }
  }

  // Start popping after short delay
  addTimer(setTimeout(popHamster, 600));

  // Cleanup
  gameCleanup = () => {
    grid.innerHTML = '';
  };
}

// ═══════════════════════════════════════════
//  Game Card Click Router
// ═══════════════════════════════════════════

const GAME_STARTERS = {
  breather: startBreather,
  reflex:   startReflex,
  hamster:  startHamster
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

  console.log('🎮 Games module initialized');
}
