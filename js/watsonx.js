/* ============================================
   FitBuddy — IBM watsonx.ai API Client
   ============================================
   Supports three connection modes:
   - 'proxy'  → Vercel serverless proxy at /api/chat
   - 'local'  → Local dev proxy at localhost:3001
   - 'direct' → Two-step IAM auth + watsonx.ai REST API
   ============================================ */

import { State } from './app.js';

// ──── IAM Token Cache ────
// Direct mode requires a fresh IBM Cloud IAM bearer token.
// Tokens are valid for 60 min; we cache for 50 min to stay safe.
let _cachedToken = null;
let _tokenExpiry = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; // 50 minutes

// ──── Constants ────
const TIMEOUT_MS = 15_000; // 15-second hard timeout on every fetch
const WATSONX_API_VERSION = '2025-02-06';
const MODEL_ID = 'meta-llama/llama-3-3-70b-instruct';

// ──── Helpers ────

/**
 * Creates an AbortController that auto-aborts after TIMEOUT_MS.
 * Returns { signal, clear } — call clear() on success to avoid leaks.
 */
function createTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

/**
 * Wraps a successful result.
 */
function ok(text) {
  return { success: true, text: text.trim() };
}

/**
 * Wraps an error result with a human-readable message.
 */
function fail(message) {
  return { success: false, error: message };
}

// ──── IAM Token Acquisition (direct mode) ────

/**
 * Fetches (or returns cached) IAM bearer token from IBM Cloud.
 * POST https://iam.cloud.ibm.com/identity/token
 * Body: grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey={key}
 */
async function getIAMToken(apiKey) {
  // Return cached token if still valid
  if (_cachedToken && Date.now() < _tokenExpiry) {
    return _cachedToken;
  }

  const { signal, clear } = createTimeout();

  try {
    const response = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${encodeURIComponent(apiKey)}`,
      signal
    });

    clear();

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`IAM auth failed (${response.status}): ${errBody || response.statusText}`);
    }

    const data = await response.json();
    _cachedToken = data.access_token;
    _tokenExpiry = Date.now() + TOKEN_TTL_MS;
    return _cachedToken;

  } catch (err) {
    clear();
    if (err.name === 'AbortError') {
      throw new Error('IAM token request timed out after 15 seconds. Check your network connection.');
    }
    throw err;
  }
}

// ──── Mode Handlers ────

/**
 * Proxy / Local mode — simple POST with { prompt, max_tokens }.
 */
async function callProxyOrLocal(endpoint, prompt, maxTokens) {
  const { signal, clear } = createTimeout();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, max_tokens: maxTokens }),
      signal
    });

    clear();

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Proxy error (${response.status}): ${errBody || response.statusText}`);
    }

    const data = await response.json();
    const text = data.generated_text;

    if (!text) {
      throw new Error('No generated_text in proxy response.');
    }

    return ok(text);

  } catch (err) {
    clear();
    if (err.name === 'AbortError') {
      return fail('Request timed out after 15 seconds. The AI server may be busy — try again.');
    }
    return fail(err.message);
  }
}

/**
 * Direct mode — two-step: IAM auth → watsonx.ai text generation.
 */
async function callDirect(apiKey, projectId, region, prompt, maxTokens) {
  // Step 1: Obtain IAM bearer token
  let token;
  try {
    token = await getIAMToken(apiKey);
  } catch (err) {
    return fail(`Authentication failed: ${err.message}`);
  }

  // Step 2: Call watsonx.ai text generation endpoint
  const url = `https://${region}.ml.cloud.ibm.com/ml/v1/text/generation?version=${WATSONX_API_VERSION}`;

  const payload = {
    model_id: MODEL_ID,
    input: prompt,
    project_id: projectId,
    parameters: {
      decoding_method: 'greedy',
      max_new_tokens: maxTokens,
      temperature: 0.7,
      top_p: 0.9,
      repetition_penalty: 1.1
    }
  };

  const { signal, clear } = createTimeout();

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal
    });

    clear();

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      // If 401, invalidate cached token so next call re-authenticates
      if (response.status === 401) {
        _cachedToken = null;
        _tokenExpiry = 0;
      }
      throw new Error(`watsonx.ai error (${response.status}): ${errBody || response.statusText}`);
    }

    const data = await response.json();
    const text = data?.results?.[0]?.generated_text;

    if (!text) {
      throw new Error('No generated_text in watsonx.ai response. The model may have returned an empty result.');
    }

    return ok(text);

  } catch (err) {
    clear();
    if (err.name === 'AbortError') {
      return fail('Request timed out after 15 seconds. The watsonx.ai server may be under heavy load.');
    }
    return fail(err.message);
  }
}

// ──── Public API ────

/**
 * Generate a text response from IBM watsonx.ai (Granite model).
 *
 * Reads connection settings from State.settings:
 *   - mode: 'proxy' | 'local' | 'direct'
 *   - apiKey, projectId, region (used only in direct mode)
 *
 * @param {string} prompt      — Full prompt string (system + user context)
 * @param {number} maxTokens   — Maximum tokens to generate (default 400)
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export async function generateResponse(prompt, maxTokens = 400) {
  const isLocal = window.location.port === '3000' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const endpoint = isLocal ? 'http://localhost:3001/api/chat' : '/api/chat';
  
  return callProxyOrLocal(endpoint, prompt, maxTokens);
}

/**
 * No-op initializer for module consistency.
 * Every FitBuddy module exports an init function.
 */
export function initWatsonx() {
  // Nothing to initialize — watsonx is a stateless API client.
  // Token cache and settings are read on demand.
  console.log('🔗 watsonx.ai client ready');
}
