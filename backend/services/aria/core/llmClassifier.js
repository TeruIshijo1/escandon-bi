'use strict';

/**
 * Clasificación de intención con LLM (Gemini / DeepSeek / OpenAI).
 * Capa de respaldo: cuando los patrones regex y la coincidencia difusa
 * no aciertan, el LLM mapea la pregunta en lenguaje natural al intent
 * correcto, dándole a MAR-IA vocabulario prácticamente ilimitado.
 */

const LLM_API_KEY = process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
const LLM_MODEL = process.env.GEMINI_MODEL || process.env.DEEPSEEK_MODEL || process.env.OPENAI_MODEL ||
  (process.env.GEMINI_API_KEY ? 'gemini-2.0-flash' : (process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'gpt-4o'));
const LLM_BASE = process.env.LLM_BASE_URL ||
  (process.env.GEMINI_API_KEY ? 'https://generativelanguage.googleapis.com/v1beta/openai' :
  (process.env.DEEPSEEK_API_KEY ? 'https://api.deepseek.com' :
  (process.env.AZURE_OPENAI_ENDPOINT || 'https://api.openai.com/v1')));

/**
 * Clasifica una consulta en una de las intenciones registradas.
 * @param {string} query - Consulta del usuario (normalizada o cruda)
 * @param {Array} intents - INTENT_REGISTRY (id + patterns)
 * @returns {Promise<string|null>} id del intent o null si no clasifica / no hay LLM
 */
async function classifyWithLLM(query, intents) {
  if (!LLM_API_KEY) return null;
  if (!query || query.trim().length < 4) return null;

  const intentList = intents
    .map(i => `- ${i.id}: patrones relacionados: ${(i.patterns || []).map(p => p.source).join(', ')}`)
    .join('\n');

  const systemPrompt = `Eres el clasificador de intenciones de MAR-IA, el asistente de un hospital.
Clasifica la pregunta del usuario en UNA de las intenciones disponibles.
Responde SOLO con el id exacto de la intención, sin puntos ni comillas.
Si la pregunta no corresponde a ninguna intención, responde NINGUNA.

Intenciones disponibles:
${intentList}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`${LLM_BASE.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        max_tokens: 30,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[MAR-IA LLM] Clasificación falló (HTTP ${res.status}). Usando fallback sin LLM.`);
      return null;
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    const intentId = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

    if (intentId === 'ninguna' || intentId === '') return null;
    return intents.some(i => i.id === intentId) ? intentId : null;
  } catch (err) {
    console.warn('[MAR-IA LLM] No se pudo clasificar con LLM:', err.message);
    return null;
  }
}

module.exports = { classifyWithLLM, LLM_API_KEY };