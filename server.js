/* ============================================
   FitBuddy — Local Development Proxy Server
   Run: node server.js
   Proxies /api/chat to IBM watsonx.ai
   ============================================ */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);

// ── Database lives in .data/ — outside the static-served directory.
// This folder is gitignored and never served to clients.
const DATA_DIR = path.join(__dirname, '.data');
const DB_PATH  = path.join(DATA_DIR, 'db.json');

function hashPassword(password, salt) {
  const activeSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, activeSalt, 1000, 64, 'sha512').toString('hex');
  return { salt: activeSalt, hash };
}

class JSONDatabase {
  constructor() {
    // Ensure the .data directory exists before writing
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
    }
    // Clean up verify* users on startup
    try {
      const data = this.read();
      let changed = false;
      for (const [userId, user] of Object.entries(data.users)) {
        if (user.state && user.state.user && user.state.user.username && user.state.user.username.startsWith('verify')) {
          delete data.users[userId];
          changed = true;
        }
      }
      if (changed) {
        this.write(data);
        console.log('🧹 Cleaned up verify* test users on startup.');
      }
    } catch (e) { /* ignore */ }
  }

  read() {
    try {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return { users: {} };
    }
  }

  write(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  }

  findByUsername(username) {
    const db = this.read();
    const lower = username.toLowerCase();
    for (const user of Object.values(db.users)) {
      if (user.state && user.state.user && user.state.user.username && user.state.user.username.toLowerCase() === lower) {
        return user;
      }
    }
    return null;
  }

  findByUsernameOrEmail(usernameOrEmail) {
    const db = this.read();
    const query = usernameOrEmail.toLowerCase();
    for (const user of Object.values(db.users)) {
      if (user.state && user.state.user) {
        const uName = (user.state.user.username || '').toLowerCase();
        const uEmail = (user.state.user.email || '').toLowerCase();
        if (uName === query || uEmail === query) {
          return user;
        }
      }
    }
    return null;
  }

  findByUserId(userId) {
    const db = this.read();
    return db.users[userId] || null;
  }

  findByGoogleId(googleId) {
    const db = this.read();
    for (const user of Object.values(db.users)) {
      if (user.googleId === googleId) {
        return user;
      }
    }
    return null;
  }

  onboardUser(username, password, state) {
    const db = this.read();
    const existing = this.findByUsername(username);

    if (existing) {
      if (existing.hash) {
        if (!password) throw new Error('Password required for existing account');
        const { hash } = hashPassword(password, existing.salt);
        if (hash !== existing.hash) {
          throw new Error('Incorrect password for this username');
        }
      }
      return { exists: true, state: existing.state };
    }

    // Check if email is already taken by someone else
    if (state.user.email) {
      const emailTaken = this.findByUsernameOrEmail(state.user.email);
      if (emailTaken) {
        throw new Error('Email address is already in use by another account');
      }
    }

    const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
    const { salt, hash } = hashPassword(password);
    
    // Inject IDs
    state.user.userId = userId;
    state.user.username = username;

    db.users[userId] = {
      userId,
      salt,
      hash,
      state
    };
    this.write(db);
    return { exists: false, state };
  }

  updateUser(userId, username, password, newPassword, state) {
    const db = this.read();
    const user = db.users[userId];
    if (!user) {
      throw new Error('User not found');
    }

    if (user.hash) {
      if (!password) throw new Error('Password required to verify updates');
      const { hash } = hashPassword(password, user.salt);
      if (hash !== user.hash) {
        throw new Error('Incorrect password');
      }
    }

    if (username && user.state.user.username.toLowerCase() !== username.toLowerCase()) {
      const taken = this.findByUsername(username);
      if (taken && taken.userId !== userId) {
        throw new Error('Username already taken by another user');
      }
      state.user.username = username;
    }

    let salt = user.salt;
    let hash = user.hash;
    if (newPassword) {
      const cryptoPack = hashPassword(newPassword);
      salt = cryptoPack.salt;
      hash = cryptoPack.hash;
    }

    db.users[userId] = {
      userId,
      salt,
      hash,
      state
    };
    this.write(db);
    return state;
  }

  resetPasswordWithCode(userId, newPassword) {
    const db = this.read();
    const user = db.users[userId];
    if (!user) {
      throw new Error('User not found');
    }

    const cryptoPack = hashPassword(newPassword);
    user.salt = cryptoPack.salt;
    user.hash = cryptoPack.hash;

    this.write(db);
    return user.state;
  }

  onboardGoogleUser(googleId, email, name) {
    const db = this.read();
    
    // Check if googleId already exists
    let existing = this.findByGoogleId(googleId);
    if (existing) {
      return existing.state;
    }

    // Check if email already exists for standard user
    existing = this.findByUsernameOrEmail(email);
    if (existing) {
      // Link Google Account
      existing.googleId = googleId;
      this.write(db);
      return existing.state;
    }

    // Register a new user
    const userId = 'usr_' + crypto.randomBytes(8).toString('hex');
    const { salt, hash } = hashPassword('google-auth-placeholder-' + crypto.randomBytes(4).toString('hex'));
    
    const state = {
      user: {
        username: name,
        email: email,
        weight: 70,
        height: 175,
        age: 25,
        gender: 'male',
        bmi: 22.9,
        goal: 'maintain',
        tdee: 2000,
        macros: { protein: 150, carbs: 200, fat: 67 },
        cuisine: 'any',
        diet: 'no-restriction',
        userId: userId
      },
      today: {
        date: new Date().toISOString().split('T')[0],
        meals: [],
        exercises: [],
        water: 0,
        sleep: 7,
        mood: 'neutral',
        xpEarned: 0,
        challenges: []
      },
      xp: {
        current: 0,
        level: 1,
        total: 0
      },
      settings: {
        mode: 'proxy'
      },
      chatHistory: [],
      onboarded: false
    };

    db.users[userId] = {
      userId,
      googleId,
      salt,
      hash,
      state
    };
    this.write(db);
    return state;
  }
}

