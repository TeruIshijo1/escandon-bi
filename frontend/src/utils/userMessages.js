// Keep technical details in diagnostics; show people a useful next step.
const DEFAULT_MESSAGE = 'No se pudo completar la acción. Intenta de nuevo. Si el problema continúa, contacta a soporte.';
const CONNECTION_MESSAGE = 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
const translations = new Map([
  ['Sin referencia en UT_Honorarios', 'Aún no hay un precio de referencia para este servicio.'],
  ['Referencia duplicada en UT_Honorarios', 'Hay más de un precio de referencia. Revisa cuál corresponde.'],
  ['Servicio profesional candidato; requiere inclusión y tarifa autorizadas en BI.', 'Antes de preparar el pago, incluye este servicio y registra su tarifa autorizada.'],
  ['ItemCode requerido', 'Selecciona un producto para continuar.'],
  ['NoExpediente y FechaHoraCita son obligatorios', 'Indica el expediente del paciente y la fecha y hora de la cita.'],
  ['CitaId es obligatorio', 'Selecciona una cita para continuar.'],
  ['Credenciales incorrectas', 'El usuario o la contraseña son incorrectos. Revisa tus datos e intenta de nuevo.'],
  ['Token inválido', 'Tu sesión terminó. Inicia sesión de nuevo.'],
  ['Token inválido o expirado', 'Tu sesión terminó. Inicia sesión de nuevo.'],
]);

const technicalDetails = /\b(?:UT_\w+|Vw_\w+|dw_\w+|bi_\w+|SQL(?:STATE| Server)?|PostgreSQL|SQLite|MSSQL|Sequelize|Knex|ECONN\w*|ENOTFOUND|EHOST\w*|ETIMEDOUT|EADDR\w*|ENOENT|EACCES|TypeError|ReferenceError|SyntaxError|stack trace|backend|frontend|endpoint|payload|schema|migration|migraci[oó]n|Service Layer|OData|dataset|pipeline|rowId|providerId|itemCode|NoExpediente|FechaHoraCita|CitaId|fingerprint)\b|relation .+ does not exist|invalid (?:object|column)|column .+ does not exist|duplicate key|violates .+ constraint|Cannot (?:read|access)|Unexpected token|<\/?(?:html|!doctype)|\bat \S+\.(?:js|jsx|ts):\d+|[A-Z]:\\/i;
const networkDetails = /failed to fetch|fetch failed|network ?error|network request failed|load failed|ECONN\w*|ENOTFOUND|EHOST\w*|ETIMEDOUT|socket hang up|connection (?:refused|terminated)|timeout.*exceeded|request timed out/i;
const internalFailure = /\b(?:UDR_\w+|base de datos|request failed|out of bounds|permission denied|invalid (?:date|input)|missing parameter)\b/i;

/** Format only application notices and errors, never business data or user notes. */
export function userMessage(value, status) {
  const input = typeof value === 'string' ? value : value?.message || value?.error;
  const message = typeof input === 'string' ? input.trim() : '';
  if ((status === 401 && !/contrase[ñn]a|credenciales|usuario no existe/i.test(message)) || /\btoken (?:inv[aá]lido|expirado|caducado)|jwt|sesi[oó]n (?:expirada|caducada)/i.test(message)) {
    return 'Tu sesión terminó. Inicia sesión de nuevo.';
  }
  if (status === 403) return 'No tienes permiso para realizar esta acción. Solicita acceso al responsable de la plataforma.';
  if (status === 413) return 'El archivo es demasiado grande. Elige uno más pequeño e intenta de nuevo.';
  if (status === 429) return 'Has hecho varios intentos seguidos. Espera unos minutos e intenta de nuevo.';
  if (translations.has(message)) return translations.get(message);
  if (networkDetails.test(message)) return CONNECTION_MESSAGE;
  if (!message || technicalDetails.test(message) || internalFailure.test(message) || /^(?:Error(?: interno(?: del servidor)?| del servidor)?|Internal Server Error|Bad Gateway|Service Unavailable|undefined|null)(?:[. :\d()]*)$/i.test(message)) {
    return status === 409 ? 'La información cambió. Actualiza la pantalla y revisa los datos antes de guardar.' : DEFAULT_MESSAGE;
  }
  return message;
}
