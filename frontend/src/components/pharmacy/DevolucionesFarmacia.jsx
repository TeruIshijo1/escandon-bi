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

  const filtered = useMemo(() => {
    return rows.filter(item => {
      return Object.keys(colFilters).every(key => {
        if (!colFilters[key]) return true;
        return String(item[key]) === String(colFilters[key]);
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
            <ExportButton type="excel" variant="solid" reportId="devoluciones-farmacia" queryParams={{ fechaDesde, fechaHasta }} />
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
                  <td colSpan="10" style={{ textAlign: 'center', padding: '3rem', color: '#94A3B8' }}>
                    No se encontraron registros de devoluciones.
                  </td>
                </tr>
              ) : (
                paginated.map((p, idx) => (
                  <tr key={idx} style={{ transition: 'background 0.2s' }}>
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
