


const { compileServerPrompt, getIAMToken } = require('./_lib');

module.exports = async function handler(req, res) {
  
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, history, context, max_tokens = 400 } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const apiKey = process.env.IBM_API_KEY;
    const projectId = process.env.IBM_PROJECT_ID;
    const region = process.env.IBM_REGION || 'us-south';
    const modelId = process.env.IBM_MODEL_ID || 'ibm/granite-3-8b-instruct';

    if (!apiKey || !projectId) {
      console.log('💡 Missing watsonx credentials — sending fallback response.');
      return res.status(200).json({
        generated_text: '[IBM watsonx.ai Fallback] Please configure IBM_API_KEY and IBM_PROJECT_ID in your Vercel environment variables to enable live AI coaching replies!'
      });
    }

    
    const prompt = compileServerPrompt(message, history, context);

    
    const token = await getIAMToken(apiKey);

    
    const wxRes = await fetch(
      `https://${region}.ml.cloud.ibm.com/ml/v1/text/generation?version=2025-02-06`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          model_id: modelId,
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

    if (!wxRes.ok) {
      const errorBody = await wxRes.text();
      console.error('watsonx.ai error:', wxRes.status, errorBody);
      return res.status(wxRes.status).json({
        error: `watsonx.ai API error: ${wxRes.status}`,
        details: errorBody
      });
    }

    const data = await wxRes.json();
    const generatedText = data.results?.[0]?.generated_text || '';

    return res.status(200).json({
      generated_text: generatedText.trim(),
      token_count: data.results?.[0]?.generated_token_count || 0
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
