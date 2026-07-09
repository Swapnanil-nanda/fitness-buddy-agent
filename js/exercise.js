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
  div.dataset.id = exercise.id;

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
    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
      <div class="log-value">${exercise.burn} kcal</div>
      <div class="action-buttons">
        <button class="action-btn edit-exercise-btn" title="Edit">✏️</button>
        <button class="action-btn delete-exercise-btn" title="Delete">❌</button>
      </div>
    </div>
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
  list.querySelectorAll('.log-item, .category-header').forEach(el => el.remove());

  if (exercises.length > 0) {
    empty.style.display = 'none';

    // Group by time of day
    const grouped = {};
    exercises.forEach(ex => {
      const time = ex.timeOfDay || 'Morning';
      if (!grouped[time]) grouped[time] = [];
      grouped[time].push(ex);
    });

    const order = ['Morning', 'Afternoon', 'Evening'];
    order.forEach(time => {
      if (grouped[time] && grouped[time].length > 0) {
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = time;
        header.style.fontSize = '12px';
        header.style.fontWeight = '700';
        header.style.color = 'var(--text-3)';
        header.style.textTransform = 'uppercase';
        header.style.marginTop = '10px';
        header.style.marginBottom = '4px';
        header.style.letterSpacing = '1px';
        header.style.paddingLeft = '4px';
        list.appendChild(header);
        
        grouped[time].forEach(ex => list.appendChild(renderExerciseItem(ex)));
      }
    });

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
  let editingExerciseId = null;
  // DOM references
  const modal       = document.getElementById('exercise-modal');
  const addBtn      = document.getElementById('add-exercise-btn');
  const cancelBtn   = document.getElementById('exercise-cancel');
  const submitBtn   = document.getElementById('exercise-submit');
  const actSelect   = document.getElementById('exercise-name');
  const timeInput   = document.getElementById('exercise-time');
  const repsInput   = document.getElementById('exercise-reps');
  const timeOfDayInput = document.getElementById('exercise-timeofday');
  const warningEl   = document.getElementById('exercise-warning');
  
  const customGroup = document.getElementById('custom-exercise-group');
  const customInput = document.getElementById('exercise-custom-name');
  const list        = document.getElementById('exercises-list');

  // ── Show custom name field when Other is selected ──
  actSelect.addEventListener('change', () => {
    if (actSelect.value === 'other') {
      customGroup.classList.remove('hidden');
      customInput.focus();
    } else {
      customGroup.classList.add('hidden');
    }
  });

  // ── Open modal (Mental-health locking enforced) ──
  addBtn.addEventListener('click', () => {
    if (State.isStressedOrExhausted || State.today.mood === 'sad') {
      showToast('Workout locked for mental health recovery. Please rest today!', '🧠');
      return; // Lock exercise logging
    }

    editingExerciseId = null;
    actSelect.value  = '';
    customInput.value = '';
    customGroup.classList.add('hidden');
    timeInput.value  = '';
    repsInput.value  = '';
    if (timeOfDayInput) timeOfDayInput.value = 'Morning';
    document.querySelector('#exercise-modal .modal-title').textContent = 'Log Exercise';
    submitBtn.textContent = 'Log Exercise';

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

  // ── Delegation for Edit / Delete ──
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    
    const item = btn.closest('.log-item');
    if (!item) return;
    
    const id = Number(item.dataset.id);

    if (btn.classList.contains('delete-exercise-btn')) {
      if (confirm('Delete this exercise?')) {
        State.today.exercises = State.today.exercises.filter(ex => ex.id !== id);
        State.save();
        renderAllExercises();
        showToast('Exercise deleted', '🗑️');
      }
    } else if (btn.classList.contains('edit-exercise-btn')) {
      if (State.isStressedOrExhausted || State.today.mood === 'sad') {
        showToast('Workout locked for mental health recovery. Please rest today!', '🧠');
        return; // Lock editing
      }

      const exercise = State.today.exercises.find(ex => ex.id === id);
      if (exercise) {
        editingExerciseId = id;
        actSelect.value = exercise.activity;
        if (exercise.activity === 'other') {
          customGroup.classList.remove('hidden');
          customInput.value = exercise.name.replace('✏️ ', '').trim();
        } else {
          customGroup.classList.add('hidden');
        }
        timeInput.value = exercise.time || '';
        repsInput.value = exercise.reps || '';
        if (timeOfDayInput) timeOfDayInput.value = exercise.timeOfDay || 'Morning';
        
        document.querySelector('#exercise-modal .modal-title').textContent = 'Edit Exercise';
        submitBtn.textContent = 'Update Exercise';
        
        modal.classList.add('visible');
      }
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
    
    const timeOfDay = timeOfDayInput ? timeOfDayInput.value : 'Morning';

    if (editingExerciseId) {
      const exercise = State.today.exercises.find(ex => ex.id === editingExerciseId);
      if (exercise) {
        exercise.name = displayName;
        exercise.activity = activity;
        exercise.time = time || null;
        exercise.reps = reps || null;
        exercise.timeOfDay = timeOfDay;
        exercise.burn = burn;
      }
      editingExerciseId = null;
      showToast('Exercise updated!', '✅');
    } else {
      // Build exercise object
      const exercise = {
        id: Date.now(),
        name: displayName,
        activity,
        time: time || null,
        reps: reps || null,
        timeOfDay,
        burn,
        timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      State.today.exercises.push(exercise);
      EventBus.emit('exercise:added', { exercise });
      EventBus.emit('xp:gained', { amount: 20, reason: 'Logged an exercise' });

      // User feedback
      showToast(`${displayName} logged — ${burn} kcal burned! 🔥`, '🏃');
    }

    // Persist to state
    State.save();

    // Re-render
    renderAllExercises();

    // Clear inputs and close modal
    actSelect.value  = '';
    customInput.value = '';
    customGroup.classList.add('hidden');
    timeInput.value  = '';
    repsInput.value  = '';
    if (timeOfDayInput) timeOfDayInput.value = 'Morning';
    modal.classList.remove('visible');
    warningEl.classList.remove('visible');
  });

  // ── Restore persisted exercises on load ──
  renderAllExercises();

  console.log('🏃 Exercise module initialized');
}
