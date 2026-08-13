import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import EstadoCuentaModal from '../shared/EstadoCuentaModal';
import FacturaProveedorModal from '../shared/FacturaProveedorModal';
import ReciboIngresoModal from '../shared/ReciboIngresoModal';
import PremiumLoader from '../shared/PremiumLoader';
import ExportButton from '../shared/ExportButton';
import { API_BASE } from '../../api/config';

const formatCurrency = (val) => {
  if (val == null) return '-';
  return '$' + parseFloat(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
};

const COLORS = ['#004687', '#0088C9', '#10B981', '#E8853D', '#8B5CF6'];

export default function DashboardFinanzasNativo({ globalFilters, globalTrigger }) {
  const [data, setData] = useState(null);
  const [mlData, setMlData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMl, setLoadingMl] = useState(false);
  const [activeTab, setActiveTab] = useState('HISTORIAL');
  const [error, setError] = useState(null);
  const [selectedPCNum, setSelectedPCNum] = useState(null);
  const [selectedFacturaDocNum, setSelectedFacturaDocNum] = useState(null);
  const [selectedIngresoDocNum, setSelectedIngresoDocNum] = useState(null);
  const [tipoFiltro, setTipoFiltro] = useState('TODOS');

  useEffect(() => {
    fetchData();
    fetchMlForecast();
  }, [globalFilters, globalTrigger]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = sessionStorage.getItem('escandon_token');
      let url = `${API_BASE}/dashboard/finanzas-nativo?`;
      if (globalFilters?.startDate) url += `startDate=${globalFilters.startDate}&`;
      if (globalFilters?.endDate) url += `endDate=${globalFilters.endDate}&`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Error al cargar datos');
      }
    } catch (err) {
      setError('Error de conexión con el servidor.');
    } finally {
      setLoading(false);
    }
  };

  const fetchMlForecast = async () => {
    setLoadingMl(true);
    try {
      const token = sessionStorage.getItem('escandon_token');
      const res = await fetch(`${API_BASE}/finanzas/ml-forecast`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.ok) {
        setMlData(json.data);
      }
    } catch (err) {
      console.error('Error cargando predicciones ML:', err);
    } finally {
      setLoadingMl(false);
    }
  };

  const runMlForecast = async () => {
    try {
      const token = sessionStorage.getItem('escandon_token');
      await fetch(`${API_BASE}/finanzas/ml-forecast/run`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      alert('Entrenamiento/Predicción iniciada en segundo plano. Los resultados se actualizarán pronto.');
      setTimeout(fetchMlForecast, 5000);
    } catch (err) {
      console.error('Error corriendo ML:', err);
    }
  };

  if (loading) return <PremiumLoader text="Cargando datos financieros..." style={{ height: '400px' }} />;
  if (error) return <div style={{ padding: 20, color: '#EF4444', background: '#FEE2E2', borderRadius: 8 }}>{error}</div>;
  if (!data || !data.metodosData) return <div style={{ textAlign: 'center', color: '#64748b' }}>Sin registros en las fechas seleccionadas...</div>;

  const { metodosData, transacciones, kpis } = data;

  const handleExportExcel = () => {
    if (!transacciones || transacciones.length === 0) return;

    const cols = [
      { header: 'TIPO', key: 'tipoStr', align: 'center', width: 90 },
      { header: 'FECHA', key: 'Fecha', align: 'center', width: 140, type: 'datetime' },
      { header: 'FOLIO / RECIBO', key: 'Code', align: 'center', width: 130 },
      { header: 'NO. CUENTA / BP', key: 'PCNum', align: 'center', width: 120 },
      { header: 'PACIENTE / PROVEEDOR', key: 'Paciente', align: 'left', width: 280 },
      { header: 'MÉTODO', key: 'MetodoNombre', align: 'center', width: 150 },
      { header: 'MONTO ($)', key: 'MontoVal', align: 'right', width: 120, type: 'money' },
    ];
    
    const fmt = (val, col) => {
      if (val == null || val === '') return '';
      if (col.type === 'datetime') return new Date(val).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
      if (col.type === 'money') return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const filtered = transacciones.filter(t => {
      const tipo = t.tipo || t.Tipo || (t.Code?.startsWith('FAC') ? 'EGRESO' : 'INGRESO');
      return tipoFiltro === 'TODOS' || tipo === tipoFiltro;
    }).map(t => {
      const isIngreso = (t.tipo || t.Tipo || (t.Code?.startsWith('FAC') ? 'EGRESO' : 'INGRESO')) === 'INGRESO';
      return {
        ...t,
        tipoStr: isIngreso ? 'INGRESO' : 'EGRESO',
        MontoVal: t.MontoPago ?? t.Monto ?? t.MontoTotal ?? 0
      };
    });

    const tMontoIn = filtered.filter(x => x.tipoStr === 'INGRESO').reduce((s, r) => s + (Number(r.MontoVal) || 0), 0);
    const tMontoOut = filtered.filter(x => x.tipoStr === 'EGRESO').reduce((s, r) => s + (Number(r.MontoVal) || 0), 0);
    
    const fechaReporte = new Date().toLocaleString('es-MX');
    
    const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:10pt;padding:6px 16px}
  .info-row td{font-size:9pt;color:#475569;padding:4px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:10pt;padding:10px 8px;border:1px solid #003366;text-align:center}
  td{padding:7px 8px;font-size:9pt;border:1px solid #D1D5DB;color:#1E293B}
  .even{background:#F4F6F9}.odd{background:#FFF}
  .money{font-weight:bold;text-align:right}
  .ingreso {color:#15803D;}
  .egreso {color:#B45309;}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:10pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte de Ingresos y Egresos (SAP Business One)</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Período: ${globalFilters?.startDate || 'Histórico'} al ${globalFilters?.endDate || 'Hoy'} &nbsp;|&nbsp; Tipo: ${tipoFiltro} &nbsp;|&nbsp; Registros: ${filtered.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filtered.map((row, i) => `<tr class="${i%2===0?'even':'odd'}">${cols.map(c => {
    let cls='', val=fmt(row[c.key],c);
    if(c.key === 'tipoStr') cls = row.tipoStr === 'INGRESO' ? ' class="ingreso"' : ' class="egreso"';
    if(c.type==='money') cls = row.tipoStr === 'INGRESO' ? ' class="money ingreso"' : ' class="money egreso"';
    return `<td${cls} style="text-align:${c.align}">${val}</td>`;
  }).join('')}</tr>`).join('')}
  <tr class="total-row">
    <td colspan="6" style="text-align:right">TOTAL INGRESOS</td>
    <td style="text-align:right">$${tMontoIn.toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
  </tr>
  <tr class="total-row">
    <td colspan="6" style="text-align:right">TOTAL EGRESOS</td>
    <td style="text-align:right">$${tMontoOut.toLocaleString('es-MX',{minimumFractionDigits:2})}</td>
  </tr>
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Ingresos_Egresos_SAP_${fechaReporte.replace(/[/:, ]/g, '_')}.xls`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const kpiCards = [
    { label: 'Ingresos Totales (Cobros)', value: `$${(kpis.totalIngresos||0).toLocaleString('en-US', {minimumFractionDigits:2})}`, delta: 'Vertical POS', up: true },
    { label: 'Total en Efectivo', value: `$${(kpis.totalEfectivo||0).toLocaleString('en-US', {minimumFractionDigits:2})}`, delta: 'MXN', up: true },
    { label: 'Egresos (Cuentas por Pagar)', value: `$${(kpis.totalEgresos||0).toLocaleString('en-US', {minimumFractionDigits:2})}`, delta: 'SAP B1', up: false },
    { label: 'Total Pagos', value: kpis.totalTransacciones, delta: 'Transacciones', up: null },
  ];

  return (
    <div id="dashboard-finanzas-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Hidden export buttons triggered by DashboardDirectivo header */}
      <div style={{ display: 'none' }}>
        <ExportButton id="export-pdf-btn" type="pdf" targetId="dashboard-finanzas-container" compact={true} />
        <button id="export-excel-btn" onClick={handleExportExcel}></button>
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '2px solid #e2e8f0', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setActiveTab('HISTORIAL')}
          style={{
            background: 'none', border: 'none', padding: '0.5rem 1rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
            color: activeTab === 'HISTORIAL' ? '#004687' : '#64748b',
            borderBottom: activeTab === 'HISTORIAL' ? '3px solid #004687' : 'none',
            marginBottom: '-0.6rem'
          }}
        >
          Historial Transaccional
        </button>
        <button
          onClick={() => setActiveTab('IA')}
          style={{
            background: 'none', border: 'none', padding: '0.5rem 1rem', fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
            color: activeTab === 'IA' ? '#8B5CF6' : '#64748b',
            borderBottom: activeTab === 'IA' ? '3px solid #8B5CF6' : 'none',
            marginBottom: '-0.6rem',
            display: 'flex', alignItems: 'center', gap: '0.5rem'
          }}
        >
          ✨ Proyecciones IA
        </button>
      </div>

      {activeTab === 'HISTORIAL' ? (
        <>
      {/* KPIs Section */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem'
      }}>
        {kpiCards.map((kpi, i) => (
          <div key={i} style={{
            background: 'var(--surface-raised)',
            borderRadius: 'var(--radius-md)',
            padding: '1.2rem 1.25rem',
            border: '1px solid rgba(0,70,135,0.07)',
            borderLeft: `4px solid ${i===0?'#10B981':i===1?'#3B82F6':i===2?'#EF4444':'#8B5CF6'}`,
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            boxSizing: 'border-box'
          }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.05em',
              textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '0.4rem'
            }}>
              {kpi.label}
            </div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '1.75rem', fontWeight: 600,
              color: 'var(--text-primary)', lineHeight: 1, marginBottom: '0.35rem',
              letterSpacing: '-0.02em'
            }}>
              {kpi.value}
            </div>
            {kpi.delta && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', fontWeight: 600 }}>
                {kpi.up !== null && (
                  <span style={{ color: kpi.up ? '#10B981' : '#EF4444', fontSize: '1rem' }}>
                    {kpi.up ? '▲' : '▼'}
                  </span>
                )}
                <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-body)' }}>{kpi.delta}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', border: '1px solid rgba(0,70,135,0.05)', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.1rem', fontWeight: 700 }}>Distribución por Método de Pago</h3>
          <div style={{ flex: 1, minHeight: '300px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={metodosData} dataKey="monto" nameKey="metodo" cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={3}>
                  {metodosData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', border: '1px solid rgba(0,70,135,0.05)' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: '#0f172a', fontSize: '1.1rem', fontWeight: 700 }}>Detalle por Método</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {metodosData.map((m, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: '#f8fafc', borderRadius: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: COLORS[idx % COLORS.length] }} />
                  <div>
                    <div style={{ fontWeight: 600, color: '#334155' }}>{m.metodo}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{m.transacciones} transacciones</div>
                  </div>
                </div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#0f172a' }}>{formatCurrency(m.monto)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)', border: '1px solid rgba(0,70,135,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: 700 }}>Últimos Movimientos Registrados</h3>
          
          {/* Filtro rápido por tipo de movimiento */}
          <div style={{ display: 'flex', gap: '0.5rem', background: '#F1F5F9', padding: '4px', borderRadius: '10px' }}>
            {[
              { id: 'TODOS', label: 'Todos' },
              { id: 'INGRESO', label: '🟢 Ingresos' },
              { id: 'EGRESO', label: '🔴 Egresos' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setTipoFiltro(f.id)}
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: tipoFiltro === f.id ? '#FFFFFF' : 'transparent',
                  color: tipoFiltro === f.id ? '#0F172A' : '#64748B',
                  fontWeight: tipoFiltro === f.id ? 700 : 500,
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  boxShadow: tipoFiltro === f.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease'
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                <th style={{ padding: '1rem' }}>TIPO</th>
                <th style={{ padding: '1rem' }}>FECHA</th>
                <th style={{ padding: '1rem' }}>FOLIO / RECIBO</th>
                <th style={{ padding: '1rem' }}>NO. CUENTA / BP</th>
                <th style={{ padding: '1rem' }}>PACIENTE / PROVEEDOR</th>
                <th style={{ padding: '1rem' }}>MÉTODO</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>MONTO</th>
                <th style={{ padding: '1rem', textAlign: 'center' }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {transacciones
                .filter(t => {
                  const tipo = t.tipo || t.Tipo || (t.Code?.startsWith('FAC') ? 'EGRESO' : 'INGRESO');
                  return tipoFiltro === 'TODOS' || tipo === tipoFiltro;
                })
                .map((t, idx) => {
                  const tipo = t.tipo || t.Tipo || (t.Code?.startsWith('FAC') ? 'EGRESO' : 'INGRESO');
                  const isIngreso = tipo === 'INGRESO';
                  const isNumericPCNum = !!t.PCNum; // Allowing any PCNum, including CTE00029
                  const montoVal = t.MontoPago ?? t.Monto ?? t.MontoTotal ?? 0;
                  return (
                    <tr 
                      key={idx} 
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.2s', cursor: (isNumericPCNum || (!isIngreso && t.DocNum)) ? 'pointer' : 'default' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onClick={() => {
                        if (isIngreso && t.DocNum) setSelectedIngresoDocNum(t.DocNum);
                        else if (!isIngreso && t.DocNum) setSelectedFacturaDocNum(t.DocNum);
                        else if (isIngreso && isNumericPCNum && !t.DocNum) setSelectedPCNum(t.PCNum);
                      }}
                      title={isIngreso && t.DocNum ? "Ver Recibo SAP" : (isNumericPCNum ? "Ver Estado de Cuenta" : (!isIngreso ? "Ver Factura de Proveedor SAP" : "Cobro Directo SAP B1"))}
                    >
                      <td style={{ padding: '1rem' }}>
                        <span style={{ 
                          background: isIngreso ? '#D1FAE5' : '#FEE2E2', 
                          color: isIngreso ? '#065F46' : '#991B1B', 
                          padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.7rem', fontWeight: 700 
                        }}>
                          {isIngreso ? '🟢 INGRESO' : '🔴 EGRESO'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', color: '#64748b' }}>{formatDate(t.Fecha)}</td>
                      <td style={{ padding: '1rem', fontFamily: 'monospace', color: '#64748b', fontWeight: 600 }}>{t.Code}</td>
                      <td style={{ padding: '1rem', fontWeight: 600, color: '#0f172a' }}>{t.PCNum || '-'}</td>
                      <td style={{ padding: '1rem', fontWeight: 500 }}>{t.Paciente || 'Desconocido'}</td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ background: '#DBEAFE', color: '#1E40AF', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600 }}>
                          {t.MetodoNombre}
                        </span>
                      </td>
                      <td style={{ padding: '1rem', fontWeight: 700, color: isIngreso ? '#10B981' : '#EF4444', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {isIngreso ? '+ ' : '- '} {formatCurrency(montoVal)}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        {isIngreso && t.DocNum ? (
                          <button 
                            onClick={(e) => { e.stopPropagation(); setSelectedIngresoDocNum(t.DocNum); }}
                            style={{ background: 'transparent', border: '1px solid #10B981', borderRadius: '6px', padding: '0.4rem 0.8rem', color: '#047857', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#ECFDF5'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            📄 Recibo SAP
                          </button>
                        ) : isIngreso && isNumericPCNum ? (
                          <button 
                            onClick={(e) => { e.stopPropagation(); setSelectedPCNum(t.PCNum); }}
                            style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.4rem 0.8rem', color: '#005FA9', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            📄 Estado
                          </button>
                        ) : !isIngreso && t.DocNum ? (
                          <button 
                            onClick={(e) => { e.stopPropagation(); setSelectedFacturaDocNum(t.DocNum); }}
                            style={{ background: 'transparent', border: '1px solid #FCA5A5', borderRadius: '6px', padding: '0.4rem 0.8rem', color: '#DC2626', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#FEE2E2'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            📄 Factura
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: '#64748b', background: '#F1F5F9', padding: '0.25rem 0.5rem', borderRadius: '4px', fontWeight: 500 }}>
                            {isIngreso ? 'SAP B1' : 'Factura SAP'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              {transacciones.filter(t => {
                const tipo = t.tipo || t.Tipo || (t.Code?.startsWith('FAC') ? 'EGRESO' : 'INGRESO');
                return tipoFiltro === 'TODOS' || tipo === tipoFiltro;
              }).length === 0 && (
                <tr>
                  <td colSpan="8" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    No hay movimientos registrados del tipo seleccionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPCNum && (
        <EstadoCuentaModal 
          pcNum={selectedPCNum}
          onClose={() => setSelectedPCNum(null)}
        />
      )}

      {selectedFacturaDocNum && (
        <FacturaProveedorModal 
          docNum={selectedFacturaDocNum}
          onClose={() => setSelectedFacturaDocNum(null)}
        />
      )}

      {selectedIngresoDocNum && (
        <ReciboIngresoModal 
          docNum={selectedIngresoDocNum}
          onClose={() => setSelectedIngresoDocNum(null)}
        />
      )}
      </>
      ) : (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: '#0f172a', fontSize: '1.1rem', fontWeight: 700 }}>Proyección de Ingresos (Próximo Mes)</h3>
            <button 
              onClick={runMlForecast}
              style={{ background: '#8B5CF6', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
            >
              🔄 Recalcular Proyecciones
            </button>
          </div>
          
          {loadingMl ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Cargando modelo predictivo...</div>
          ) : mlData.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>No hay proyecciones generadas. Haz clic en recalcular.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0', color: '#64748b', textTransform: 'uppercase', fontSize: '0.75rem' }}>
                    <th style={{ padding: '1rem' }}>Periodo Predicho</th>
                    <th style={{ padding: '1rem' }}>Área / Servicio</th>
                    <th style={{ padding: '1rem', textAlign: 'right' }}>Ingreso Estimado</th>
                    <th style={{ padding: '1rem', textAlign: 'right' }}>Rango (Bajo - Alto)</th>
                    <th style={{ padding: '1rem', textAlign: 'center' }}>Modelo</th>
                  </tr>
                </thead>
                <tbody>
                  {mlData.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '1rem', fontWeight: 600 }}>{row.periodo_predicho}</td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ fontWeight: 600, color: '#334155' }}>{row.area}</div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{row.servicio}</div>
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 700, color: '#10B981', fontSize: '1.05rem' }}>
                        {formatCurrency(row.ingreso_estimado)}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right', color: '#64748b', fontSize: '0.85rem' }}>
                        {formatCurrency(row.intervalo_bajo)} - {formatCurrency(row.intervalo_alto)}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        <span style={{ background: '#F3E8FF', color: '#7E22CE', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>
                          {row.modelo_version}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
