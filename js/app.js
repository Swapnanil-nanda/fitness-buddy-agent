/* ============================================
   FitBuddy — Core Application State & Router
   ============================================ */

// ──── Event Bus ────
const _listeners = {};
export const EventBus = {
  on(event, fn) {
    (_listeners[event] ||= []).push(fn);
  },
  off(event, fn) {
    if (_listeners[event]) _listeners[event] = _listeners[event].filter(f => f !== fn);
  },
  emit(event, data) {
    (_listeners[event] || []).forEach(fn => {
      try { fn(data); } catch(e) { console.error(`EventBus [${event}]:`, e); }
    });
  }
};

// ──── Default State ────
function createDefaultState() {
  return {
    user: {
      username: '',
      weight: 0,
      height: 0,
      age: 0,
      gender: 'male',
      bmi: 0,
      goal: 'maintain', // 'loss' | 'maintain' | 'gain'
      tdee: 0,
      macros: { protein: 0, carbs: 0, fat: 0 },
      bodyFat: 0,
      neck: 0,
      waist: 0,
      hip: 0,
      activity: 'lightly' // 'sedentary' | 'lightly' | 'moderately' | 'very' | 'extra'
    },
    onboarded: false,
    today: freshDay(),
    xp: { total: 0, level: 1, title: 'Beginner' },
    settings: {
      mode: 'proxy' // 'proxy' | 'local' | 'direct'
    },
    chatHistory: []
  };
}

export function freshDay() {
  return {
    date: new Date().toISOString().split('T')[0],
    meals: [],
    exercises: [],
    water: 0,
    sleep: 7,
    mood: 'neutral',
    xpEarned: 0,
    challenges: [
      { id: 'c1', text: 'Drink 8 glasses of water', xp: 20, completed: false },
      { id: 'c2', text: 'Log at least 2 meals', xp: 15, completed: false },
      { id: 'c3', text: 'Do 10 minutes of exercise', xp: 25, completed: false }
    ]
  };
}

async function syncToDatabase() {
  const username = _state.user.username;
  if (!username) return;
  try {
    const isLocal = window.location.port === '3000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const endpoint = isLocal ? 'http://localhost:3001/api/user-data' : '/api/user-data';
    
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, state: _state })
    });
  } catch (e) {
    console.warn('Database sync failed:', e);
  }
}

export async function loadUserDataFromDB(username) {
  try {
    const isLocal = window.location.port === '3000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const endpoint = isLocal ? `http://localhost:3001/api/user-data?username=${encodeURIComponent(username)}` : `/api/user-data?username=${encodeURIComponent(username)}`;
    
    const res = await fetch(endpoint);
    const resData = await res.json();
    if (resData.success && resData.data) {
      _state = deepMerge(createDefaultState(), resData.data);
      const todayStr = new Date().toISOString().split('T')[0];
      if (_state.today.date !== todayStr) {
        _state.today = freshDay();
        _state.today.date = todayStr;
      }
      localStorage.setItem('fitbuddy_state', JSON.stringify(_state));
      EventBus.emit('state:changed', { path: '', value: _state });
      console.log(`📡 Fetched user "${username}" from database!`);
    }
  } catch (e) {
    console.warn('Failed to load user data from DB:', e);
  }
}

// ──── State Singleton ────
let _state = createDefaultState();

export const State = {
  get data() { return _state; },
  get user() { return _state.user; },
  get today() { return _state.today; },
  get xp() { return _state.xp; },
  get settings() { return _state.settings; },
  get chatHistory() { return _state.chatHistory; },

  /** Update state at a path and persist */
  set(path, value) {
    const keys = path.split('.');
    let obj = _state;
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    this.save();
    EventBus.emit('state:changed', { path, value });
  },

  /** Deep merge patch */
  patch(path, partial) {
    const keys = path.split('.');
    let obj = _state;
    for (const k of keys) obj = obj[k];
    Object.assign(obj, partial);
    this.save();
    EventBus.emit('state:changed', { path, value: obj });
  },

  save() {
    try {
      localStorage.setItem('fitbuddy_state', JSON.stringify(_state));
      syncToDatabase();
    } catch (e) {
      console.warn('State save failed:', e);
    }
  },

  load() {
    try {
      const raw = localStorage.getItem('fitbuddy_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        _state = deepMerge(createDefaultState(), parsed);
        // Check for day rollover
        const todayStr = new Date().toISOString().split('T')[0];
        if (_state.today.date !== todayStr) {
          _state.today = freshDay();
          _state.today.date = todayStr;
          this.save();
        }
      }
    } catch (e) {
      console.warn('State load failed, using defaults:', e);
      _state = createDefaultState();
    }
  },

  reset() {
    _state = createDefaultState();
    localStorage.removeItem('fitbuddy_state');
    EventBus.emit('state:changed', { path: '', value: _state });
  },

  // ── Computed Properties ──
  get caloriesConsumed() {
    return _state.today.meals.reduce((s, m) => s + (m.calories || 0), 0);
  },
  get caloriesBurned() {
    return _state.today.exercises.reduce((s, e) => s + (e.burn || 0), 0);
  },
  get dietQuality() {
    const meals = _state.today.meals;
    if (meals.length === 0) return 100;
    const healthy = meals.filter(m => !m.isCheat).length;
    return Math.round((healthy / meals.length) * 100);
  },
  get calorieTarget() {
    return _state.user.tdee || 2000;
  },
  get isStressedOrExhausted() {
    const m = _state.today.mood;
    return m === 'stressed' || m === 'exhausted';
  }
};

// ──── Deep Merge Utility ────
function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
        && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      out[key] = deepMerge(target[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

// ──── Tab Router ────
function initTabRouter() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      panes.forEach(p => p.classList.toggle('active', p.id === `${target}-tab`));
    });
  });
}

