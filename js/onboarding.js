/* ============================================
   FitBuddy — Onboarding Wizard Module
   Real-time BMI, TDEE (Mifflin-St Jeor), Macros
   ============================================ */

import { State, EventBus, getApiBaseUrl, showToast } from './app.js';

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

    // Toggle valid/invalid visual feedback classes if user has typed something
    usernameInput.classList.toggle('invalid-input', username.length > 0 && !validUsername);
    weightInput.classList.toggle('invalid-input', weightInput.value.length > 0 && !validWeight);
    heightInput.classList.toggle('invalid-input', heightInput.value.length > 0 && !validHeight);
    ageInput.classList.toggle('invalid-input', ageInput.value.length > 0 && !validAge);

    let bmiRounded = null;
    let goalKey = null;
    let adjustedTDEE = null;
    let proteinG = null;
    let carbsG = null;
    let fatG = null;

    // ── 1. BMI & Goal (Needs valid weight & height) ──
    if (validWeight && validHeight) {
      const heightM = height / 100;
      const bmi = weight / (heightM * heightM);
      bmiRounded = bmi.toFixed(1);

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
      bmiDisplay.style.display = 'flex';
      bmiValue.textContent     = bmiRounded;
      bmiIndicator.textContent = bmiLabel;
      bmiIndicator.className   = `bmi-indicator ${bmiClass}`;

      // ── Auto-suggest goal ──
      let goalLabel;
      if (bmi < 18.5) {
        goalKey = 'gain';     goalLabel = 'Gain Weight';
      } else if (bmi < 25) {
        goalKey = 'maintain';  goalLabel = 'Maintain';
      } else {
        goalKey = 'loss';      goalLabel = 'Lose Weight';
      }

      goalDisplay.style.display = 'flex';
      goalValue.textContent     = goalLabel;
    } else {
      bmiDisplay.style.display  = 'none';
      goalDisplay.style.display = 'none';
    }

    // ── 2. TDEE & Macros (Needs valid weight, height, and age) ──
    if (validWeight && validHeight && validAge) {
      // Get suggested goal from BMI
      const heightM = height / 100;
      const bmi = weight / (heightM * heightM);
      let calculatedGoalKey;
      if (bmi < 18.5) calculatedGoalKey = 'gain';
      else if (bmi < 25) calculatedGoalKey = 'maintain';
      else calculatedGoalKey = 'loss';

      let bmr;
      if (gender === 'male') {
        bmr = 10 * weight + 6.25 * height - 5 * age + 5;
      } else {
        bmr = 10 * weight + 6.25 * height - 5 * age - 161;
      }

      const baseTDEE    = bmr * ACTIVITY_MULTIPLIER;
      const adjustment  = GOAL_ADJUSTMENTS[calculatedGoalKey] || 0;
      adjustedTDEE = Math.round(baseTDEE + adjustment);

      tdeeDisplay.style.display = 'flex';
      tdeeValue.textContent     = `${adjustedTDEE} kcal`;

      // Macros from adjusted TDEE
      proteinG = Math.round((adjustedTDEE * MACRO_PROTEIN_PCT) / KCAL_PER_G_PROTEIN);
      carbsG   = Math.round((adjustedTDEE * MACRO_CARBS_PCT)   / KCAL_PER_G_CARBS);
      fatG     = Math.round((adjustedTDEE * MACRO_FAT_PCT)     / KCAL_PER_G_FAT);
    } else {
      tdeeDisplay.style.display = 'none';
    }

    // ── 3. Final submission package (Only sets when all fields are valid) ──
    if (allValid && bmiRounded && goalKey && adjustedTDEE) {
      _computed = {
        bmi: parseFloat(bmiRounded),
        goalKey,
        adjustedTDEE,
        proteinG,
        carbsG,
        fatG,
        weight,
        height,
        age,
        gender
      };
    } else {
      _computed = null;
    }
  }

  // Holds the latest computed values
  let _computed = null;

  // Run once initially to handle any pre-filled or browser autofilled values
  recalculate();

  // ── Submit Handler ──
  submitBtn.addEventListener('click', async () => {
    if (!_computed) return;

    const username = usernameInput.value.trim();
    if (!username) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Syncing...';

    try {
      const endpoint = `${getApiBaseUrl()}/api/user-data?username=${encodeURIComponent(username)}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout fail-safe
      
      const res = await fetch(endpoint, { signal: controller.signal });
      clearTimeout(timeoutId);
      const resData = await res.json();
      
      if (resData.success && resData.data) {
        localStorage.setItem('fitbuddy_state', JSON.stringify(resData.data));
        window.location.reload();
        return;
      }
    } catch (e) {
      console.warn('DB check failed or timed out, creating local user first:', e);
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
