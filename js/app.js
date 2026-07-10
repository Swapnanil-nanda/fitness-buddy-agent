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

export function getApiBaseUrl() {
  const staticPort = Number(window.location.port);
  if (!staticPort) return '';

  const apiPort = staticPort === 3000 ? 3001 : staticPort + 1;
  return `${window.location.protocol}//${window.location.hostname}:${apiPort}`;
}

// ── Session DB token — fetched once from /api/db-token at boot (local only).
// Attached as X-DB-Token header on every /api/user-data request.
let _dbToken = null;

async function fetchDbToken() {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/db-token`);
    if (res.ok) {
      const data = await res.json();
      _dbToken = data.token || null;
    }
  } catch (e) {
    // Running on Vercel or token endpoint unavailable — no token needed
    _dbToken = null;
  }
}

export function dbHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_dbToken) h['X-DB-Token'] = _dbToken;
  return h;
}

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
      activity: 'lightly', // 'sedentary' | 'lightly' | 'moderately' | 'very' | 'extra'
      cuisine: 'any',      // preferred cuisine
      diet: 'no-restriction' // diet type / restriction
    },
    onboarded: false,
    today: freshDay(),
    xp: { total: 0, level: 1, title: 'Beginner' },
    settings: {
      mode: 'proxy', // 'proxy' | 'local' | 'direct'
      waterTarget: 8,
      customCheatFoods: [],
      customHealthyFoods: []
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
    challenges: []
  };
}

async function syncToDatabase() {
  const username = _state.user.username;
  if (!username) return;
  try {
    const endpoint = `${getApiBaseUrl()}/api/user-data`;
    const password = localStorage.getItem('fitbuddy_password') || '';
    
    await fetch(endpoint, {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({ username, password, state: _state })
    });
  } catch (e) {
    console.warn('Database sync failed:', e);
  }
}

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

const debouncedSyncToDatabase = debounce(syncToDatabase, 1000);

export async function loadUserDataFromDB(username, password) {
  try {
    const activePassword = password || localStorage.getItem('fitbuddy_password') || '';
    const endpoint = `${getApiBaseUrl()}/api/user-data?username=${encodeURIComponent(username)}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5 second timeout fail-safe
    
    const headers = {
      ...dbHeaders(),
      'X-User-Password': activePassword
    };
    
    const res = await fetch(endpoint, { signal: controller.signal, headers });
    clearTimeout(timeoutId);
    const resData = await res.json();
    
    if (!res.ok) {
      throw new Error(resData.error || 'Failed to authenticate');
    }
    
    if (resData.success) {
      if (activePassword) {
        localStorage.setItem('fitbuddy_password', activePassword);
      }
      if (resData.data) {
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
    }
  } catch (e) {
    console.warn('Failed to load user data from DB:', e.message);
    throw e;
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
      debouncedSyncToDatabase();
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
        } else {
          // Remove old default challenges (c1, c2, c3) so only AI/custom tasks remain
          if (_state.today.challenges) {
            _state.today.challenges = _state.today.challenges.filter(c => !['c1', 'c2', 'c3'].includes(c.id));
          }
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
    localStorage.removeItem('fitbuddy_password');
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
    return m === 'stressed' || m === 'exhausted' || m === 'sad';
  }
};

export function reloadState(newState, password) {
  _state = newState;
  localStorage.setItem('fitbuddy_state', JSON.stringify(_state));
  if (password) {
    localStorage.setItem('fitbuddy_password', password);
  }
  EventBus.emit('state:changed', { path: '', value: _state });
}

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

function initLabEntry() {
  const labPage = document.getElementById('init-lab-page');
  const enterLabBtn = document.getElementById('enter-lab-btn');
  if (!labPage || !enterLabBtn || enterLabBtn.dataset.bound === 'true') return;

  enterLabBtn.dataset.bound = 'true';
  enterLabBtn.addEventListener('click', () => {
    if (!State.data.onboarded) {
      const onboardingModal = document.getElementById('onboarding-modal');
      if (onboardingModal) {
        onboardingModal.classList.add('visible');
      }
    } else {
      labPage.classList.remove('visible');
      window.setTimeout(() => {
        labPage.style.display = 'none';
      }, 600);
    }
  });
}

