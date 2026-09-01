import React, { useState, useEffect, useMemo, useRef } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

const ColumnFilter = ({ columnKey, data, colFilters, setColFilters, label, align = 'left', maxWidth }) => {
  const uniqueVals = useMemo(() => {
    return Array.from(new Set(data.map(item => item[columnKey]))).filter(Boolean).sort();
  }, [data, columnKey]);

  const val = colFilters[columnKey] || '';
  const isActive = val !== '';

  return (
    <th style={{
      textAlign: align,
      maxWidth: maxWidth || 'none',
      padding: '12px 10px',
      background: '#004687',
      borderBottom: '3px solid #0088C9',
      whiteSpace: 'nowrap'
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.04em', fontWeight: '700' }}>
          {label}
        </span>
        <select
          value={val}
          onChange={(e) => setColFilters(prev => ({ ...prev, [columnKey]: e.target.value }))}
          style={{
            fontSize: '0.7rem',
            padding: '3px 6px',
            borderRadius: '4px',
            border: isActive ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.25)',
            background: isActive ? 'rgba(56,189,248,0.2)' : 'rgba(255,255,255,0.12)',
            color: '#fff',
            outline: 'none',
            maxWidth: maxWidth || '100%',
            textOverflow: 'ellipsis'
          }}
        >
          <option value="" style={{ color: '#1e293b' }}>Todos ({uniqueVals.length})</option>
          {uniqueVals.map(v => (
            <option key={v} value={v} style={{ color: '#1e293b' }}>{v}</option>
          ))}
        </select>
      </div>
    </th>
  );
};

const StaticTh = ({ label, align = 'center', width }) => (
  <th style={{
    textAlign: align,
    width: width || 'auto',
    padding: '12px 10px',
    background: '#004687',
    borderBottom: '3px solid #0088C9',
    whiteSpace: 'nowrap'
  }}>
    <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.04em', fontWeight: '700' }}>
      {label}
    </span>
  </th>
);

export default function CargosReversasPaciente() {
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(1600);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const getTodayStr = () => new Date().toLocaleDateString('en-CA');
  const getDaysAgoStr = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toLocaleDateString('en-CA');
  };

  const [fechaDesde, setFechaDesde] = useState(getTodayStr());
  const [fechaHasta, setFechaHasta] = useState(getTodayStr());
  const [tipoMovimiento, setTipoMovimiento] = useState('TODOS');
  const [unidadServicio, setUnidadServicio] = useState('TODAS');
  const [busqueda, setBusqueda] = useState('');

  const [colFilters, setColFilters] = useState({});
  const [page, setPage] = useState(1);
  const PER_PAGE = 100;

  useEffect(() => {
    setPage(1);
  }, [colFilters, fechaDesde, fechaHasta, tipoMovimiento, unidadServicio, busqueda]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        fechaDesde,
        fechaHasta,
        ...(tipoMovimiento !== 'TODOS' ? { tipoMovimiento } : {}),
        ...(unidadServicio !== 'TODAS' ? { unidadServicio } : {}),
        ...(busqueda.trim() ? { busqueda: busqueda.trim() } : {}),
      });

      const res = await fetch(`${API_BASE}/audit/movimientos-paciente?${q}`, {
        headers: authHeaders()
      });
      if (!res.ok) throw new Error('Error al cargar movimientos de pacientes');
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error('[CargosReversasPaciente Error]', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fechaDesde, fechaHasta, tipoMovimiento, unidadServicio]);

  // Mantener scroll sincronizado
  useEffect(() => {
    const tableContainer = tableScrollRef.current;
    if (!tableContainer) return;

    const observer = new ResizeObserver(() => {
      if (tableContainer.scrollWidth > 0) {
        setTableScrollWidth(tableContainer.scrollWidth);
      }
    });

    observer.observe(tableContainer);
    if (tableContainer.firstChild) observer.observe(tableContainer.firstChild);

    return () => observer.disconnect();
  }, [data]);

  const rows = data?.data || [];
  const resumen = data?.resumen || {};

  // Unidades de servicio disponibles en el dataset
  const unidadesDisponibles = useMemo(() => {
    const set = new Set(rows.map(r => r.unidadServicio).filter(Boolean));
    // Garantizar que Carro Rojo aparezca destacado
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(row => {
      // Filtros de encabezados
      const matchCol = Object.entries(colFilters).every(([key, val]) => {
        if (!val) return true;
        return String(row[key] ?? '').trim().toLowerCase() === String(val).trim().toLowerCase();
      });
      if (!matchCol) return false;

      // Filtro de texto en vivo
      if (busqueda.trim()) {
        const query = busqueda.toLowerCase().trim();
        const str = `${row.cuenta} ${row.paciente} ${row.codigo} ${row.insumo} ${row.usuarioCargo} ${row.lote} ${row.unidadServicio}`.toLowerCase();
        if (!str.includes(query)) return false;
      }

      return true;
    });
  }, [rows, colFilters, busqueda]);

  const paginated = useMemo(() => {
    return filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  }, [filtered, page]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  // Totales calculados sobre la vista filtrada en cliente
  const filteredMetrics = useMemo(() => {
    let cantCargada = 0;
    let cantReversada = 0;
    let ventaCargada = 0;
    let ventaReversada = 0;
    let costoCompra = 0;

    for (const r of filtered) {
      if (r.isReversa) {
        cantReversada += Math.abs(Number(r.cantidad) || 0);
        ventaReversada += Math.abs(Number(r.precioVentaTotal) || 0);
      } else {
        cantCargada += Number(r.cantidad) || 0;
        ventaCargada += Number(r.precioVentaTotal) || 0;
      }
      costoCompra += Number(r.costoCompraTotal) || 0;
    }

    const netoVenta = ventaCargada - ventaReversada;
    const margenNeto = netoVenta - costoCompra;
    const margenPct = netoVenta > 0 ? (margenNeto / netoVenta) * 100 : 0;

    return {
      totalRegistros: filtered.length,
      cantCargada,
      cantReversada,
      ventaCargada,
      ventaReversada,
      netoVenta,
      costoCompra,
      margenNeto,
      margenPct
    };
  }, [filtered]);

  const handleExportExcel = () => {
    const cols = [
      { header: 'No. Cuenta', key: 'cuenta', align: 'center', width: 100 },
      { header: 'Paciente', key: 'paciente', align: 'left', width: 230 },
      { header: 'Tipo Movimiento', key: 'tipoMovimiento', align: 'center', width: 120 },
      { header: 'Estado', key: 'estadoLinea', align: 'center', width: 140 },
      { header: 'Fecha y Hora', key: 'fechaMovimiento', align: 'center', width: 140, type: 'datetime' },
      { header: 'Código', key: 'codigo', align: 'center', width: 90 },
      { header: 'Insumo / Servicio', key: 'insumo', align: 'left', width: 260 },
      { header: 'Unidad de Servicio', key: 'unidadServicio', align: 'center', width: 160 },
      { header: 'Almacén', key: 'almacenOrigen', align: 'center', width: 80 },
      { header: 'Cantidad', key: 'cantidad', align: 'center', width: 75, type: 'num' },
      { header: 'P. Venta Unit. ($)', key: 'precioVentaUnitario', align: 'right', width: 110, type: 'money' },
      { header: 'P. Venta Total ($)', key: 'precioVentaTotal', align: 'right', width: 110, type: 'money' },
      { header: 'Costo Compra Unit. SAP ($)', key: 'costoCompraUnitario', align: 'right', width: 125, type: 'money' },
      { header: 'Costo Compra Total SAP ($)', key: 'costoCompraTotal', align: 'right', width: 125, type: 'money' },
      { header: 'Margen ($)', key: 'margenMonto', align: 'right', width: 100, type: 'money' },
      { header: 'Lote', key: 'lote', align: 'center', width: 100 },
      { header: 'Caducidad', key: 'caducidad', align: 'center', width: 95, type: 'date' },
      { header: 'Área/Cama Destino', key: 'areaDestino', align: 'left', width: 160 },
      { header: 'Responsable Cargo', key: 'usuarioCargo', align: 'left', width: 190 },
      { header: 'Médico Tratante', key: 'medicoTratante', align: 'left', width: 190 },
    ];

    const fmt = (val, col) => {
      if (val == null || val === '') return '';
      if (col.type === 'date') return new Date(val).toLocaleDateString('es-MX');
      if (col.type === 'datetime') return new Date(val).toLocaleString('es-MX');
      if (col.type === 'money') return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const fechaReporte = new Date().toLocaleString('es-MX');
    const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:10pt;padding:6px 16px}
  .info-row td{font-size:9pt;color:#475569;padding:4px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:9.5pt;padding:9px 8px;border:1px solid #003366;text-align:center}
  td{padding:6px 8px;font-size:8.5pt;border:1px solid #D1D5DB;color:#1E293B}
  .even{background:#F4F6F9}.odd{background:#FFF}
  .cargo{color:#004687;font-weight:bold}
  .reversa{color:#DC2626;font-weight:bold}
  .carro-rojo{background:#FEE2E2;color:#991B1B;font-weight:bold}
  .money{color:#15803D;font-weight:bold;text-align:right}
  .costo{color:#B45309;font-weight:bold;text-align:right}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:9.5pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Auditoría: Reporte Consolidado de Cargos y Reversas por Paciente (Costos SAP vs Venta Cirrus y Unidad de Servicio)</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Período: ${fechaDesde} al ${fechaHasta} &nbsp;|&nbsp; Movimientos: ${tipoMovimiento} &nbsp;|&nbsp; Unidad: ${unidadServicio} &nbsp;|&nbsp; Total Registros: ${filtered.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filtered.map((row, i) => `<tr class="${i%2===0?'even':'odd'}">${cols.map(c => {
    let cls = '';
    let val = fmt(row[c.key], c);
    if (c.key === 'tipoMovimiento') cls = row.isReversa ? ' class="reversa"' : ' class="cargo"';
    if (c.key === 'unidadServicio' && String(row.unidadServicio).includes('Carro Rojo')) cls = ' class="carro-rojo"';
    if (c.key === 'precioVentaTotal') cls = ' class="money"';
    if (c.key === 'costoCompraTotal') cls = ' class="costo"';
    return `<td${cls} style="text-align:${c.align}">${val}</td>`;
  }).join('')}</tr>`).join('')}
  <tr class="total-row">
    <td colspan="9" style="text-align:right">TOTALES NETOS</td>
    <td style="text-align:center">${(filteredMetrics.cantCargada - filteredMetrics.cantReversada).toLocaleString('es-MX')}</td>
    <td style="text-align:right"></td>
    <td style="text-align:right">$${filteredMetrics.netoVenta.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
    <td style="text-align:right"></td>
    <td style="text-align:right">$${filteredMetrics.costoCompra.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
    <td style="text-align:right">$${filteredMetrics.margenNeto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
    <td colspan="${cols.length - 15}"></td>
  </tr>
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Auditoria_Cargos_Reversas_Pacientes_${fechaDesde}_${fechaHasta}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1600px', margin: '0 auto', color: '#1e293b' }}>
      
      {/* ── Header Principal ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '2rem' }}>🧾</span>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#004687', margin: 0, letterSpacing: '-0.02em' }}>
                Cargos y Reversas por Paciente
              </h1>
              <p style={{ margin: '2px 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                Auditoría consolidada de consumos hospitalarios, reversas, costo de compra (SAP B1), precio de venta y unidades de servicio (ej. Carro Rojo).
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              padding: '0.6rem 1rem', background: '#fff', border: '1px solid #cbd5e1',
              borderRadius: 8, color: '#334155', fontWeight: 600, fontSize: '0.82rem',
              cursor: 'pointer', transition: 'all 0.15s ease'
            }}
          >
            🔄 Actualizar
          </button>

          <button
            onClick={handleExportExcel}
            disabled={rows.length === 0}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              padding: '0.6rem 1.2rem', background: '#00974A', border: 'none',
              borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: '0.85rem',
              cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
              opacity: rows.length === 0 ? 0.6 : 1,
              boxShadow: '0 4px 12px rgba(0,151,74,0.3)',
              transition: 'all 0.2s ease'
            }}
          >
            📥 Exportar Excel Oficial
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem'
      }}>
        {/* Total Movimientos */}
        <div style={{ background: '#fff', padding: '1.1rem', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Total Movimientos</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#004687', marginTop: '0.3rem' }}>
            {filteredMetrics.totalRegistros.toLocaleString('es-MX')}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '0.2rem' }}>
            {filteredMetrics.cantCargada.toLocaleString('es-MX')} pzas cargadas | {filteredMetrics.cantReversada.toLocaleString('es-MX')} devueltas
          </div>
        </div>

        {/* Total Cargos (Venta) */}
        <div style={{ background: '#fff', padding: '1.1rem', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#004687', textTransform: 'uppercase' }}>Total Cargado (Venta)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#004687', marginTop: '0.3rem' }}>
            ${filteredMetrics.ventaCargada.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#0088C9', marginTop: '0.2rem' }}>
            Precio facturado a pacientes
          </div>
        </div>

        {/* Total Reversas */}
        <div style={{ background: '#fff', padding: '1.1rem', borderRadius: '12px', border: '1px solid #FEE2E2', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase' }}>Total Reversado (Devoluciones)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#DC2626', marginTop: '0.3rem' }}>
            ${filteredMetrics.ventaReversada.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#991B1B', marginTop: '0.2rem' }}>
            Reversas y cancelaciones
          </div>
        </div>

        {/* Costo de Compra SAP */}
        <div style={{ background: '#fff', padding: '1.1rem', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#B45309', textTransform: 'uppercase' }}>Costo de Compra (SAP B1)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#B45309', marginTop: '0.3rem' }}>
            ${filteredMetrics.costoCompra.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#92400E', marginTop: '0.2rem' }}>
            Costo ponderado de adquisición
          </div>
        </div>

        {/* Margen Neto */}
        <div style={{ background: '#fff', padding: '1.1rem', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803D', textTransform: 'uppercase' }}>Margen Operativo Neto</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: filteredMetrics.margenNeto >= 0 ? '#15803D' : '#DC2626', marginTop: '0.3rem' }}>
            ${filteredMetrics.margenNeto.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.2rem' }}>
            Margen: {filteredMetrics.margenPct.toFixed(1)}% sobre venta neta
          </div>
        </div>
      </div>

      {/* ── Barra de Filtros ── */}
      <div style={{
        background: '#fff',
        padding: '1.2rem',
        borderRadius: '12px',
        border: '1px solid #E2E8F0',
        marginBottom: '1.5rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'flex-end'
      }}>
        {/* Fechas */}
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            Fecha Desde
          </label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            style={{
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem'
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            Fecha Hasta
          </label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            style={{
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem'
            }}
          />
        </div>

        {/* Atajos Rápidos */}
        <div style={{ display: 'flex', gap: '0.35rem', alignSelf: 'flex-end', paddingBottom: '2px' }}>
          <button
            onClick={() => { setFechaDesde(getTodayStr()); setFechaHasta(getTodayStr()); }}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}
          >
            Hoy
          </button>
          <button
            onClick={() => { setFechaDesde(getDaysAgoStr(1)); setFechaHasta(getDaysAgoStr(1)); }}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}
          >
            Ayer
          </button>
          <button
            onClick={() => { setFechaDesde(getDaysAgoStr(7)); setFechaHasta(getTodayStr()); }}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}
          >
            7 Días
          </button>
          <button
            onClick={() => { setFechaDesde(getDaysAgoStr(30)); setFechaHasta(getTodayStr()); }}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}
          >
            30 Días
          </button>
        </div>

        {/* Tipo de Movimiento */}
        <div style={{ minWidth: '150px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            Tipo de Movimiento
          </label>
          <select
            value={tipoMovimiento}
            onChange={(e) => setTipoMovimiento(e.target.value)}
            style={{
              width: '100%',
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem'
            }}
          >
            <option value="TODOS">Todos (Cargos + Reversas)</option>
            <option value="CARGO">Solo Cargos</option>
            <option value="REVERSA">Solo Reversas / Devoluciones</option>
          </select>
        </div>

        {/* Unidad de Servicio */}
        <div style={{ minWidth: '180px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            Unidad de Servicio
          </label>
          <select
            value={unidadServicio}
            onChange={(e) => setUnidadServicio(e.target.value)}
            style={{
              width: '100%',
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem'
            }}
          >
            <option value="TODAS">Todas las Unidades</option>
            <option value="Carro Rojo">🚨 Carro Rojo (QXCR)</option>
            <option value="Quirófano">🏥 Quirófano (QX)</option>
            <option value="Farmacia">📦 Farmacia Central (FAR)</option>
            <option value="Urgencias">🚑 Urgencias</option>
            <option value="Hospitalización">🛏️ Hospitalización</option>
            <option value="UCI">❤️ Terapia Intensiva (UCI)</option>
            {unidadesDisponibles.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        {/* Búsqueda General */}
        <div style={{ flex: 1, minWidth: '220px' }}>
          <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '4px' }}>
            Búsqueda Rápida (Cuenta, Paciente, Insumo...)
          </label>
          <input
            type="text"
            placeholder="Escribe paciente, cuenta, insumo..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            style={{
              width: '100%',
              padding: '0.45rem 0.6rem',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '0.85rem',
              boxSizing: 'border-box'
            }}
          />
        </div>
      </div>

      {/* ── Mensaje de Error ── */}
      {error && (
        <div style={{
          background: '#FEE2E2', border: '1px solid #F87171', color: '#991B1B',
          padding: '1rem', borderRadius: '8px', marginBottom: '1rem', fontWeight: 600
        }}>
          ⚠️ Error al consultar movimientos: {error}
        </div>
      )}

      {/* ── Contenedor de Tabla con Doble Scroll ── */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
        
        {/* Scrollbar Superior Sincronizada */}
        <div
          ref={topScrollRef}
          onScroll={() => {
            if (topScrollRef.current && tableScrollRef.current) {
              tableScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft;
            }
          }}
          style={{ overflowX: 'auto', overflowY: 'hidden', height: '14px', background: '#F1F5F9' }}
        >
          <div style={{ width: `${tableScrollWidth}px`, height: '14px' }}></div>
        </div>

        {loading ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
            <PremiumLoader text="Consultando cargos, reversas y costos SAP..." />
          </div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: '#64748B' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📭</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>No se encontraron movimientos</div>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
              Prueba cambiando el rango de fechas o los filtros seleccionados.
            </p>
          </div>
        ) : (
          <div
            ref={tableScrollRef}
            onScroll={() => {
              if (topScrollRef.current && tableScrollRef.current) {
                topScrollRef.current.scrollLeft = tableScrollRef.current.scrollLeft;
              }
            }}
            style={{ overflowX: 'auto' }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr>
                  <ColumnFilter columnKey="cuenta" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="No. Cuenta" align="center" maxWidth="100px" />
                  <ColumnFilter columnKey="paciente" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Paciente" align="left" maxWidth="220px" />
                  <ColumnFilter columnKey="tipoMovimiento" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Tipo Mov." align="center" maxWidth="110px" />
                  <StaticTh label="Fecha y Hora" align="center" width="135px" />
                  <ColumnFilter columnKey="codigo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Código" align="center" maxWidth="90px" />
                  <ColumnFilter columnKey="insumo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Insumo / Medicamento" align="left" maxWidth="250px" />
                  <ColumnFilter columnKey="unidadServicio" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Unidad de Servicio" align="center" maxWidth="160px" />
                  <StaticTh label="Cant." align="center" width="60px" />
                  <StaticTh label="P. Venta ($)" align="right" width="100px" />
                  <StaticTh label="Total Venta ($)" align="right" width="105px" />
                  <StaticTh label="Costo Compra ($)" align="right" width="115px" />
                  <StaticTh label="Total Costo ($)" align="right" width="115px" />
                  <StaticTh label="Margen ($)" align="right" width="95px" />
                  <ColumnFilter columnKey="lote" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Lote" align="center" maxWidth="95px" />
                  <ColumnFilter columnKey="usuarioCargo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Responsable" align="left" maxWidth="180px" />
                  <ColumnFilter columnKey="medicoTratante" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="Médico" align="left" maxWidth="180px" />
                </tr>
              </thead>
              <tbody>
                {paginated.map((r, i) => {
                  const isCarroRojo = String(r.unidadServicio).toUpperCase().includes('CARRO ROJO');
                  return (
                    <tr
                      key={i}
                      style={{
                        background: r.isReversa ? '#FFF5F5' : i % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                        borderBottom: '1px solid #E2E8F0',
                        transition: 'background 0.1s ease'
                      }}
                    >
                      {/* Cuenta */}
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: '#004687' }}>
                        {r.cuenta}
                      </td>

                      {/* Paciente */}
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1E293B' }}>
                        <div>{r.paciente}</div>
                        <div style={{ fontSize: '0.7rem', color: '#64748B' }}>
                          Cama/Área: {r.areaDestino}
                        </div>
                      </td>

                      {/* Tipo Movimiento */}
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '12px',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          background: r.isReversa ? '#FEE2E2' : '#E0F2FE',
                          color: r.isReversa ? '#DC2626' : '#0369A1',
                          border: r.isReversa ? '1px solid #FCA5A5' : '1px solid #BAE6FD'
                        }}>
                          {r.tipoMovimiento}
                        </span>
                      </td>

                      {/* Fecha */}
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: '0.75rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {r.fechaMovimiento ? new Date(r.fechaMovimiento).toLocaleString('es-MX', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit'
                        }) : 'N/A'}
                      </td>

                      {/* Código */}
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', color: '#64748B' }}>
                        {r.codigo}
                      </td>

                      {/* Insumo */}
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1E293B' }}>
                        {r.insumo}
                      </td>

                      {/* Unidad de Servicio */}
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: isCarroRojo ? 800 : 600,
                          background: isCarroRojo ? '#DC2626' : '#F1F5F9',
                          color: isCarroRojo ? '#FFFFFF' : '#334155',
                          border: isCarroRojo ? '1px solid #B91C1C' : '1px solid #CBD5E1'
                        }}>
                          {isCarroRojo ? '🚨 ' : ''}{r.unidadServicio}
                        </span>
                      </td>

                      {/* Cantidad */}
                      <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: r.isReversa ? '#DC2626' : '#004687' }}>
                        {r.isReversa ? `-${r.cantidad}` : r.cantidad}
                      </td>

                      {/* Precio Venta Unitario */}
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#475569' }}>
                        ${Number(r.precioVentaUnitario).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Total Venta */}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: r.isReversa ? '#DC2626' : '#15803D' }}>
                        ${Number(r.precioVentaTotal).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Costo Compra Unitario */}
                      <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748B' }}>
                        ${Number(r.costoCompraUnitario).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Total Costo */}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#B45309' }}>
                        ${Number(r.costoCompraTotal).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Margen */}
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: r.margenMonto >= 0 ? '#15803D' : '#DC2626' }}>
                        ${Number(r.margenMonto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>

                      {/* Lote */}
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        {r.lote && r.lote !== 'N/A' ? (
                          <span style={{ background: '#FEF3C7', color: '#92400E', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
                            {r.lote}
                          </span>
                        ) : (
                          <span style={{ color: '#94A3B8' }}>-</span>
                        )}
                      </td>

                      {/* Responsable */}
                      <td style={{ padding: '8px 10px', color: '#334155' }}>
                        <div>{r.usuarioCargo}</div>
                        {r.deptoUsuarioCargo && (
                          <div style={{ fontSize: '0.68rem', color: '#64748B' }}>{r.deptoUsuarioCargo}</div>
                        )}
                      </td>

                      {/* Médico */}
                      <td style={{ padding: '8px 10px', color: '#475569', fontSize: '0.75rem' }}>
                        {r.medicoTratante}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Paginador ── */}
        {!loading && filtered.length > PER_PAGE && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1rem',
            background: '#F8FAFC',
            borderTop: '1px solid #E2E8F0',
            fontSize: '0.85rem'
          }}>
            <div style={{ color: '#64748B' }}>
              Mostrando {((page - 1) * PER_PAGE) + 1} a {Math.min(page * PER_PAGE, filtered.length)} de {filtered.length} registros
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: page === 1 ? '#e2e8f0' : '#fff',
                  cursor: page === 1 ? 'not-allowed' : 'pointer'
                }}
              >
                Anterior
              </button>
              <span style={{ padding: '0.35rem 0.75rem', fontWeight: 700, color: '#004687' }}>
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: page === totalPages ? '#e2e8f0' : '#fff',
                  cursor: page === totalPages ? 'not-allowed' : 'pointer'
                }}
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
