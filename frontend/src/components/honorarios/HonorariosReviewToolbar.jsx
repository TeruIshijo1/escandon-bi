import { userMessage } from '../../utils/userMessages';
import React, { useRef } from 'react';
import './HonorariosReviewToolbar.css';

const WORKSPACES = [['review', 'Servicios'], ['approved', 'Pagos y PDF'], ['audit', 'Auditoría'], ['fiscal', 'Configuración']];
const navWorkspace = workspace => workspace === 'liquidations' ? 'approved' : ['catalog', 'monthly-fixed'].includes(workspace) ? 'fiscal' : workspace;

function FriendlyButton({ children, variant = 'subtle', className = '', ...props }) {
  return <button type="button" className={`hon-friendly-button ${variant} ${className}`} {...props}>{children}</button>;
}

export function HonorariosHeader({ workspace, onWorkspaceChange, canExport, canExportExcel = canExport, onExportSummary, onExportDetail, onExportExcel }) {
  const exportMenu = useRef(null);
  const exportFile = callback => { exportMenu.current.open = false; callback(); };
  return <>
    <header className="hon-friendly-header">
      <div>
        <h1 className="hon-friendly-title">Honorarios médicos</h1>
        <p className="hon-friendly-subtitle">Revisa los servicios y prepara el pago a médicos.</p>
      </div>
      {['review', 'approved'].includes(workspace) && <details className="hon-export" ref={exportMenu}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
        onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus(); } }}>
        <summary role="button" className="hon-friendly-button subtle" aria-disabled={!canExport}
          title={canExport ? 'Descargar los resultados del periodo consultado' : 'Busca servicios y espera a que termine la consulta para exportar.'}
          onClick={event => { if (!canExport) event.preventDefault(); }}>
          Exportar <span aria-hidden="true">⌄</span>
        </summary>
        <div className="hon-export-menu">
          <p className="hon-export-caption">{workspace === 'approved' ? 'PDF con los servicios aprobados que cumplen los filtros de esta pantalla.' : 'PDF de revisión de servicios. El PDF para pago se genera en Pagos y PDF, con el saldo pendiente actualizado.'}</p>
          <FriendlyButton disabled={!canExport} onClick={() => exportFile(onExportSummary)}>PDF resumido</FriendlyButton>
          <FriendlyButton disabled={!canExport} onClick={() => exportFile(onExportDetail)}>PDF detallado</FriendlyButton>
          <FriendlyButton disabled={!canExportExcel} onClick={() => exportFile(onExportExcel)}>Descargar Excel</FriendlyButton>
        </div>
      </details>}
    </header>
    <nav className="hon-friendly-nav" aria-label="Áreas de honorarios">
      {WORKSPACES.map(([key, label]) => <FriendlyButton key={key} aria-pressed={navWorkspace(workspace) === key}
        onClick={() => onWorkspaceChange(key)}>{label}</FriendlyButton>)}
    </nav>
  </>;
}

export function HonorariosPeriod({ startDate, endDate, onStartDateChange, onEndDateChange, loading, coverage, error, onSearch }) {
  return <section className="hon-friendly-period hon-card" aria-label="Periodo de servicios">
    <div className="hon-field">
      <label htmlFor="hon-period-start">Desde</label>
      <input id="hon-period-start" className="hon-input" type="date" value={startDate} disabled={loading} onChange={event => onStartDateChange(event.target.value)} />
    </div>
    <div className="hon-field">
      <label htmlFor="hon-period-end">Hasta</label>
      <input id="hon-period-end" className="hon-input" type="date" value={endDate} disabled={loading} onChange={event => onEndDateChange(event.target.value)} />
    </div>
    <FriendlyButton variant="primary" disabled={loading} onClick={onSearch}>{loading ? 'Buscando servicios…' : 'Buscar servicios'}</FriendlyButton>
    <details className="hon-context-note" open={coverage?.omittedFromReview > 0}>
      <summary>Cómo se calculan los honorarios</summary>
      <p>Se muestran las atenciones de servicios aprobados en el catálogo, con una tarifa autorizada para el médico y la fecha. Confirma la atención para aprobar su pago.</p>
      {coverage?.omittedFromReview > 0 && <p role="status" className="hon-friendly-message">{coverage.omittedFromReview.toLocaleString()} atenciones aún necesitan configuración:
        {' '}{(coverage.pendingCatalog || 0).toLocaleString()} sin servicio aprobado,
        {' '}{(coverage.pendingTariff || 0).toLocaleString()} sin tarifa aplicable y
        {' '}{(coverage.pendingProvider || 0).toLocaleString()} sin médico identificado. Revisa el catálogo y los datos de la atención antes de cerrar el periodo.</p>}
      {coverage?.source === 'SERVICIOS_ORDENES_CARGOS' && (coverage.sourceCounts ? <p>Fuentes consultadas: {(coverage.sourceCounts.orderLines || 0).toLocaleString()} líneas de venta, {(coverage.sourceCounts.clinicalCharges || 0).toLocaleString()} cargos clínicos, {(coverage.sourceCounts.standaloneAppointments || 0).toLocaleString()} citas independientes, {(coverage.sourceCounts.surgicalProcedures || 0).toLocaleString()} procedimientos por rol y {(coverage.sourceCounts.contactCenter || 0).toLocaleString()} servicios de Contact Center.</p>
        : <p>Atenciones con configuración aplicable: {(coverage.orderLines || 0).toLocaleString()} líneas de venta, {(coverage.clinicalCharges || 0).toLocaleString()} cargos clínicos y {(coverage.surgicalProcedures || 0).toLocaleString()} procedimientos por rol.</p>)}
      {coverage?.monthlyFixed > 0 && <p>Los pagos fijos de jefes de área son opcionales. Al incluir uno, se toma completo el importe configurado para ese mes, adicional a sus servicios y antes de impuestos. No se incluyen al aprobar servicios en conjunto.</p>}
    </details>
    {error && <p role="alert" className="hon-friendly-message error">No se pudieron consultar los servicios: {userMessage(error)}</p>}
  </section>;
}

