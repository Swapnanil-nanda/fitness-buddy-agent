/* ============================================
   FitBuddy — Onboarding Wizard Module
   Real-time BMI, TDEE (Mifflin-St Jeor), Macros
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── Constants ────
const ACTIVITY_MULTIPLIER = 1.375; // Lightly active default
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS   = 4;
const KCAL_PER_G_FAT     = 9;

// Macro split ratios
const MACRO_PROTEIN_PCT = 0.30;
const MACRO_CARBS_PCT   = 0.40;
const MACRO_FAT_PCT     = 0.30;

// Goal calorie adjustments
const GOAL_ADJUSTMENTS = {
  loss:     -500,
  maintain:  0,
  gain:      300
};

/**
 * Initialise the onboarding wizard.
 * Sets up input listeners for real-time calculation and the submit handler.
 */
export function initOnboarding() {
  // ── DOM References ──
  const usernameInput = document.getElementById('onboard-username');
  const weightInput  = document.getElementById('onboard-weight');
  const heightInput  = document.getElementById('onboard-height');
  const ageInput     = document.getElementById('onboard-age');
  const genderSelect = document.getElementById('onboard-gender');
  const submitBtn    = document.getElementById('onboard-submit');

  // Computed display elements
  const bmiDisplay   = document.getElementById('bmi-display');
  const bmiValue     = document.getElementById('bmi-value');
  const bmiIndicator = document.getElementById('bmi-indicator');
  const goalDisplay  = document.getElementById('goal-display');
  const goalValue    = document.getElementById('goal-value');
  const tdeeDisplay  = document.getElementById('tdee-display');
  const tdeeValue    = document.getElementById('tdee-value');
  const modal        = document.getElementById('onboarding-modal');

  // ── Recalculate on every input change ──
  const inputs = [usernameInput, weightInput, heightInput, ageInput, genderSelect];
  inputs.forEach(el => el.addEventListener('input', recalculate));
  genderSelect.addEventListener('change', recalculate);

  /**
   * Core recalculation pipeline.
   * Runs on every keystroke / dropdown change.
   */
  function recalculate() {
    const username = usernameInput.value.trim();
    const weight = parseFloat(weightInput.value);
    const height = parseFloat(heightInput.value);
    const age    = parseInt(ageInput.value, 10);
    const gender = genderSelect.value;

    // ── Validate inputs ──
    const validUsername = username.length >= 2;
    const validWeight = weight >= 20 && weight <= 300;
    const validHeight = height >= 100 && height <= 250;
    const validAge    = age >= 10 && age <= 120;
    const allValid    = validUsername && validWeight && validHeight && validAge;

    // Enable / disable submit
    submitBtn.disabled = !allValid;

    if (!allValid) {
      // Hide computed sections when data is incomplete
      bmiDisplay.style.display  = 'none';
      goalDisplay.style.display = 'none';
      tdeeDisplay.style.display = 'none';
      return;
    }

    // ── BMI ──
    const heightM = height / 100;
    const bmi = weight / (heightM * heightM);
    const bmiRounded = bmi.toFixed(1);

    // Classify
    let bmiClass, bmiLabel;
    if (bmi < 18.5) {
      bmiClass = 'underweight'; bmiLabel = 'Underweight';
    } else if (bmi < 25) {
      bmiClass = 'normal';      bmiLabel = 'Normal';
    } else if (bmi < 30) {
      bmiClass = 'overweight';  bmiLabel = 'Overweight';
    } else {
      bmiClass = 'obese';       bmiLabel = 'Obese';
    }

    // Update BMI display
    bmiDisplay.style.display = '';
    bmiValue.textContent     = bmiRounded;
    bmiIndicator.textContent = bmiLabel;
    bmiIndicator.className   = `bmi-indicator ${bmiClass}`;

    // ── Auto-suggest goal ──
    let goalKey, goalLabel;
    if (bmi < 18.5) {
      goalKey = 'gain';     goalLabel = 'Gain Weight';
    } else if (bmi < 25) {
      goalKey = 'maintain';  goalLabel = 'Maintain';
    } else {
      goalKey = 'loss';      goalLabel = 'Lose Weight';
    }

    goalDisplay.style.display = '';
    goalValue.textContent     = goalLabel;

    // ── TDEE (Mifflin-St Jeor) ──
    let bmr;
    if (gender === 'male') {
      bmr = 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      bmr = 10 * weight + 6.25 * height - 5 * age - 161;
    }

    const baseTDEE    = bmr * ACTIVITY_MULTIPLIER;
    const adjustment  = GOAL_ADJUSTMENTS[goalKey] || 0;
    const adjustedTDEE = Math.round(baseTDEE + adjustment);

    tdeeDisplay.style.display = '';
    tdeeValue.textContent     = `${adjustedTDEE} kcal`;

    // ── Macros from adjusted TDEE ──
    const proteinG = Math.round((adjustedTDEE * MACRO_PROTEIN_PCT) / KCAL_PER_G_PROTEIN);
    const carbsG   = Math.round((adjustedTDEE * MACRO_CARBS_PCT)   / KCAL_PER_G_CARBS);
    const fatG     = Math.round((adjustedTDEE * MACRO_FAT_PCT)     / KCAL_PER_G_FAT);

    // Stash computed values in closure-level vars for the submit handler
    _computed = { bmi: parseFloat(bmiRounded), goalKey, adjustedTDEE, proteinG, carbsG, fatG, weight, height, age, gender };
  }

  // Holds the latest computed values
  let _computed = null;

  // ── Submit Handler ──
  submitBtn.addEventListener('click', async () => {
    if (!_computed) return;

    const username = usernameInput.value.trim();
    if (!username) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Syncing...';

    try {
      const isLocal = window.location.port === '3000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const endpoint = isLocal ? `http://localhost:3001/api/user-data?username=${encodeURIComponent(username)}` : `/api/user-data?username=${encodeURIComponent(username)}`;
      
      const res = await fetch(endpoint);
      const resData = await res.json();
      
      if (resData.success && resData.data) {
        localStorage.setItem('fitbuddy_state', JSON.stringify(resData.data));
        window.location.reload();
        return;
      }
    } catch (e) {
      console.warn('DB check failed, creating local user first:', e);
    }

    const { bmi, goalKey, adjustedTDEE, proteinG, carbsG, fatG, weight, height, age, gender } = _computed;

    State.patch('user', {
      username,
      weight,
      height,
      age,
      gender,
      bmi,
      goal: goalKey,
      tdee: adjustedTDEE,
      macros: { protein: proteinG, carbs: carbsG, fat: fatG }
    });

    State.set('onboarded', true);
    modal.classList.remove('visible');
    showToast(`Account "${username}" created! Target: ${adjustedTDEE} kcal.`, '🎉', 3500);
  });
}
