/* ============================================
   FitBuddy — Gamification: XP, Levels & Challenges
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── Level Configuration ────
const LEVEL_TITLES = {
  1: 'Beginner', 2: 'Rookie', 3: 'Warrior', 4: 'Athlete',
  5: 'Champion', 6: 'Hero', 7: 'Legend', 8: 'Mythic'
};
const LEVEL_ICONS = {
  1: '🌱', 2: '🌿', 3: '⚔️', 4: '🏅',
  5: '🏆', 6: '🦸', 7: '👑', 8: '🔱'
};
const DEFAULT_TITLE = 'Transcendent';
const DEFAULT_ICON  = '💫';

// ──── Level Math ────

/** Calculate level from total XP: level = floor(sqrt(xp / 100)) + 1 */
function calcLevel(totalXP) {
  return Math.floor(Math.sqrt(totalXP / 100)) + 1;
}

/** XP needed to reach a given level: level² × 100 */
function xpForLevel(level) {
  return level * level * 100;
}

/** Get the title string for a level */
function titleForLevel(level) {
  return LEVEL_TITLES[level] || DEFAULT_TITLE;
}

/** Get the icon emoji for a level */
function iconForLevel(level) {
  return LEVEL_ICONS[level] || DEFAULT_ICON;
}

// ──── UI Update Helpers ────

/** Refresh the XP bar, level badge, icon and title */
function updateLevelUI() {
  const xp       = State.xp;
  const level    = xp.level;
  const total    = xp.total;

  // XP boundaries for progress bar within current level
  const xpFloor  = xpForLevel(level - 1); // XP at which this level was reached
  const xpCeil   = xpForLevel(level);     // XP needed for NEXT level
  const progress = xpCeil > xpFloor
    ? ((total - xpFloor) / (xpCeil - xpFloor)) * 100
    : 100;

  // Badge & text
  const iconEl  = document.getElementById('level-icon');
  const titleEl = document.getElementById('level-title');
  const fillEl  = document.getElementById('xp-fill');
  const textEl  = document.getElementById('xp-text');

  if (iconEl)  iconEl.textContent  = iconForLevel(level);
  if (titleEl) titleEl.textContent = titleForLevel(level);
  if (fillEl)  fillEl.style.width  = `${Math.min(progress, 100)}%`;
  if (textEl)  textEl.textContent  = `${total} / ${xpCeil} XP`;
}

/** Render challenge cards into #challenges-list */
function renderChallenges() {
  const container = document.getElementById('challenges-list');
  if (!container) return;

  const challenges = State.today.challenges || [];

  if (challenges.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏅</div><p>No challenges today.</p></div>';
    return;
  }

  container.innerHTML = challenges.map(ch => `
    <div class="challenge-card${ch.completed ? ' completed' : ''}" data-id="${ch.id}">
      <span class="challenge-check">${ch.completed ? '✓' : ''}</span>
      <span class="challenge-text">${ch.text}</span>
      <span class="challenge-xp">+${ch.xp} XP</span>
    </div>
  `).join('');
}

// ──── Core XP Logic ────

/**
 * Handle an 'xp:gained' event.
 * @param {{ amount: number, reason?: string }} data
 */
function handleXPGain({ amount, reason }) {
  if (!amount || amount <= 0) return;

  const oldLevel = State.xp.level;
  const newTotal = State.xp.total + amount;
  const newLevel = calcLevel(newTotal);
  const newTitle = titleForLevel(newLevel);

  // Persist XP state
  State.set('xp.total', newTotal);
  State.set('xp.level', newLevel);
  State.set('xp.title', newTitle);

  // Track daily XP earned
  State.set('today.xpEarned', (State.today.xpEarned || 0) + amount);

  // Update UI
  updateLevelUI();

  // Level-up celebration
  if (newLevel > oldLevel) {
    showToast(`Level Up! You are now a ${newTitle}!`, '🎉', 3500);
    EventBus.emit('level:up', { level: newLevel, title: newTitle });

    // Animate the level badge
    const badge = document.getElementById('level-badge');
    if (badge) {
      badge.classList.add('level-up');
      setTimeout(() => badge.classList.remove('level-up'), 1200);
    }
  }
}

// ──── Challenge Completion ────

/**
 * Toggle a challenge's completed state by its ID.
 * Awards XP when completing, removes XP when uncompleting.
 */