export function HonorariosSummary({ kpis, loading, reviewReady, formatMoney, approvedView = false }) {
  return <section className="hon-friendly-summary hon-card" aria-label="Resumen del periodo">
    <div>
      <span className="hon-total-label">{approvedView ? kpis.fixedMonthlyCount > 0 ? 'Conceptos aprobados' : 'Servicios aprobados' : 'Total aprobado'}</span>
      <strong className="hon-total-value">{approvedView ? `${kpis.totalElegibles.toLocaleString()} ${kpis.fixedMonthlyCount > 0 ? kpis.totalElegibles === 1 ? 'concepto' : 'conceptos' : kpis.totalElegibles === 1 ? 'servicio' : 'servicios'}` : loading ? 'Calculando…' : formatMoney(reviewReady ? kpis.totalNeto : null)}</strong>
      <p className="hon-total-caption">{approvedView ? `Honorarios aprobados: ${formatMoney(kpis.totalBase)} · IVA: ${loading ? 'Consultando…' : formatMoney(kpis.totalIVA)}` : loading ? 'Comprobando el cálculo de impuestos' : kpis.pendingCount
        ? `${kpis.pendingCount.toLocaleString()} aprobados tienen el cálculo pendiente`
        : kpis.totalElegibles ? `${kpis.totalElegibles.toLocaleString()} servicios aprobados · Neto en MXN del periodo`
          : 'Aún no hay servicios aprobados en este periodo.'}</p>
      {kpis.fixedMonthlyCount > 0 && <p className="hon-total-caption">Servicios: {formatMoney(kpis.totalServiceBase)} · Pagos fijos mensuales: {formatMoney(kpis.totalFixedMonthlyBase)}. Antes de impuestos.</p>}
    </div>
    <details className="hon-tax-details">
      <summary>Ver desglose de impuestos</summary>
      <div className="hon-tax-grid">
        {[['Honorario', kpis.totalBase], ['IVA', kpis.totalIVA], ['ISR estimado', kpis.totalISR], ['Retención de IVA', kpis.totalRetIVA]].map(([label, amount], index) => <div key={label}>
          <span>{label}</span><strong>{loading ? '…' : `${index > 1 && Number(amount) > 0 ? '−' : ''}${formatMoney(amount)}`}</strong>
        </div>)}
      </div>
    </details>
  </section>;
}

