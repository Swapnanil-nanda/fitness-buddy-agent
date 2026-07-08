/* ============================================
   FitBuddy — Exercise Logging Module
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── MET Values (Metabolic Equivalent of Task) ────
// burn = MET × weight_kg × (time_min / 60)
const MET_TABLE = {
  running: 9.8,
  walking: 3.5,
  cycling: 7.5,
  swimming: 8.0,
  yoga: 3.0,
  pushups: 8.0,
  squats: 5.5,
  plank: 4.0,
  jumping_jacks: 8.0,
  burpees: 10.0,
  sit_ups: 4.0,
  lunges: 5.0,
  pull_ups: 8.0,
  jump_rope: 12.0,
  hiit: 10.0,
  stretching: 2.5,
  dance: 6.5,
  weightlifting: 6.0,
  other: 5.0
};

// ──── Calories per Rep (for rep-based exercises) ────
const REPS_CALORIES = {
  pushups: 0.5,
  squats: 0.6,
  sit_ups: 0.3,
  lunges: 0.5,
  pull_ups: 1.0,
  burpees: 1.5,
  jumping_jacks: 0.2
};

/**
 * Calculate calories burned for an exercise.
 * Priority: time-based (if time > 0) → reps-based → 0
 * @param {string} activity – Activity key from MET_TABLE
 * @param {number} time     – Duration in minutes (0 or NaN = not provided)
 * @param {number} reps     – Number of reps (0 or NaN = not provided)
 * @returns {number} Rounded calorie burn
 */
function calculateBurn(activity, time, reps) {
  const weight = State.user.weight || 70; // fallback 70 kg
  const met = MET_TABLE[activity] || MET_TABLE.other;

  // Time-based takes priority
  if (time && time > 0) {
    return Math.round(met * weight * (time / 60));
  }

  // Reps-based fallback
  if (reps && reps > 0) {
    const perRep = REPS_CALORIES[activity] || 0.5;
    return Math.round(reps * perRep);
  }

  return 0;
}

// ──── DOM Rendering ────

/**
 * Render a single exercise item.
 * @param {Object} exercise
 * @returns {HTMLElement}
 */
function renderExerciseItem(exercise) {
  const div = document.createElement('div');
  div.className = 'log-item';

  // Build a concise meta string (e.g. "30 min" or "50 reps" or "30 min · 50 reps")
  const metaParts = [];
  if (exercise.time)  metaParts.push(`${exercise.time} min`);
  if (exercise.reps)  metaParts.push(`${exercise.reps} reps`);
  const metaText = metaParts.join(' · ') || exercise.timeLogged;

  div.innerHTML = `
    <div class="log-icon exercise">🏋️</div>
    <div class="log-details">
      <div class="name">${exercise.name}</div>
      <div class="meta">${metaText}</div>
    </div>
    <div class="log-value">${exercise.burn} kcal</div>
  `;

  return div;
}

/**
 * Rebuild the full exercises list + summary cards from State.
 */
function renderAllExercises() {
  const list  = document.getElementById('exercises-list');
  const empty = document.getElementById('exercises-empty');
  const exercises = State.today.exercises;

  // Clear rendered items (keep empty-state placeholder)
  list.querySelectorAll('.log-item').forEach(el => el.remove());

  if (exercises.length > 0) {
    empty.style.display = 'none';
    exercises.forEach(ex => list.appendChild(renderExerciseItem(ex)));
  } else {
    empty.style.display = '';
  }

  updateExerciseSummary(exercises);
}

/**
 * Update exercise summary cards.
 */
function updateExerciseSummary(exercises) {
  const totalBurned = exercises.reduce((sum, ex) => sum + (ex.burn || 0), 0);
  document.getElementById('ex-burned').textContent = totalBurned;
  document.getElementById('ex-count').textContent  = exercises.length;
}

// ──── Module Init ────

/**
 * Initialize the Exercise module.
 * Sets up modal interactions, calorie calculations, stress warnings, and XP rewards.
 */
export function initExercise() {
  // DOM references
  const modal       = document.getElementById('exercise-modal');
  const addBtn      = document.getElementById('add-exercise-btn');
  const cancelBtn   = document.getElementById('exercise-cancel');
  const submitBtn   = document.getElementById('exercise-submit');
  const actSelect   = document.getElementById('exercise-name');
  const timeInput   = document.getElementById('exercise-time');
  const repsInput   = document.getElementById('exercise-reps');
  const warningEl   = document.getElementById('exercise-warning');

  // ── Open modal (with optional stress warning) ──
  addBtn.addEventListener('click', () => {
    // Show stress/exhaustion warning if applicable
    if (State.isStressedOrExhausted) {
      warningEl.classList.add('visible');
    } else {
      warningEl.classList.remove('visible');
    }
    modal.classList.add('visible');
  });

  // ── Close modal ──
  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('visible');
    warningEl.classList.remove('visible');
  });

  // ── Close on backdrop click ──
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('visible');
      warningEl.classList.remove('visible');
    }
  });

  // ── Submit exercise ──
  submitBtn.addEventListener('click', () => {
    const activity = actSelect.value;
    const displayName = actSelect.options[actSelect.selectedIndex]?.text || 'Exercise';
    const time = parseInt(timeInput.value, 10) || 0;
    const reps = parseInt(repsInput.value, 10) || 0;

    // Validation — must pick an activity
    if (!activity) {
      showToast('Please select an activity.', '⚠️');
      return;
    }

    // At least time or reps should be provided
    if (time <= 0 && reps <= 0) {
      showToast('Please enter time or reps.', '⚠️');
      return;
    }

    // Calculate calorie burn
    const burn = calculateBurn(activity, time, reps);

    // Build exercise object
    const exercise = {
      id: Date.now(),
      name: displayName,
      activity,
      time: time || null,
      reps: reps || null,
      burn,
      timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Persist to state
    State.today.exercises.push(exercise);
    State.save();

    // Notify the system
    EventBus.emit('exercise:added', { exercise });
    EventBus.emit('xp:gained', { amount: 20, reason: 'Logged an exercise' });

    // User feedback
    showToast(`${displayName} logged — ${burn} kcal burned! 🔥`, '🏃');

    // Re-render
    renderAllExercises();

    // Clear inputs and close modal
    actSelect.value  = '';
    timeInput.value  = '';
    repsInput.value  = '';
    modal.classList.remove('visible');
    warningEl.classList.remove('visible');
  });

  // ── Restore persisted exercises on load ──
  renderAllExercises();

  console.log('🏃 Exercise module initialized');
}