function toggleChallenge(id) {
  const challenges = State.today.challenges || [];
  const index = challenges.findIndex(c => c.id === id);
  if (index === -1) return;

  const challenge = challenges[index];
  challenge.completed = !challenge.completed;

  if (challenge.completed) {
    EventBus.emit('xp:gained', { amount: challenge.xp, reason: `Challenge: ${challenge.text}` });
    showToast(`Challenge completed! +${challenge.xp} XP`, '🏅');
    EventBus.emit('challenge:completed', { id });

    // If it's a temporary challenge (custom or AI-generated, not default c1/c2/c3)
    if (!id.toString().startsWith('c')) {
      challenges.splice(index, 1);
    }
  }
  State.save();
  renderChallenges();
}

/**
 * Auto-complete a challenge matching a keyword (partial text match)
 * if it hasn't already been completed.
 */
function autoCompleteChallenge(keyword) {
  const challenges = State.today.challenges || [];
  const index = challenges.findIndex(
    c => !c.completed && c.text.toLowerCase().includes(keyword.toLowerCase())
  );
  if (index !== -1) {
    const match = challenges[index];
    match.completed = true;
    EventBus.emit('xp:gained', { amount: match.xp, reason: `Auto-challenge: ${match.text}` });
    showToast(`Challenge completed! +${match.xp} XP`, '🏅');
    EventBus.emit('challenge:completed', { id: match.id });

    // Remove if temporary
    if (!match.id.toString().startsWith('c')) {
      challenges.splice(index, 1);
    }
    State.save();
    renderChallenges();
  }
}

// ──── Auto-Check Listeners ────

/** Water challenge: complete when user reaches 8 glasses */
function onWaterChanged({ count }) {
  if (count >= 8) {
    autoCompleteChallenge('water');
  }
}

/** Meal challenge: complete when 2+ meals are logged today */
function onMealAdded() {
  if (State.today.meals.length >= 2) {
    autoCompleteChallenge('meal');
  }
}

/** Exercise challenge: complete when an exercise with 10+ min is logged */
function onExerciseAdded({ exercise }) {
  if (exercise && exercise.time >= 10) {
    autoCompleteChallenge('exercise');
  }
  // Also check total exercise time across the day
  const totalMinutes = State.today.exercises.reduce((s, e) => s + (e.time || 0), 0);
  if (totalMinutes >= 10) {
    autoCompleteChallenge('exercise');
  }
}

/** Handle AI-generated challenge additions */
function onChallengeAdded({ challenge }) {
  const newChallenge = {
    id: 'ai_' + Date.now(),
    text: challenge?.text || challenge || 'Mystery challenge',
    xp: challenge?.xp || 15,
    completed: false
  };

  const challenges = State.today.challenges || [];
  challenges.push(newChallenge);
  State.set('today.challenges', challenges);
  renderChallenges();
  showToast(`New challenge: ${newChallenge.text}`, '🎯');
}

// ──── Click Delegation for Challenge Cards ────

function initChallengeClicks() {
  const container = document.getElementById('challenges-list');
  if (!container) return;

  container.addEventListener('click', (e) => {
    const card = e.target.closest('.challenge-card');
    if (!card) return;
    const id = card.dataset.id;
    if (id) toggleChallenge(id);
  });
}

// ──── Module Init ────

export function initGamification() {
  // Restore UI from persisted state
  updateLevelUI();
  renderChallenges();

  // ── Custom Challenge Addition ──
  const addBtn = document.getElementById('add-custom-challenge-btn');
  const input = document.getElementById('custom-challenge-text');
  if (addBtn && input) {
    addBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      
      const newChallenge = {
        id: 'cust_' + Date.now(),
        text,
        xp: 15,
        completed: false
      };
      
      const challenges = State.today.challenges || [];
      challenges.push(newChallenge);
      State.set('today.challenges', challenges);
      renderChallenges();
      
      input.value = '';
      showToast(`Custom challenge "${text}" added!`, '🎯');
    });
  }

  // Set up click handlers for challenges
  initChallengeClicks();

  // Subscribe to XP events
  EventBus.on('xp:gained', handleXPGain);

  // Subscribe to auto-check triggers
  EventBus.on('water:changed', onWaterChanged);
  EventBus.on('meal:added', onMealAdded);
  EventBus.on('exercise:added', onExerciseAdded);

  // Subscribe to AI-generated challenge additions
  EventBus.on('challenge:added', onChallengeAdded);

  console.log('🏅 Gamification module initialized');
}
