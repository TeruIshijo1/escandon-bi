import React, { useId } from 'react';

export function HonorariosPhysicianCorrection({ correction, expanded = false }) {
  if (!correction) return null;
  const actor = correction.correctedBy || {};
  const correctedBy = actor.name || actor.username || 'Usuario no identificado';
  return <details className="hon-physician-correction" open={expanded || undefined} onClick={event => event.stopPropagation()}>
    <summary><span className="hon-physician-correction-badge">Corregido</span><span>Ver cambio de médico</span></summary>
    <div className="hon-physician-correction-detail">
      <p><b>Médico anterior:</b> {correction.fromProviderName || (correction.fromProviderId ? `Médico #${correction.fromProviderId}` : 'Sin médico asignado')}</p>
      <p><b>Médico confirmado:</b> {correction.toProviderName || `Médico #${correction.toProviderId}`}</p>
      <p><b>Corregido por:</b> {correctedBy}{actor.name && actor.username && actor.name !== actor.username ? ` (${actor.username})` : ''}</p>
      <p><b>Motivo:</b> {correction.reason}</p>
    </div>
  </details>;
}

export default function HonorariosDoctorReviewCard({ group, rows, pendingRows, selectedRows = [], approvedView = false, onDownloadApproved, expanded, onToggle,
  onApprove, onSelectRows, canSelect, canExport, onPreparePayment, onEditFiscal, onExportSummary,
  onExportDetail, formatMoney, formatSapMoney, formatDate, reviewButtons, reviewLabel, onOpenDetail, onRestore,
  canRestore, rateText, sapLinkLabel, sapLoading, pagination }) {
  const servicesId = useId();
  const approvalLabel = selectedRows.length ? 'Aprobar seleccionados' : 'Aprobar pendientes';
  const monthlyPending = group.filas.filter(row => row.FixedMonthly && row._reviewStatus === 'PENDIENTE');
  const needsIndividualReview = Math.max(0, group.filas.filter(row => row._reviewStatus === 'PENDIENTE').length - pendingRows.length - monthlyPending.length);
  return <article className={`hon-doc-item hon-doctor-simple ${expanded ? 'expanded' : ''}`}>
    <header className="hon-doctor-simple-header">
      <div className="hon-doctor-identity">
        <h3>{group.medico}</h3>
        <p>{!approvedView && <>{group.pendingReviewCount} por revisar · </>}{group.approvedCount} {group.approvedCount === 1 ? 'aprobado' : 'aprobados'}
          {!approvedView && group.rejectedCount > 0 && ` · ${group.rejectedCount} excluidos`}</p>
        {group.approvedCount > 0 && <p className="hon-doctor-approved-total">
          {group.pendingCount > 0 || group.totalNeto == null ? 'Aprobación guardada. Contabilidad debe completar los datos fiscales para calcular el neto.'
            : <>Total aprobado: <strong>{formatMoney(group.totalNeto)}</strong></>}</p>}
      </div>
      <div className="hon-doctor-main-actions">
        {approvedView ? <><button type="button" className="hon-friendly-button primary" disabled={!canExport}
          onClick={onPreparePayment}>Preparar pago y PDF</button>
          <button type="button" className="hon-friendly-button subtle" disabled={!canExport} onClick={() => onDownloadApproved(true)}>Descargar PDF detallado</button>
          <button type="button" className="hon-friendly-button subtle" disabled={!canExport} onClick={() => onDownloadApproved(false)}>Descargar PDF resumido</button>
          {group.pendingCount > 0 && <button type="button" className="hon-friendly-button" onClick={onEditFiscal}>Completar datos fiscales</button>}</> : (selectedRows.length > 0 || pendingRows.length > 0) ? <button type="button" className="hon-friendly-button primary" disabled={!canSelect || selectedRows.length > 100}
          aria-label={`${approvalLabel} de ${group.medico}`}
          onClick={onApprove}>{approvalLabel} ({selectedRows.length || Math.min(pendingRows.length, 100)})</button>
          : group.approvedCount > 0 && <><button type="button" className="hon-friendly-button primary"
            onClick={() => onDownloadApproved(true)} disabled={!canExport}>Descargar PDF detallado</button>
            <button type="button" className="hon-friendly-button subtle"
              onClick={() => onDownloadApproved(false)} disabled={!canExport}>Descargar PDF resumido</button></>}
        <button type="button" className="hon-friendly-button" aria-expanded={expanded} aria-controls={servicesId}
          aria-label={`${expanded ? 'Ocultar' : 'Ver'} servicios de ${group.medico}`} onClick={onToggle}>
          {expanded ? 'Ocultar servicios' : 'Ver servicios'}</button>
      </div>
    </header>
    {group.fixedMonthlyCount > 0 && <p className="hon-doctor-review-notice">Servicios aprobados: {formatMoney(group.totalServiceBase)} · Pago fijo mensual aprobado: {formatMoney(group.totalFixedMonthlyBase)}. Importes antes de impuestos.</p>}
    {!approvedView && monthlyPending.length > 0 && <p className="hon-doctor-review-notice">Este médico tiene un pago fijo mensual opcional. Abre «Ver servicios» y elige «Incluir pago mensual» para el mes que deseas pagar. Aprobar pendientes incluye únicamente sus servicios.</p>}
    {!approvedView && needsIndividualReview > 0 && <p className="hon-doctor-review-notice">{needsIndividualReview} {needsIndividualReview === 1 ? 'servicio necesita' : 'servicios necesitan'} revisión individual. Abre «Ver servicios» para revisar el aviso.</p>}
    {!approvedView && !selectedRows.length && pendingRows.length > 100 && <p className="hon-doctor-review-notice">Aprueba los primeros 100 y después continúa con los restantes.</p>}
    {!approvedView && selectedRows.length > 100 && <p className="hon-doctor-review-notice">Selecciona hasta 100 servicios para aprobarlos juntos.</p>}
    {expanded && <div id={servicesId} className="hon-doctor-services">
      <div className="hon-doctor-services-intro">
        <p>{approvedView ? 'Estos servicios ya están aprobados y se incluyen en el PDF. Detalle permite consultar sus folios y datos.' : 'Si alguno no corresponde, revísalo antes de aprobar. Para elegir solo algunos, marca sus casillas y pulsa el botón azul «Aprobar seleccionados».'}</p>
        {!approvedView && canSelect && <button type="button" className="hon-friendly-button subtle"
          onClick={onSelectRows}>Seleccionar todos los servicios mostrados</button>}
      </div>
      <ul className="hon-doctor-service-list" aria-label={`Servicios de ${group.medico}`}>
        {rows.map(row => <li key={row._rowId} className="hon-doctor-service" data-service-id={row.SourceLineId}>
          <div className="hon-service-description">
            <p className="hon-service-date">{formatDate(row.FechaAtencion)} · <span className={row.Cancelado ? 'hon-service-cancelled' : undefined} title={reviewLabel(row)}>
              {row.Cancelado ? 'Cancelado' : row.LiquidacionCerrada ? `Cierre #${row.LiquidacionCerrada}`
                : row._reviewStatus === 'APROBADO' ? 'Aprobado' : row._reviewStatus === 'RECHAZADO' ? 'Excluido' : 'Por aprobar'}</span></p>
            <strong>{row.FixedMonthly ? `Pago fijo del mes ${row.FeeMonth}` : row.Paciente || 'Sin paciente registrado'}</strong>
            <p>{row.Servicio}</p>
            <HonorariosPhysicianCorrection correction={row._physicianCorrection} />
          </div>
          <div className="hon-service-fee"><span>Honorario</span><strong>{row.TipoCalculo === 'SAP_DOCUMENTO' ? 'Según factura'
            : formatMoney(row._effectiveElegible ? row._effectiveBase : Number(row.BaseImporte) > 0 ? row.BaseImporte : row.BasePropuesta)}</strong>
            <span>{row.FixedMonthly ? 'Un pago completo por mes' : `Cantidad: ${row.Cantidad ?? 'Pendiente'}`}</span>{row._reviewStatus === 'APROBADO' && <span>IVA {row._effectiveVatRate == null ? '' : `${Math.round(row._effectiveVatRate * 100)}%: `}{formatMoney(row._effectiveIVA)}</span>}</div>
          <div className="hon-service-actions">
            {!approvedView && reviewButtons(row)}
            <button type="button" className="hon-friendly-button subtle" onClick={() => onOpenDetail(row)}>Detalle</button>
            {!approvedView && row._isOverridden && !row.LiquidacionCerrada && <button type="button" className="hon-friendly-button subtle"
              disabled={!canRestore} onClick={() => onRestore(row)}>Devolver a revisión</button>}
          </div>
        </li>)}
      </ul>
      {pagination}
      <details className="hon-doctor-extra">
        <summary>Ver impuestos y documentos</summary>
        <div className="hon-tax-grid">
          {[['Honorario aprobado', group.totalBase], ['IVA', group.totalIVA], ['ISR estimado', group.totalISR], ['Retención de IVA', group.totalRetIVA]].map(([label, amount], index) =>
            <div key={label}><span>{label}</span><strong>{index > 1 && Number(amount) > 0 ? '−' : ''}{formatMoney(amount)}</strong></div>)}
        </div>
        <p>ISR estimada: {rateText}. {sapLoading ? 'Consultando facturas e impuestos…' : sapLinkLabel}.</p>
        {group.sap && <p>Facturas activas en SAP: {group.sap.invoices?.filter(invoice => !invoice.cancelled).length || 0}.</p>}
        {(group.sap?.totalsByCurrency || []).map(total => <p key={total.currency}>
          Saldo de facturas SAP ({total.currency}): {formatSapMoney(total.openBalance, total.currency)}.</p>)}
        {group.approvedDocuments > 0 && <p>Atenciones aprobadas: {formatMoney(group.clinicalNet)} · Facturas aprobadas: {formatMoney(group.sapDocumentNet)}.
          Las facturas conservan los importes registrados en SAP.</p>}
        {group.fiscalNotes.map(note => <p key={note}>{note}</p>)}
        <div className="hon-friendly-actions">
          {group.approvedCount > 0 && <button type="button" className="hon-friendly-button" onClick={onPreparePayment}>Preparar pago de aprobados</button>}
          {!approvedView && <><button type="button" className="hon-friendly-button" disabled={!canExport} onClick={onExportSummary}>PDF Resumido</button>
          <button type="button" className="hon-friendly-button" disabled={!canExport} onClick={onExportDetail}>PDF Detallado</button></>}
        </div>
        <p>Estos PDF sirven para revisar. El PDF para pago está en Pagos y PDF y descuenta los pagos registrados.</p>
      </details>
    </div>}
  </article>;
}
