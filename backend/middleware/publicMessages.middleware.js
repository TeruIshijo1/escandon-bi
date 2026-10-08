'use strict';

const DEFAULT_MESSAGE = 'No se pudo completar la acción. Intenta de nuevo. Si el problema continúa, contacta a soporte.';
const technicalDetails = /\b(?:UT_\w+|Vw_\w+|dw_\w+|bi_\w+|SQL(?:STATE| Server)?|PostgreSQL|SQLite|MSSQL|Sequelize|Knex|ECONN\w*|ENOTFOUND|EHOST\w*|ETIMEDOUT|EADDR\w*|ENOENT|EACCES|TypeError|ReferenceError|SyntaxError|backend|frontend|endpoint|payload|schema|migration|Service Layer|OData|fingerprint)\b|relation .+ does not exist|invalid (?:object|column)|column .+ does not exist|duplicate key|violates .+ constraint|Cannot (?:read|access)|Unexpected token|[A-Z]:\\/i;

function publicMessage(value, status) {
  if (typeof value !== 'string') return value;
  if ((status === 401 && !/contrase[ñn]a|credenciales|usuario no existe/i.test(value)) || /\btoken (?:inv[aá]lido|expirado|caducado)|jwt/i.test(value)) return 'Tu sesión terminó. Inicia sesión de nuevo.';
  if (status === 403) return 'No tienes permiso para realizar esta acción. Solicita acceso al responsable de la plataforma.';
  if (value === 'Sin referencia en UT_Honorarios') return 'Aún no hay un precio de referencia para este servicio.';
  if (technicalDetails.test(value) || /\b(?:UDR_\w+|base de datos|request failed|out of bounds|permission denied)\b/i.test(value) || /^(?:Error(?: interno(?: del servidor)?)?|Internal Server Error|Bad Gateway|Service Unavailable)[. :\d()]*$/i.test(value)) {
    return status === 409 ? 'La información cambió. Actualiza la pantalla y revisa los datos antes de guardar.' : DEFAULT_MESSAGE;
  }
  return value;
}

// Only notices are formatted. Identifiers, business data and recorded reasons stay intact.
function formatNotices(body, status) {
  if (Array.isArray(body)) {
    const values = body.map(value => formatNotices(value, status));
    return values.some((value, index) => value !== body[index]) ? values : body;
  }
  if (!body || typeof body !== 'object') return body;
  if (Object.getPrototypeOf(body) !== Object.prototype && Object.getPrototypeOf(body) !== null) return body;
  const entries = Object.entries(body).filter(([key]) => key !== 'stack').map(([key, value]) => {
    if (['message', 'error', 'lastError', 'warning'].includes(key) && typeof value === 'string') {
      return [key, publicMessage(value, status)];
    }
    if (['warnings', 'referenceWarnings'].includes(key) && Array.isArray(value)) {
      return [key, value.map(warning => typeof warning === 'string' ? publicMessage(warning, status) : formatNotices(warning, status))];
    }
    return [key, formatNotices(value, status)];
  });
  return entries.some(([key, value]) => value !== body[key]) || Object.hasOwn(body, 'stack') ? Object.fromEntries(entries) : body;
}

function publicMessages(req, res, next) {
  const json = res.json;
  res.json = function (body) { return json.call(this, formatNotices(body, this.statusCode)); };
  next();
}

module.exports = { publicMessages, publicMessage, formatNotices };
