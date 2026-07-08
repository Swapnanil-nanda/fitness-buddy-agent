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
      weight: 0,
      height: 0,
      age: 0,
      gender: 'male',
      bmi: 0,
      goal: 'maintain', // 'loss' | 'maintain' | 'gain'
      tdee: 0,
      macros: { protein: 0, carbs: 0, fat: 0 }
    },
    onboarded: false,
    today: freshDay(),
    xp: { total: 0, level: 1, title: 'Beginner' },
    settings: {
      apiKey: '',
      projectId: '',
      region: 'us-south',
      mode: 'direct' // 'proxy' | 'local' | 'direct'
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

  // Hide onboarding if already done
  if (State.data.onboarded) {
    document.getElementById('onboarding-modal').classList.remove('visible');
  }

  console.log('🏋️ FitBuddy initialized');
}

// ──── Settings Modal ────
function initSettings() {
  const btn = document.getElementById('settings-btn');
  const modal = document.getElementById('settings-modal');
  const cancel = document.getElementById('settings-cancel');
  const save = document.getElementById('settings-save');

  const apiKeyInput = document.getElementById('settings-api-key');
  const projectIdInput = document.getElementById('settings-project-id');
  const regionSelect = document.getElementById('settings-region');
  const modeSelect = document.getElementById('settings-mode');

  btn.addEventListener('click', () => {
    // Populate fields
    apiKeyInput.value = State.settings.apiKey;
    projectIdInput.value = State.settings.projectId;
    regionSelect.value = State.settings.region;
    modeSelect.value = State.settings.mode;
    modal.classList.add('visible');
  });

  cancel.addEventListener('click', () => modal.classList.remove('visible'));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  save.addEventListener('click', () => {
    State.patch('settings', {
      apiKey: apiKeyInput.value.trim(),
      projectId: projectIdInput.value.trim(),
      region: regionSelect.value,
      mode: modeSelect.value
    });
    modal.classList.remove('visible');
    showToast('Settings saved!', '⚙️');
  });
}

// ──── Boot ────
document.addEventListener('DOMContentLoaded', boot);
