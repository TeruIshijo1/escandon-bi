import React from 'react';

const paths = {
  chat: <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" /><path d="M8 11h8M8 14h5" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4zM22 2 11 13" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2l1 4M4 12l1 4a8 8 0 0 0 13 2" /></>,
  report: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2z" /><path d="M7 3v6h9V3M7 21v-8h10v8" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" /></>,
  inventory: <><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5" /></>,
  movement: <><path d="M3 7h16m-4-4 4 4-4 4M21 17H5m4-4-4 4 4 4" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5.65" /></>,
  money: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 12h.01M18 12h.01" /></>,
  chart: <><path d="M4 3v18h17M9 16v-5M14 16V7M19 16v-8" /></>,
  hospital: <><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18M9 21v-5h6v5M12 6v6M9 9h6" /></>,
  clinical: <><path d="M6 3v5a4 4 0 0 0 8 0V3M4 3h4M12 3h4M10 12v3a5 5 0 0 0 10 0v-2" /><circle cx="20" cy="11" r="2" /></>,
  pharmacy: <><path d="m8 4 12 12a4.25 4.25 0 0 1-6 6L2 10a4.25 4.25 0 0 1 6-6Z" transform="translate(1 -1)" /><path d="m8 16 8-8" /></>,
};

export function reportTopicIcon(entity) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const category = normalize(entity?.category);
  const title = normalize(entity?.title);
  if (/directorio/.test(title)) return 'people';
  if (/factura|orden.*compra|requisicion|nota.*credito/.test(title)) return 'report';
  if (/recepcion|devolucion|traslado|entrada|salida/.test(title)) return 'movement';
  if (/caducidad/.test(category)) return 'calendar';
  if (/movimiento/.test(category)) return 'movement';
  if (/inventari|stock/.test(category)) return 'inventory';
  if (/proveedor|catalogo/.test(category)) return 'people';
  if (/factur|ingreso|saldo|pago|tesorer|contabil|honorario|venta/.test(category)) return 'money';
  if (/indicador|productividad/.test(category)) return 'chart';
  if (/farmacia/.test(category)) return 'pharmacy';
  if (/hospitaliz|cuenta/.test(category)) return 'hospital';
  if (/clinic|consulta|quirofano|estudio/.test(category)) return 'clinical';
  return 'report';
}

export default function ReportBuilderIcon({ name = 'report', className = '' }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] || paths.report}</svg>;
}
