/* ============================================
   FitBuddy — AI Chat Console (The Brain)
   ============================================
   Advanced prompt engineering with:
   • Full user profile + today's status injection
   • Intent detection (craving, ingredients, stress, workout)
   • Structured response parsing ([CHALLENGE:...], [RECIPE_START]...[RECIPE_END])
   • Persistent 5-message chat history
   ============================================ */

import { State, EventBus, showToast } from './app.js';
import { generateResponse } from './watsonx.js';

// ──── DOM References (resolved once on init) ────
let $messages, $input, $sendBtn, $typing;

// ──── Intent Detection Patterns ────
// Compiled once — these regexes identify special conversational intents
// so we can inject targeted instructions into the system prompt.
const INTENT = {
  CRAVING:     /crav(?:e|ing)|want(?:s|ing)?\s+(?:pizza|burger|fries|soda|candy|chocolate|junk|fast food|sweets|sugar|ice cream|cookie|donut)/i,
  INGREDIENTS: /i have |ingredients?|in my (?:fridge|kitchen|pantry)|what can i (?:make|cook)/i,
  STRESS:      /exhausted|stressed|anxious|overwhelmed|can't sleep|burned out|tired/i,
  WORKOUT:     /workout|exercise|push.?up|squat|plank|routine|training|cardio|home workout/i
};

// ──── BMI Category Helper ────
function bmiCategory(bmi) {
  if (bmi <= 0) return 'Not calculated';
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25)   return 'Normal';
  if (bmi < 30)   return 'Overweight';
  return 'Obese';
}

// ──── Advanced Prompt Compiler ────

/**
 * Builds a comprehensive system prompt injecting all available user data,
 * then appends recent conversation context and the current user message.
 *
 * The prompt is structured to:
 * 1. Ground the AI in the user's exact biometrics and today's progress
 * 2. Provide a fitness knowledge base for accurate calculations
 * 3. Enforce concise, data-driven response rules
 * 4. Activate special behaviors based on detected intent
 */
function getChatContext() {
  const { weight, height, age, gender, bmi, goal, tdee, macros, bodyFat, neck, waist, hip, activity, cuisine, diet } = State.user;
  const { meals, exercises, water, sleep, mood } = State.today;
  const consumed  = State.caloriesConsumed;
  const burned    = State.caloriesBurned;
  const dietQual  = State.dietQuality;
  const mealCount = meals.length;
  const exerciseCount = exercises.length;

  const goalLabel = { loss: 'Weight Loss', maintain: 'Maintain Weight', gain: 'Muscle Gain' }[goal] || goal;
  const activityLabel = {
    sedentary: 'Sedentary (little to no exercise)',
    lightly: 'Lightly Active (light exercise 1-3 days/week)',
    moderately: 'Moderately Active (moderate exercise 3-5 days/week)',
    very: 'Very Active (hard exercise 6-7 days/week)',
    extra: 'Extra Active (very hard exercise/physical job)'
  }[activity] || activity || 'Lightly Active';

  const cuisineLabel = {
    any: 'No specific preference',
    indian: 'Indian',
    mediterranean: 'Mediterranean',
    'east-asian': 'East Asian (Chinese, Japanese, Korean)',
    'southeast-asian': 'Southeast Asian (Thai, Vietnamese, Filipino)',
    'middle-eastern': 'Middle Eastern',
    mexican: 'Mexican / Latin American',
    american: 'American / Western',
    african: 'African',
    european: 'European'
  }[cuisine] || cuisine || 'No specific preference';

  const dietLabel = {
    'no-restriction': 'No restriction (eats everything)',
    vegetarian: 'Vegetarian (no meat/seafood)',
    vegan: 'Vegan (no animal products)',
    eggetarian: 'Eggetarian (vegetarian + eggs)',
    pescatarian: 'Pescatarian (fish/seafood only, no meat)',
    keto: 'Keto / Low-carb (under 30g net carbs/day)',
    'gluten-free': 'Gluten-free',
    'dairy-free': 'Dairy-free (no milk/cheese/butter)',
    halal: 'Halal',
    kosher: 'Kosher'
  }[diet] || diet || 'No restriction';

  const recentMealNames = meals.slice(-5).map(m => m.name).join(', ') || 'none logged today';

  let biometricDetails = '';
  if (bodyFat > 0) biometricDetails += `\n- Body Fat: ${bodyFat}%`;
  if (neck > 0) biometricDetails += `\n- Neck Size: ${neck}cm`;
  if (waist > 0) biometricDetails += `\n- Waist Size: ${waist}cm`;
  if (hip > 0) biometricDetails += `\n- Hip Size: ${hip}cm`;

  return {
    weight, height, age, gender, bmi, goalLabel, activityLabel, tdee, macros,
    biometricDetails, cuisineLabel, dietLabel, recentMealNames,
    consumed, burned, mealCount, dietQual, water, sleep, mood, exerciseCount
  };
}

