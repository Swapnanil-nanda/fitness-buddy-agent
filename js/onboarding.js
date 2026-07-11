

import { State, EventBus, getApiBaseUrl, showToast, dbHeaders } from './app.js';


const ACTIVITY_MULTIPLIER = 1.375; 
const KCAL_PER_G_PROTEIN = 4;
const KCAL_PER_G_CARBS   = 4;
const KCAL_PER_G_FAT     = 9;


const MACRO_PROTEIN_PCT = 0.30;
const MACRO_CARBS_PCT   = 0.40;
const MACRO_FAT_PCT     = 0.30;


const GOAL_ADJUSTMENTS = {
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
  const emailInput    = document.getElementById('onboard-email');
  const weightInput   = document.getElementById('onboard-weight');
  const heightInput   = document.getElementById('onboard-height');
  const ageInput      = document.getElementById('onboard-age');
  const genderSelect  = document.getElementById('onboard-gender');
  const submitBtn     = document.getElementById('onboard-submit');

  const bmiDisplay   = document.getElementById('bmi-display');
  const bmiValue     = document.getElementById('bmi-value');
  const bmiIndicator = document.getElementById('bmi-indicator');
  const goalDisplay  = document.getElementById('goal-display');
  const goalValue    = document.getElementById('goal-value');
  const tdeeDisplay  = document.getElementById('tdee-display');
  const tdeeValue    = document.getElementById('tdee-value');
  const modal        = document.getElementById('onboarding-modal');

  const inputs = [usernameInput, passwordInput, emailInput, weightInput, heightInput, ageInput, genderSelect];
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
    const email    = emailInput ? emailInput.value.trim() : '';
    const weight = parseFloat(weightInput.value);
    const height = parseFloat(heightInput.value);
    const age    = parseInt(ageInput.value, 10);
    const gender = genderSelect.value;

    const validUsername = username.length >= 2;
    const validPassword = password.length >= 4;
    const validEmail    = email.includes('@') && email.length >= 5;
    const validWeight = weight >= 20 && weight <= 300;
    const validHeight = height >= 100 && height <= 250;
    const validAge    = age >= 10 && age <= 120;
    const allValid    = validUsername && validPassword && validEmail && validWeight && validHeight && validAge;

    submitBtn.disabled = !allValid;

    usernameInput.classList.toggle('invalid-input', username.length > 0 && !validUsername);
    if (passwordInput) passwordInput.classList.toggle('invalid-input', password.length > 0 && !validPassword);
    if (emailInput) emailInput.classList.toggle('invalid-input', email.length > 0 && !validEmail);
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
    const email    = emailInput ? emailInput.value.trim() : '';

    if (!username || !password || !email) {
      showToast('Username, password, and email are required!', '⚠️');
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
        email,
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
        submitBtn.textContent = 'Get Started →';
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
      submitBtn.textContent = 'Get Started →';
    }
  });

  const forgotPasswordLink = document.getElementById('forgot-password-link');
  const onboardMainSection = document.getElementById('onboard-main-section');
  const forgotPasswordSection = document.getElementById('forgot-password-section');
  const verifyCodeSection = document.getElementById('verify-code-section');

  const backToLoginLink = document.getElementById('back-to-login');
  const backToResetLink = document.getElementById('back-to-reset');

  const resetUsernameInput = document.getElementById('reset-username');
  const resetEmailInput = document.getElementById('reset-email');
  const resetSendCodeBtn = document.getElementById('reset-send-code');

  const verifyCodeInput = document.getElementById('verify-code-input');
  const verifyNewPasswordInput = document.getElementById('verify-new-password');
  const resetSubmitNewPasswordBtn = document.getElementById('reset-submit-new-password');

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      onboardMainSection.style.display = 'none';
      forgotPasswordSection.style.display = 'block';
    });
  }

  if (backToLoginLink) {
    backToLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      forgotPasswordSection.style.display = 'none';
      onboardMainSection.style.display = 'block';
    });
  }

  if (backToResetLink) {
    backToResetLink.addEventListener('click', (e) => {
      e.preventDefault();
      verifyCodeSection.style.display = 'none';
      forgotPasswordSection.style.display = 'block';
    });
  }

  if (resetSendCodeBtn) {
    resetSendCodeBtn.addEventListener('click', async () => {
      const username = resetUsernameInput.value.trim();
      const email = resetEmailInput.value.trim();

      if (!username || !email) {
        showToast('Username and email are required!', '⚠️');
        return;
      }

      resetSendCodeBtn.disabled = true;
      resetSendCodeBtn.textContent = 'Sending...';

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/reset-password?action=send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, email })
        });

        const data = await response.json();
        if (!response.ok) {
          showToast(data.error || 'Failed to send recovery code.', '⚠️');
          resetSendCodeBtn.disabled = false;
          resetSendCodeBtn.textContent = 'Send Verification Code';
          return;
        }

        if (data.devMode && data.code) {
          showToast(`[Dev Mode] Code: ${data.code}`, '🔑');
          console.log(`[Dev Mode] Recovery code: ${data.code}`);
        } else {
          showToast('Verification code sent to your email!', '✉️');
        }

        forgotPasswordSection.style.display = 'none';
        verifyCodeSection.style.display = 'block';

      } catch (err) {
        console.error(err);
        showToast('Error connecting to recovery service.', '⚠️');
      } finally {
        resetSendCodeBtn.disabled = false;
        resetSendCodeBtn.textContent = 'Send Verification Code';
      }
    });
  }

  if (resetSubmitNewPasswordBtn) {
    resetSubmitNewPasswordBtn.addEventListener('click', async () => {
      const username = resetUsernameInput.value.trim();
      const code = verifyCodeInput.value.trim();
      const newPassword = verifyNewPasswordInput.value.trim();

      if (!username || !code || !newPassword) {
        showToast('Code and new password are required!', '⚠️');
        return;
      }

      if (newPassword.length < 4) {
        showToast('Password must be at least 4 characters long!', '⚠️');
        return;
      }

      resetSubmitNewPasswordBtn.disabled = true;
      resetSubmitNewPasswordBtn.textContent = 'Resetting...';

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/reset-password?action=verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, code, newPassword })
        });

        const data = await response.json();
        if (!response.ok) {
          showToast(data.error || 'Failed to reset password.', '⚠️');
          resetSubmitNewPasswordBtn.disabled = false;
          resetSubmitNewPasswordBtn.textContent = 'Reset Password';
          return;
        }

        showToast('Password reset successfully! Logging you in...', '🎉');
        localStorage.setItem('fitbuddy_password', newPassword);

        verifyCodeSection.style.display = 'none';
        onboardMainSection.style.display = 'block';
        usernameInput.value = username;
        passwordInput.value = newPassword;
        recalculate();
        submitBtn.click();

      } catch (err) {
        console.error(err);
        showToast('Error resetting password.', '⚠️');
      } finally {
        resetSubmitNewPasswordBtn.disabled = false;
        resetSubmitNewPasswordBtn.textContent = 'Reset Password';
      }
    });
  }
}
