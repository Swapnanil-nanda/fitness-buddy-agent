// Vercel Serverless Function — IBM watsonx.ai Proxy
// Handles IAM token exchange and model inference

let cachedToken = null;
let tokenExpiry = 0;

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, max_tokens = 400 } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const apiKey = process.env.IBM_API_KEY;
    const projectId = process.env.IBM_PROJECT_ID;
    const region = process.env.IBM_REGION || 'us-south';

    if (!apiKey || !projectId) {
      return res.status(500).json({
        error: 'IBM Cloud credentials not configured. Set IBM_API_KEY and IBM_PROJECT_ID environment variables.'
      });
    }

    // Step 1: Get/refresh IAM token
    const token = await getIAMToken(apiKey);

    // Step 2: Call watsonx.ai
    const response = await fetch(
      `https://${region}.ml.cloud.ibm.com/ml/v1/text/generation?version=2025-02-06`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model_id: 'meta-llama/llama-3-3-70b-instruct',
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
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('watsonx.ai error:', response.status, errorBody);
      return res.status(response.status).json({
        error: `watsonx.ai API error: ${response.status}`,
        details: errorBody
      });
    }

    const data = await response.json();
    const generatedText = data.results?.[0]?.generated_text || '';

    return res.status(200).json({
      generated_text: generatedText.trim(),
      token_count: data.results?.[0]?.generated_token_count || 0
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function getIAMToken(apiKey) {
  const now = Date.now();

  // Return cached token if still valid (50 min buffer, tokens last 60 min)
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  const response = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${apiKey}`
  });

  if (!response.ok) {
    throw new Error(`IAM token exchange failed: ${response.status}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = now + 50 * 60 * 1000; // Cache for 50 minutes

  return cachedToken;
}
