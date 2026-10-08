export function formatHonorarioReference(row) {
  if (row.FixedMonthly) return `Mes ${row.FeeMonth}`;
  if (row.TipoCalculo === 'SAP_DOCUMENTO') return `Factura SAP #${row.SapDocumento?.docNum ?? row.FolioAtencion}`;
  if (row.FolioAtencion) return `Atención #${row.FolioAtencion}`;
  if (row.FolioCita) return `Cita #${row.FolioCita} · Sin atención vinculada`;
  return 'Sin atención vinculada';
}

export function formatHonorarioSalesOrder(row) {
  if (row.FixedMonthly) return 'Pago fijo mensual';
  return row.FolioOrdenVenta ? `Orden de venta #${row.FolioOrdenVenta}` : 'Sin orden de venta';
}