// ──── Module Initialization ────
async function boot() {
  // Keep the front door responsive even if a feature module fails later.
  initLabEntry();

  // Fetch session DB token from server (local dev only — no-op on Vercel)
  await fetchDbToken();

  // Load persisted state
  State.load();

  // Hide onboarding and landing page synchronously if already logged in
  if (State.data.onboarded) {
    const onboardingModal = document.getElementById('onboarding-modal');
    if (onboardingModal) onboardingModal.classList.remove('visible');
    
    const labPage = document.getElementById('init-lab-page');
    if (labPage) {
      labPage.classList.remove('visible');
      labPage.style.display = 'none';
    }
  }

  // Load from DB if username exists to ensure sync
  if (State.user.username) {
    try {
      await loadUserDataFromDB(State.user.username);
    } catch (err) {
      console.warn('DB loading failed on startup:', err.message);
      if (err.message.toLowerCase().includes('password') || err.message.toLowerCase().includes('authenticate')) {
        State.reset();
        window.location.reload();
      }
    }
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

  const moduleLoaders = [
    ['onboarding', () => import('./onboarding.js')],
    ['tracker', () => import('./tracker.js')],
    ['nutrition', () => import('./nutrition.js')],
    ['exercise', () => import('./exercise.js')],
    ['chat', () => import('./chat.js')],
    ['games', () => import('./games.js')],
    ['gamification', () => import('./gamification.js')]
  ];
  const modules = [];
  try {
    for (const [name, load] of moduleLoaders) {
      try {
        modules.push(await load());
      } catch (err) {
        err.message = `${name}: ${err.message}`;
        throw err;
      }
    }
  } catch (err) {
    console.error('FitBuddy module startup failed:', err);
    console.error('FitBuddy module startup stack:', err?.stack || err?.message || err);
    showToast('Some app modules failed to load. Check the console.', '!', 5000);
    return;
  }

  const [
    { initOnboarding },
    { initTracker },
    { initNutrition },
    { initExercise },
    { initChat },
    { initGames },
    { initGamification }
  ] = modules;

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
  initMobileNav();
  initMobilePanelMenu();

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
    const pwdInput = document.getElementById('settings-password');
    if (pwdInput) pwdInput.value = '';
    document.getElementById('settings-weight').value = user.weight || '';
    document.getElementById('settings-height').value = user.height || '';
    document.getElementById('settings-age').value = user.age || '';
    document.getElementById('settings-gender').value = user.gender || 'male';
    document.getElementById('settings-goal').value = user.goal || 'maintain';
    document.getElementById('settings-activity').value = user.activity || 'lightly';
    document.getElementById('settings-cuisine').value = user.cuisine || 'any';
    document.getElementById('settings-diet').value = user.diet || 'no-restriction';
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

  save.addEventListener('click', async () => {
    const username = document.getElementById('settings-username').value.trim();
    if (!username) {
      showToast('Username is required!', '⚠️');
      return;
    }
    const weight = parseFloat(document.getElementById('settings-weight').value) || 0;
    const height = parseFloat(document.getElementById('settings-height').value) || 0;
    const age = parseInt(document.getElementById('settings-age').value, 10) || 0;
    const gender = document.getElementById('settings-gender').value;
    const goal = document.getElementById('settings-goal').value;
    const activity = document.getElementById('settings-activity').value;
    const cuisine = document.getElementById('settings-cuisine').value;
    const diet = document.getElementById('settings-diet').value;
    const bodyFat = parseFloat(document.getElementById('settings-bodyfat').value) || 0;
    const neck = parseFloat(document.getElementById('settings-neck').value) || 0;
    const waist = parseFloat(document.getElementById('settings-waist').value) || 0;
    const hip = parseFloat(document.getElementById('settings-hip').value) || 0;

    const pwdInput = document.getElementById('settings-password');
    const newPassword = pwdInput ? pwdInput.value.trim() : '';
    if (newPassword && newPassword.length < 4) {
      showToast('New password must be at least 4 characters!', '⚠️');
      return;
    }

    const currentPassword = localStorage.getItem('fitbuddy_password') || '';

    // Recalculate BMI, TDEE, Macros
    const metrics = calculateUserMetrics({ weight, height, age, gender, goal, activity });

    // Create a clone of the current state and apply the patches
    const proposedState = JSON.parse(JSON.stringify(_state));
    Object.assign(proposedState.user, {
      username,
      weight,
      height,
      age,
      gender,
      goal,
      activity,
      cuisine,
      diet,
      bodyFat,
      neck,
      waist,
      hip,
      ...metrics
    });

    save.disabled = true;
    save.textContent = 'Saving...';

    try {
      const endpoint = `${getApiBaseUrl()}/api/user-data`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: dbHeaders(),
        body: JSON.stringify({
          username: proposedState.user.username,
          password: currentPassword,
          newPassword: newPassword || undefined,
          state: proposedState
        })
      });

      const resData = await response.json();
      save.disabled = false;
      save.textContent = 'Save Settings';

      if (!response.ok) {
        showToast(resData.error || 'Failed to update settings!', '🔒');
        return;
      }

      // Success! Update password in local storage if changed
      if (newPassword) {
        localStorage.setItem('fitbuddy_password', newPassword);
      }

      const finalState = resData.state || proposedState;
      _state = finalState;
      localStorage.setItem('fitbuddy_state', JSON.stringify(_state));
      EventBus.emit('state:changed', { path: '', value: _state });

      modal.classList.remove('visible');
      showToast('Profile & Biometrics saved!', '👤');

    } catch (e) {
      console.error('Update settings failed:', e);
      showToast('Could not connect to server. Please try again.', '⚠️');
      save.disabled = false;
      save.textContent = 'Save Settings';
    }
  });
}

