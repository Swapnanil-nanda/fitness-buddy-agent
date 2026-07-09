/* ============================================
   FitBuddy — Nutrition / Meal Logging Module
   ============================================ */

import { State, EventBus, showToast } from './app.js';
import { generateResponse } from './watsonx.js';

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
  'sausage roll', 'energy drink', 'redbull', 'monster',
  'mountain dew', 'sprite', 'fanta', '7up', 'dr pepper', 'mirinda',
  'samosa', 'samosas', 'pakora', 'pakoras', 'bhajia', 'jalebi', 'gulab jamun',
  'kachori', 'bhature', 'puri', 'panipuri', 'pani puri', 'sevpuri', 'sev puri',
  'bhelpuri', 'bhel puri', 'chaat', 'aloo tikki', 'vada pav', 'vadapav',
  'pav bhaji', 'pavbhaji', 'misal pav', 'dabeli', 'momos', 'spring roll',
  'spring rolls', 'namkeen', 'bhujia', 'chivda', 'lassi', 'falooda', 'kulfi',
  'rasgulla', 'ladoo', 'laddu', 'halwa', 'barfi', 'pedha', 'kaju katli',
  'shawarma', 'fish and chips', 'fried fish', 'chicken nuggets', 'hot wings',
  'muffin', 'croissant', 'tart', 'pie', 'gelato', 'butter naan', 'kebab',
  'sweet', 'sweets', 'candy floss', 'gummy', 'marshmallow', 'milk chocolate'
];

/**
 * Detect whether a meal qualifies as "cheat food".
 * Checks both name and ingredients against the dictionary (case-insensitive).
 * @param {string} name  – Meal name
 * @param {string} ingredients – Comma-separated ingredients string
 * @returns {boolean}
 */
// ──── Healthy-Food Dictionary (for calibration check) ────
const HEALTHY_FOODS = [
  'salad', 'chicken breast', 'egg', 'eggs', 'spinach', 'broccoli', 'oats',
  'oatmeal', 'rice', 'dal', 'chapati', 'roti', 'fish', 'salmon', 'tuna',
  'apple', 'banana', 'orange', 'cucumber', 'tomato', 'onion', 'veggies',
  'vegetables', 'yogurt', 'curd', 'paneer', 'lentils', 'beans', 'avocado',
  'water', 'almonds', 'nuts', 'whey', 'protein', 'milk'
];

function detectCheat(name, ingredients) {
  const combined = `${name} ${ingredients}`.toLowerCase();
  
  // Check custom cheat foods first
  const customCheats = State.settings?.customCheatFoods || [];
  if (customCheats.some(food => combined.includes(food.toLowerCase()))) {
    return true;
  }

  // Check custom healthy foods next (if it's explicitly healthy, it's not a cheat)
  const customHealthy = State.settings?.customHealthyFoods || [];
  if (customHealthy.some(food => combined.includes(food.toLowerCase()))) {
    return false;
  }

  return CHEAT_FOODS.some(term => combined.includes(term));
}

/**
 * Categorize food cuisine origins based on keywords.
 */
function getCuisineCategory(name, ingredients) {
  const text = `${name} ${ingredients}`.toLowerCase();
  if (/soda|cola|pepsi|coke|juice|milk|coffee|tea|smoothie|shake|drink|dew|fanta|sprite|7up|dr pepper/i.test(text)) return 'Beverage 🥤';
  if (/cake|donut|cookie|brownie|cream|pastry|muffin|pie|chocolate|sweet|jalebi|jamun|waffle|pancake|syrup/i.test(text)) return 'Dessert & Bakery 🍰';
  if (/salad|lettuce|spinach|kale|broccoli|veggie|cucumber|avocado|tomato/i.test(text)) return 'Greens & Salad 🥗';
  if (/samosa|biryani|roti|chapati|paneer|dal|curry|naan|tikka|pakora|chole|dosa|idli|sambar|kebab|puri|kachori/i.test(text)) return 'South Asian 🍛';
  if (/pizza|pasta|spaghetti|lasagna|risotto|mozzarella|pesto/i.test(text)) return 'Italian 🍝';
  if (/burger|fries|hotdog|nugget|wings|steak|mac|fish and chips/i.test(text)) return 'American / Fast Food 🍔';
  if (/ramen|noodle|sushi|dumpling|tofu|soy|kimchi|teriyaki|spring roll|chow mein/i.test(text)) return 'East Asian 🥢';
  if (/taco|burrito|quesadilla|nachos|salsa|guacamole|tortilla/i.test(text)) return 'Mexican 🌮';
  if (/shawarma|hummus|falafel|pita|gyro/i.test(text)) return 'Middle Eastern 🥙';
  return 'Global Cuisine 🌐';
}