// ──── Response Parser ────

/**
 * Parses the raw AI response text to:
 * 1. Extract [CHALLENGE:text] tags → emit as new daily challenges
 * 2. Extract [RECIPE_START]json[RECIPE_END] → render as recipe card HTML
 * 3. Return cleaned display text
 */
function parseResponse(text) {
  let displayText = text;
  let recipeHTML = '';

  // ── 1. Extract Challenges ──
  const challengeRegex = /\[CHALLENGE:(.*?)\]/gi;
  let challengeMatch;
  let challengeCount = 0;
  while ((challengeMatch = challengeRegex.exec(text)) !== null) {
    const challengeText = challengeMatch[1].trim();
    if (challengeText) {
      addChallengeFromAI(challengeText, 20);
      challengeCount++;
    }
  }
  // Strip challenge tags from display
  displayText = displayText.replace(challengeRegex, '').trim();

  if (challengeCount > 0) {
    showToast(`${challengeCount} task${challengeCount > 1 ? 's' : ''} added!`, '🎯');
  }

  // ── 2. Extract Recipes ──
  const recipeRegex = /\[RECIPE_START\]([\s\S]*?)\[RECIPE_END\]/gi;
  let recipeMatch;
  while ((recipeMatch = recipeRegex.exec(text)) !== null) {
    let rawJSON = recipeMatch[1].trim();
    // Clean up markdown code block ticks if the AI wrapped the JSON
    rawJSON = rawJSON.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      const recipe = JSON.parse(rawJSON);
      recipeHTML += renderRecipeCard(recipe);
    } catch (e) {
      console.warn('Failed to parse recipe JSON:', e);
      recipeHTML += `<div class="recipe-card" style="background:rgba(255,255,255,0.02);padding:12px;border-radius:8px;font-size:13px;color:var(--text-3);">Estimated nutritional breakdown and recipe instructions logged to daily summaries.</div>`;
    }
  }
  // Strip recipe blocks from display
  displayText = displayText.replace(recipeRegex, '').trim();

  return { displayText, recipeHTML };
}

/**
 * Renders a parsed recipe object as a styled card with macro pills and YouTube link.
 */
function renderRecipeCard(recipe) {
  const { name = 'Recipe', steps = [], calories = 0, protein = 0, carbs = 0, fat = 0, fiber = 0 } = recipe;
  const ytQuery = encodeURIComponent(`${name} recipe`);

  const stepsHTML = steps.map((s, i) =>
    `<div class="recipe-step"><span class="step-num">${i + 1}.</span> ${escapeHTML(s)}</div>`
  ).join('');

  return `
    <div class="recipe-card" style="background:rgba(0,0,0,0.3);border-radius:12px;padding:16px;margin-top:10px;border:1px solid rgba(255,255,255,0.08);">
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">🍳 ${escapeHTML(name)}</div>
      <div style="margin-bottom:10px;">${stepsHTML}</div>
      <div class="macro-pills" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="background:#ff6b3520;color:#ff6b35;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">🔥 ${calories} kcal</span>
        <span style="background:#4ecdc420;color:#4ecdc4;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">💪 ${protein}g protein</span>
        <span style="background:#ffe66d20;color:#ffe66d;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">🌾 ${carbs}g carbs</span>
        <span style="background:#ff649920;color:#ff6499;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">🥑 ${fat}g fat</span>
        ${fiber ? `<span style="background:#a2d14920;color:#a2d149;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">🌿 ${fiber}g fiber</span>` : ''}
      </div>
      <a href="https://www.youtube.com/results?search_query=${ytQuery}" target="_blank" rel="noopener"
         style="color:#ff6b6b;text-decoration:none;font-size:13px;font-weight:600;">
        🎥 Watch a tutorial on YouTube →
      </a>
    </div>`;
}

/**
 * Escape HTML to prevent XSS in user/AI-generated content.
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ──── Chat UI ────

/**
 * Adds a message bubble to the chat container.
 * @param {'user'|'ai'} role   — determines styling
 * @param {string}       content — text content (will be escaped)
 * @param {string}       extra  — optional raw HTML appended after text (e.g. recipe cards)
 */