// ──── Mobile Navigation Controller ────
function initMobileNav() {
  const navButtons = document.querySelectorAll('.mobile-nav-btn');
  const panels = {
    left: document.getElementById('left-panel'),
    center: document.getElementById('center-panel'),
    right: document.getElementById('right-panel')
  };

  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      
      // Toggle active button
      navButtons.forEach(b => b.classList.toggle('active', b === btn));
      
      // Toggle active panels
      Object.entries(panels).forEach(([key, panel]) => {
        if (panel) {
          panel.classList.toggle('active', key === target);
        }
      });
    });
  });

  // Set default active panel for mobile on load
  if (window.innerWidth <= 1100) {
    const activeBtn = document.querySelector('.mobile-nav-btn.active') || navButtons[0];
    if (activeBtn) {
      const target = activeBtn.dataset.target;
      navButtons.forEach(b => b.classList.toggle('active', b === activeBtn));
      Object.entries(panels).forEach(([key, panel]) => {
        if (panel) {
          panel.classList.toggle('active', key === target);
        }
      });
    }
  }
}

function initMobilePanelMenu() {
  const menuBtn = document.getElementById('mobile-panel-menu-btn');
  const menuContent = document.getElementById('mobile-panel-menu-content');
  if (!menuBtn || !menuContent) return;

  // Toggle dropdown on click
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menuContent.classList.toggle('show');
  });

  // Close dropdown on clicking outside
  document.addEventListener('click', () => {
    menuContent.classList.remove('show');
  });

  // Handle dropdown link clicks
  const links = menuContent.querySelectorAll('a');
  const panels = {
    left: document.getElementById('left-panel'),
    center: document.getElementById('center-panel'),
    right: document.getElementById('right-panel')
  };
  const navButtons = document.querySelectorAll('.mobile-nav-btn');

  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.dataset.target;

      menuContent.classList.remove('show');

      // Update mobile bottom nav active button
      navButtons.forEach(b => b.classList.toggle('active', b.dataset.target === target));

      // Toggle active panels
      Object.entries(panels).forEach(([key, panel]) => {
        if (panel) {
          panel.classList.toggle('active', key === target);
        }
      });
      
      showToast(`Switched to ${link.textContent.split(' ')[1]}`, '🔄');
    });
  });
}

// ──── Boot ────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
