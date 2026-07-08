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
function compilePrompt(userMessage) {
  const { weight, height, age, gender, bmi, goal, tdee, macros, bodyFat, neck, waist, hip, activity } = State.user;
  const { meals, exercises, water, sleep, mood } = State.today;
  const consumed  = State.caloriesConsumed;
  const burned    = State.caloriesBurned;
  const dietQual  = State.dietQuality;
  const mealCount = meals.length;
  const exerciseCount = exercises.length;

  // Goal label for readability
  const goalLabel = { loss: 'Weight Loss', maintain: 'Maintain Weight', gain: 'Muscle Gain' }[goal] || goal;
  const activityLabel = {
    sedentary: 'Sedentary (little to no exercise)',
    lightly: 'Lightly Active (light exercise 1-3 days/week)',
    moderately: 'Moderately Active (moderate exercise 3-5 days/week)',
    very: 'Very Active (hard exercise 6-7 days/week)',
    extra: 'Extra Active (very hard exercise/physical job)'
  }[activity] || activity || 'Lightly Active';

  let biometricDetails = '';
  if (bodyFat > 0) biometricDetails += `\n- Body Fat: ${bodyFat}%`;
  if (neck > 0) biometricDetails += `\n- Neck Size: ${neck}cm`;
  if (waist > 0) biometricDetails += `\n- Waist Size: ${waist}cm`;
  if (hip > 0) biometricDetails += `\n- Hip Size: ${hip}cm`;

  // ── Core System Prompt ──
  const systemPrompt = `You are FitBuddy, a helpful and accurate AI fitness and nutrition coach. Answer the user's questions directly and accurately.

USER PROFILE:
- Weight: ${weight}kg, Height: ${height}cm, Age: ${age}, Gender: ${gender}
- BMI: ${bmi} (${bmiCategory(bmi)}), Goal: ${goalLabel}
- Activity Level: ${activityLabel}
- Daily Calorie Target: ${tdee} kcal
- Macro Targets: Protein ${macros.protein}g, Carbs ${macros.carbs}g, Fat ${macros.fat}g${biometricDetails}

TODAY'S PROGRESS:
- Calories consumed: ${consumed}/${tdee} kcal
- Calories burned: ${burned} kcal
- Meals logged: ${mealCount} (Diet Quality: ${dietQual}%)
- Water: ${water}/8 glasses
- Sleep: ${sleep} hrs
- Mood: ${mood}
- Exercises: ${exerciseCount}

RESPONSE RULES:
1. Answer the user's question directly. Do not output anything irrelevant.
2. Be concise and friendly. Keep responses under 150 words.
3. If the user asks about workouts or nutrition, give specific suggestions.
4. Do not simulate future dialog. Stop generating when your response is complete.

SPECIAL BEHAVIORS (detect and handle):

A) CRAVING DETECTION: If user mentions craving junk food:
   → Suggest a SPECIFIC healthy alternative with estimated calories.
B) INGREDIENT/RECIPE MODE: If user lists ingredients:
   → Generate a simple recipe. Wrap in [RECIPE_START] and [RECIPE_END] with valid JSON format: {"name":"Recipe Name","steps":["step1","step2"],"calories":number,"protein":number,"carbs":number,"fat":number}
C) STRESS/EXHAUSTION MODE: If mood is Stressed or Exhausted:
   → Recommend light stretching, deep breathing, or games in the Play tab instead of heavy workouts.
D) WORKOUT/CHALLENGE MODE: If user asks for workouts:
   → Suggest specific exercises. Wrap each exercise in a [CHALLENGE:Exercise name] tag to track it.`;

  // ── Compile Prompt using Chat Template format to prevent model hallucinations/run-on conversation ──
  let prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>\n`;

  // Add conversation history
  const history = (State.chatHistory || []).slice(-3);
  history.forEach(msg => {
    const roleId = msg.role === 'user' ? 'user' : 'assistant';
    prompt += `<|start_header_id|>${roleId}<|end_header_id|>\n\n${msg.content}<|eot_id|>\n`;
  });

  // Add the current user query
  prompt += `<|start_header_id|>user<|end_header_id|>\n\n${userMessage}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n\n`;

  return prompt;
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
    showToast(`${challengeCount} challenge${challengeCount > 1 ? 's' : ''} added!`, '🎯');
  }

  // ── 2. Extract Recipes ──
  const recipeRegex = /\[RECIPE_START\]([\s\S]*?)\[RECIPE_END\]/gi;
  let recipeMatch;
  while ((recipeMatch = recipeRegex.exec(text)) !== null) {
    const rawJSON = recipeMatch[1].trim();
    try {
      const recipe = JSON.parse(rawJSON);
      recipeHTML += renderRecipeCard(recipe);
    } catch (e) {
      // If JSON is malformed, show raw text in a code block as fallback
      console.warn('Failed to parse recipe JSON:', e);
      recipeHTML += `<div class="recipe-card"><pre style="white-space:pre-wrap">${escapeHTML(rawJSON)}</pre></div>`;
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
  const { name = 'Recipe', steps = [], calories = 0, protein = 0, carbs = 0, fat = 0 } = recipe;
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

  // Render text content with basic line-break support
  const textNode = document.createElement('div');
  textNode.innerHTML = escapeHTML(content).replace(/\n/g, '<br>');
  bubble.appendChild(textNode);

  // Append extra HTML (recipe cards, etc.) if present
  if (extra) {
    const extraContainer = document.createElement('div');
    extraContainer.innerHTML = extra;
    bubble.appendChild(extraContainer);
  }

  wrapper.appendChild(bubble);
  $messages.appendChild(wrapper);

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
    // Compile the full prompt with user context + intent augmentation
    const fullPrompt = compilePrompt(text);

    // Call watsonx.ai
    const result = await generateResponse(fullPrompt);

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

  // ── Send on Enter key (Shift+Enter for newline in future textarea upgrade) ──
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

  console.log('💬 Chat console initialized');
}
