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

// ──── Ingredient Database & Calorie Estimator ────
const INGREDIENT_DB = {
  egg: { base: 75, perUnit: true },
  eggs: { base: 75, perUnit: true },
  chicken: { base: 250, perGram: 1.65 },
  rice: { base: 200, perGram: 1.3 },
  roti: { base: 80, perUnit: true },
  chapati: { base: 80, perUnit: true },
  tortilla: { base: 100, perUnit: true },
  bread: { base: 80, perUnit: true },
  oil: { base: 120, perUnit: true },
  butter: { base: 100, perUnit: true },
  ghee: { base: 120, perUnit: true },
  cheese: { base: 110, perGram: 3.5 },
  milk: { base: 120, perGram: 0.6 },
  sugar: { base: 40, perUnit: true },
  honey: { base: 60, perUnit: true },
  paneer: { base: 260, perGram: 2.6 },
  dal: { base: 120, perUnit: true },
  lentils: { base: 100, perUnit: true },
  beans: { base: 110, perUnit: true },
  fish: { base: 180, perGram: 1.5 },
  salmon: { base: 200, perGram: 1.8 },
  tuna: { base: 150, perGram: 1.3 },
  beef: { base: 250, perGram: 2.5 },
  steak: { base: 300, perGram: 2.5 },
  salad: { base: 20, perUnit: true },
  lettuce: { base: 15, perUnit: true },
  spinach: { base: 15, perUnit: true },
  cucumber: { base: 15, perUnit: true },
  tomato: { base: 20, perUnit: true },
  onion: { base: 30, perUnit: true },
  veggies: { base: 25, perUnit: true },
  vegetables: { base: 25, perUnit: true },
  apple: { base: 80, perUnit: true },
  banana: { base: 90, perUnit: true },
  orange: { base: 60, perUnit: true },
  mango: { base: 150, perUnit: true },
  potato: { base: 130, perUnit: true },
  potatoes: { base: 130, perUnit: true },
  nuts: { base: 160, perUnit: true },
  almonds: { base: 160, perUnit: true },
  avocado: { base: 160, perUnit: true },
  pasta: { base: 200, perUnit: true },
  noodles: { base: 220, perUnit: true },
  oats: { base: 150, perUnit: true },
  oatmeal: { base: 150, perUnit: true },
  yogurt: { base: 100, perUnit: true },
  curd: { base: 100, perUnit: true },
  protein: { base: 120, perUnit: true },
  whey: { base: 120, perUnit: true }
};

export function parseAndEstimateCalories(ingredientsStr) {
  if (!ingredientsStr.trim()) return 0;
  
  const items = ingredientsStr.split(/[,\n]/);
  let totalCal = 0;
  
  items.forEach(item => {
    const text = item.toLowerCase().trim();
    if (!text) return;
    
    let matched = false;
    for (const [key, info] of Object.entries(INGREDIENT_DB)) {
      if (text.includes(key)) {
        matched = true;
        const qtyMatch = text.match(/(\d+(?:\.\d+)?)\s*(g|ml|tbsp|tsp|cup|x)?/i);
        if (qtyMatch) {
          const val = parseFloat(qtyMatch[1]);
          const unit = qtyMatch[2] ? qtyMatch[2].toLowerCase() : '';
          
          if (info.perGram && (unit === 'g' || unit === 'ml')) {
            totalCal += val * info.perGram;
          } else if (unit === 'tbsp' || unit === 'cup') {
            totalCal += val * (info.base * 0.8);
          } else {
            totalCal += val * info.base;
          }
        } else {
          totalCal += info.base;
        }
        break;
      }
    }
    
    if (!matched) {
      totalCal += 50; 
    }
  });
  
  return Math.round(totalCal);
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

  // ── Auto-calculate calories from ingredients in real-time ──
  ingInput.addEventListener('input', () => {
    const estimated = parseAndEstimateCalories(ingInput.value);
    calInput.value = estimated > 0 ? estimated : '';
  });

  // ── Submit meal ──
  submitBtn.addEventListener('click', () => {
    const name     = nameInput.value.trim();
    const ingredients = ingInput.value.trim();
    let calories = parseInt(calInput.value, 10);

    // Basic validation
    if (!name) {
      showToast('Please enter a meal name.', '⚠️');
      return;
    }

    // Auto-calculate if calories is left blank
    if (isNaN(calories) || calories <= 0) {
      if (ingredients) {
        calories = parseAndEstimateCalories(ingredients);
        showToast(`Estimated ${calories} kcal from ingredients list`, '🥗');
      } else {
        calories = 150; // Default fallback
        showToast('No calories or ingredients entered. Defaulted to 150 kcal.', 'ℹ️');
      }
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
