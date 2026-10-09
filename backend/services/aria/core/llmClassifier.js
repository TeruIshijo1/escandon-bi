'use strict';

/**
 * Clasificación de intención con LLM (Gemini / DeepSeek / OpenAI).
 * Capa de respaldo: cuando los patrones regex y la coincidencia difusa
 * no aciertan, el LLM mapea la pregunta en lenguaje natural al intent
 * correcto, dándole a MAR-IA vocabulario prácticamente ilimitado.
 */

const { providerConfig } = require('../../../utils/reportAiProviders');
const { failureDiagnostic } = require('../../../utils/reportAiDiagnostics');

/**
 * Clasifica una consulta en una de las intenciones registradas.
 * @param {string} query - Consulta del usuario (normalizada o cruda)
 * @param {Array} intents - INTENT_REGISTRY (id + patterns)
 * @returns {Promise<string|null>} id del intent o null si no clasifica / no hay LLM
 */
async function classifyWithLLM(query, intents, { onDiagnostic, fetchImpl = global.fetch } = {}) {
  const config = providerConfig();
  if (!config.key || !Array.isArray(intents) || !intents.length) return null;
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const diagnose = (error, details) => {
    const diagnostic = failureDiagnostic(config, error, details);
    console.warn('[MAR-IA] La interpretación externa no está disponible.', diagnostic);
    if (typeof onDiagnostic === 'function') onDiagnostic(diagnostic);
  };
  try {

    const res = await fetchImpl(`${config.base.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        max_tokens: 128,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      diagnose(null, { stage: 'http', httpStatus: res.status });
      return null;
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content || '';
    const intentId = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

    if (intentId === 'ninguna' || intentId === '') return null;
    return intents.some(i => i.id === intentId) ? intentId : null;
  } catch (err) {
    diagnose(err, { aborted: controller.signal.aborted });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { classifyWithLLM, get LLM_API_KEY() { return providerConfig().key; } };
