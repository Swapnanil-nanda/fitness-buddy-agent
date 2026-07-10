

import { State, getApiBaseUrl } from './app.js';




let _cachedToken = null;
let _tokenExpiry = 0;
const TOKEN_TTL_MS = 50 * 60 * 1000; 


const TIMEOUT_MS = 15_000; 
const WATSONX_API_VERSION = '2025-02-06';
const MODEL_ID = 'meta-llama/llama-3-3-70b-instruct';




function createTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}


function ok(text) {
  return { success: true, text: text.trim() };
}


function fail(message) {
  return { success: false, error: message };
}




async function getIAMToken(apiKey) {
  
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




async function callProxyOrLocal(endpoint, message, history, context, maxTokens) {
  const { signal, clear } = createTimeout();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, context, max_tokens: maxTokens }),
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


async function callDirect(apiKey, projectId, region, prompt, maxTokens) {
  
  let token;
  try {
    token = await getIAMToken(apiKey);
  } catch (err) {
    return fail(`Authentication failed: ${err.message}`);
  }

  
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




export async function generateResponse(message, history = [], context = {}, maxTokens = 400) {
  const endpoint = `${getApiBaseUrl()}/api/chat`;
  
  return callProxyOrLocal(endpoint, message, history, context, maxTokens);
}


export function initWatsonx() {
  
  
  console.log('🔗 watsonx.ai client ready');
}
