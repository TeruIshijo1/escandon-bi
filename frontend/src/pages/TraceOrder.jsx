import React, { useState } from 'react';
import axios from 'axios';

const TraceOrder = () => {
  const [docNum, setDocNum] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const handleSearch = async () => {
    if (!docNum) return;
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await axios.get(`/api/sap/trace-order/${docNum}`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('escandon_token')}`
        }
      });
      setData(response.data.data);
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || err.message || 'Error al buscar la orden');
    } finally {
      setLoading(false);
    }
  };

  /* ── Estilos reutilizables ─────────────────────────────── */
  const card = {
    background: 'var(--surface-raised)',
    border: '1px solid rgba(0,70,135,0.07)',
    borderRadius: 'var(--radius-md)',
    padding: '1.25rem 1.5rem',
    boxShadow: 'var(--shadow-sm)',
  };

  const thStyle = {
    background: 'var(--surface-2)',
    color: 'var(--text-secondary)',
    padding: '0.6rem 0.85rem',
    textAlign: 'left',
    fontFamily: 'var(--font-display)',
    fontSize: '0.7rem',
    fontWeight: 800,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    borderBottom: '2px solid var(--navbar-border)',
  };

  const tdStyle = {
    padding: '0.55rem 0.85rem',
    fontSize: '0.82rem',
    fontFamily: 'var(--font-body)',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--navbar-border)',
  };

  const sectionTitle = {
    fontFamily: 'var(--font-display)',
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  };

  const emptyMsg = {
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    padding: '0.5rem 0',
  };

  /* ── Tabla de Stock ────────────────────────────────────── */
  const renderStockTable = (stock) => {
    if (!stock || stock.length === 0) return <p style={emptyMsg}>No hay stock en ningún almacén.</p>;
    return (
      <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--navbar-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thStyle}>Almacén</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Stock Real</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Comprometido</th>
          </tr></thead>
          <tbody>
            {stock.map((s, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-2)' }}>
                <td style={tdStyle}>{s.WarehouseCode}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.InStock}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.Committed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* ── Tabla de Kardex ───────────────────────────────────── */
  const renderKardexTable = (kardex) => {
    if (!kardex || kardex.length === 0) return <p style={emptyMsg}>No hay movimientos recientes.</p>;
    return (
      <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--navbar-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thStyle}>Fecha</th>
            <th style={thStyle}>Origen</th>
            <th style={thStyle}>Destino</th>
            <th style={thStyle}>Ref</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Mov</th>
          </tr></thead>
          <tbody>
            {kardex.map((k, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-2)' }}>
                <td style={tdStyle}>{new Date(k.fecha).toLocaleString()}</td>
                <td style={tdStyle}>{k.almacenorigen}</td>
                <td style={tdStyle}>{k.almacendestino}</td>
                <td style={tdStyle}>{k.documentoref}</td>
                <td style={{
                  ...tdStyle,
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  color: parseFloat(k.movimiento) < 0 ? 'var(--color-danger)' : 'var(--color-verde-e)',
                }}>{k.movimiento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* ── Tabla de Traslados ────────────────────────────────── */
  const renderTransfersTable = (transfers) => {
    if (!transfers || transfers.length === 0) return <p style={emptyMsg}>No hay traslados recientes.</p>;
    return (
      <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--navbar-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thStyle}>Fecha</th>
            <th style={thStyle}>DocNum</th>
            <th style={thStyle}>De</th>
            <th style={thStyle}>A</th>
            <th style={thStyle}>Comentarios</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Cant</th>
          </tr></thead>
          <tbody>
            {transfers.map((t, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surface-2)' }}>
                <td style={tdStyle}>{new Date(t.DocDate).toLocaleDateString()}</td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{t.DocNum}</td>
                <td style={tdStyle}>{t.From}</td>
                <td style={tdStyle}>{t.To}</td>
                <td style={{ ...tdStyle, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.Comments}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{t.QuantityTransferred}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* ── Render Principal ──────────────────────────────────── */
  return (
    <div style={{ padding: '0.5rem 0' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.35rem' }}>
        Rastreo de Órdenes e Insumos
      </h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
        Ingrese el número de orden de venta para verificar su estatus, el nivel de inventario de los artículos en los almacenes, y los traslados o salidas recientes para detectar incidencias.
      </p>

      {/* Buscador */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', alignItems: 'center' }}>
        <input
          placeholder="DocNum de Orden"
          value={docNum}
          onChange={(e) => setDocNum(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{
            width: 260,
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--navbar-border)',
            background: 'var(--surface-raised)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            outline: 'none',
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !docNum}
          style={{
            padding: '0.65rem 1.5rem',
            background: 'var(--color-azul-claro)',
            color: 'var(--color-bg-white)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-display)',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: loading || !docNum ? 'not-allowed' : 'pointer',
            opacity: loading || !docNum ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          🔍 RASTREAR
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <div className="premium-spinner" style={{ width: 36, height: 36, border: '3px solid var(--navbar-border)', borderTopColor: 'var(--color-azul-claro)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 1rem' }} />
          Buscando orden...
        </div>
      )}

      {error && <p style={{ color: 'var(--color-danger)', fontWeight: 600, marginBottom: '1rem' }}>{error}</p>}

      {data && (
        <>
          {/* Detalles de la Orden */}
          <div style={{ ...card, marginBottom: '1.5rem' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              Detalles de la Orden {data.OrderInfo.DocNum}
            </div>
            <div style={{ height: 1, background: 'var(--navbar-border)', margin: '0.5rem 0 1rem' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
              <div>
                <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Cliente</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{data.OrderInfo.CardName} ({data.OrderInfo.CardCode})</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Fecha</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{new Date(data.OrderInfo.DocDate).toLocaleDateString()}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Estatus SAP</div>
                <span style={{
                  display: 'inline-block',
                  padding: '0.2rem 0.75rem',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  background: data.OrderInfo.DocumentStatus === 'bost_Open' ? 'rgba(var(--color-accent-warm-rgb), 0.15)' : 'rgba(var(--color-verde-e-rgb), 0.15)',
                  color: data.OrderInfo.DocumentStatus === 'bost_Open' ? 'var(--color-accent-warm)' : 'var(--color-verde-e)',
                }}>
                  {data.OrderInfo.DocumentStatus === 'bost_Open' ? 'Abierta' : 'Cerrada'}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.2rem' }}>Total</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>${parseFloat(data.OrderInfo.DocTotal).toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Artículos */}
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 1rem' }}>
            Artículos de la Orden
          </h2>

          {data.Items.map((item, index) => (
            <div key={index} style={{ ...card, marginBottom: '1.25rem', borderLeft: '4px solid var(--color-azul-claro)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {item.ItemCode} - {item.ItemDescription}
                </div>
                <span style={{
                  padding: '0.3rem 0.85rem',
                  borderRadius: '100px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(var(--color-azul-claro-rgb), 0.12)',
                  color: 'var(--color-azul-claro)',
                }}>
                  Solicitado: {item.RequestedQuantity} en {item.TargetWarehouse}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={sectionTitle}>📦 Inventario Actual</div>
                  {renderStockTable(item.StockByWarehouse)}
                </div>
                <div style={{ flex: 1, minWidth: 280 }}>
                  <div style={sectionTitle}>🔄 Traslados Recientes</div>
                  {renderTransfersTable(item.RecentTransfers)}
                </div>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <div style={sectionTitle}>📋 Movimientos de Kardex (Consumos y Entradas)</div>
                {renderKardexTable(item.RecentKardex)}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default TraceOrder;
