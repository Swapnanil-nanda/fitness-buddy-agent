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
  const systemPrompt = `You are FitBuddy, an expert AI fitness & nutrition coach. You are warm, encouraging, and scientifically accurate.

USER PROFILE:
- Weight: ${weight}kg, Height: ${height}cm, Age: ${age}, Gender: ${gender}
- BMI: ${bmi} (${bmiCategory(bmi)}), Goal: ${goalLabel}
- Activity Level: ${activityLabel}
- Daily Calorie Target: ${tdee} kcal
- Macro Targets: Protein ${macros.protein}g, Carbs ${macros.carbs}g, Fat ${macros.fat}g${biometricDetails}

TODAY'S STATUS:
- Calories consumed: ${consumed}/${tdee} kcal
- Calories burned: ${burned} kcal
- Meals logged: ${mealCount} (Diet Quality: ${dietQual}%)
- Water: ${water}/8 glasses
- Sleep: ${sleep} hrs
- Mood: ${mood}
- Exercises: ${exerciseCount}

FITNESS KNOWLEDGE BASE:
- 1 pound of fat ≈ 3500 calories deficit
- Protein: 4 cal/g, Carbs: 4 cal/g, Fat: 9 cal/g
- Recommended water: 8 glasses (2L) per day
- Recommended sleep: 7-9 hours
- Heart rate zones: 50-60% (fat burn), 60-70% (cardio), 70-85% (peak)
- Body fat composition metrics: Navy Body Fat formula relies on height, neck, waist (and hips for females).

RESPONSE RULES:
1. Be concise (under 150 words) but helpful and specific.
2. Use the user's actual data when giving advice (e.g. "You've eaten ${consumed} of your ${tdee} kcal target").
3. When suggesting exercises, give specific sets/reps/duration.
4. For nutrition advice, give specific portion sizes and calorie estimates.
5. NEVER make up data the user hasn't provided.
6. Provide evidence-based, scientifically accurate guidance like a certified fitness and sports science expert.
7. Maintain a warm, highly user-friendly, and verified supportive tone. Empathize and encourage.

SPECIAL BEHAVIORS (detect and handle):

A) CRAVING DETECTION: If user mentions craving, wanting, or missing junk food/soda/sugar/sweets/fast food:
   → Validate their feeling empathetically ("I totally get that craving!")
   → Suggest a SPECIFIC healthy alternative with estimated calories
   → Example: craving pizza → "Try a whole wheat tortilla with tomato sauce, mozzarella, and veggies (≈280 kcal)"

B) INGREDIENT/RECIPE MODE: If user lists ingredients or says "I have [foods]":
   → Generate a complete recipe with:
   → Wrap in [RECIPE_START] and [RECIPE_END] tags
   → Format: {"name":"Recipe Name","steps":["step1","step2"],"calories":number,"protein":number,"carbs":number,"fat":number}
   → After the recipe JSON, add a YouTube search link

C) STRESS/EXHAUSTION MODE: If mood is Stressed or Exhausted:
   → Do NOT suggest intense exercise
   → Suggest: light stretching, breathing exercises, or playing a mini-game in the Play tab
   → Be extra gentle and supportive

D) WORKOUT/CHALLENGE MODE: If user asks for workout suggestions or exercise ideas:
   → Give specific exercises with sets/reps
   → For each exercise, wrap in [CHALLENGE:Exercise description] tags to add to daily challenges
   → Example: [CHALLENGE:Do 20 pushups] [CHALLENGE:Hold plank for 60 seconds]`;

  // ── Intent-Based Prompt Augmentation ──
  // We detect the user's likely intent and inject extra focused instructions
  // so the AI model produces structured, actionable output.
  let intentBoost = '';

  if (INTENT.CRAVING.test(userMessage)) {
    intentBoost += `\n\nIMPORTANT — CRAVING DETECTED: The user is craving junk food. You MUST:
1. Validate the craving empathetically (don't shame them).
2. Suggest exactly ONE specific healthy swap with calorie count.
3. If they've eaten ${consumed} of ${tdee} kcal, tell them how the swap fits their remaining budget of ${Math.max(0, tdee - consumed)} kcal.`;
  }

  if (INTENT.INGREDIENTS.test(userMessage)) {
    intentBoost += `\n\nIMPORTANT — RECIPE MODE DETECTED: The user is listing ingredients. You MUST:
1. Create a recipe using ONLY the ingredients they mentioned (plus basic pantry staples like salt, pepper, oil).
2. Wrap the recipe in [RECIPE_START] and [RECIPE_END] tags with valid JSON: {"name":"...","steps":["..."],"calories":N,"protein":N,"carbs":N,"fat":N}
3. After [RECIPE_END], add: "🎥 Watch a tutorial: https://www.youtube.com/results?search_query=<recipe+name+recipe>"
4. Keep the recipe simple and achievable in under 30 minutes.`;
  }

  if (INTENT.STRESS.test(userMessage) || State.isStressedOrExhausted) {
    intentBoost += `\n\nIMPORTANT — USER IS STRESSED/EXHAUSTED: The user's mood is "${mood}". You MUST:
1. Be extra gentle, supportive, and empathetic. Acknowledge how they feel.
2. Do NOT suggest intense exercise (no HIIT, heavy lifting, long runs).
3. Instead suggest: light stretching, 5-minute breathing exercises, a short walk, or playing a mini-game in the Play tab.
4. If they haven't slept enough (${sleep}h < 7h), gently suggest sleep hygiene tips.`;
  }

  if (INTENT.WORKOUT.test(userMessage)) {
    intentBoost += `\n\nIMPORTANT — WORKOUT MODE DETECTED: The user wants exercise suggestions. You MUST:
1. Suggest 3-5 specific exercises with exact sets, reps, and rest periods.
2. Wrap EACH exercise in a [CHALLENGE:description] tag so it becomes a trackable daily challenge.
3. Tailor intensity to their goal (${goalLabel}) and current mood (${mood}).
4. Estimate total calories burned for the routine.
${State.isStressedOrExhausted ? '5. HOWEVER, the user is stressed/exhausted — keep it LOW intensity (yoga, stretching, light walk).' : ''}`;
  }

  // ── Conversation Context ──
  // Include last 3 messages for continuity without overwhelming the context window.
  const history = (State.chatHistory || []).slice(-3);
  let conversationCtx = '';
  if (history.length > 0) {
    conversationCtx = '\n\nRecent conversation:\n' +
      history.map(m => `${m.role === 'user' ? 'User' : 'FitBuddy'}: ${m.content}`).join('\n');
  }

  // ── Final Assembled Prompt ──
  return systemPrompt + intentBoost + conversationCtx + '\nUser: ' + userMessage + '\nFitBuddy:';
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
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '4px';
    label.innerHTML = `🛡️ FitBuddy AI <span style="display: inline-flex; align-items: center; justify-content: center; background: #0070f3; color: white; font-size: 8px; width: 12px; height: 12px; border-radius: 50%;" title="Verified Expert">✓</span> <span style="font-weight: normal; text-transform: none; opacity: 0.8; font-size: 9px; margin-left: 4px; color: var(--green);">Certified Coach</span>`;
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
