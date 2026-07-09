/* ============================================
   FitBuddy — Biometric Tracker Module
   Trinity Rings · Mood · Hydration · Sleep
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── Ring circumferences (match SVG stroke-dasharray) ────
const RING_KCAL_CIRC   = 565.49;
const RING_ACTIVE_CIRC = 471.24;
const RING_DIET_CIRC   = 376.99;

// ──── Active burn daily target (kcal) ────
const ACTIVE_BURN_TARGET = 300;

// ──── Total hydration glasses ────
const TOTAL_GLASSES = 8;

/**
 * Initialise all left-panel biometric trackers.
 */
export function initTracker() {
  // Cache DOM nodes once
  const ringKcal    = document.getElementById('ring-kcal');
  const ringActive  = document.getElementById('ring-active');
  const ringDiet    = document.getElementById('ring-diet');
  const kcalDisplay = document.getElementById('kcal-display');

  // ═══════ Trinity Rings ═══════

  /**
   * Recompute and animate all three rings.
   */
  function refreshRings() {
    const consumed = State.caloriesConsumed;
    const target   = State.calorieTarget;
    const burned   = State.caloriesBurned;
    const diet     = State.dietQuality;

    // Kcal ring: consumed / target (allow >100 % — the ring just fills fully)
    const kcalRatio = Math.min(consumed / (target || 1), 1);
    ringKcal.style.strokeDashoffset = RING_KCAL_CIRC * (1 - kcalRatio);

    // Active ring: burned / 300 (capped at 100 %)
    const activeRatio = Math.min(burned / ACTIVE_BURN_TARGET, 1);
    ringActive.style.strokeDashoffset = RING_ACTIVE_CIRC * (1 - activeRatio);

    // Diet quality ring: quality score 0-100
    const dietRatio = Math.min(diet / 100, 1);
    ringDiet.style.strokeDashoffset = RING_DIET_CIRC * (1 - dietRatio);

    // Kcal numeric display
    kcalDisplay.textContent = consumed;
  }

  // Listen for events that affect rings
  EventBus.on('state:changed', refreshRings);
  EventBus.on('meal:added',    refreshRings);
  EventBus.on('exercise:added', refreshRings);

  // Initial render
  refreshRings();

  // ═══════ Mood Selector ═══════

  const moodBtns = document.querySelectorAll('.mood-btn');

  /**
   * Set active mood button and persist.
   */
  function selectMood(mood) {
    moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === mood));
    State.set('today.mood', mood);
    EventBus.emit('mood:changed', { mood });

    // Suggest mood-lifting techniques for negative moods
    if (mood === 'sad') {
      showToast('Feeling low? Try a Zen Breather or a fun mini game in the Play tab to lift your spirits! 🎮🧘', '💙', 5000);
    } else if (mood === 'stressed') {
      showToast('Stressed out? Take a deep breath. Try the Zen Breather game or just rest for a bit — you deserve it! 🌿', '🫂', 5000);
    } else if (mood === 'exhausted') {
      showToast('You look tired! Rest is important. Or try a relaxing mini game to unwind before anything else 😴🎮', '💤', 5000);
    }
  }

  moodBtns.forEach(btn => {
    btn.addEventListener('click', () => selectMood(btn.dataset.mood));
  });

  // Restore persisted mood
  const savedMood = State.today.mood || 'neutral';
  moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === savedMood));

  // Sync mood selection if updated externally (like post-game completion)
  EventBus.on('mood:changed', ({ mood }) => {
    moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === mood));
  });

  // ═══════ Hydration Tracker ═══════

  const glassesContainer = document.getElementById('water-glasses');
  const drankInput       = document.getElementById('water-drank-input');
  const litresInput      = document.getElementById('water-litres-input');
  const targetInput      = document.getElementById('water-target-input');
  const hydrationCount   = document.getElementById('hydration-count');

  /**
   * Synthesize a clean, physical "bubble plop" sound using the Web Audio API.
   */
  function playWaterSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      const now = audioCtx.currentTime;
      osc.type = 'sine';
      // Pitch sweeps up quickly to emulate a bubble pop or water droplet plip
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(850, now + 0.12);
      
      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      console.warn("Web Audio failed to play:", e);
    }
  }

  /**
   * Re-renders the hydration section: updates inputs, labels, and generates water drop divs.
   */
  function renderGlassesSection() {
    if (!glassesContainer || !drankInput || !litresInput || !targetInput || !hydrationCount) return;

    const current = State.today.water || 0;
    const target = State.settings.waterTarget || 8;
    
    // Sync numerical inputs
    drankInput.value = current;
    litresInput.value = (current * 0.25).toFixed(2); // 1 glass = 0.25L
    targetInput.value = target;
    
    hydrationCount.innerHTML = `${current}<span> / ${target} glasses (${(current * 0.25).toFixed(2)}L)</span>`;
    
    // Clear and build the dynamic droplets
    glassesContainer.innerHTML = '';
    for (let i = 0; i < target; i++) {
      const glass = document.createElement('div');
      glass.className = `water-glass${i < current ? ' filled' : ''}`;
      glass.dataset.index = i;
      glass.innerHTML = '💧';
      
      // Inline style transitions for the droplet hover
      glass.style.transition = 'all var(--t-spring)';
      
      glass.addEventListener('click', () => {
        const idx = i;
        let newCount;
        if (idx < current) {
          // Toggle off glasses from this index onwards
          newCount = idx;
        } else {
          // Toggle on up to this index
          newCount = idx + 1;
        }
        updateWaterCount(newCount);
        playWaterSound();
      });
      glassesContainer.appendChild(glass);
    }
  }

  /**
   * Commits the new water count to state, handles XP rewards, and re-renders.
   */
  function updateWaterCount(newCount) {
    const current = State.today.water || 0;
    const added = newCount - current;
    if (added > 0) {
      EventBus.emit('xp:gained', { amount: 5 * added, reason: `Drank ${added} glass${added > 1 ? 'es' : ''} of water` });
    }
    State.set('today.water', newCount);
    EventBus.emit('water:changed', { count: newCount });
    renderGlassesSection();
  }

  // ── Input Listeners ──
  if (drankInput) {
    drankInput.addEventListener('change', () => {
      let val = parseInt(drankInput.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      updateWaterCount(val);
      playWaterSound();
    });
  }

  if (litresInput) {
    litresInput.addEventListener('change', () => {
      let val = parseFloat(litresInput.value);
      if (isNaN(val) || val < 0) val = 0;
      // Convert litres back to glasses (0.25L per glass)
      const glasses = Math.round(val / 0.25);
      updateWaterCount(glasses);
      playWaterSound();
    });
  }

  if (targetInput) {
    targetInput.addEventListener('change', () => {
      let val = parseInt(targetInput.value, 10);
      if (isNaN(val) || val < 1) val = 8;
      State.set('settings.waterTarget', val);
      renderGlassesSection();
    });
  }

  // Restore persisted hydration
  renderGlassesSection();

  // ═══════ Sleep Tracker ═══════

  const sleepSlider  = document.getElementById('sleep-slider');
  const sleepValue   = document.getElementById('sleep-value');
  const sleepQuality = document.getElementById('sleep-quality');

  /**
   * Derive a quality label + CSS class from hours slept.
   */
  function qualifySlep(hours) {
    if (hours < 5)   return { label: 'Poor',  cls: 'poor'  };
    if (hours < 6.5) return { label: 'Fair',  cls: 'fair'  };
    if (hours < 8)   return { label: 'Good',  cls: 'good'  };
    return              { label: 'Great', cls: 'great' };
  }

  function updateSleep(hours) {
    sleepValue.innerHTML = `${hours}<span> hrs</span>`;
    const q = qualifySlep(hours);
    sleepQuality.textContent = q.label;
    sleepQuality.className   = `sleep-quality ${q.cls}`;
    State.set('today.sleep', hours);
  }

  sleepSlider.addEventListener('input', () => {
    updateSleep(parseFloat(sleepSlider.value));
  });

  // Restore persisted sleep
  const savedSleep = State.today.sleep ?? 7;
  sleepSlider.value = savedSleep;
  // Render without re-persisting (already in state)
  sleepValue.innerHTML = `${savedSleep}<span> hrs</span>`;
  const sq = qualifySlep(savedSleep);
  sleepQuality.textContent = sq.label;
  sleepQuality.className   = `sleep-quality ${sq.cls}`;
}
