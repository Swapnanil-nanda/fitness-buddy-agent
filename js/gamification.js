

import { State, EventBus, showToast } from './app.js';


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



/** Refresh the XP bar, level badge, icon and title */
function updateLevelUI() {
  const xp       = State.xp;
  const level    = xp.level;
  const total    = xp.total;

  
  const xpFloor  = xpForLevel(level - 1); 
  const xpCeil   = xpForLevel(level);     
  const progress = xpCeil > xpFloor
    ? ((total - xpFloor) / (xpCeil - xpFloor)) * 100
    : 100;

  
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
    container.innerHTML = `<div class="empty-state">No tasks yet!<br><button class="btn btn-secondary btn-add-task-empty" style="margin-top:10px;font-size:12px;padding:6px 10px;">+ Add Task</button></div>`;
    return;
  }

  container.innerHTML = challenges.map(ch => `
    <div class="challenge-card${ch.completed ? ' completed' : ''}" data-id="${ch.id}" style="position: relative; overflow: visible;">
      <span class="challenge-check">${ch.completed ? '✓' : ''}</span>
      <span class="challenge-text" style="flex: 1; padding: 0 8px;">${ch.text}</span>
      <span class="challenge-xp" style="margin-right: 8px;">+${ch.xp} XP</span>
      <div class="challenge-actions" style="position: relative;">
        <button class="task-kebab-btn">⋮</button>
        <div class="task-dropdown">
          <button class="task-dropdown-item btn-add-task">➕ Add Below</button>
          <button class="task-dropdown-item btn-edit-task">✏️ Edit</button>
          <button class="task-dropdown-item btn-delete-task">🗑️ Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}




function handleXPGain({ amount, reason }) {
  if (!amount || amount <= 0) return;

  const oldLevel = State.xp.level;
  const newTotal = State.xp.total + amount;
  const newLevel = calcLevel(newTotal);
  const newTitle = titleForLevel(newLevel);

  
  State.set('xp.total', newTotal);
  State.set('xp.level', newLevel);
  State.set('xp.title', newTitle);

  
  State.set('today.xpEarned', (State.today.xpEarned || 0) + amount);

  
  updateLevelUI();

  
  if (newLevel > oldLevel) {
    showToast(`Level Up! You are now a ${newTitle}!`, '🎉', 3500);
    EventBus.emit('level:up', { level: newLevel, title: newTitle });

    
    const badge = document.getElementById('level-badge');
    if (badge) {
      badge.classList.add('level-up');
      setTimeout(() => badge.classList.remove('level-up'), 1200);
    }
  }
}




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

    
    if (!id.toString().startsWith('c')) {
      challenges.splice(index, 1);
    }
  }
  State.save();
  renderChallenges();
}


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

    
    if (!match.id.toString().startsWith('c')) {
      challenges.splice(index, 1);
    }
    State.save();
    renderChallenges();
  }
}



/** Water challenge: complete when user reaches 8 glasses */
function onWaterChanged({ count }) {
  const target = State.settings?.waterTarget || 8;
  if (count >= target) {
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
  const challenges = State.today.challenges || [];
  const hasUncompleted = challenges.some(
    c => !c.completed && c.text.toLowerCase().includes('exercise')
  );
  if (!hasUncompleted) return;

  if (exercise && exercise.time >= 10) {
    autoCompleteChallenge('exercise');
    return;
  }
  
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
  showToast(`New task: ${newChallenge.text}`, '🎯');
}

let editingTaskId = null;
let insertAfterTaskId = null;

export function openTaskModal(taskId = null, insertAfterId = null) {
  const modal = document.getElementById('task-modal');
  const title = document.getElementById('task-modal-title');
  const submitBtn = document.getElementById('task-submit');
  const nameInput = document.getElementById('task-name');
  const xpInput = document.getElementById('task-xp');

  editingTaskId = taskId;
  insertAfterTaskId = insertAfterId;

  if (editingTaskId) {
    const challenges = State.today.challenges || [];
    const challenge = challenges.find(c => c.id === editingTaskId);
    if (challenge) {
      nameInput.value = challenge.text;
      xpInput.value = challenge.xp || 15;
      title.textContent = 'Edit Task';
      submitBtn.textContent = 'Update Task';
    }
  } else {
    nameInput.value = '';
    xpInput.value = 15;
    title.textContent = 'Add Task';
    submitBtn.textContent = 'Save Task';
  }

  modal.classList.add('visible');
  nameInput.focus();
}

function deleteChallenge(id) {
  const challenges = State.today.challenges || [];
  const index = challenges.findIndex(c => c.id === id);
  if (index === -1) return;
  
  const challenge = challenges[index];
  const confirmDelete = confirm(`🗑️ Delete task "${challenge.text}"?`);
  if (!confirmDelete) return;
  
  challenges.splice(index, 1);
  State.save();
  renderChallenges();
  showToast('Task deleted.', '🗑️');
}



function initChallengeClicks() {
  const container = document.getElementById('challenges-list');
  if (!container) return;

  
  document.addEventListener('click', () => {
    document.querySelectorAll('.task-dropdown.visible').forEach(d => d.classList.remove('visible'));
  });

  container.addEventListener('click', (e) => {
    const kebabBtn = e.target.closest('.task-kebab-btn');
    if (kebabBtn) {
      e.stopPropagation();
      
      document.querySelectorAll('.task-dropdown.visible').forEach(d => {
        if (d !== kebabBtn.nextElementSibling) d.classList.remove('visible');
      });
      kebabBtn.nextElementSibling.classList.toggle('visible');
      return;
    }

    if (e.target.closest('.btn-add-task-empty')) {
      e.stopPropagation();
      openTaskModal(null, null);
      return;
    }

    const card = e.target.closest('.challenge-card');
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;

    if (e.target.closest('.btn-edit-task')) {
      e.stopPropagation();
      document.querySelectorAll('.task-dropdown.visible').forEach(d => d.classList.remove('visible'));
      openTaskModal(id);
      return;
    }

    if (e.target.closest('.btn-delete-task')) {
      e.stopPropagation();
      document.querySelectorAll('.task-dropdown.visible').forEach(d => d.classList.remove('visible'));
      deleteChallenge(id);
      return;
    }
    
    if (e.target.closest('.btn-add-task')) {
      e.stopPropagation();
      document.querySelectorAll('.task-dropdown.visible').forEach(d => d.classList.remove('visible'));
      openTaskModal(null, id);
      return;
    }

    if (id) toggleChallenge(id);
  });
}



export function initGamification() {
  
  updateLevelUI();
  renderChallenges();

  
  const emptyStateAddBtn = document.getElementById('add-custom-challenge-btn');
  if (emptyStateAddBtn) emptyStateAddBtn.remove(); 

  
  const modal = document.getElementById('task-modal');
  const cancelBtn = document.getElementById('task-cancel');
  const submitBtn = document.getElementById('task-submit');
  const nameInput = document.getElementById('task-name');
  const xpInput = document.getElementById('task-xp');

  if (cancelBtn && modal) {
    cancelBtn.addEventListener('click', () => modal.classList.remove('visible'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('visible');
    });
  }

  const saveTask = () => {
    const text = nameInput.value.trim();
    const xp = parseInt(xpInput.value, 10) || 15;

    if (!text) {
      showToast('Please enter a task name.', '⚠️');
      return;
    }

    const challenges = State.today.challenges || [];

    if (editingTaskId) {
      
      const challenge = challenges.find(c => c.id === editingTaskId);
      if (challenge) {
        challenge.text = text;
        challenge.xp = xp;
        showToast('Task updated!', '📝');
      }
    } else {
      
      const newChallenge = {
        id: 'cust_' + Date.now(),
        text,
        xp,
        completed: false
      };

      if (insertAfterTaskId) {
        
        const idx = challenges.findIndex(c => c.id === insertAfterTaskId);
        if (idx !== -1) {
          challenges.splice(idx + 1, 0, newChallenge);
        } else {
          challenges.push(newChallenge);
        }
      } else {
        challenges.push(newChallenge);
      }
      showToast('Task added!', '🎯');
    }

    State.set('today.challenges', challenges);
    renderChallenges();
    modal.classList.remove('visible');
  };

  if (submitBtn) {
    submitBtn.addEventListener('click', saveTask);
  }

  if (nameInput) {
    nameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') saveTask();
    });
  }

  if (xpInput) {
    xpInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') saveTask();
    });
  }

  
  initChallengeClicks();

  
  EventBus.on('xp:gained', handleXPGain);

  
  EventBus.on('water:changed', onWaterChanged);
  EventBus.on('meal:added', onMealAdded);
  EventBus.on('exercise:added', onExerciseAdded);

  
  EventBus.on('challenge:added', onChallengeAdded);

  console.log('🏅 Gamification module initialized');
}