// ──── Toast Notifications ────
let toastTimer = null;
export function showToast(text, icon = '✨', duration = 2500) {
  const toast = document.getElementById('toast');
  const toastText = document.getElementById('toast-text');
  const toastIcon = document.getElementById('toast-icon');
  toastText.textContent = text;
  toastIcon.textContent = icon;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), duration);
}

// ──── Module Initialization ────
async function boot() {
  // Load persisted state
  State.load();

  // Load from DB if username exists to ensure sync
  if (State.user.username) {
    await loadUserDataFromDB(State.user.username);
  }

  // ── Periodic Day Rollover Checker ──
  setInterval(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (State.today.date !== todayStr) {
      console.log('🌅 New day detected! Resetting daily log and games...');
      const rolledState = freshDay();
      rolledState.date = todayStr;
      State.data.today = rolledState;
      State.save();
      window.location.reload();
    }
  }, 15000);

  // Initialize tab router
  initTabRouter();

  // Dynamically import modules
  const [
    { initOnboarding },
    { initTracker },
    { initNutrition },
    { initExercise },
    { initChat },
    { initGames },
    { initGamification }
  ] = await Promise.all([
    import('./onboarding.js'),
    import('./tracker.js'),
    import('./nutrition.js'),
    import('./exercise.js'),
    import('./chat.js'),
    import('./games.js'),
    import('./gamification.js')
  ]);

  // Initialize all modules
  initOnboarding();
  initTracker();
  initNutrition();
  initExercise();
  initChat();
  initGames();
  initGamification();

  // Settings modal
  initSettings();
  initLogout();

  // Hide onboarding if already done
  if (State.data.onboarded) {
    document.getElementById('onboarding-modal').classList.remove('visible');
  }

  console.log('🏋️ FitBuddy initialized');
}

// ──── Settings Recalculation Helpers ────
const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  lightly: 1.375,
  moderately: 1.55,
  very: 1.725,
  extra: 1.9
};
const GOAL_ADJUSTMENTS = {
  loss: -500,
  maintain: 0,
  gain: 300
};

export function calculateUserMetrics({ weight, height, age, gender, goal, activity }) {
  const heightM = height / 100;
  const bmi = heightM > 0 ? parseFloat((weight / (heightM * heightM)).toFixed(1)) : 0;
  
  let bmr;
  if (gender === 'male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }
  
  const multiplier = ACTIVITY_MULTIPLIERS[activity] || 1.375;
  const baseTDEE = bmr * multiplier;
  const adjustment = GOAL_ADJUSTMENTS[goal] || 0;
  const tdee = Math.round(baseTDEE + adjustment);
  
  const protein = Math.round((tdee * 0.30) / 4);
  const carbs = Math.round((tdee * 0.40) / 4);
  const fat = Math.round((tdee * 0.30) / 9);
  
  return { bmi, tdee, macros: { protein, carbs, fat } };
}

// ──── Logout Option ────
function initLogout() {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      const confirmReset = confirm('🚪 Log Out & Reset All Data?\n\nThis will clear all your biometrics, settings, nutrition logs, exercises, and mini-game states. Are you sure?');
      if (confirmReset) {
        State.reset();
        window.location.reload();
      }
    });
  }
}

// ──── Settings Modal ────
function initSettings() {
  const btn = document.getElementById('settings-btn');
  const modal = document.getElementById('settings-modal');
  const cancel = document.getElementById('settings-cancel');
  const save = document.getElementById('settings-save');

  btn.addEventListener('click', () => {
    // Populate fields from State.user
    const user = State.user;
    document.getElementById('settings-username').value = user.username || '';
    document.getElementById('settings-weight').value = user.weight || '';
    document.getElementById('settings-height').value = user.height || '';
    document.getElementById('settings-age').value = user.age || '';
    document.getElementById('settings-gender').value = user.gender || 'male';
    document.getElementById('settings-goal').value = user.goal || 'maintain';
    document.getElementById('settings-activity').value = user.activity || 'lightly';
    document.getElementById('settings-bodyfat').value = user.bodyFat || '';
    document.getElementById('settings-neck').value = user.neck || '';
    document.getElementById('settings-waist').value = user.waist || '';
    document.getElementById('settings-hip').value = user.hip || '';
    modal.classList.add('visible');
  });

  cancel.addEventListener('click', () => modal.classList.remove('visible'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  save.addEventListener('click', () => {
    const weight = parseFloat(document.getElementById('settings-weight').value) || 0;
    const height = parseFloat(document.getElementById('settings-height').value) || 0;
    const age = parseInt(document.getElementById('settings-age').value, 10) || 0;
    const gender = document.getElementById('settings-gender').value;
    const goal = document.getElementById('settings-goal').value;
    const activity = document.getElementById('settings-activity').value;
    const bodyFat = parseFloat(document.getElementById('settings-bodyfat').value) || 0;
    const neck = parseFloat(document.getElementById('settings-neck').value) || 0;
    const waist = parseFloat(document.getElementById('settings-waist').value) || 0;
    const hip = parseFloat(document.getElementById('settings-hip').value) || 0;

    // Recalculate BMI, TDEE, Macros
    const metrics = calculateUserMetrics({ weight, height, age, gender, goal, activity });

    State.patch('user', {
      weight,
      height,
      age,
      gender,
      goal,
      activity,
      bodyFat,
      neck,
      waist,
      hip,
      ...metrics
    });

    modal.classList.remove('visible');
    showToast('Profile & Biometrics saved!', '👤');
  });
}

// ──── Boot ────
document.addEventListener('DOMContentLoaded', boot);
