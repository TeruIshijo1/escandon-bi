'use strict';

function honorarioRowId(row) {
  if (row.SourceIdentity) return row.SourceIdentity;
  if (row.TipoCalculo === 'SAP_DOCUMENTO') return `SAP_FACTURA|${row.SapDocumento?.docEntry}`;
  return [row.UDRKey, row.RenglonAuditoria, row.FolioReferenciaOrigen ?? row.FolioAtencion,
    row.CodigoServicio, row.OrigenRenglon, row.Medico].map(value => String(value ?? '').trim()).join('|');
}

// Mantener este contrato junto a reviewFingerprint del cliente. El servidor
// compara de nuevo la fuente y nunca acepta importes o médicos del navegador.
function reviewFingerprint(row) {
  const fields = [row.UDRKey, row.RenglonAuditoria, row.Medico, row.FechaAtencion,
    row.Paciente, row.Cliente, row.FolioOrdenVenta, row.MedicoId, row.Servicio,
    row.CodigoServicio, row.Cantidad, row.BaseImporte, row.BasePropuesta, row.IvaLinea,
    row.TasaISR, row.ElegiblePago, row.EstadoVertical, row.FuenteHonorario, row.OrigenRenglon,
    row.MensajeAuditoria, row.MotivoExclusionOriginal, row.SapDocumento?.documentTotal,
    row.SapDocumento?.currency, row.SapDocumento?.cancelled, row.SapDocumento?.cfdiUuid,
    row.SapDocumento?.retentions, row.SapDocumento?.lines];
  if (row.ModeBI) fields.push(row.SourceIdentity, row.SourceLineId, row.OccurrenceId,
    row.RolMedico, row.Cancelado, row.EjecucionConfirmada, row.MedicoConfirmado,
    row.CantidadConfirmada, row.CantidadOriginal, row.CantidadMaxima, row.PosibleDuplicado,
    row.CatalogSnapshot, row.TariffSnapshot, row.FechaReferenciaTipo);
  if (row.FixedMonthly) fields.push(row.FixedMonthlySnapshot);
  return JSON.stringify(fields);
}

module.exports = { honorarioRowId, reviewFingerprint };
