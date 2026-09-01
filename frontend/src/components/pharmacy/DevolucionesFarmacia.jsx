import { useState, useEffect, useMemo, useRef } from 'react';
import PremiumLoader from '../shared/PremiumLoader';
import ExportButton from '../shared/ExportButton';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';

const ColumnFilter = ({ columnKey, data, colFilters, setColFilters, label, align = 'left', maxWidth }) => {
  const uniqueVals = Array.from(new Set(data.map(item => item[columnKey]))).filter(Boolean).sort();
  const val = colFilters[columnKey] || '';
  return (
    <th style={{ textAlign: align, maxWidth: maxWidth || 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: '#8A97A8' }}>{label}</span>
        <select
          value={val}
          onChange={(e) => setColFilters(prev => ({ ...prev, [columnKey]: e.target.value }))}
          style={{
            fontSize: '0.7rem', padding: '2px 4px', borderRadius: '4px',
            border: '1px solid #E2E8F0', background: '#F8FAFC', outline: 'none',
            maxWidth: maxWidth || '100%', textOverflow: 'ellipsis'
          }}
        >
          <option value="">Todos</option>
          {uniqueVals.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
    </th>
  );
};

export default function DevolucionesFarmacia() {
  // ----------------------------------------------------
  // MANEJO DE DOBLE BARRA DE DESPLAZAMIENTO (ARRIBA Y ABAJO)
  // ----------------------------------------------------
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);
  const [tableScrollWidth, setTableScrollWidth] = useState(1200);

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

  const [colFilters, setColFilters] = useState({});
  const [page, setPage] = useState(1);
  const PER_PAGE = 100;

  useEffect(() => {
    setPage(1);
  }, [colFilters]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams({ fechaDesde, fechaHasta });
        const res = await fetch(`${API_BASE}/pharmacy/devoluciones?${q}`, {
          headers: authHeaders()
        });
        if (!res.ok) throw new Error('Error al cargar datos de devoluciones');
        const json = await res.json();
        setData(json);
        setPage(1);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [fechaDesde, fechaHasta]);

  useEffect(() => {
    // Mantener sincronizado el ancho del scroll de arriba con el tamaño real de la tabla
    const tableContainer = tableScrollRef.current;
    if (!tableContainer) return;

    const observer = new ResizeObserver(() => {
      if (tableContainer.scrollWidth > 0) {
        setTableScrollWidth(tableContainer.scrollWidth);
      }
    });
    
    observer.observe(tableContainer);
    if (tableContainer.firstChild) {
      observer.observe(tableContainer.firstChild);
    }

    return () => observer.disconnect();
  }, [data]); // Using data instead of paginated, since it re-renders the DOM elements

  const rows = data?.data || [];

  const printTicket = (p) => {
    // 1. Agrupar todos los artículos que pertenecen a la misma devolución.
    // Usaremos la misma Orden (PCPRNum) y la misma Fecha/Hora (CreatedOn) para agrupar.
    const ticketItems = rows.filter(r => 
      r.Orden === p.Orden && 
      r.FechaDevolucion === p.FechaDevolucion
    );

    const w = window.open('', '_blank', 'width=350,height=600');
    if (!w) {
      alert('Por favor, deshabilite el bloqueador de ventanas emergentes (pop-ups) para imprimir el ticket.');
      return;
    }

    const fechaNac = p.FechaNacimiento ? new Date(p.FechaNacimiento).toLocaleDateString('es-MX') : 'N/A';
    const fechaHora = p.FechaDevolucion ? new Date(p.FechaDevolucion).toLocaleString('es-MX') : 'N/A';

    // 2. Calcular los totales sumando todos los artículos del ticket
    let suma = 0;
    let ivaTotal = 0;
    
    // Construir las filas de la tabla de artículos
    const itemsHtml = ticketItems.map(item => {
      // Usamos TotalLinea o (Precio * Cantidad)
      const importeLinea = item.TotalLinea ?? (item.PrecioUnitario * item.CantidadDevuelta);
      const ivaLinea = item.IVA ?? 0;
      
      suma += importeLinea;
      ivaTotal += ivaLinea;

      return `
        <tr>
          <td class="text-center">${item.CantidadDevuelta}</td>
          <td>${item.Codigo} - ${item.Insumo}</td>
          <td>${item.Lote || 'N/A'}<br>exp. ${item.Caducidad ? new Date(item.Caducidad).toLocaleDateString('es-MX') : 'N/A'}</td>
          <td class="text-right">$${(item.PrecioUnitario || 0).toFixed(2)}</td>
          <td class="text-right">$${importeLinea.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const descuento = 0; // Por defecto $0.00
    const importeTotal = suma - descuento;
    const totalNeto = importeTotal + ivaTotal;

    const logoUrl = window.location.origin + '/logo-escandon.png';
    
    // HTML y estilos enfocados 100% en impresión térmica (80mm o 58mm ajustado)
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ticket Devolución - ${p.Orden}</title>
        <style>
          /* Estilos base para impresora térmica */
          body { font-family: monospace; font-size: 10px; margin: 0; padding: 5px; color: black; width: 100%; max-width: 100%; box-sizing: border-box; }
          .header { text-align: center; margin-bottom: 8px; }
          .title { text-align: center; font-weight: bold; border-top: 1px dashed black; border-bottom: 1px dashed black; padding: 4px 0; margin-bottom: 8px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9px; table-layout: fixed; word-wrap: break-word; }
          th, td { border: 1px solid #ccc; padding: 2px; text-align: left; vertical-align: top; overflow: hidden; }
          th { background: #f0f0f0; }
          
          /* Proporciones de las columnas para evitar que se desborde */
          th:nth-child(1), td:nth-child(1) { width: 10%; text-align: center; } /* CANT */
          th:nth-child(2), td:nth-child(2) { width: 40%; } /* PRODUCTO */
          th:nth-child(3), td:nth-child(3) { width: 22%; } /* LOTE */
          th:nth-child(4), td:nth-child(4) { width: 14%; text-align: right; } /* PRECIO */
          th:nth-child(5), td:nth-child(5) { width: 14%; text-align: right; } /* IMPORT */

          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .info-box { border: 1px dashed black; padding: 4px; margin-bottom: 4px; }
          .footer-table { width: 70%; margin-left: auto; table-layout: auto; font-size: 10px; }
          .footer-table td { border: 1px solid #ccc; padding: 2px; }
          
          @media print {
            @page { margin: 0; }
            body { 
              padding: 2mm;
              width: 100%; 
              max-width: 76mm;
              margin: 0 auto;
              box-sizing: border-box;
            }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="${logoUrl}" alt="Logo Hospital Escandón" style="width: 100%; max-width: 230px; margin-bottom: 5px; filter: grayscale(100%) brightness(0.6) contrast(100);" />
        </div>
        
        <div class="title">TICKET DEVOLUCIÓN DE FARMACIA</div>

        <div style="display: flex; justify-content: space-between;">
          <div class="info-box" style="flex: 1; margin-right: 5px;">No Req: <br><strong>${p.Orden || 'N/A'}</strong></div>
          <div class="info-box" style="flex: 2;">Habitación: <br><strong>${p.Cama || 'N/A'}</strong></div>
        </div>
        
        <div class="info-box">
          Folio: <strong>${p.Cuenta || 'N/A'}</strong>
        </div>

        <div class="info-box">
          ${p.Paciente || 'N/A'}<br>
          F. Nac.: ${fechaNac}
        </div>

        <div class="info-box text-center">
          Fecha / Hora: ${fechaHora}
        </div>

        <table>
          <thead>
            <tr>
              <th>CANT.</th>
              <th>PRODUCTO</th>
              <th>LOTE</th>
              <th>PRECIO</th>
              <th>IMPORT</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <table class="footer-table">
          <tr><td>SUMA</td><td class="text-right">$${suma.toFixed(2)}</td></tr>
          <tr><td>DESCUENTO</td><td class="text-right">$${descuento.toFixed(2)}</td></tr>
          <tr><td>IMPORTE</td><td class="text-right">$${importeTotal.toFixed(2)}</td></tr>
          <tr><td>IVA</td><td class="text-right">$${ivaTotal.toFixed(2)}</td></tr>
          <tr><td><strong>TOTAL</strong></td><td class="text-right"><strong>$${totalNeto.toFixed(2)}</strong></td></tr>
        </table>

        <div class="info-box">
          Usuario Solicita: ${p.UAbierto || 'N/A'}<br>
          Usuario Procesa: ${p.UConfirma || p.UsuarioProceso || 'N/A'}<br>
          Médico: ${p.Medico || 'N/A'}
        </div>

        <div class="info-box text-center">
          Estado: <strong>${p.Estado || 'N/A'}</strong> | Línea: <strong>${p.EstadoLinea || 'N/A'}</strong>
        </div>

        <div class="info-box text-center">
          *** Gracias por su preferencia ***
        </div>
        
        <div style="text-align: center; margin-top: 15px;">
          <button onclick="window.print()" style="padding: 10px 20px; cursor: pointer;">Imprimir</button>
        </div>
      </body>
      </html>
    `;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const exportToExcel = () => {
    if (filtered.length === 0) {
      alert('No hay devoluciones para exportar con los filtros seleccionados.');
      return;
    }

    const cols = [
      { header: 'Folio Ticket', key: 'Cuenta', align: 'center', width: 90 },
      { header: 'No. Requisición', key: 'Orden', align: 'center', width: 100 },
      { header: 'Fecha Devolución', key: 'FechaDevolucion', align: 'center', width: 140, type: 'datetime' },
      { header: 'Estado', key: 'EstadoLinea', align: 'center', width: 110 },
      { header: 'Solicita', key: 'UAbierto', align: 'left', width: 140 },
      { header: 'Acepta', key: 'UConfirma', align: 'left', width: 140 },
      { header: 'Paciente', key: 'Paciente', align: 'left', width: 220 },
      { header: 'Cama', key: 'Cama', align: 'center', width: 90 },
      { header: 'Código', key: 'Codigo', width: 100, align: 'center' },
      { header: 'Insumo / Medicamento', key: 'Insumo', align: 'left', width: 280 },
      { header: 'Cant. Devuelta', key: 'CantidadDevuelta', align: 'center', width: 100, type: 'num' },
      { header: 'Precio Unitario ($)', key: 'PrecioUnitario', align: 'right', width: 110, type: 'money' },
      { header: 'Monto Total ($)', key: 'Monto', align: 'right', width: 110, type: 'money' }
    ];

    const fmt = (val, col) => {
      if (val == null || val === '') return '';
      if (col.type === 'date') return new Date(val).toLocaleDateString('es-MX');
      if (col.type === 'datetime') return new Date(val).toLocaleString('es-MX');
      if (col.type === 'money') return `$${Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    const tMonto = filtered.reduce((s, r) => s + (Number(r.Monto) || 0), 0);
    const tCant = filtered.reduce((s, r) => s + (Number(r.CantidadDevuelta) || 0), 0);
    const fechaReporte = new Date().toLocaleString('es-MX');

    const activeColFiltersStr = Object.entries(colFilters)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: "${v}"`)
      .join(', ');

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
  .money{color:#15803D;font-weight:bold;text-align:right}
  .code{color:#005FA9;font-weight:bold}
  .devuelto{background:#D1FAE5;color:#065F46;font-weight:bold}
  .total-row td{background:#E0EAF4;font-weight:bold;color:#004687;border-top:2px solid #004687;font-size:10pt;padding:10px 8px}
</style></head><body>
<table>
  <tr><td colspan="${cols.length}" class="title-bar">HOSPITAL ESCANDÓN</td></tr>
  <tr><td colspan="${cols.length}" class="subtitle-bar">Reporte de Devoluciones de Farmacia a Áreas Clínicas</td></tr>
  <tr class="info-row"><td colspan="${cols.length}">Período: ${fechaDesde || 'Inicio'} al ${fechaHasta || 'Hoy'} &nbsp;|&nbsp; Filtros activos: ${activeColFiltersStr || 'Ninguno (Todos)'} &nbsp;|&nbsp; Registros: ${filtered.length} &nbsp;|&nbsp; Generado: ${fechaReporte}</td></tr>
  <tr><td colspan="${cols.length}" style="height:6px;border:none"></td></tr>
  <tr>${cols.map(c => `<th style="width:${c.width}px">${c.header}</th>`).join('')}</tr>
  ${filtered.map((row, i) => `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${cols.map(c => {
    let cls = '', val = fmt(row[c.key], c);
    if (c.key === 'Codigo') cls = ' class="code"';
    if (c.key === 'EstadoLinea' && row.EstadoLinea === 'DEVUELTO') cls = ' class="devuelto"';
    if (c.type === 'money') cls = ' class="money"';
    return `<td${cls} style="text-align:${c.align}">${val}</td>`;
  }).join('')}</tr>`).join('')}
  <tr class="total-row">
    <td colspan="10" style="text-align:right">TOTALES</td>
    <td style="text-align:center">${tCant.toLocaleString('es-MX')}</td>
    <td></td>
    <td style="text-align:right">$${tMonto.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
  </tr>
</table></body></html>`;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Devoluciones_Farmacia_${fechaDesde || 'inicio'}_${fechaHasta || 'hoy'}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    return rows.filter(item => {
      return Object.keys(colFilters).every(key => {
        if (!colFilters[key]) return true;
        return String(item[key] ?? '').trim().toLowerCase() === String(colFilters[key]).trim().toLowerCase();
      });
    });
  }, [rows, colFilters]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    return filtered.slice(start, start + PER_PAGE);
  }, [filtered, page]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));

  const summaryStats = {
    totalPartidas: filtered.length,
    totalArticulos: filtered.reduce((acc, curr) => acc + (curr.CantidadDevuelta || 0), 0),
    montoRealCobrado: filtered.reduce((acc, curr) => acc + (curr.MontoCobrado || 0), 0),
    pacientesImpactados: new Set(filtered.map(x => x.Cuenta)).size
  };

  if (loading && !data) {
    return <PremiumLoader text="Conectando con Farmacia..." />;
  }

  const handleTopScroll = (e) => {
    if (tableScrollRef.current && tableScrollRef.current.scrollLeft !== e.target.scrollLeft) {
      tableScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  const handleTableScroll = (e) => {
    if (topScrollRef.current && topScrollRef.current.scrollLeft !== e.target.scrollLeft) {
      topScrollRef.current.scrollLeft = e.target.scrollLeft;
    }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white', padding: '1rem 1.5rem', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,70,135,0.1)' }}>
        <div>
          <h2 style={{ margin: 0, color: '#004687', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            💊 Devoluciones de Farmacia
            <span style={{ background: '#004687', color: 'white', fontSize: '0.6rem', padding: '2px 6px', borderRadius: 4, letterSpacing: '0.05em' }}>MÓDULO FARMACIA</span>
          </h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748B', marginTop: '0.2rem' }}>
            Auditoría de reingresos físicos a farmacia desde las áreas clínicas.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Desde</label>
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.8rem', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <label style={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Hasta</label>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} style={{ padding: '0.4rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.8rem', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '0.5rem' }}>
            <button
              onClick={() => {
                setColFilters({});
                setFechaDesde('');
                setFechaHasta('');
              }}
              style={{
                padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #E2E8F0', 
                background: 'white', 
                color: '#64748B', 
                fontSize: '0.8rem', cursor: 'pointer', 
                fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' 
              }}
              title="Limpiar todos los filtros de las columnas"
            >
              🧹 Limpiar Filtros
            </button>
            <button
              onClick={exportToExcel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.6rem 1.1rem',
                background: '#00974A',
                border: 'none',
                borderRadius: 10,
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,151,74,0.35)',
                transition: 'all 0.2s ease'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>
                <line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/>
              </svg>
              Exportar Excel
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ background: '#FEF2F2', color: '#DC2626', padding: '1rem', borderRadius: 8, border: '1px solid #FECACA' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div style={{ background: 'white', borderRadius: 8, padding: '0.8rem 1rem', border: '1px solid rgba(0,70,135,0.07)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#8A97A8', marginBottom: '0.2rem' }}>Total Registros</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: '1.25rem', fontWeight: 700, color: '#004687' }}>{summaryStats.totalPartidas.toLocaleString('es-MX')}</div>
          </div>
          <span style={{ fontSize: '1.4rem', opacity: 0.8 }}>📋</span>
        </div>

        <div style={{ background: 'white', borderRadius: 8, padding: '0.8rem 1rem', border: '1px solid rgba(0,70,135,0.07)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#8A97A8', marginBottom: '0.2rem' }}>Artículos Devueltos</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: '1.25rem', fontWeight: 700, color: '#004687' }}>{summaryStats.totalArticulos.toLocaleString('es-MX')}</div>
          </div>
          <span style={{ fontSize: '1.4rem', opacity: 0.8 }}>↩️</span>
        </div>

        <div style={{ background: 'white', borderRadius: 8, padding: '0.8rem 1rem', border: '1px solid rgba(0,70,135,0.07)', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: '#8A97A8', marginBottom: '0.2rem' }}>Pacientes Impactados</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: '1.25rem', fontWeight: 700, color: '#004687' }}>{summaryStats.pacientesImpactados.toLocaleString('es-MX')}</div>
          </div>
          <span style={{ fontSize: '1.4rem', opacity: 0.8 }}>👥</span>
        </div>
      </div>

      {/* TABLE */}
      <div style={{ flex: 1, background: 'white', borderRadius: '12px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 6px rgba(0,0,0,0.02)', border: '1px solid rgba(0,70,135,0.1)', overflow: 'hidden' }}>
        
        {loading && <div style={{ padding: '0.5rem', background: '#FEF3C7', color: '#B45309', fontSize: '0.75rem', textAlign: 'center', fontWeight: 600 }}>Actualizando datos...</div>}

        {/* Scrollbar Superior */}
        <div 
          ref={topScrollRef} 
          onScroll={handleTopScroll} 
          style={{ overflowX: 'auto', overflowY: 'hidden', height: '14px', flexShrink: 0 }}
        >
          <div style={{ width: `${tableScrollWidth}px`, height: '14px' }}>&nbsp;</div>
        </div>

        <div ref={tableScrollRef} onScroll={handleTableScroll} style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
          <table className="premium-table" style={{ width: '100%', minWidth: '1000px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#F8FAFC', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <tr>
                <ColumnFilter columnKey="Cuenta" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="FOLIO TICKET" maxWidth="90px" />
                <ColumnFilter columnKey="Orden" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="NO. REQ." maxWidth="90px" />
                <th style={{ textAlign: 'left', fontSize: '0.65rem', color: '#8A97A8', paddingBottom: '20px' }}>FECHA</th>
                <ColumnFilter columnKey="EstadoLinea" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="ESTADO" />
                <ColumnFilter columnKey="UAbierto" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="SOLICITA" />
                <ColumnFilter columnKey="UConfirma" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="ACEPTA" />
                <ColumnFilter columnKey="Paciente" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="PACIENTE" maxWidth="150px" />
                <ColumnFilter columnKey="Cama" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="CAMA" maxWidth="80px" />
                <ColumnFilter columnKey="Codigo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="CÓDIGO" />
                <ColumnFilter columnKey="Insumo" data={rows} colFilters={colFilters} setColFilters={setColFilters} label="INSUMO" maxWidth="250px" />
                <th style={{ textAlign: 'center' }}>CANTIDAD DEVUELTA</th>
                <th style={{ textAlign: 'right' }}>MONTO ($)</th>
                <th style={{ textAlign: 'center', width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan="12" style={{ textAlign: 'center', padding: '3rem', color: '#94A3B8' }}>
                    No se encontraron registros de devoluciones.
                  </td>
                </tr>
              ) : (
                paginated.map((p, idx) => (
                  <tr key={idx} style={{ transition: 'background 0.2s' }}>
                    <td><strong style={{ color: '#004687', fontFamily: 'var(--font-mono)' }}>{p.Cuenta || 'N/A'}</strong></td>
                    <td><span style={{ color: '#475569', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{p.Orden || 'N/A'}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(p.FechaDevolucion).toLocaleDateString('es-MX')} {new Date(p.FechaDevolucion).toLocaleTimeString('es-MX', {hour: '2-digit', minute:'2-digit'})}</td>
                    <td>
                      <span style={{ 
                        background: p.EstadoLinea === 'DEVUELTO' ? '#D1FAE5' : '#FEF3C7', 
                        color: p.EstadoLinea === 'DEVUELTO' ? '#065F46' : '#92400E', 
                        padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600
                      }}>
                        {p.EstadoLinea || 'N/A'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#475569' }}>{p.UAbierto || 'N/A'}</td>
                    <td style={{ fontWeight: 600, color: '#004687' }}>{p.UConfirma || 'N/A'}</td>
                    <td style={{ maxWidth: '150px', fontSize: '0.8rem', whiteSpace: 'normal', wordWrap: 'break-word' }}>{p.Paciente}</td>
                    <td style={{ maxWidth: '80px', whiteSpace: 'normal', wordWrap: 'break-word' }}><span style={{ background: '#F1F5F9', padding: '2px 6px', borderRadius: 4, fontSize: '0.75rem', color: '#475569' }}>{p.Cama || 'N/A'}</span></td>
                    <td><code style={{ fontSize: '0.75rem', color: '#475569' }}>{p.Codigo}</code></td>
                    <td style={{ maxWidth: '250px', whiteSpace: 'normal', wordWrap: 'break-word' }}>{p.Insumo}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700, color: '#F59E0B' }}>{p.CantidadDevuelta}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#00974A' }}>${p.Monto?.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    <td style={{ textAlign: 'center' }}>
                      <button 
                        onClick={() => printTicket(p)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
                        title="Generar Ticket"
                      >
                        🖨️
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* FOOTER */}
        <div style={{ padding: '0.75rem 1.5rem', background: '#F8FAFC', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748B' }}>
            Mostrando <strong style={{ color: '#004687' }}>{paginated.length}</strong> de <strong style={{ color: '#004687' }}>{filtered.length}</strong> registros
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))} 
              disabled={page === 1}
              style={{ padding: '0.25rem 0.75rem', borderRadius: 4, border: '1px solid #CBD5E1', background: page === 1 ? '#F1F5F9' : 'white', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
            >
              Anterior
            </button>
            <span style={{ fontSize: '0.8rem', color: '#475569', margin: '0 0.5rem' }}>Página {page} de {totalPages}</span>
            <button 
              onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
              disabled={page === totalPages || totalPages === 0}
              style={{ padding: '0.25rem 0.75rem', borderRadius: 4, border: '1px solid #CBD5E1', background: (page === totalPages || totalPages === 0) ? '#F1F5F9' : 'white', cursor: (page === totalPages || totalPages === 0) ? 'not-allowed' : 'pointer' }}
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
