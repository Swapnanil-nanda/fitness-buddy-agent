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
  }

  moodBtns.forEach(btn => {
    btn.addEventListener('click', () => selectMood(btn.dataset.mood));
  });

  // Restore persisted mood
  const savedMood = State.today.mood || 'neutral';
  moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === savedMood));

  // ═══════ Hydration Tracker ═══════

  const glassEls       = document.querySelectorAll('.water-glass');
  const hydrationCount = document.getElementById('hydration-count');

  /**
   * Render glasses filled up to `count` and update the counter.
   */
  function renderGlasses(count) {
    glassEls.forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      el.classList.toggle('filled', idx < count);
    });
    hydrationCount.innerHTML = `${count}<span> / ${TOTAL_GLASSES} glasses</span>`;
  }

  glassEls.forEach(el => {
    el.addEventListener('click', () => {
      const idx        = parseInt(el.dataset.index, 10);
      const current    = State.today.water;
      let newCount;

      if (idx < current) {
        // Clicking an already-filled glass: unfill from here onward
        newCount = idx;
      } else {
        // Clicking the next (or a later) glass: fill up to and including it
        newCount = idx + 1;
      }

      // Award XP only for genuinely NEW glasses
      const added = newCount - current;
      if (added > 0) {
        EventBus.emit('xp:gained', { amount: 5 * added, reason: `Drank ${added} glass${added > 1 ? 'es' : ''} of water` });
      }

      State.set('today.water', newCount);
      EventBus.emit('water:changed', { count: newCount });
      renderGlasses(newCount);
    });
  });

  // Restore persisted hydration
  renderGlasses(State.today.water || 0);

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
