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

let googleSessionState = null;
let standardSignupData = null;
let _computedBiometrics = null;

window.__actualHandleCredentialResponse = async (response) => {
  try {
    const jwt = response.credential;
    const payloadBase64 = jwt.split('.')[1];
    const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const decodedPayload = JSON.parse(atob(padded));

    const googleId = decodedPayload.sub;
    const email = decodedPayload.email;
    const name = decodedPayload.name;

    const apiRes = await fetch(`${getApiBaseUrl()}/api/google-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ googleId, email, name })
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      showToast(data.error || 'Google Sign-In failed', '🔒');
      return;
    }

    const returnedState = data.state;

    if (returnedState.onboarded) {
      const { reloadState } = await import('./app.js');
      reloadState(returnedState, 'google-auth-session');
      const modal = document.getElementById('onboarding-modal');
      if (modal) modal.classList.remove('visible');
      showToast(`Welcome back, ${returnedState.user.username}!`, '🎉');
    } else {
      googleSessionState = returnedState;
      standardSignupData = null;
      
      document.getElementById('auth-signin-section').style.display = 'none';
      document.getElementById('auth-signup-section').style.display = 'none';
      document.getElementById('onboard-biometrics-section').style.display = 'block';
      
      // Hide shared Google elements during biometrics phase
      document.getElementById('shared-google-btn-section').style.display = 'none';
      document.getElementById('signin-footer-link').style.display = 'none';
      document.getElementById('signup-footer-link').style.display = 'none';
      
      showToast('Login successful! Please complete your biometrics setup.', '📊');
    }

  } catch (err) {
    console.error('Google Sign-In Callback Error:', err);
    showToast('Google Sign-In failed: ' + (err.message || err), '⚠️');
  }
};

if (window.__pendingGoogleResponse) {
  const resp = window.__pendingGoogleResponse;
  window.__pendingGoogleResponse = null;
  window.__actualHandleCredentialResponse(resp);
}

export function initOnboarding() {
  const goToSignupBtn = document.getElementById('go-to-signup');
  const goToSigninBtn = document.getElementById('go-to-signin');
  const forgotPasswordLink = document.getElementById('forgot-password-link');
  const backToLoginLink = document.getElementById('back-to-login');
  const backToResetLink = document.getElementById('back-to-reset');

  const authSigninSection = document.getElementById('auth-signin-section');
  const authSignupSection = document.getElementById('auth-signup-section');
  const onboardBiometricsSection = document.getElementById('onboard-biometrics-section');
  const forgotPasswordSection = document.getElementById('forgot-password-section');
  const verifyCodeSection = document.getElementById('verify-code-section');

  const sharedGoogleBtnSection = document.getElementById('shared-google-btn-section');
  const signinFooterLink = document.getElementById('signin-footer-link');
  const signupFooterLink = document.getElementById('signup-footer-link');

  const signinUsernameInput = document.getElementById('signin-username');
  const signinPasswordInput = document.getElementById('signin-password');
  const signinSubmitBtn = document.getElementById('signin-submit');

  const onboardEmailInput = document.getElementById('onboard-email');
  const onboardUsernameInput = document.getElementById('onboard-username');
  const onboardPasswordInput = document.getElementById('onboard-password');
  const signupNextBtn = document.getElementById('signup-next');

  const onboardGenderSelect = document.getElementById('onboard-gender');
  const onboardWeightInput = document.getElementById('onboard-weight');
  const onboardHeightInput = document.getElementById('onboard-height');
  const onboardAgeInput = document.getElementById('onboard-age');
  const onboardCuisineSelect = document.getElementById('onboard-cuisine');
  const onboardDietSelect = document.getElementById('onboard-diet');
  const onboardSubmitBtn = document.getElementById('onboard-submit');

  const bmiDisplay = document.getElementById('bmi-display');
  const bmiValue = document.getElementById('bmi-value');
  const bmiIndicator = document.getElementById('bmi-indicator');
  const goalDisplay = document.getElementById('goal-display');
  const goalValue = document.getElementById('goal-value');
  const tdeeDisplay = document.getElementById('tdee-display');
  const tdeeValue = document.getElementById('tdee-value');
  const modal = document.getElementById('onboarding-modal');

  const resetUsernameInput = document.getElementById('reset-username');
  const resetEmailInput = document.getElementById('reset-email');
  const resetSendCodeBtn = document.getElementById('reset-send-code');
  const verifyCodeInput = document.getElementById('verify-code-input');
  const verifyNewPasswordInput = document.getElementById('verify-new-password');
  const resetSubmitNewPasswordBtn = document.getElementById('reset-submit-new-password');

  if (goToSignupBtn) {
    goToSignupBtn.addEventListener('click', (e) => {
      e.preventDefault();
      authSigninSection.style.display = 'none';
      authSignupSection.style.display = 'block';
      signinFooterLink.style.display = 'none';
      signupFooterLink.style.display = 'block';
      sharedGoogleBtnSection.style.display = 'block';
    });
  }

  if (goToSigninBtn) {
    goToSigninBtn.addEventListener('click', (e) => {
      e.preventDefault();
      authSignupSection.style.display = 'none';
      authSigninSection.style.display = 'block';
      signupFooterLink.style.display = 'none';
      signinFooterLink.style.display = 'block';
      sharedGoogleBtnSection.style.display = 'block';
    });
  }

  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      authSigninSection.style.display = 'none';
      forgotPasswordSection.style.display = 'block';
      sharedGoogleBtnSection.style.display = 'none';
      signinFooterLink.style.display = 'none';
      signupFooterLink.style.display = 'none';
    });
  }

  if (backToLoginLink) {
    backToLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      forgotPasswordSection.style.display = 'none';
      authSigninSection.style.display = 'block';
      sharedGoogleBtnSection.style.display = 'block';
      signinFooterLink.style.display = 'block';
      signupFooterLink.style.display = 'none';
    });
  }

  if (backToResetLink) {
    backToResetLink.addEventListener('click', (e) => {
      e.preventDefault();
      verifyCodeSection.style.display = 'none';
      forgotPasswordSection.style.display = 'block';
      sharedGoogleBtnSection.style.display = 'none';
      signinFooterLink.style.display = 'none';
      signupFooterLink.style.display = 'none';
    });
  }

  const signinInputs = [signinUsernameInput, signinPasswordInput];
  signinInputs.forEach(el => {
    if (el) {
      el.addEventListener('input', validateSignin);
    }
  });

  const signupInputs = [onboardEmailInput, onboardUsernameInput, onboardPasswordInput];
  signupInputs.forEach(el => {
    if (el) {
      el.addEventListener('input', validateSignup);
    }
  });

  const biometricInputs = [onboardWeightInput, onboardHeightInput, onboardAgeInput, onboardGenderSelect];
  biometricInputs.forEach(el => {
    if (el) {
      el.addEventListener('input', recalculateBiometrics);
      el.addEventListener('change', recalculateBiometrics);
    }
  });

  function validateSignin() {
    const user = signinUsernameInput.value.trim();
    const pass = signinPasswordInput.value.trim();
    signinSubmitBtn.disabled = !(user.length >= 2 && pass.length >= 4);
  }

  function validateSignup() {
    const email = onboardEmailInput.value.trim();
    const user = onboardUsernameInput.value.trim();
    const pass = onboardPasswordInput.value.trim();

    const validEmail = email.includes('@') && email.length >= 5;
    const validUser = user.length >= 2;
    const validPass = pass.length >= 4;

    signupNextBtn.disabled = !(validEmail && validUser && validPass);
  }

  function recalculateBiometrics() {
    const weight = parseFloat(onboardWeightInput.value);
    const height = parseFloat(onboardHeightInput.value);
    const age    = parseInt(onboardAgeInput.value, 10);
    const gender = onboardGenderSelect.value;

    const validWeight = weight >= 20 && weight <= 300;
    const validHeight = height >= 100 && height <= 250;
    const validAge    = age >= 10 && age <= 120;
    const allValid    = validWeight && validHeight && validAge;

    onboardSubmitBtn.disabled = !allValid;

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
      _computedBiometrics = {
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
      _computedBiometrics = null;
    }
  }

  signinSubmitBtn.addEventListener('click', async () => {
    const username = signinUsernameInput.value.trim();
    const password = signinPasswordInput.value.trim();

    if (!username || !password) {
      showToast('Username and password are required!', '⚠️');
      return;
    }

    signinSubmitBtn.disabled = true;
    signinSubmitBtn.textContent = 'Signing In...';

    try {
      const endpoint = `${getApiBaseUrl()}/api/user-data?username=${encodeURIComponent(username)}`;
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Password': password
        }
      });

      const resData = await response.json();
      if (!response.ok) {
        showToast(resData.error || 'Authentication failed!', '🔒');
        signinSubmitBtn.disabled = false;
        signinSubmitBtn.textContent = 'Sign In →';
        return;
      }

      if (!resData.exists || !resData.data) {
        showToast('Username does not exist. Please Sign Up.', '⚠️');
        signinSubmitBtn.disabled = false;
        signinSubmitBtn.textContent = 'Sign In →';
        return;
      }

      localStorage.setItem('fitbuddy_password', password);
      
      const finalState = resData.data;
      const { reloadState } = await import('./app.js');
      reloadState(finalState, password);

      modal.classList.remove('visible');
      showToast(`Welcome back, ${username}!`, '🎉');

    } catch (e) {
      console.error(e);
      showToast('Could not connect to server.', '⚠️');
      signinSubmitBtn.disabled = false;
      signinSubmitBtn.textContent = 'Sign In →';
    }
  });

  signupNextBtn.addEventListener('click', () => {
    const email = onboardEmailInput.value.trim();
    const username = onboardUsernameInput.value.trim();
    const password = onboardPasswordInput.value.trim();

    standardSignupData = { email, username, password };
    googleSessionState = null;

    authSignupSection.style.display = 'none';
    onboardBiometricsSection.style.display = 'block';

    // Hide shared Google elements during biometrics phase
    sharedGoogleBtnSection.style.display = 'none';
    signinFooterLink.style.display = 'none';
    signupFooterLink.style.display = 'none';
  });

  onboardSubmitBtn.addEventListener('click', async () => {
    if (!_computedBiometrics) return;

    onboardSubmitBtn.disabled = true;
    onboardSubmitBtn.textContent = 'Saving Profile...';

    const { bmi, goalKey, adjustedTDEE, proteinG, carbsG, fatG, weight, height, age, gender } = _computedBiometrics;
    const cuisine = onboardCuisineSelect.value;
    const diet = onboardDietSelect.value;

    if (googleSessionState) {
      const updatedState = { ...googleSessionState };
      updatedState.user = {
        ...updatedState.user,
        weight,
        height,
        age,
        gender,
        bmi,
        goal: goalKey,
        tdee: adjustedTDEE,
        macros: { protein: proteinG, carbs: carbsG, fat: fatG },
        cuisine,
        diet,
      };
      updatedState.onboarded = true;

      try {
        const response = await fetch(`${getApiBaseUrl()}/api/user-data`, {
          method: 'POST',
          headers: dbHeaders(),
          body: JSON.stringify({
            username: updatedState.user.username,
            password: 'google-auth-session',
            state: updatedState
          })
        });

        const resData = await response.json();
        if (!response.ok) {
          showToast(resData.error || 'Failed to complete Google profile.', '⚠️');
          onboardSubmitBtn.disabled = false;
          onboardSubmitBtn.textContent = 'Complete Profile →';
          return;
        }

        const { reloadState } = await import('./app.js');
        reloadState(resData.state || updatedState, 'google-auth-session');

        modal.classList.remove('visible');
        showToast('Registration complete! Welcome to FitBuddy.', '🎉');

      } catch (err) {
        console.error(err);
        showToast('Could not complete Google biometrics.', '⚠️');
        onboardSubmitBtn.disabled = false;
        onboardSubmitBtn.textContent = 'Complete Profile →';
      }

    } else if (standardSignupData) {
      const { email, username, password } = standardSignupData;

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
          cuisine,
          diet,
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
        const response = await fetch(`${getApiBaseUrl()}/api/user-data`, {
          method: 'POST',
          headers: dbHeaders(),
          body: JSON.stringify({ username, password, state: proposedState })
        });

        const resData = await response.json();
        if (!response.ok) {
          showToast(resData.error || 'Registration failed!', '🔒');
          onboardSubmitBtn.disabled = false;
          onboardSubmitBtn.textContent = 'Complete Profile →';
          return;
        }

        localStorage.setItem('fitbuddy_password', password);
        
        const finalState = resData.state || proposedState;
        const { reloadState } = await import('./app.js');
        reloadState(finalState, password);

        modal.classList.remove('visible');
        showToast(`Account "${username}" registered!`, '🎉');

      } catch (e) {
        console.error(e);
        showToast('Could not connect to server.', '⚠️');
        onboardSubmitBtn.disabled = false;
        onboardSubmitBtn.textContent = 'Complete Profile →';
      }
    }
  });

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

        showToast('Password reset successfully! Please sign in.', '🎉');
        
        verifyCodeSection.style.display = 'none';
        authSigninSection.style.display = 'block';
        signinUsernameInput.value = username;
        signinPasswordInput.value = newPassword;
        validateSignin();

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
