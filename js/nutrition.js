/* ============================================
   FitBuddy — Nutrition / Meal Logging Module
   ============================================ */

import { State, EventBus, showToast } from './app.js';

// ──── Cheat-Food Dictionary ────
// Any case-insensitive substring match against meal name OR ingredients → cheat
const CHEAT_FOODS = [
  'pizza', 'burger', 'fries', 'french fries', 'soda', 'cola', 'pepsi',
  'coke', 'candy', 'chocolate', 'cake', 'donut', 'doughnut', 'ice cream',
  'cookie', 'cookies', 'chips', 'nachos', 'hot dog', 'hotdog',
  'fried chicken', 'bacon', 'milkshake', 'brownie', 'pastry', 'waffle',
  'pancake', 'syrup', 'corndog', 'mozzarella sticks', 'onion rings',
  'taco bell', 'mcdonalds', 'kfc', 'wendys', 'popeyes', 'cupcake',
  'pop tart', 'cheetos', 'doritos', 'ramen noodles', 'instant noodles',
  'sausage roll', 'energy drink', 'redbull', 'monster'
];

/**
 * Detect whether a meal qualifies as "cheat food".
 * Checks both name and ingredients against the dictionary (case-insensitive).
 * @param {string} name  – Meal name
 * @param {string} ingredients – Comma-separated ingredients string
 * @returns {boolean}
 */
function detectCheat(name, ingredients) {
  const combined = `${name} ${ingredients}`.toLowerCase();
  return CHEAT_FOODS.some(term => combined.includes(term));
}

// ──── DOM Rendering ────

/**
 * Render a single meal item into the meals list.
 * @param {Object} meal
 */
function renderMealItem(meal) {
  const div = document.createElement('div');
  div.className = 'log-item';
  const typeClass = meal.isCheat ? 'cheat' : 'healthy';

  div.innerHTML = `
    <div class="log-icon ${typeClass}">${meal.isCheat ? '🍔' : '🥗'}</div>
    <div class="log-details">
      <div class="name">${meal.name}</div>
      <div class="meta">${meal.time}</div>
    </div>
    <span class="tag ${typeClass}">${meal.isCheat ? 'Cheat' : 'Healthy'}</span>
    <div class="log-value">${meal.calories} kcal</div>
  `;

  return div;
}

/**
 * Rebuild the full meals list + summary cards from State.
 */
function renderAllMeals() {
  const list = document.getElementById('meals-list');
  const empty = document.getElementById('meals-empty');
  const meals = State.today.meals;

  // Clear everything except the empty-state placeholder
  list.querySelectorAll('.log-item').forEach(el => el.remove());

  if (meals.length > 0) {
    empty.style.display = 'none';
    meals.forEach(meal => list.appendChild(renderMealItem(meal)));
  } else {
    empty.style.display = '';
  }

  updateNutritionSummary(meals);
}

/**
 * Update the four nutrition summary cards.
 * Macro estimation per meal:
 *   protein = calories × 0.3 / 4 g
 *   carbs   = calories × 0.4 / 4 g
 *   fat     = calories × 0.3 / 9 g
 */
function updateNutritionSummary(meals) {
  let totalCal = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;

  meals.forEach(m => {
    const cal = m.calories || 0;
    totalCal += cal;
    totalProtein += (cal * 0.3) / 4;
    totalCarbs   += (cal * 0.4) / 4;
    totalFat     += (cal * 0.3) / 9;
  });

  document.getElementById('nut-calories').textContent = totalCal;
  document.getElementById('nut-protein').textContent  = `${Math.round(totalProtein)}g`;
  document.getElementById('nut-carbs').textContent    = `${Math.round(totalCarbs)}g`;
  document.getElementById('nut-fat').textContent      = `${Math.round(totalFat)}g`;
}

// ──── Module Init ────

/**
 * Initialize the Nutrition module.
 * Sets up modal interactions, meal logging, cheat detection, and XP rewards.
 */
export function initNutrition() {
  // DOM references
  const modal      = document.getElementById('meal-modal');
  const addBtn     = document.getElementById('add-meal-btn');
  const cancelBtn  = document.getElementById('meal-cancel');
  const submitBtn  = document.getElementById('meal-submit');
  const nameInput  = document.getElementById('meal-name');
  const calInput   = document.getElementById('meal-calories');
  const ingInput   = document.getElementById('meal-ingredients');

  // ── Open modal ──
  addBtn.addEventListener('click', () => {
    modal.classList.add('visible');
  });

  // ── Close modal ──
  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('visible');
  });

  // ── Close on backdrop click ──
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('visible');
  });

  // ── Submit meal ──
  submitBtn.addEventListener('click', () => {
    const name     = nameInput.value.trim();
    const calories = parseInt(calInput.value, 10);
    const ingredients = ingInput.value.trim();

    // Basic validation
    if (!name || isNaN(calories) || calories <= 0) {
      showToast('Please enter a meal name and valid calories.', '⚠️');
      return;
    }

    // Cheat detection
    const isCheat = detectCheat(name, ingredients);

    // Build meal object
    const meal = {
      id: Date.now(),
      name,
      calories,
      ingredients,
      isCheat,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    // Persist to state
    State.today.meals.push(meal);
    State.save();

    // Notify the system
    EventBus.emit('meal:added', { meal });
    EventBus.emit('xp:gained', { amount: 15, reason: 'Logged a meal' });

    // User feedback
    if (isCheat) {
      showToast(`${name} logged — cheat meal detected! 🍔`, '🍔');
    } else {
      showToast(`${name} logged — nice healthy choice! 🥗`, '🥗');
    }

    // Re-render
    renderAllMeals();

    // Clear inputs and close modal
    nameInput.value = '';
    calInput.value  = '';
    ingInput.value  = '';
    modal.classList.remove('visible');
  });

  // ── Restore persisted meals on load ──
  renderAllMeals();

  console.log('🍎 Nutrition module initialized');
}
