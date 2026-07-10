const crypto = require('crypto');
const https = require('https');

let cachedToken = null;
let tokenExpiry = 0;

function hashPassword(password, salt) {
  const activeSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, activeSalt, 1000, 64, 'sha512').toString('hex');
  return { salt: activeSalt, hash };
}

function httpsRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'POST',
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function getIAMToken(apiKey) {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

  const res = await httpsRequest('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${apiKey}`);

  if (!res.ok) throw new Error(`IAM token failed: ${res.status}`);
  const data = JSON.parse(res.body);
  cachedToken = data.access_token;
  tokenExpiry = now + 50 * 60 * 1000;
  return cachedToken;
}

function compileServerPrompt(userMessage, history = [], context = {}) {
  if (context.isLevelUp) {
    const { level = 2, remaining = 1000, cuisine = 'any', diet = 'no-restriction', tdee = 2000 } = context;
    
    const cuisineHint = {
      any: 'any cuisine the user would enjoy',
      indian: 'Indian cuisine (e.g. biryani, paneer, dal makhani, kheer)',
      mediterranean: 'Mediterranean cuisine (e.g. falafel, hummus, kebab, baklava)',
      'east-asian': 'East Asian cuisine (e.g. ramen, sushi, bibimbap, dim sum)',
      'southeast-asian': 'Southeast Asian cuisine (e.g. pad thai, pho, nasi goreng)',
      'middle-eastern': 'Middle Eastern cuisine (e.g. shawarma, mansaf, kunafa)',
      mexican: 'Mexican cuisine (e.g. tacos, enchiladas, churros)',
      american: 'American / Western cuisine (e.g. burger, mac and cheese, pancakes)',
      african: 'African cuisine (e.g. jollof rice, suya, injera with stew)',
      european: 'European cuisine (e.g. pasta, pizza, crepes, schnitzel)'
    }[cuisine] || 'any cuisine the user would enjoy';

    const dietRule = {
      'no-restriction': 'The user eats everything — meat, dairy, eggs are all fine.',
      vegetarian: 'The user is VEGETARIAN. Do NOT include any meat, poultry, or seafood.',
      vegan: 'The user is VEGAN. Do NOT include any animal products (no meat, dairy, eggs, honey).',
      eggetarian: 'The user is EGGETARIAN — vegetarian but eggs are allowed. No meat or seafood.',
      pescatarian: 'The user is PESCATARIAN — fish and seafood are allowed, but no other meat.',
      keto: 'The user is on KETO — keep net carbs under 15g. High fat, moderate protein.',
      'gluten-free': 'The user is GLUTEN-FREE. No wheat, barley, or rye.',
      'dairy-free': 'The user is DAIRY-FREE. No milk, cheese, butter, or cream.',
      halal: 'The user eats HALAL — no pork, no alcohol in cooking.',
      kosher: 'The user eats KOSHER — no pork, no shellfish, no mixing meat and dairy.'
    }[diet] || 'The user eats everything.';

    const systemPrompt = `You are FitBuddy AI. The user just reached Level ${level} — celebrate them warmly!

USER FOOD CONTEXT:
- Preferred cuisine: ${cuisineHint}
- Diet rule: ${dietRule}
- Remaining calories today: ~${remaining} kcal (daily target: ${tdee} kcal)

YOUR TASK:
1. Write 2-3 short, warm, personal sentences congratulating them.
2. Then suggest ONE satisfying but relatively healthy treat/cheat meal from their preferred cuisine that fits within their remaining calories and strictly follows their diet rule.
3. Keep the recipe SIMPLE — 2 to 4 steps maximum. Real everyday ingredients.
4. Provide accurate macros (use real-world nutritional data, not guesses).

STRICT RULES:
- NEVER suggest a dish that violates the diet rule above.
- Keep the total calorie count realistic and close to the remaining calories.
- Never show raw JSON, backticks, or code outside of the [RECIPE_START]...[RECIPE_END] block.
- Write warm, human words everywhere else.

At the very end, output the recipe card in this exact format:
[RECIPE_START]
{"name":"Dish Name","steps":["Step 1","Step 2","Step 3"],"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number}
[RECIPE_END]`;

    return `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>\n<|start_header_id|>user<|end_header_id|>\n\nGenerate my level up reward recipe.<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n\n`;
  }

  const {
    weight = 70, height = 175, age = 25, gender = 'male',
    bmi = 22.9, goalLabel = 'Maintain Weight', activityLabel = 'Lightly Active',
    tdee = 2000, macros = { protein: 150, carbs: 200, fat: 67 },
    biometricDetails = '', cuisineLabel = 'Any / No preference',
    dietLabel = 'No restriction (everything)', recentMealNames = 'none logged today',
    consumed = 0, burned = 0, mealCount = 0, dietQual = 100,
    water = 0, sleep = 7, mood = 'neutral', exerciseCount = 0
  } = context;

  const systemPrompt = `You are FitBuddy, a helpful and accurate AI fitness and nutrition coach. Answer the user's questions directly and accurately.

USER PROFILE:
- Weight: ${weight}kg, Height: ${height}cm, Age: ${age}, Gender: ${gender}
- BMI: ${bmi}, Goal: ${goalLabel}
- Activity Level: ${activityLabel}
- Daily Calorie Target: ${tdee} kcal
- Macro Targets: Protein ${macros.protein}g, Carbs ${macros.carbs}g, Fat ${macros.fat}g${biometricDetails}

FOOD PREFERENCES (CRITICAL — always respect these):
- Preferred Cuisine: ${cuisineLabel}
- Diet Type: ${dietLabel}
- Recent meals logged today: ${recentMealNames}

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
2. Be concise, empathetic, and friendly. Keep responses under 150 words.
3. NEVER generate raw JSON payloads, developer backticks, code blocks, or HTML formatting. Your response MUST be plain, warm, human conversational text.
4. Do not repeat the prompt. Do not simulate future dialog. Stop generating when your response is complete.
5. CRITICAL NUTRITION ACCURACY: When providing recipes, calories, or macros, YOU MUST BE FACTUALLY CORRECT. Use USDA data for Western foods, IFCT for Indian foods, and authoritative sources for other cuisines. Never hallucinate macros. Always cite realistic calorie ranges.
6. YOUTUBE LINKS: When providing a YouTube link, you MUST format it as a markdown link with a descriptive name, e.g., [Watch 10 Min Workout](https://youtube.com/...). Do not output raw URLs.
7. FOOD PREFERENCE ENFORCEMENT: You MUST tailor ALL food suggestions, recipes, and meal ideas to the user's preferred cuisine and diet type above. If they are vegetarian, NEVER suggest meat. If they prefer Indian food, suggest Indian dishes. If they ask about a different ethnic cuisine (e.g. Korean, Mexican, Italian), enthusiastically provide authentic dishes from that cuisine with accurate nutritional info — you may also draw a connection to their usual cuisine if it helps (e.g. "This is similar to a dal in terms of protein!").

SPECIAL BEHAVIORS (detect and handle):

A) CRAVING DETECTION: If user mentions craving junk food:
   → Suggest a SPECIFIC healthy alternative that fits their cuisine preference and diet type, with estimated calories.
B) INGREDIENT/RECIPE MODE: If user lists ingredients:
   → Generate a simple recipe aligned to their cuisine preference. Wrap in [RECIPE_START] and [RECIPE_END] with valid JSON: {"name":"Recipe Name","steps":["step1","step2"],"calories":number,"protein":number,"carbs":number,"fat":number,"fiber":number}. Macros MUST be accurate. ONLY JSON inside the brackets; rest of reply must be conversational.
C) STRESS/EXHAUSTION/SAD MODE: If mood is sad, stressed, or exhausted:
   → Do NOT suggest heavy exercise. Instead ask warmly how they're coping, then suggest the Play tab (mini games or Zen Breather). Tell them their workout tab will unlock once they feel better.
   → If they tell you they played a game and feel better now, respond enthusiastically, confirm their Exercise tab is unlocked, and suggest a gentle first workout that fits their cuisine/diet context.
   → If they say they still don't feel better, give a warm supportive message: suggest rest, a glass of water, or another game. Never pressure them to exercise.
D) WORKOUT/CHALLENGE MODE: If user asks for workouts or exercise suggestions:
   → First ask them what type of exercise they prefer (e.g. cardio, strength, yoga, home workout).
   → Once they specify, suggest exactly ONE proper exercise with sets/reps or duration, and wrap it in a [CHALLENGE:Exercise name] tag.
E) ETHNIC / UNFAMILIAR CUISINE QUESTIONS: If user asks about foods from any culture or cuisine (e.g. "what is pho?", "is bibimbap healthy?", "explain injera"):
   → Answer enthusiastically with the dish's origin, key ingredients, and accurate macros/calories. Always respect the user's diet restrictions in any suggestions.`;

  let prompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|>\n`;

  (history || []).forEach(msg => {
    const roleId = msg.role === 'user' ? 'user' : 'assistant';
    prompt += `<|start_header_id|>${roleId}<|end_header_id|>\n\n${msg.content}<|eot_id|>\n`;
  });

  prompt += `<|start_header_id|>user<|end_header_id|>\n\n${userMessage}<|eot_id|>\n<|start_header_id|>assistant<|end_header_id|>\n\n`;

  return prompt;
}

module.exports = {
  hashPassword,
  getIAMToken,
  compileServerPrompt
};
