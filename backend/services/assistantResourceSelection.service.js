'use strict';

const normalize = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const expansions = [
  [/\b(?:socios?|pagador|aseguradora|clientes?)\b/, 'business partner card name socio pagador aseguradora cliente BP'],
  [/\b(?:descuentos?|bonificaci[oó]n)\b/, 'discount descuento global special price'],
  [/\b(?:convenios?|acuerdos?)\b/, 'agreement convenio acuerdo AG PCAG blanket'],
  [/\b(?:precios?|tarifas?|tabuladores?)\b/, 'price list lista precio tarifa PL item'],
  [/\b(?:p[uú]blico|hospitalizaci[oó]n)\b/, 'lista precios item_prices price list price hospitalizacion publico'],
  [/\b(?:estado de cuenta|saldos?|cartera)\b/, 'cuenta saldo balance receivable payable PC'],
  [/\b(?:facturas?|facturado)\b/, 'invoice factura documento ingresos'],
  [/\b(?:cobros?|pagos?|anticipos?)\b/, 'payment pago cobro down payment anticipo tesoreria'],
  [/\b(?:contab|asientos?|p[oó]lizas?|contadores?)\w*\b/, 'journal entry account asiento contable cuenta ledger'],
  [/\b(?:auditor|contralor|administrativ)\w*\b/, 'invoice discount payment journal business partner agreement price audit'],
];

// Keep the full permitted schema on the server. Only relevant metadata goes to
// the provider; no hospital records, arbitrary SQL or credentials are supplied.
function selectResources(catalog, message, context, pending) {
  const original = normalize([pending?.request, ...(pending?.answers || []), message].filter(Boolean).join(' '));
  let expanded = original;
  for (const [pattern, addition] of expansions) if (pattern.test(original)) expanded += ` ${addition}`;
  const words = [...new Set(expanded.split(/[^a-z0-9_]+/).filter(word => word.length >= 3 && !/^(con|sin|del|los|las|para|quiero|necesito|reporte|datos|que|una|por|como|mes|pasado|desde|hasta)$/.test(word)))];
  const required = new Set([context?.entity].filter(Boolean));
  const manual = catalog.filter(entity => !entity.assistantOnly);
  const hidden = catalog.filter(entity => entity.assistantOnly).map(entity => {
    const identity = normalize([entity.id, entity.title, ...(entity.aliases || [])].join(' '));
    const fields = normalize(entity.fields.map(field => field.label).join(' '));
    const score = words.reduce((sum, word) => sum + (identity.includes(word) ? 5 : fields.includes(word) ? 1 : 0), 0)
      + (required.has(entity.id) ? 100000 : 0);
    return { entity, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  // Rich known capabilities are small and should stay available for followups.
  const capabilities = catalog.filter(entity => entity.assistantOnly && !entity.resourceMetadata);
  return [...new Map([...manual, ...capabilities, ...hidden.slice(0, 16).map(item => item.entity)].map(entity => [entity.id, entity])).values()];
}

module.exports = { selectResources };
