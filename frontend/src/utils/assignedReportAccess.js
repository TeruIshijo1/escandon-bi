// Una asignación abre únicamente la pantalla de Mis reportes. Los módulos y
// datos continúan sujetos a sus controles independientes en el servidor.
export const REPORT_WORKSPACE_PATH = '/mi-area/consultas-service-layer';

export function canUseAssignedReportNavigation(user, path, hasAssignedReports) {
  return Boolean(user && path === REPORT_WORKSPACE_PATH && hasAssignedReports === true);
}

export async function requestAssignedReportAccess(apiBase, token, signal, timeoutMs = 8000) {
  if (!token) return false;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, timeoutMs);
  try {
    const response = await fetch(`${apiBase}/sap-query/saved/access`, {
      headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.ok === true && data.hasAssignedReports === true;
  } catch { return false; }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
