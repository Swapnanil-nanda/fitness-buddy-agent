

import { State, EventBus, showToast } from './app.js';


const RING_KCAL_CIRC   = 565.49;
const RING_ACTIVE_CIRC = 471.24;
const RING_DIET_CIRC   = 376.99;


const ACTIVE_BURN_TARGET = 300;


const TOTAL_GLASSES = 8;


export function initTracker() {
  
  const ringKcal    = document.getElementById('ring-kcal');
  const ringActive  = document.getElementById('ring-active');
  const ringDiet    = document.getElementById('ring-diet');
  const kcalDisplay = document.getElementById('kcal-display');

  

  
  function refreshRings() {
    const consumed = State.caloriesConsumed;
    const target   = State.calorieTarget;
    const burned   = State.caloriesBurned;
    const diet     = State.dietQuality;

    
    const kcalRatio = Math.min(consumed / (target || 1), 1);
    ringKcal.style.strokeDashoffset = RING_KCAL_CIRC * (1 - kcalRatio);

    
    const activeRatio = Math.min(burned / ACTIVE_BURN_TARGET, 1);
    ringActive.style.strokeDashoffset = RING_ACTIVE_CIRC * (1 - activeRatio);

    
    const dietRatio = Math.min(diet / 100, 1);
    ringDiet.style.strokeDashoffset = RING_DIET_CIRC * (1 - dietRatio);

    
    kcalDisplay.textContent = consumed;
  }

  
  EventBus.on('state:changed', refreshRings);
  EventBus.on('meal:added',    refreshRings);
  EventBus.on('exercise:added', refreshRings);

  
  refreshRings();

  

  const moodBtns = document.querySelectorAll('.mood-btn');

  
  function selectMood(mood) {
    moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === mood));
    State.set('today.mood', mood);
    EventBus.emit('mood:changed', { mood });

    
    if (mood === 'sad') {
      showToast('Feeling low? Try a Zen Breather or a fun mini game in the Play tab to lift your spirits! 🎮🧘', '💙', 5000);
    } else if (mood === 'stressed') {
      showToast('Stressed out? Take a deep breath. Try the Zen Breather game or just rest for a bit — you deserve it! 🌿', '🫂', 5000);
    } else if (mood === 'exhausted') {
      showToast('You look tired! Rest is important. Or try a relaxing mini game to unwind before anything else 😴🎮', '💤', 5000);
    }
  }

  moodBtns.forEach(btn => {
    btn.addEventListener('click', () => selectMood(btn.dataset.mood));
  });

  
  const savedMood = State.today.mood || 'neutral';
  moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === savedMood));

  
  EventBus.on('mood:changed', ({ mood }) => {
    moodBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.mood === mood));
  });

  

  const glassesContainer = document.getElementById('water-glasses');
  const drankInput       = document.getElementById('water-drank-input');
  const litresInput      = document.getElementById('water-litres-input');
  const targetInput      = document.getElementById('water-target-input');
  const hydrationCount   = document.getElementById('hydration-count');

  
  function playWaterSound() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      const now = audioCtx.currentTime;
      osc.type = 'sine';
      
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(850, now + 0.12);
      
      gainNode.gain.setValueAtTime(0.2, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      
      osc.start(now);
      osc.stop(now + 0.15);
    } catch (e) {
      console.warn("Web Audio failed to play:", e);
    }
  }

  
  function renderGlassesSection() {
    if (!glassesContainer || !drankInput || !litresInput || !targetInput || !hydrationCount) return;

    const current = State.today.water || 0;
    const target = State.settings.waterTarget || 8;
    
    
    drankInput.value = current;
    litresInput.value = (current * 0.25).toFixed(2); 
    targetInput.value = target;
    
    hydrationCount.innerHTML = `${current}<span> / ${target} glasses (${(current * 0.25).toFixed(2)}L)</span>`;
    
    
    glassesContainer.innerHTML = '';
    for (let i = 0; i < target; i++) {
      const glass = document.createElement('div');
      glass.className = `water-glass${i < current ? ' filled' : ''}`;
      glass.dataset.index = i;
      glass.innerHTML = '💧';
      
      
      glass.style.transition = 'all var(--t-spring)';
      
      glass.addEventListener('click', () => {
        const idx = i;
        let newCount;
        if (idx < current) {
          
          newCount = idx;
        } else {
          
          newCount = idx + 1;
        }
        updateWaterCount(newCount);
        playWaterSound();
      });
      glassesContainer.appendChild(glass);
    }
  }

  
  function updateWaterCount(newCount) {
    const current = State.today.water || 0;
    const added = newCount - current;
    if (added > 0) {
      EventBus.emit('xp:gained', { amount: 5 * added, reason: `Drank ${added} glass${added > 1 ? 'es' : ''} of water` });
    }
    State.set('today.water', newCount);
    EventBus.emit('water:changed', { count: newCount });
    renderGlassesSection();
  }

  
  if (drankInput) {
    drankInput.addEventListener('change', () => {
      let val = parseInt(drankInput.value, 10);
      if (isNaN(val) || val < 0) val = 0;
      updateWaterCount(val);
      playWaterSound();
    });
  }

  if (litresInput) {
    litresInput.addEventListener('change', () => {
      let val = parseFloat(litresInput.value);
      if (isNaN(val) || val < 0) val = 0;
      
      const glasses = Math.round(val / 0.25);
      updateWaterCount(glasses);
      playWaterSound();
    });
  }

  if (targetInput) {
    targetInput.addEventListener('change', () => {
      let val = parseInt(targetInput.value, 10);
      if (isNaN(val) || val < 1) val = 8;
      State.set('settings.waterTarget', val);
      renderGlassesSection();
    });
  }

  
  renderGlassesSection();

  

  const sleepSlider  = document.getElementById('sleep-slider');
  const sleepValue   = document.getElementById('sleep-value');
  const sleepQuality = document.getElementById('sleep-quality');

  
  function qualifySlep(hours) {
    if (hours < 5)   return { label: 'Poor',  cls: 'poor'  };
    if (hours < 6.5) return { label: 'Fair',  cls: 'fair'  };
    if (hours < 8)   return { label: 'Good',  cls: 'good'  };
    return              { label: 'Great', cls: 'great' };
  }

  function updateSleep(hours) {
    sleepValue.innerHTML = `${hours}<span> hrs</span>`;
    const q = qualifySlep(hours);
    sleepQuality.textContent = q.label;
    sleepQuality.className   = `sleep-quality ${q.cls}`;
    State.set('today.sleep', hours);
  }

  sleepSlider.addEventListener('input', () => {
    updateSleep(parseFloat(sleepSlider.value));
  });

  
  const savedSleep = State.today.sleep ?? 7;
  sleepSlider.value = savedSleep;
  
  sleepValue.innerHTML = `${savedSleep}<span> hrs</span>`;
  const sq = qualifySlep(savedSleep);
  sleepQuality.textContent = sq.label;
  sleepQuality.className   = `sleep-quality ${sq.cls}`;
}