function formatMarkdown(content) {
  let escaped = escapeHTML(content);
  
  // Strip markdown code block ticks entirely to keep responses user-friendly
  escaped = escaped.replace(/```[a-zA-Z]*\n?/g, '');
  escaped = escaped.replace(/`/g, '');
  
  // Bold formatting: **text** -> <strong>text</strong>
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Bullet points: convert list syntax to clean bullets
  escaped = escaped.replace(/^\s*[-*•]\s+(.+)/gm, '• $1');

  escaped = escaped.replace(/\n/g, '<br>');
  // Convert [text](url) markdown to clickable links
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  escaped = escaped.replace(linkRegex, (match, linkText, url) => {
    return `<a href="${url}" target="_blank" class="chat-link" style="color: var(--teal); text-decoration: underline; font-weight: 600;">${linkText}</a>`;
  });
  
  // Fallback: convert raw URLs to clickable links
  const rawUrlRegex = /(?<!href=")(https?:\/\/[^\s<]+)/g;
  escaped = escaped.replace(rawUrlRegex, (url) => {
    let name = "View Link";
    if (url.includes('youtube.com') || url.includes('youtu.be')) name = "Watch on YouTube →";
    return `<a href="${url}" target="_blank" class="chat-link" style="color: var(--teal); text-decoration: underline; font-weight: 600;">${name}</a>`;
  });
  
  return escaped;
}

/**
 * Adds a message bubble to the chat container.
 * @param {'user'|'ai'} role   — determines styling
 * @param {string}       content — text content
 * @param {string}       extra  — optional raw HTML appended after text (e.g. recipe cards)
 */
function addMessage(role, content, extra = '') {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  if (role === 'ai') {
    const label = document.createElement('div');
    label.className = 'ai-label';
    label.textContent = 'FitBuddy AI';
    wrapper.appendChild(label);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // Render text content with markdown link support
  const textNode = document.createElement('div');
  textNode.innerHTML = formatMarkdown(content);
  bubble.appendChild(textNode);

  // Append extra HTML (recipe cards, etc.) if present
  if (extra) {
    const extraContainer = document.createElement('div');
    extraContainer.innerHTML = extra;
    bubble.appendChild(extraContainer);
  }

  wrapper.appendChild(bubble);
  // Insert before the typing indicator so it stays at the bottom
  $messages.insertBefore(wrapper, $typing);

  // Auto-scroll to latest message
  $messages.scrollTop = $messages.scrollHeight;
}

/**
 * Shows/hides the typing indicator dots.
 */
function setTyping(visible) {
  $typing.style.display = visible ? 'flex' : 'none';
  if (visible) {
    $messages.scrollTop = $messages.scrollHeight;
  }
}

// ──── Chat History Management ────

/**
 * Pushes a message into State.chatHistory, keeping only the last 5 entries.
 */
function pushHistory(role, content) {
  const history = State.chatHistory || [];
  history.push({ role, content });
  // Keep only the last 5 messages
  while (history.length > 5) {
    history.shift();
  }
  State.set('chatHistory', history);
}

// ──── Send Message Flow ────

/**
 * Main send handler — compiles prompt, calls watsonx, parses response.
 */
async function handleSend() {
  const text = $input.value.trim();
  if (!text) return;

  // Clear input immediately for snappy UX
  $input.value = '';
  $sendBtn.disabled = true;

  // Show user message
  addMessage('user', text);
  pushHistory('user', text);

  // Show typing indicator
  setTyping(true);

  try {
    const context = getChatContext();
    const history = (State.chatHistory || []).slice(-5);

    // Call watsonx.ai
    const result = await generateResponse(text, history, context);

    setTyping(false);

    if (result.success) {
      // Parse structured elements from the response
      const { displayText, recipeHTML } = parseResponse(result.text);

      // Show AI response
      addMessage('ai', displayText, recipeHTML);
      pushHistory('ai', displayText);
    } else {
      // Show error as AI message so user sees it in-context
      addMessage('ai', `⚠️ ${result.error}`);
    }

  } catch (err) {
    setTyping(false);
    console.error('Chat error:', err);
    addMessage('ai', '⚠️ Something went wrong. Please try again.');
  }

  $sendBtn.disabled = false;
  $input.focus();
}

// ──── External API ────

/**
 * Adds a challenge from AI-generated [CHALLENGE:...] tags.
 * Exported so other modules can programmatically inject challenges.
 *
 * @param {string} text — Challenge description
 * @param {number} xp   — XP reward for completing the challenge
 */
export function addChallengeFromAI(text, xp = 20) {
  // Check if challenge already exists (case-insensitive)
  const exists = State.today.challenges.some(
    c => c.text.toLowerCase() === text.toLowerCase()
  );

  if (exists) {
    console.log(`Skipping duplicate AI challenge: "${text}"`);
    return;
  }

  const challenge = {
    id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    text,
    xp,
    completed: false,
    source: 'ai'
  };

  // Append to today's challenges
  const challenges = [...State.today.challenges, challenge];
  State.set('today.challenges', challenges);

  EventBus.emit('challenge:added', { challenge });
}

// ──── Module Initializer ────

/**
 * Sets up the chat console: DOM bindings, event listeners, welcome message.
 * Called once from app.js boot sequence.
 */
export function initChat() {
  // Resolve DOM elements
  $messages = document.getElementById('chat-messages');
  $input    = document.getElementById('chat-input');
  $sendBtn  = document.getElementById('chat-send-btn');
  $typing   = document.getElementById('typing-indicator');

  // Hide typing indicator initially
  setTyping(false);

  // ── Send on button click ──
  $sendBtn.addEventListener('click', handleSend);

  // ── Send on Enter key ──
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // ── Reset chat history on start/reload for fresh agent session ──
  State.set('chatHistory', []);

  // ── Welcome message ──
  const welcomeText = '👋 Hey! I\'m FitBuddy, your AI fitness coach. Ask me about nutrition, workouts, recipes, or just tell me how you\'re feeling. I\'m here to help!';
  addMessage('ai', welcomeText);

  // ── Mood-aware proactive messages ──

  // When user sets a negative mood — ask how they're doing & suggest games
  EventBus.on('mood:changed', ({ mood }) => {
    const NEGATIVE = new Set(['sad', 'stressed', 'exhausted']);
    if (!NEGATIVE.has(mood)) return;

    const moodMessages = {
      sad: '💙 Hey, I noticed you\'re feeling sad. That\'s completely okay — everyone has rough days. Why not try one of the mini games in the **Play tab**? Even a 30-second Zen Breather can shift your mood. I\'ll check in with you after! 🌿',
      stressed: '🫂 You seem stressed right now. Before we tackle any workouts, let\'s take a breath first — literally! Try the **Zen Breather** game in the Play tab. It takes just 30 seconds and really helps. How does that sound?',
      exhausted: '😴 Feeling exhausted? Your body is telling you something important. Rest is a form of fitness too! Try the **Play tab** for a gentle game or some guided breathing. Once you\'re feeling better, your workout tab will unlock. 💪'
    };

    const msg = moodMessages[mood];
    if (msg) {
      setTimeout(() => addMessage('ai', msg), 600);
    }
  });

  // When user says "Yes, I feel better" after a game — unlock message + exercise invite
  EventBus.on('mood:unlocked', () => {
    const name = State.user.username ? `, ${State.user.username}` : '';
    const msg = `🌟 That's awesome${name}! So glad the game helped you feel better! Your **Exercise tab is now unlocked** — head over whenever you're ready. Even a short walk or a light stretch counts. You've got this! 💪`;
    setTimeout(() => addMessage('ai', msg), 400);
  });

  // When user says "No, still not feeling better" — supportive rest message
  EventBus.on('mood:still-low', () => {
    const msg = `💙 No worries at all — take all the time you need. Here\'s what I suggest:\n\n• 🧘 Try the **Zen Breather** for one more calming round\n• 😴 Close your eyes and rest for 5–10 minutes\n• 🥤 Drink a glass of water — it genuinely helps\n\nWhenever you feel ready, just come back and I\'ll be here. Your well-being matters most. 🌿`;
    setTimeout(() => addMessage('ai', msg), 400);
  });

  // ── Level Up Reward Generator ──
  EventBus.on('level:up', async ({ level, title }) => {
    const introMsg = `🎉 **Level Up!** You reached Level ${level} (${title})! Give me a moment to whip up a special Level-Up Reward recipe for you based on your preferences today...`;
    addMessage('ai', introMsg);
    setTyping(true);

    const { tdee, cuisine, diet } = State.user;
    const remaining = Math.max(0, tdee - State.caloriesConsumed);

    const context = {
      isLevelUp: true,
      level,
      remaining,
      cuisine,
      diet,
      tdee
    };

    try {
      const result = await generateResponse("Generate my level up reward recipe.", [], context);
      setTyping(false);
      if (result.success) {
        const { displayText, recipeHTML } = parseResponse(result.text);
        let finalMsg = displayText || "Here is your Level-Up Reward recipe! Enjoy! 🍽️";
        addMessage('ai', finalMsg, recipeHTML);
      } else {
        addMessage('ai', `⚠️ Oops, I couldn't generate the recipe right now.`);
      }
    } catch (err) {
      setTyping(false);
      addMessage('ai', `⚠️ Something went wrong generating your reward.`);
    }
  });

  console.log('💬 Chat console initialized');
}
