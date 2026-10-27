'use strict';

const { providerConfig, configuredGeminiBackups } = require('../../../utils/reportAiProviders');
const { failureDiagnostic } = require('../../../utils/reportAiDiagnostics');

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
    const models = [config.model, ...configuredGeminiBackups(config)].slice(0, 3);
    let res;
    let activeModel = config.model;
    for (let index = 0; index < models.length; index += 1) {
      activeModel = models[index];
      res = await fetchImpl(`${config.base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.key}`,
        },
        body: JSON.stringify({
          model: activeModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
          ],
          max_tokens: 128,
          temperature: 0,
        }),
        signal: controller.signal,
      });
      if (res.ok || ![404, 429, 502, 503, 504].includes(res.status)) break;
    }
    if (!res.ok) {
      diagnose(null, { stage: 'http', httpStatus: res.status, activeModel });
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