const db = new JSONDatabase();

let cachedToken = null;
let tokenExpiry = 0;

// Read env from .env file if it exists
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...rest] = trimmed.split('=');
          process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    }
  } catch (e) { /* ignore */ }
}

loadEnv();

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

// ── Internal DB token — generated once at startup, stored in memory only.
// The frontend receives it via /api/db-token (localhost only).
// All /api/user-data calls must include it in the X-DB-Token header.
const DB_TOKEN = require('crypto').randomBytes(32).toString('hex');

// Combined Static Asset & API HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.replace(/\/$/, '');

  // ──── 1. API Route Requests ────
  if (pathname.startsWith('/api')) {
    // CORS
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DB-Token');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // ── Token handshake endpoint ──
    if (req.method === 'GET' && pathname === '/api/db-token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: DB_TOKEN }));
      return;
    }

    // ── Token guard for all /api/user-data calls ──
    function isValidToken(request) {
      return request.headers['x-db-token'] === DB_TOKEN;
    }

    // ── Database Routes ──
    if (req.method === 'GET' && pathname === '/api/user-data') {
      if (!isValidToken(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const username = parsedUrl.searchParams.get('username');
      if (!username) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Username is required' }));
        return;
      }
      const password = req.headers['x-user-password'];

      const userRecord = db.findByUsername(username);
      if (!userRecord) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, exists: false, data: null }));
        return;
      }

      try {
        if (userRecord.hash) {
          if (!password) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Password required' }));
            return;
          }
          const { hash } = hashPassword(password, userRecord.salt);
          if (hash !== userRecord.hash) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Incorrect password for this username' }));
            return;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, exists: true, data: userRecord.state }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/user-data') {
      if (!isValidToken(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > 65536) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large (64 KB limit)' }));
          req.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        try {
          const { username, password, newPassword, state } = JSON.parse(body);
          if (!username) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Username is required' }));
            return;
          }
          if (!state || !state.user) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Valid state object is required' }));
            return;
          }

          const userId = state.user.userId;
          let resultState;
          let exists = false;

          if (userId) {
            resultState = db.updateUser(userId, username, password, newPassword, state);
            exists = true;
          } else {
            const onboardResult = db.onboardUser(username, password, state);
            resultState = onboardResult.state;
            exists = onboardResult.exists;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, exists, state: resultState }));
        } catch (err) {
          const status = err.message.toLowerCase().includes('password') || err.message.toLowerCase().includes('taken') ? 401 : 500;
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      let body = '';
      let tooLarge = false;
      req.on('data', chunk => {
        if (tooLarge) return;
        body += chunk;
        if (body.length > 65536) {
          tooLarge = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large (64 KB limit)' }));
          req.destroy();
        }
      });
      req.on('end', async () => {
        if (tooLarge) return;
        try {
          const { message, history, context, max_tokens = 400 } = JSON.parse(body);
          if (!message) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Message is required' }));
            return;
          }

          const prompt = compileServerPrompt(message, history, context);
          const apiKey = process.env.IBM_API_KEY;
          const projectId = process.env.IBM_PROJECT_ID;
          const region = process.env.IBM_REGION || 'us-south';

          if (!apiKey || !projectId) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Set IBM_API_KEY and IBM_PROJECT_ID in .env file' }));
            return;
          }

          const token = await getIAMToken(apiKey);
          const wxRes = await httpsRequest(
            `https://${region}.ml.cloud.ibm.com/ml/v1/text/generation?version=2025-02-06`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
              }
            },
            JSON.stringify({
              model_id: process.env.IBM_MODEL_ID || 'ibm/granite-3-8b-instruct',
              input: prompt,
              project_id: projectId,
              parameters: {
                decoding_method: 'greedy',
                max_new_tokens: max_tokens,
                temperature: 0.7,
                top_p: 0.9,
                repetition_penalty: 1.1,
                stop_sequences: ['<|eot_id|>', '<|start_header_id|>', '\nUser:', '\nHuman:', '\n\n\n']
              }
            })
          );

          if (!wxRes.ok) {
            console.error('watsonx error:', wxRes.status, wxRes.body);
            res.writeHead(wxRes.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `watsonx.ai error: ${wxRes.status}` }));
            return;
          }

          const data = JSON.parse(wxRes.body);
          const generatedText = data.results?.[0]?.generated_text || '';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ generated_text: generatedText.trim() }));

        } catch (err) {
          console.error('Proxy error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
    return;
  }

  // ──── 2. Static Assets File Serving ────
  const requestPath = parsedUrl.pathname === '/' ? 'index.html' : decodeURIComponent(parsedUrl.pathname);

  // Security: block access to sensitive paths
  const normalized = requestPath.replace(/\\/g, '/').toLowerCase();
  const BLOCKED = ['.data', 'db.json', '.env', '.gitignore', 'server.js'];
  const isBlocked = BLOCKED.some(b => normalized.includes(b));
  if (isBlocked) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  let filePath = path.join(__dirname, requestPath);

  // Security: prevent path traversal outside __dirname
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA fallback
        fs.readFile(path.join(__dirname, 'index.html'), (e, c) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(c);
        });
      } else {
        res.writeHead(500);
        res.end('Server error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// Static File Server MIME Types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

server.listen(PORT, () => {
  console.log(`🏋️ FitBuddy running at http://localhost:${PORT}`);
  console.log(`\n📝 Set IBM credentials in .env file:\n   IBM_API_KEY=your_key\n   IBM_PROJECT_ID=your_project_id\n   IBM_REGION=us-south\n`);
});