// ──── DOM Rendering ────

/**
 * Render a single meal item into the meals list.
 * @param {Object} meal
 */
function renderMealItem(meal) {
  const div = document.createElement('div');
  div.className = 'log-item';
  div.dataset.id = meal.id;
  const typeClass = meal.isCheat ? 'cheat' : 'healthy';
  const cuisine = meal.cuisine || 'Global Cuisine 🌐';

  div.innerHTML = `
    <div class="log-icon ${typeClass}">${meal.isCheat ? '🍔' : '🥗'}</div>
    <div class="log-details">
      <div class="name">${meal.name}</div>
      <div class="meta">${meal.time} · <span style="opacity: 0.8; font-weight: 500;">${cuisine}</span></div>
    </div>
    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="tag ${typeClass}">${meal.isCheat ? 'Cheat' : 'Healthy'}</span>
        <div class="log-value" style="min-width:60px; text-align:right;">${meal.calories} kcal</div>
      </div>
      <div class="action-buttons">
        <button class="action-btn edit-meal-btn" title="Edit">✏️</button>
        <button class="action-btn delete-meal-btn" title="Delete">❌</button>
      </div>
    </div>
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
  list.querySelectorAll('.log-item, .category-header').forEach(el => el.remove());

  if (meals.length > 0) {
    empty.style.display = 'none';
    
    // Group by category
    const grouped = {};
    meals.forEach(m => {
      const cat = m.category || 'Breakfast';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(m);
    });

    const order = ['Breakfast', 'Brunch', 'Lunch', 'Snack', 'Dinner'];
    order.forEach(cat => {
      if (grouped[cat] && grouped[cat].length > 0) {
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = cat;
        header.style.fontSize = '12px';
        header.style.fontWeight = '700';
        header.style.color = 'var(--text-3)';
        header.style.textTransform = 'uppercase';
        header.style.marginTop = '10px';
        header.style.marginBottom = '4px';
        header.style.letterSpacing = '1px';
        header.style.paddingLeft = '4px';
        list.appendChild(header);
        
        grouped[cat].forEach(meal => list.appendChild(renderMealItem(meal)));
      }
    });
  } else {
    empty.style.display = '';
  }

  updateNutritionSummary(meals);
}

function updateMealProgressBars(meals) {
  const container = document.getElementById('meal-progress-bars');
  if (!container) return;

  const tdee = State.user.tdee || 2000;
  const targets = {
    Breakfast: Math.round(tdee * 0.25),
    Brunch: Math.round(tdee * 0.10),
    Lunch: Math.round(tdee * 0.35),
    Snack: Math.round(tdee * 0.10),
    Dinner: Math.round(tdee * 0.30)
  };

  const logged = { Breakfast: 0, Brunch: 0, Lunch: 0, Snack: 0, Dinner: 0 };
  meals.forEach(m => {
    const cat = m.category || 'Breakfast';
    if (logged[cat] !== undefined) {
      logged[cat] += m.calories || 0;
    }
  });

  const emojis = {
    Breakfast: '🍳',
    Brunch: '🥞',
    Lunch: '🍱',
    Snack: '🍿',
    Dinner: '🍽️'
  };

  // Only render categories that have logged calories today (First Food -> Then Calorie Tracker activation)
  const activeCategories = Object.keys(targets).filter(cat => logged[cat] > 0);

  if (activeCategories.length === 0) {
    container.innerHTML = `<div style="font-size: 13px; color: var(--text-3); text-align: center; padding: 12px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.06); border-radius: 8px;">No active meal trackers. Log a meal to activate calorie tracking for that timing.</div>`;
    return;
  }

  container.innerHTML = activeCategories.map(cat => {
    const cur = logged[cat];
    const tgt = targets[cat];
    const pct = Math.min(100, Math.round((cur / tgt) * 100));
    
    let barColor = 'var(--grad-energy)';
    if (pct >= 85 && pct <= 110) {
      barColor = 'var(--grad-nature)';
    } else if (pct > 110) {
      barColor = 'var(--grad-fire)';
    }

    return `
      <div class="glass-card" style="padding: 12px; display: flex; flex-direction: column; gap: 6px; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); border-radius: 12px;">
        <div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 600;">
          <span>${emojis[cat]} ${cat}</span>
          <span style="color: var(--text-2);">${cur} / ${tgt} kcal</span>
        </div>
        <div class="progress-bar-container" style="background: rgba(255,255,255,0.06); height: 8px; border-radius: 4px; overflow: hidden; position: relative;">
          <div class="progress-fill" style="background: ${barColor}; width: ${pct}%; height: 100%; border-radius: 4px; transition: width 0.3s ease;"></div>
        </div>
      </div>
    `;
  }).join('');
}

function updateNutritionSummary(meals) {
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  let totalFiber = 0;

  meals.forEach(m => {
    if (m.protein !== undefined) {
      totalProtein += m.protein || 0;
      totalCarbs   += m.carbs || 0;
      totalFat     += m.fat || 0;
      totalFiber   += m.fiber || 0;
    } else {
      const calculated = calculateMacrosForMeal(m.name, m.ingredients || '', m.calories);
      totalProtein += calculated.protein;
      totalCarbs   += calculated.carbs;
      totalFat     += calculated.fat;
      totalFiber   += calculated.fiber;
      // populate in memory
      m.protein = calculated.protein;
      m.carbs = calculated.carbs;
      m.fat = calculated.fat;
      m.fiber = calculated.fiber;
    }
  });

  const pEl = document.getElementById('nut-protein');
  const cEl = document.getElementById('nut-carbs');
  const fEl = document.getElementById('nut-fat');
  const fibEl = document.getElementById('nut-fiber');

  if (pEl) pEl.textContent = `${Math.round(totalProtein)}g`;
  if (cEl) cEl.textContent = `${Math.round(totalCarbs)}g`;
  if (fEl) fEl.textContent = `${Math.round(totalFat)}g`;
  if (fibEl) fibEl.textContent = `${Math.round(totalFiber)}g`;

  // Update level progress bars
  updateMealProgressBars(meals);
}

// ──── Ingredient Database & Calorie Estimator ────
const INGREDIENT_DB = {
  egg: { base: 78, protein: 6, carbs: 0.6, fat: 5, fiber: 0, perUnit: true },
  eggs: { base: 78, protein: 6, carbs: 0.6, fat: 5, fiber: 0, perUnit: true },
  chicken: { base: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, perGram: { cal: 1.65, protein: 0.31, carbs: 0, fat: 0.036, fiber: 0 } },
  rice: { base: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, perGram: { cal: 1.3, protein: 0.027, carbs: 0.28, fat: 0.003, fiber: 0.004 } },
  roti: { base: 85, protein: 3, carbs: 18, fat: 0.5, fiber: 2.2, perUnit: true },
  chapati: { base: 85, protein: 3, carbs: 18, fat: 0.5, fiber: 2.2, perUnit: true },
  tortilla: { base: 150, protein: 4, carbs: 26, fat: 3, fiber: 1.5, perUnit: true },
  bread: { base: 80, protein: 3, carbs: 15, fat: 1, fiber: 1.2, perUnit: true },
  oil: { base: 120, protein: 0, carbs: 0, fat: 14, fiber: 0, perUnit: true, perGram: { cal: 8.8, protein: 0, carbs: 0, fat: 1.0, fiber: 0 } },
  butter: { base: 100, protein: 0.1, carbs: 0.1, fat: 11, fiber: 0, perUnit: true, perGram: { cal: 7.2, protein: 0.008, carbs: 0.001, fat: 0.81, fiber: 0 } },
  ghee: { base: 120, protein: 0, carbs: 0, fat: 14, fiber: 0, perUnit: true, perGram: { cal: 8.8, protein: 0, carbs: 0, fat: 1.0, fiber: 0 } },
  cheese: { base: 350, protein: 25, carbs: 1.3, fat: 28, fiber: 0, perGram: { cal: 3.5, protein: 0.25, carbs: 0.013, fat: 0.28, fiber: 0 } },
  milk: { base: 60, protein: 3.2, carbs: 4.8, fat: 3.25, fiber: 0, perGram: { cal: 0.6, protein: 0.032, carbs: 0.048, fat: 0.0325, fiber: 0 } },
  sugar: { base: 40, protein: 0, carbs: 10, fat: 0, fiber: 0, perUnit: true, perGram: { cal: 3.87, protein: 0, carbs: 1.0, fat: 0, fiber: 0 } },
  honey: { base: 60, protein: 0.1, carbs: 17, fat: 0, fiber: 0, perUnit: true, perGram: { cal: 3.04, protein: 0.003, carbs: 0.82, fat: 0, fiber: 0 } },
  paneer: { base: 260, protein: 18, carbs: 1.5, fat: 20, fiber: 0, perGram: { cal: 2.6, protein: 0.18, carbs: 0.015, fat: 0.20, fiber: 0 } },
  dal: { base: 150, protein: 8, carbs: 24, fat: 0.5, fiber: 6, perUnit: true, perGram: { cal: 3.4, protein: 0.22, carbs: 0.57, fat: 0.01, fiber: 0.15 } },
  lentils: { base: 110, protein: 9, carbs: 20, fat: 0.4, fiber: 8, perUnit: true },
  beans: { base: 110, protein: 7, carbs: 20, fat: 0.5, fiber: 7, perUnit: true },
  fish: { base: 150, protein: 22, carbs: 0, fat: 6, fiber: 0, perGram: { cal: 1.5, protein: 0.22, carbs: 0, fat: 0.06, fiber: 0 } },
  salmon: { base: 180, protein: 22, carbs: 0, fat: 10, fiber: 0, perGram: { cal: 1.8, protein: 0.22, carbs: 0, fat: 0.10, fiber: 0 } },
  tuna: { base: 130, protein: 26, carbs: 0, fat: 3, fiber: 0, perGram: { cal: 1.3, protein: 0.26, carbs: 0, fat: 0.03, fiber: 0 } },
  beef: { base: 250, protein: 26, carbs: 0, fat: 15, fiber: 0, perGram: { cal: 2.5, protein: 0.26, carbs: 0, fat: 0.15, fiber: 0 } },
  steak: { base: 250, protein: 26, carbs: 0, fat: 15, fiber: 0, perGram: { cal: 2.5, protein: 0.26, carbs: 0, fat: 0.15, fiber: 0 } },
  salad: { base: 20, protein: 1, carbs: 4, fat: 0.2, fiber: 2, perUnit: true },
  lettuce: { base: 15, protein: 1, carbs: 3, fat: 0.15, fiber: 1.5, perUnit: true },
  spinach: { base: 15, protein: 2, carbs: 2.5, fat: 0.3, fiber: 1.8, perUnit: true },
  cucumber: { base: 15, protein: 0.6, carbs: 3.5, fat: 0.1, fiber: 0.5, perUnit: true },
  tomato: { base: 20, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2, perUnit: true },
  onion: { base: 30, protein: 0.8, carbs: 7, fat: 0.1, fiber: 1.3, perUnit: true },
  veggies: { base: 25, protein: 1.5, carbs: 5, fat: 0.2, fiber: 2.5, perUnit: true },
  vegetables: { base: 25, protein: 1.5, carbs: 5, fat: 0.2, fiber: 2.5, perUnit: true },
  apple: { base: 80, protein: 0.3, carbs: 20, fat: 0.2, fiber: 4.4, perUnit: true },
  banana: { base: 90, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, perUnit: true },
  orange: { base: 60, protein: 1.2, carbs: 15, fat: 0.2, fiber: 3, perUnit: true },
  mango: { base: 150, protein: 1.5, carbs: 35, fat: 0.6, fiber: 3, perUnit: true },
  potato: { base: 130, protein: 3, carbs: 30, fat: 0.2, fiber: 3.2, perUnit: true },
  potatoes: { base: 130, protein: 3, carbs: 30, fat: 0.2, fiber: 3.2, perUnit: true },
  nuts: { base: 160, protein: 6, carbs: 6, fat: 14, fiber: 3, perUnit: true },
  almonds: { base: 160, protein: 6, carbs: 6, fat: 14, fiber: 3, perUnit: true },
  avocado: { base: 160, protein: 2, carbs: 9, fat: 15, fiber: 7, perUnit: true },
  pasta: { base: 200, protein: 7, carbs: 42, fat: 1, fiber: 2, perUnit: true },
  noodles: { base: 220, protein: 6, carbs: 45, fat: 2, fiber: 1.5, perUnit: true },
  oats: { base: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, perUnit: true },
  oatmeal: { base: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, perUnit: true },
  yogurt: { base: 100, protein: 10, carbs: 4, fat: 3, fiber: 0, perUnit: true },
  curd: { base: 100, protein: 10, carbs: 4, fat: 3, fiber: 0, perUnit: true },
  protein: { base: 120, protein: 25, carbs: 2, fat: 1, fiber: 1, perUnit: true },
  whey: { base: 120, protein: 25, carbs: 2, fat: 1, fiber: 1, perUnit: true },
  
  // Indian Snacks / Fast Foods
  samosa: { base: 260, protein: 5, carbs: 32, fat: 13, fiber: 2, perUnit: true, perGram: { cal: 3.0, protein: 0.06, carbs: 0.37, fat: 0.15, fiber: 0.02 } },
  samosas: { base: 260, protein: 5, carbs: 32, fat: 13, fiber: 2, perUnit: true, perGram: { cal: 3.0, protein: 0.06, carbs: 0.37, fat: 0.15, fiber: 0.02 } },
  pakora: { base: 50, protein: 1, carbs: 6, fat: 2.5, fiber: 0.8, perUnit: true, perGram: { cal: 3.0, protein: 0.06, carbs: 0.36, fat: 0.15, fiber: 0.05 } },
  pakoras: { base: 50, protein: 1, carbs: 6, fat: 2.5, fiber: 0.8, perUnit: true, perGram: { cal: 3.0, protein: 0.06, carbs: 0.36, fat: 0.15, fiber: 0.05 } },
  bhajia: { base: 50, protein: 1, carbs: 6, fat: 2.5, fiber: 0.8, perUnit: true, perGram: { cal: 3.0, protein: 0.06, carbs: 0.36, fat: 0.15, fiber: 0.05 } },
  jalebi: { base: 150, protein: 1, carbs: 28, fat: 4, fiber: 0.2, perUnit: true, perGram: { cal: 3.5, protein: 0.02, carbs: 0.65, fat: 0.09, fiber: 0.01 } },
  'gulab jamun': { base: 150, protein: 2, carbs: 25, fat: 5, fiber: 0.1, perUnit: true },
  kachori: { base: 200, protein: 4, carbs: 24, fat: 10, fiber: 1.5, perUnit: true },
  bhatura: { base: 220, protein: 5, carbs: 34, fat: 7, fiber: 1.2, perUnit: true },
  bhature: { base: 220, protein: 5, carbs: 34, fat: 7, fiber: 1.2, perUnit: true },
  puri: { base: 100, protein: 2, carbs: 15, fat: 4, fiber: 1.0, perUnit: true },
  panipuri: { base: 30, protein: 0.5, carbs: 5, fat: 0.8, fiber: 0.5, perUnit: true },
  'pani puri': { base: 30, protein: 0.5, carbs: 5, fat: 0.8, fiber: 0.5, perUnit: true },
  sevpuri: { base: 220, protein: 4, carbs: 28, fat: 10, fiber: 2, perUnit: true },
  'sev puri': { base: 220, protein: 4, carbs: 28, fat: 10, fiber: 2, perUnit: true },
  bhelpuri: { base: 280, protein: 6, carbs: 42, fat: 9, fiber: 3, perUnit: true },
  'bhel puri': { base: 280, protein: 6, carbs: 42, fat: 9, fiber: 3, perUnit: true },
  chaat: { base: 250, protein: 5, carbs: 35, fat: 10, fiber: 2.5, perUnit: true },
  'aloo tikki': { base: 150, protein: 2, carbs: 24, fat: 5, fiber: 2.0, perUnit: true },
  'vada pav': { base: 300, protein: 6, carbs: 44, fat: 11, fiber: 3, perUnit: true },
  vadapav: { base: 300, protein: 6, carbs: 44, fat: 11, fiber: 3, perUnit: true },
  'pav bhaji': { base: 400, protein: 9, carbs: 62, fat: 12, fiber: 5, perUnit: true },
  pavbhaji: { base: 400, protein: 9, carbs: 62, fat: 12, fiber: 5, perUnit: true },
  'misal pav': { base: 450, protein: 12, carbs: 65, fat: 15, fiber: 6, perUnit: true },
  dabeli: { base: 250, protein: 5, carbs: 38, fat: 8, fiber: 2, perUnit: true },
  momos: { base: 40, protein: 1.5, carbs: 6, fat: 1, fiber: 0.5, perUnit: true },
  momo: { base: 40, protein: 1.5, carbs: 6, fat: 1, fiber: 0.5, perUnit: true },
  'spring roll': { base: 120, protein: 3, carbs: 16, fat: 5, fiber: 1.0, perUnit: true },
  'spring rolls': { base: 120, protein: 3, carbs: 16, fat: 5, fiber: 1.0, perUnit: true },
  biryani: { base: 500, protein: 22, carbs: 68, fat: 15, fiber: 4, perGram: { cal: 2.0, protein: 0.088, carbs: 0.27, fat: 0.06, fiber: 0.016 } },
  shawarma: { base: 500, protein: 28, carbs: 42, fat: 24, fiber: 3, perUnit: true },
  lassi: { base: 200, protein: 5, carbs: 28, fat: 6, fiber: 0, perUnit: true },
  kulfi: { base: 180, protein: 4, carbs: 22, fat: 8, fiber: 0, perUnit: true },
  rasgulla: { base: 120, protein: 2, carbs: 26, fat: 1, fiber: 0.1, perUnit: true },
  ladoo: { base: 150, protein: 2, carbs: 22, fat: 6, fiber: 0.5, perUnit: true },
  laddu: { base: 150, protein: 2, carbs: 22, fat: 6, fiber: 0.5, perUnit: true },
  halwa: { base: 250, protein: 3, carbs: 38, fat: 10, fiber: 1.0, perUnit: true },
  barfi: { base: 150, protein: 3, carbs: 20, fat: 6, fiber: 0.2, perUnit: true },
  pedha: { base: 120, protein: 2, carbs: 18, fat: 5, fiber: 0.1, perUnit: true },
  'kaju katli': { base: 50, protein: 1, carbs: 6, fat: 2.5, fiber: 0.2, perUnit: true }
};

export function calculateMacrosForMeal(name, ingredientsStr, enteredCalories) {
  const queryText = (ingredientsStr.trim() || name.trim()).toLowerCase();
  const items = queryText.split(/[,\n]/);
  
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fiber = 0;
  let totalIngredientsMatched = 0;

  items.forEach(item => {
    const text = item.trim();
    if (!text) return;

    let matched = false;
    for (const [key, info] of Object.entries(INGREDIENT_DB)) {
      if (text.includes(key)) {
        matched = true;
        totalIngredientsMatched++;
        
        const qtyMatch = text.match(/(\d+(?:\.\d+)?)\s*(g|ml|tbsp|tsp|cup|x)?/i);
        let val = 1;
        let unit = '';
        if (qtyMatch) {
          val = parseFloat(qtyMatch[1]);
          unit = qtyMatch[2] ? qtyMatch[2].toLowerCase() : '';
        }

        if (info.perGram && (unit === 'g' || unit === 'ml')) {
          calories += val * (info.perGram.cal || info.perGram);
          protein += val * (info.perGram.protein || 0);
          carbs += val * (info.perGram.carbs || 0);
          fat += val * (info.perGram.fat || 0);
          fiber += val * (info.perGram.fiber || 0);
        } else if (unit === 'tbsp' || unit === 'cup') {
          const ratio = (unit === 'cup') ? 8 : 1;
          calories += val * (info.base * ratio * 0.8);
          protein += val * ((info.protein || 0) * ratio * 0.8);
          carbs += val * ((info.carbs || 0) * ratio * 0.8);
          fat += val * ((info.fat || 0) * ratio * 0.8);
          fiber += val * ((info.fiber || 0) * ratio * 0.8);
        } else {
          calories += val * info.base;
          protein += val * (info.protein || 0);
          carbs += val * (info.carbs || 0);
          fat += val * (info.fat || 0);
          fiber += val * (info.fiber || 0);
        }
        break;
      }
    }
  });

  if (totalIngredientsMatched === 0) {
    const cal = enteredCalories || 150;
    return {
      calories: cal,
      protein: (cal * 0.2) / 4,
      carbs: (cal * 0.5) / 4,
      fat: (cal * 0.3) / 9,
      fiber: 0,
      matchedCount: 0
    };
  }

  if (enteredCalories && enteredCalories > 0 && calories > 0) {
    const scale = enteredCalories / calories;
    return {
      calories: enteredCalories,
      protein: protein * scale,
      carbs: carbs * scale,
      fat: fat * scale,
      fiber: fiber * scale,
      matchedCount: totalIngredientsMatched
    };
  }

  return { calories, protein, carbs, fat, fiber, matchedCount: totalIngredientsMatched };
}

export function parseAndEstimateCalories(ingredientsStr) {
  const res = calculateMacrosForMeal('', ingredientsStr, 0);
  return Math.round(res.calories);
}

async function estimateNutritionWithAI(name, ingredients, enteredCalories) {
  // 1. Run local database calculation first
  const local = calculateMacrosForMeal(name, ingredients, enteredCalories);
  
  // Count distinct ingredient items in the query
  const queryText = (ingredients.trim() || name.trim()).toLowerCase();
  const itemsCount = queryText.split(/[,\n]/).map(x => x.trim()).filter(Boolean).length;

  // 2. Trust the local DB if we matched all ingredients! (e.g. "20 ml oil" matches exactly)
  if (local.matchedCount >= itemsCount && local.calories > 0) {
    console.log(`Local DB matched all ${itemsCount} ingredients. Skipping AI estimation for speed and precision.`);
    return local;
  }

  // 3. Fallback to AI for complex queries or unknown foods
  const prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are a precise nutrition calculator. Estimate the nutritional values (calories, protein, carbs, fat, fiber) for the food: "${name}" with ingredients: "${ingredients || 'standard recipe'}".
Use verified USDA and IFCT (Indian Food Composition Tables) data. Be extremely accurate.
For example, standard chai with milk and sugar is ~70-90 calories, ~10g carbs, 0g fiber.
Your response MUST be ONLY a single JSON block. Do not include markdown code block ticks, backticks, or any conversational text. Just the raw JSON.

Format:
{"calories": number, "protein": number, "carbs": number, "fat": number, "fiber": number}
<|eot_id|><|start_header_id|>user<|end_header_id|>
Calculate nutrition for: ${name}<|eot_id|><|start_header_id|>assistant<|end_header_id|>
`;

  try {
    const result = await generateResponse(prompt, 100);
    if (result.success) {
      const match = result.text.match(/\{[\s\S]*?\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        let scale = 1;
        const calVal = enteredCalories || Math.round(data.calories || 150);
        if (enteredCalories && data.calories > 0) {
          scale = enteredCalories / data.calories;
        }
        return {
          calories: calVal,
          protein: Math.round((data.protein || 0) * scale * 10) / 10,
          carbs: Math.round((data.carbs || 0) * scale * 10) / 10,
          fat: Math.round((data.fat || 0) * scale * 10) / 10,
          fiber: Math.round((data.fiber || 0) * scale * 10) / 10
        };
      }
    }
  } catch (e) {
    console.warn('AI nutrition estimation failed, falling back to local DB:', e);
  }
  
  return local;
}

function isNewFood(name) {
  const normalized = name.toLowerCase().trim();
  
  // If the exact full name matches a custom preference, it is not new
  if ((State.settings?.customCheatFoods || []).includes(normalized)) return false;
  if ((State.settings?.customHealthyFoods || []).includes(normalized)) return false;
  
  // Split into words, filter out common short words and cooking modifiers
  const modifiers = new Set([
    'grilled', 'fried', 'boiled', 'baked', 'spicy', 'hot', 'fresh', 'sweet', 
    'dry', 'roasted', 'steamed', 'with', 'and', 'a', 'an', 'the', 'cooked', 
    'homemade', 'oil', 'cup', 'spoon', 'ml', 'g', 'bowl', 'plate'
  ]);
  
  const words = normalized.split(/\s+/).map(w => w.replace(/[^a-z]/g, '')).filter(w => w.length > 2 && !modifiers.has(w));
  
  // If no main words left (e.g. just "rice"), check if it matches a known healthy/cheat item exactly
  if (words.length === 0) return false;
  
  // Check if ANY of the main words in the food name are completely unknown
  const isWordKnown = (word) => {
    const inCheat = CHEAT_FOODS.some(term => term === word || term.split(/\s+/).includes(word));
    const inHealthy = HEALTHY_FOODS.some(term => term === word || term.split(/\s+/).includes(word));
    return inCheat || inHealthy;
  };
  
  const hasUnknownWord = words.some(word => !isWordKnown(word));
  return hasUnknownWord;
}

// ──── Module Init ────

/**
 * Initialize the Nutrition module.
 * Sets up modal interactions, meal logging, cheat detection, and XP rewards.
 */
export function initNutrition() {
  let editingMealId = null;
  // DOM references
  const modal      = document.getElementById('meal-modal');
  const addBtn     = document.getElementById('add-meal-btn');
  const cancelBtn  = document.getElementById('meal-cancel');
  const submitBtn  = document.getElementById('meal-submit');
  const nameInput  = document.getElementById('meal-name');
  const calInput   = document.getElementById('meal-calories');
  const ingInput   = document.getElementById('meal-ingredients');
  const catInput   = document.getElementById('meal-category');
  const list       = document.getElementById('meals-list');

  // ── Open modal ──
  addBtn.addEventListener('click', () => {
    editingMealId = null;
    nameInput.value = '';
    calInput.value = '';
    ingInput.value = '';
    if (catInput) catInput.value = 'Breakfast';
    document.querySelector('#meal-modal .modal-title').textContent = 'Log a Meal';
    submitBtn.textContent = 'Log Meal';
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

  // ── Delegation for Edit / Delete ──
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.action-btn');
    if (!btn) return;
    
    const item = btn.closest('.log-item');
    if (!item) return;
    
    const id = Number(item.dataset.id);

    if (btn.classList.contains('delete-meal-btn')) {
      if (confirm('Delete this meal?')) {
        State.today.meals = State.today.meals.filter(m => m.id !== id);
        State.save();
        renderAllMeals();
        showToast('Meal deleted', '🗑️');
      }
    } else if (btn.classList.contains('edit-meal-btn')) {
      const meal = State.today.meals.find(m => m.id === id);
      if (meal) {
        editingMealId = id;
        nameInput.value = meal.name;
        ingInput.value = meal.ingredients || '';
        calInput.value = meal.calories;
        if (catInput) catInput.value = meal.category || 'Breakfast';
        
        document.querySelector('#meal-modal .modal-title').textContent = 'Edit Meal';
        submitBtn.textContent = 'Update Meal';
        modal.classList.add('visible');
      }
    }
  });

  // ── Auto-calculate calories from ingredients in real-time ──
  ingInput.addEventListener('input', () => {
    const estimated = parseAndEstimateCalories(ingInput.value);
    calInput.value = estimated > 0 ? estimated : '';
  });

  // ── Submit meal ──
  submitBtn.addEventListener('click', async () => {
    const name     = nameInput.value.trim();
    const ingredients = ingInput.value.trim();
    let calories = parseInt(calInput.value, 10);

    // Basic validation
    if (!name) {
      showToast('Please enter a meal name.', '⚠️');
      return;
    }

    // Disable submit button and show loading state
    submitBtn.disabled = true;
    const oldText = submitBtn.textContent;
    submitBtn.textContent = 'Analyzing macros... 🤖';

    let macros;
    try {
      // Direct internet-like lookup using AI
      macros = await estimateNutritionWithAI(name, ingredients, calories);
      calories = macros.calories;
    } catch (err) {
      console.warn('AI analysis error, falling back:', err);
      macros = calculateMacrosForMeal(name, ingredients, calories || 150);
      calories = macros.calories;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = oldText;
    }

    // Cheat detection & unknown food verification
    let isCheat = detectCheat(name, ingredients);
    const normalizedName = name.toLowerCase().trim();

    if (isNewFood(name)) {
      const isHealthy = confirm(`FitBuddy: I noticed "${name}" is a new food. Is this a natural or healthy food?\n\nClick OK if it is healthy/natural.\nClick Cancel if it is a processed/cheat meal.`);
      if (isHealthy) {
        const healthyList = State.settings.customHealthyFoods || [];
        if (!healthyList.includes(normalizedName)) {
          healthyList.push(normalizedName);
          State.set('settings.customHealthyFoods', healthyList);
        }
        isCheat = false;
      } else {
        const cheatList = State.settings.customCheatFoods || [];
        if (!cheatList.includes(normalizedName)) {
          cheatList.push(normalizedName);
          State.set('settings.customCheatFoods', cheatList);
        }
        isCheat = true;
      }
    }

    const cuisine = getCuisineCategory(name, ingredients);
    const category = catInput ? catInput.value : 'Breakfast';

    if (editingMealId) {
      const meal = State.today.meals.find(m => m.id === editingMealId);
      if (meal) {
        meal.name = name;
        meal.ingredients = ingredients;
        meal.calories = calories;
        meal.protein = Math.round(macros.protein * 10) / 10;
        meal.carbs = Math.round(macros.carbs * 10) / 10;
        meal.fat = Math.round(macros.fat * 10) / 10;
        meal.fiber = Math.round(macros.fiber * 10) / 10;
        meal.category = category;
        meal.isCheat = isCheat;
        meal.cuisine = cuisine;
      }
      editingMealId = null;
      showToast('Meal updated!', '✅');
    } else {
      const meal = {
        id: Date.now(),
        name,
        calories,
        protein: Math.round(macros.protein * 10) / 10,
        carbs: Math.round(macros.carbs * 10) / 10,
        fat: Math.round(macros.fat * 10) / 10,
        fiber: Math.round(macros.fiber * 10) / 10,
        ingredients,
        category,
        isCheat,
        cuisine,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      
      State.today.meals.push(meal);
      EventBus.emit('meal:added', { meal });
      EventBus.emit('xp:gained', { amount: 15, reason: 'Logged a meal' });

      if (isCheat) {
        showToast(`${name} logged — cheat meal detected! 🍔`, '🍔');
      } else {
        showToast(`${name} logged — nice healthy choice! 🥗`, '🥗');
      }
    }

    State.save();
    renderAllMeals();

    nameInput.value = '';
    calInput.value  = '';
    ingInput.value  = '';
    if (catInput) catInput.value = 'Breakfast';
    modal.classList.remove('visible');
  });

  // ── Restore persisted meals on load ──
  renderAllMeals();

  console.log('🍎 Nutrition module initialized');
}
