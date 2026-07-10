

import { State, EventBus, getApiBaseUrl, showToast, dbHeaders } from './app.js';


const ACTIVITY_MULTIPLIER = 1.375; 
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS   = 4;
const KCAL_PER_G_FAT     = 9;


const MACRO_PROTEIN_PCT = 0.30;
const MACRO_CARBS_PCT   = 0.40;
const MACRO_FAT_PCT     = 0.30;


const GOAL_ADJUSTMENTS = {
  loss:     -500,
  maintain:  0,
  gain:      300
};


export function initOnboarding() {
  
  const usernameInput = document.getElementById('onboard-username');
  const passwordInput = document.getElementById('onboard-password');
  const weightInput  = document.getElementById('onboard-weight');
  const heightInput  = document.getElementById('onboard-height');
  const ageInput     = document.getElementById('onboard-age');
  const genderSelect = document.getElementById('onboard-gender');
  const submitBtn    = document.getElementById('onboard-submit');

  
  const bmiDisplay   = document.getElementById('bmi-display');
  const bmiValue     = document.getElementById('bmi-value');
  const bmiIndicator = document.getElementById('bmi-indicator');
  const goalDisplay  = document.getElementById('goal-display');
  const goalValue    = document.getElementById('goal-value');
  const tdeeDisplay  = document.getElementById('tdee-display');
  const tdeeValue    = document.getElementById('tdee-value');
  const modal        = document.getElementById('onboarding-modal');

  
  const inputs = [usernameInput, passwordInput, weightInput, heightInput, ageInput, genderSelect];
  inputs.forEach(el => {
    if (el) {
      el.addEventListener('input', recalculate);
      el.addEventListener('change', recalculate);
      el.addEventListener('blur', recalculate);
    }
  });
  genderSelect.addEventListener('change', recalculate);

  
  modal.addEventListener('click', recalculate);
  modal.addEventListener('touchstart', recalculate, { passive: true });

  
  function recalculate() {
    const username = usernameInput.value.trim();
    const password = passwordInput ? passwordInput.value : '';
    const weight = parseFloat(weightInput.value);
    const height = parseFloat(heightInput.value);
    const age    = parseInt(ageInput.value, 10);
    const gender = genderSelect.value;

    
    const validUsername = username.length >= 2;
    const validPassword = password.length >= 4;
    const validWeight = weight >= 20 && weight <= 300;
    const validHeight = height >= 100 && height <= 250;
    const validAge    = age >= 10 && age <= 120;
    const allValid    = validUsername && validPassword && validWeight && validHeight && validAge;

    
    submitBtn.disabled = !allValid;

    
    usernameInput.classList.toggle('invalid-input', username.length > 0 && !validUsername);
    if (passwordInput) passwordInput.classList.toggle('invalid-input', password.length > 0 && !validPassword);
    weightInput.classList.toggle('invalid-input', weightInput.value.length > 0 && !validWeight);
    heightInput.classList.toggle('invalid-input', heightInput.value.length > 0 && !validHeight);
    ageInput.classList.toggle('invalid-input', ageInput.value.length > 0 && !validAge);

    let bmiRounded = null;
    let goalKey = null;
    let adjustedTDEE = null;
    let proteinG = null;
    let carbsG = null;
    let fatG = null;

    
    if (validWeight && validHeight) {
      const heightM = height / 100;
      const bmi = weight / (heightM * heightM);
      bmiRounded = bmi.toFixed(1);

      
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

      
      bmiDisplay.style.display = 'flex';
      bmiValue.textContent     = bmiRounded;
      bmiIndicator.textContent = bmiLabel;
      bmiIndicator.className   = `bmi-indicator ${bmiClass}`;

      
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

    
    if (validWeight && validHeight && validAge) {
      
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

      
      proteinG = Math.round((adjustedTDEE * MACRO_PROTEIN_PCT) / KCAL_PER_G_PROTEIN);
      carbsG   = Math.round((adjustedTDEE * MACRO_CARBS_PCT)   / KCAL_PER_G_CARBS);
      fatG     = Math.round((adjustedTDEE * MACRO_FAT_PCT)     / KCAL_PER_G_FAT);
    } else {
      tdeeDisplay.style.display = 'none';
    }

    
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

  
  let _computed = null;

  
  recalculate();

  
  submitBtn.addEventListener('click', async () => {
    if (!_computed) return;

    const username = usernameInput.value.trim();
    const password = passwordInput ? passwordInput.value.trim() : '';
    if (!username || !password) {
      showToast('Username and password are required!', '⚠️');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Syncing...';

    const { bmi, goalKey, adjustedTDEE, proteinG, carbsG, fatG, weight, height, age, gender } = _computed;
    const cuisineEl = document.getElementById('onboard-cuisine');
    const dietEl    = document.getElementById('onboard-diet');

    const proposedState = {
      user: {
        username,
        weight,
        height,
        age,
        gender,
        bmi,
        goal: goalKey,
        tdee: adjustedTDEE,
        macros: { protein: proteinG, carbs: carbsG, fat: fatG },
        cuisine: cuisineEl ? cuisineEl.value : 'any',
        diet:    dietEl    ? dietEl.value    : 'no-restriction',
        userId: ''
      },
      today: {
        date: new Date().toISOString().split('T')[0],
        meals: [],
        exercises: [],
        water: 0,
        sleep: 0,
        mood: 'neutral',
        xpEarned: 0,
        challenges: []
      },
      xp: {
        current: 0,
        level: 1,
        total: 0
      },
      settings: {
        mode: 'proxy'
      },
      chatHistory: [],
      onboarded: true
    };

    try {
      const endpoint = `${getApiBaseUrl()}/api/user-data`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({ username, password, state: proposedState })
      });
      
      const resData = await response.json();
      
      if (!response.ok) {
        showToast(resData.error || 'Authentication failed!', '🔒');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Get Started';
        return;
      }

      localStorage.setItem('fitbuddy_password', password);
      
      const finalState = resData.state || proposedState;
      
      const { reloadState } = await import('./app.js');
      reloadState(finalState, password);
      
      modal.classList.remove('visible');
      showToast(resData.exists ? `Welcome back, ${username}!` : `Account "${username}" created!`, '🎉');
      
    } catch (e) {
      console.error('Authentication failed:', e);
      showToast('Could not connect to server. Please try again.', '⚠️');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Get Started';
    }
  });
}