export function HonorariosResultsToolbar({ kpis, statusTab, onStatusChange, searchTerm, onSearchChange, searchUpdating,
  medicoFilter, onMedicoChange, uniqueMedicos, grupoFilter, onGrupoChange, uniqueGrupos, viewMode, onViewChange,
  allowExpandAll, onExpandAll, onCollapseAll, canSelect, onSelectConfigured, configuredCount,
  selectedCount, onApproveSelection, onExcludeSelection, onClearSelection, bulkMessage, resultsCount, approvedView = false, onViewApproved }) {
  const filtered = !!searchTerm || !!medicoFilter || grupoFilter !== 'TODOS';
  return <section className="hon-friendly-results hon-card" aria-label="Revisión de servicios">
    <div className="hon-friendly-results-top">
      <div className="hon-status-tabs-container" aria-label="Estado de revisión">
        {approvedView ? <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{kpis.fixedMonthlyCount > 0 ? 'Conceptos aprobados' : 'Servicios aprobados'}</h2> : <>
        {[
          ['pendientes', 'Por revisar', kpis.totalPendientes, 'active-todos'],
          ['elegibles', 'Aprobados', kpis.totalElegibles, 'active-elegibles'],
          ['exclusiones', 'Excluidos', kpis.totalExclusiones, 'active-exclusiones'],
          ['todos', 'Todos', kpis.totalGeneral, 'active-todos'],
        ].map(([key, label, count, activeClass]) => <button key={key} type="button" aria-pressed={statusTab === key}
          className={`hon-status-btn ${statusTab === key ? activeClass : ''}`} onClick={() => onStatusChange(key)}>
          {label} <span>{count.toLocaleString()}</span>
        </button>)}
        </>}
      </div>
      <span className="hon-results-count">{resultsCount.toLocaleString()} {kpis.fixedMonthlyCount > 0 ? resultsCount === 1 ? 'concepto' : 'conceptos' : resultsCount === 1 ? 'servicio' : 'servicios'} en la lista</span>
    </div>
    <div className="hon-friendly-filters">
      <div className="hon-field hon-search-field">
        <label htmlFor="hon-service-search">Buscar</label>
        <div>
          <input id="hon-service-search" className="hon-input" type="search" value={searchTerm}
            placeholder="Médico, paciente, servicio o folio" onChange={event => onSearchChange(event.target.value)} />
          {searchTerm && <button type="button" aria-label="Borrar búsqueda" onClick={() => onSearchChange('')}>×</button>}
        </div>
      </div>
      <div className="hon-field">
        <label htmlFor="hon-doctor-filter">Médico</label>
        <select id="hon-doctor-filter" className="hon-select" value={medicoFilter} onChange={event => onMedicoChange(event.target.value)}>
          <option value="">Todos los médicos</option>
          {uniqueMedicos.map(medico => <option key={medico} value={medico}>{medico}</option>)}
        </select>
      </div>
      <details className="hon-advanced-options">
        <summary role="button" className="hon-friendly-button subtle">Más opciones{grupoFilter !== 'TODOS' ? ' · 1 filtro' : ''} <span aria-hidden="true">⌄</span></summary>
        <div className="hon-advanced-panel">
          <div className="hon-field">
            <label htmlFor="hon-group-filter">Grupo de servicios</label>
            <select id="hon-group-filter" className="hon-select" value={grupoFilter} onChange={event => onGrupoChange(event.target.value)}>
              <option value="TODOS">Todos los grupos</option>
              {uniqueGrupos.map(grupo => <option key={grupo} value={grupo}>{grupo}</option>)}
            </select>
          </div>
          <div className="hon-field">
            <label htmlFor="hon-results-view">Vista de resultados</label>
            <select id="hon-results-view" className="hon-select" value={viewMode} onChange={event => onViewChange(event.target.value)}>
              <option value="medicos">Por médico</option>
              <option value="inteligente">Lista detallada</option>
              <option value="plana">Tabla completa</option>
            </select>
          </div>
          {viewMode === 'medicos' && <div className="hon-field">
            <label>Secciones de médicos</label>
            <div className="hon-friendly-actions">
              <FriendlyButton disabled={!allowExpandAll} onClick={onExpandAll}
                title={allowExpandAll ? 'Mostrar los servicios de todos los médicos' : 'En listas grandes, abre cada médico por separado.'}>Abrir todos</FriendlyButton>
              <FriendlyButton onClick={onCollapseAll}>Cerrar todos</FriendlyButton>
            </div>
            {!allowExpandAll && <small>Abre cada médico por separado para mantener ágil la lista.</small>}
          </div>}

        </div>
      </details>
    </div>
    {(filtered || searchUpdating) && <div className="hon-filter-context">
      {grupoFilter !== 'TODOS' && <span>Grupo: {grupoFilter}</span>}
      {filtered && <FriendlyButton onClick={() => { onSearchChange(''); onMedicoChange(''); onGrupoChange('TODOS'); }}>Limpiar filtros</FriendlyButton>}
      {searchUpdating && <span role="status">Actualizando resultados…</span>}
    </div>}
    {!approvedView && canSelect && viewMode !== 'medicos' && <div className="hon-friendly-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
      <FriendlyButton disabled={!configuredCount} onClick={onSelectConfigured}>
        {configuredCount > 100 ? 'Seleccionar primeros 100' : `Seleccionar todos (${configuredCount})`}
      </FriendlyButton>
      <span style={{ fontSize: '.85rem', color: 'var(--text-muted, #64748b)' }}>Marca varios servicios y apruébalos con un solo IVA. La selección respeta tus filtros y todas las páginas.</span>
    </div>}
    {!approvedView && selectedCount > 0 && <div className="hon-selection-bar" aria-label="Acciones de la selección">
      <strong>{selectedCount} {selectedCount === 1 ? 'servicio seleccionado' : 'servicios seleccionados'}</strong>
      <FriendlyButton variant="primary" disabled={!canSelect || selectedCount > 100} onClick={onApproveSelection}>Aprobar selección</FriendlyButton>
      <FriendlyButton variant="danger" disabled={!canSelect || selectedCount > 100} onClick={onExcludeSelection}>Excluir selección</FriendlyButton>
      <FriendlyButton onClick={onClearSelection}>Cancelar selección</FriendlyButton>
      {selectedCount > 100 && <span role="alert">Selecciona hasta 100 servicios por revisión.</span>}
    </div>}
    {bulkMessage && <div role="status" className="hon-friendly-message">{bulkMessage}
      {!approvedView && kpis.totalElegibles > 0 && <FriendlyButton variant="primary" onClick={onViewApproved}>Ir a Pagos y PDF</FriendlyButton>}
    </div>}
  </section>;
}
