/* ============================================
   FitBuddy — Exercise Logging Module
   ============================================ */

import { State, EventBus, showToast } from './app.js';
import { generateResponse } from './watsonx.js';

// ──── MET Values (Metabolic Equivalent of Task) ────
// burn = MET × weight_kg × (time_min / 60)
const MET_TABLE = {
  running: 9.8,
  walking: 3.5,
  cycling: 7.5,
  swimming: 8.0,
  yoga: 3.0,
  weightlifting: 6.0,
  other: 5.0
};

/**
 * Calculate calories burned for an exercise based on MET and duration.
 * @param {string} activity – Activity key from MET_TABLE
 * @param {number} time     – Duration in minutes
 * @returns {number} Rounded calorie burn
 */
function calculateBurn(activity, time) {
  const weight = State.user.weight || 70; // fallback 70 kg
  const met = MET_TABLE[activity] || MET_TABLE.other;

  if (time && time > 0) {
    return Math.round(met * weight * (time / 60));
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
  
  const customGroup = document.getElementById('custom-exercise-group');
  const customInput = document.getElementById('exercise-custom-name');

  // ── Show custom name field when Other is selected ──
  actSelect.addEventListener('change', () => {
    if (actSelect.value === 'other') {
      customGroup.classList.remove('hidden');
      customInput.focus();
    } else {
      customGroup.classList.add('hidden');
    }
  });

  // ── Open modal (with optional stress warning) ──
  addBtn.addEventListener('click', () => {
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
  submitBtn.addEventListener('click', async () => {
    const activity = actSelect.value;
    let displayName = actSelect.options[actSelect.selectedIndex]?.text || 'Exercise';
    const time = parseInt(timeInput.value, 10) || 0;
    const reps = parseInt(repsInput.value, 10) || 0;

    // Validation — must pick an activity
    if (!activity) {
      showToast('Please select an activity.', '⚠️');
      return;
    }

    // Validation — time is mandatory
    if (isNaN(time) || time <= 0) {
      showToast('Please enter a valid exercise duration in minutes.', '⚠️');
      return;
    }

    let burn = 0;

    if (activity === 'other') {
      const customName = customInput.value.trim();
      if (!customName) {
        showToast('Please enter a custom exercise name.', '⚠️');
        return;
      }
      displayName = `✏️ ${customName}`;

      // Disable button and show loading state
      submitBtn.disabled = true;
      submitBtn.textContent = 'Analyzing burn rate...';

      try {
        const weight = State.user.weight || 70;
        const prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>

You are an expert exercise scientist. Estimate the MET (Metabolic Equivalent of Task) value or calories burned per minute for a person weighing ${weight}kg doing the exercise: "${customName}".
Return ONLY a single number representing estimated calories burned per minute. Do not write any other letters, words, units or explanations. Just a single integer number.<|eot_id|><|start_header_id|>user<|end_header_id|>

Estimate for ${customName} done by ${weight}kg person.<|eot_id|><|start_header_id|>assistant<|end_header_id|>

`;
        const result = await generateResponse(prompt, 50);
        let calsPerMinute = 7; // moderate activity fallback
        if (result.success) {
          const match = result.text.match(/\d+/);
          if (match) {
            calsPerMinute = parseInt(match[0], 10);
          }
        }
        burn = calsPerMinute * time;
        showToast(`AI analyzed "${customName}": estimated ${calsPerMinute} kcal/min`, '🤖');
      } catch (err) {
        console.warn('AI exercise analysis failed:', err);
        burn = 7 * time;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Log Exercise';
      }
    } else {
      burn = calculateBurn(activity, time);
    }

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
    customInput.value = '';
    customGroup.classList.add('hidden');
    timeInput.value  = '';
    repsInput.value  = '';
    modal.classList.remove('visible');
    warningEl.classList.remove('visible');
  });

  // ── Restore persisted exercises on load ──
  renderAllExercises();

  console.log('🏃 Exercise module initialized');
}
