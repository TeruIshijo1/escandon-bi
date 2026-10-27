import { userMessage } from '../utils/userMessages';
import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api/client';
import './TraceOrder.css';

const MODES = {
  account: { title: 'Cuenta', label: 'Número de cuenta', placeholder: 'Escribe el número de cuenta', hint: 'Busca la cuenta hospitalaria exacta para consultar sus órdenes.' },
  patient: { title: 'Paciente', label: 'Nombre del paciente', placeholder: 'Escribe nombre o apellidos', hint: 'Puedes escribir parte del nombre. Confirma la cuenta y la fecha entre las coincidencias.' },
  order: { title: 'Orden', label: 'Número de orden', placeholder: 'Escribe el número de orden', hint: 'Si ya conoces la orden de venta, puedes localizarla directamente.' },
};
const dateLabel = value => {
  const date = new Date(String(value || '').slice(0, 10) + 'T12:00:00');
  return Number.isNaN(date.getTime()) ? 'Sin fecha' : date.toLocaleDateString('es-MX');
};
const statusLabel = value => ['bost_Open', 'O'].includes(value) ? 'Abierta' : ['bost_Close', 'C'].includes(value) ? 'Cerrada' : value || 'Sin estado';
const amountLabel = (value, currency) => `${Number(value || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;

const TraceOrder = () => {
  const [mode, setMode] = useState('account');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState('');
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [orders, setOrders] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [notice, setNotice] = useState('');
  const request = useRef(null);
  const resultsRef = useRef(null);
  const ordersRef = useRef(null);
  useEffect(() => () => request.current?.abort(), []);

  const clear = () => {
    request.current?.abort();
    request.current = null;
    setLoading(''); setError(null); setData(null);
    setAccounts(null); setOrders(null); setSelectedAccount(null); setNotice('');
  };

  const run = async (stage, action) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(stage); setError(null); setNotice('');
    try {
      await action(controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) setError(userMessage(err));
    } finally {
      if (request.current === controller) { request.current = null; setLoading(''); }
    }
  };

  const search = (event, more = false) => {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (mode === 'patient' ? q.length < 2 : !/^\d+$/.test(q) || Number(q) <= 0) {
      setError(mode === 'patient' ? 'Escribe al menos dos caracteres del nombre del paciente.' : 'Escribe un número válido, sin letras ni símbolos.');
      return;
    }
    if (!more) { setAccounts(null); setOrders(null); setData(null); setSelectedAccount(null); }
    const isOrder = mode === 'order';
    const previous = isOrder ? orders : accounts;
    run('search', async signal => {
      const response = await apiFetch(`/sap/${isOrder ? 'trace-orders' : 'trace-accounts'}/search`, {
        params: { mode, q, offset: more ? previous?.nextOffset : 0 }, signal,
      });
      if (signal.aborted) return;
      const result = response.data;
      const updated = { ...result, rows: more ? [...(previous?.rows || []), ...result.rows] : result.rows,
        warnings: [...new Set([...(more ? previous?.warnings || [] : []), ...(result.warnings || [])])] };
      (isOrder ? setOrders : setAccounts)(updated);
    });
  };

  const loadOrders = (account, more = false) => {
    if (!more) { setSelectedAccount(account); setOrders(null); setData(null); }
    run('orders', async signal => {
      const response = await apiFetch('/sap/trace-orders/search', {
        params: { mode: 'account', q: account.account, offset: more ? orders?.nextOffset : 0 }, signal,
      });
      if (signal.aborted) return;
      setOrders({ ...response.data, rows: more ? [...orders.rows, ...response.data.rows] : response.data.rows,
        warnings: [...new Set([...(more ? orders?.warnings || [] : []), ...(response.data.warnings || [])])] });
      if (!more) requestAnimationFrame(() => {
        ordersRef.current?.focus({ preventScroll: true });
        ordersRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      });
    });
  };

  const traceOrder = order => {
    setData(null);
    run('trace', async signal => {
      const response = await apiFetch(`/sap/trace-order/${encodeURIComponent(order.docNum)}`, {
        params: { entity: 'Orders', docEntry: order.docEntry }, signal,
      });
      if (signal.aborted) return;
      setData(response.data);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
  };

  const patientNameFor = (sapName, linkedAccounts = []) => sapName || (
    linkedAccounts.length === 1 && selectedAccount && String(linkedAccounts[0]) === String(selectedAccount.account)
      ? selectedAccount.patientName : null
  );

  /* Estilos compartidos */
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

  /* Existencias por almacén */
  const renderStockTable = (stock) => {
    if (!stock || stock.length === 0) return <p style={emptyMsg}>No hay existencias en ningún almacén.</p>;
    return (
      <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-sm)', border: '1px solid var(--navbar-border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={thStyle}>Almacén</th>
            <th style={{ ...thStyle, textAlign: 'right' }}>Existencias reales</th>
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

  /* Movimientos del artículo */
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

  /* Traslados del artículo */
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
                <td style={tdStyle}>{dateLabel(t.DocDate)}</td>
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

  /* Vista principal */
  return (
    <div style={{ padding: '0.5rem 0' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.65rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 0.35rem' }}>
        Rastreo de Órdenes e Insumos
      </h1>
      <p className="trace-intro">Encuentra la cuenta del paciente y consulta sus órdenes, insumos y movimientos.</p>

      <section className="trace-search" aria-labelledby="trace-search-title">
        <div className="trace-search-heading">
          <span className="trace-search-icon" aria-hidden="true">⌕</span>
          <div><h2 id="trace-search-title">¿Qué dato tienes a la mano?</h2><p>Busca por cuenta, nombre del paciente o número de orden.</p></div>
        </div>
        <div className="trace-modes" role="group" aria-label="Buscar por">
          {Object.entries(MODES).map(([key, value]) => <button key={key} type="button" aria-pressed={mode === key}
            onClick={() => { if (key !== mode) { clear(); setMode(key); setQuery(''); } }}>{value.title}</button>)}
        </div>
        <form onSubmit={search}>
          <label htmlFor="trace-query">{MODES[mode].label}</label>
          <div className="trace-form-row">
            <input id="trace-query" type="search" inputMode={mode === 'patient' ? 'text' : 'numeric'} autoComplete="off" maxLength={100}
              placeholder={MODES[mode].placeholder} value={query} aria-describedby="trace-search-hint"
              onChange={event => { clear(); setQuery(event.target.value); }} />
            <button className="trace-primary" type="submit" disabled={!!loading || !query.trim()}>Buscar</button>
          </div>
          <p id="trace-search-hint">{MODES[mode].hint}</p>
        </form>
      </section>

      {loading && <div className="trace-progress" role="status">
        <span>{loading === 'trace' ? 'Consultando insumos y movimientos de la orden…' : loading === 'orders' ? 'Buscando órdenes de la cuenta…' : 'Buscando coincidencias…'}</span>
        <button type="button" className="trace-secondary" onClick={() => {
          request.current?.abort(); request.current = null; setLoading(''); setNotice('Consulta cancelada. Puedes buscar de nuevo.');
        }}>Cancelar consulta</button>
      </div>}
      {notice && <p role="status" className="trace-notice">{notice}</p>}
      {error && <p role="alert" className="trace-error">{userMessage(error)}</p>}

      {accounts && <section className="trace-results" aria-label="Cuentas encontradas">
        <h2>Cuentas encontradas <span>{accounts.rows.length}{accounts.hasMore ? '+' : ''}</span></h2>
        {accounts.warnings?.map(warning => <p key={warning} className="trace-notice" role="status">{warning}</p>)}
        {!accounts.rows.length && <div className="trace-empty"><strong>No se encontraron cuentas.</strong><p>{mode === 'patient' ? 'Prueba con un apellido o con menos palabras del nombre.' : 'Revisa el número o busca por nombre del paciente en la opción Paciente.'}</p></div>}
        <div className="trace-account-grid">{accounts.rows.map(account => <article key={account.account}
          className={`trace-account${selectedAccount?.account === account.account ? ' is-selected' : ''}`}>
          <div className="trace-account-top"><strong>Cuenta {account.account}</strong><span>{selectedAccount?.account === account.account ? 'Seleccionada' : 'Cuenta hospitalaria'}</span></div>
          <h3>{account.patientName || 'Paciente sin nombre disponible'}</h3>
          <p>Fecha de cuenta: {dateLabel(account.date)}</p>
          {account.patientNumber && <p>Expediente: {account.patientNumber}</p>}
          <button type="button" className="trace-secondary" aria-label={`Ver órdenes de la cuenta ${account.account}`}
            disabled={!!loading} onClick={() => loadOrders(account)}>Ver órdenes <span aria-hidden="true">→</span></button>
        </article>)}</div>
        {accounts.hasMore && <button type="button" className="trace-secondary trace-more" disabled={!!loading} onClick={event => search(event, true)}>Ver más cuentas</button>}
      </section>}

      {orders && <section ref={ordersRef} tabIndex={-1} className="trace-results trace-orders-results" aria-label="Órdenes encontradas">
        <h2>{selectedAccount ? `Órdenes de la cuenta ${selectedAccount.account}` : 'Órdenes encontradas'} <span>{orders.rows.length}{orders.hasMore ? '+' : ''}</span></h2>
        {orders.warnings?.map(warning => <p key={warning} className="trace-notice" role="status">{warning}</p>)}
        {selectedAccount && <p className="trace-context">{selectedAccount.patientName} · Fecha de cuenta: {dateLabel(selectedAccount.date)}</p>}
        {!orders.rows.length && <div className="trace-empty"><strong>{selectedAccount ? 'No se encontraron órdenes de venta vinculadas a esta cuenta.' : 'No se encontró esa orden de venta.'}</strong><p>{selectedAccount ? 'Puedes revisar otra cuenta del paciente o buscar un número de orden conocido.' : 'Revisa el número o localiza primero la cuenta del paciente.'}</p></div>}
        <div className="trace-order-list">{orders.rows.map(order => <article className="trace-order" key={order.docEntry}>
          <div><strong>Orden {order.docNum}</strong><p>{dateLabel(order.date)} <span className="trace-status">{statusLabel(order.status)}</span></p></div>
          <div className="trace-order-patient"><strong>{patientNameFor(order.patientName, order.accounts) || (order.accounts?.length > 1 ? 'Orden con varias cuentas' : 'Paciente sin nombre disponible')}</strong>
            <p>{order.accounts?.length ? `Cuenta${order.accounts.length > 1 ? 's' : ''}: ${order.accounts.join(', ')}` : order.account ? `Cuenta: ${order.account}` : 'Sin cuenta vinculada'}</p>
            <p>Pagador: {order.customerName || 'Sin dato'}</p></div>
          <div className="trace-order-action"><strong>{amountLabel(order.total, order.currency)}</strong><button type="button" className="trace-primary"
            aria-label={`Rastrear orden ${order.docNum}`} disabled={!!loading} onClick={() => traceOrder(order)}>Ver insumos y movimientos</button></div>
        </article>)}</div>
        {orders.hasMore && <button type="button" className="trace-secondary trace-more" disabled={!!loading}
          onClick={event => selectedAccount ? loadOrders(selectedAccount, true) : search(event, true)}>Ver más órdenes</button>}
      </section>}

      {data && (
        <>
          {/* Detalles de la Orden */}
          <div ref={resultsRef} style={{ ...card, marginBottom: '1.5rem', borderLeft: '4px solid var(--color-azul-claro)', scrollMarginTop: '6rem' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#004687', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span>📋</span> DETALLES DE LA ORDEN #{data.OrderInfo.DocNum}
            </div>
            <div style={{ height: 1, background: 'var(--navbar-border)', margin: '0.5rem 0 1rem' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2.5rem', alignItems: 'center' }}>
              <div>
                <div className="trace-detail-label">Paciente / cuenta</div>
                <div style={{ fontWeight: 700 }}>{patientNameFor(data.OrderInfo.PatientName, data.OrderInfo.Accounts) || 'Paciente sin nombre disponible'}</div>
                <div>{data.OrderInfo.Accounts?.length ? `Cuenta${data.OrderInfo.Accounts.length > 1 ? 's' : ''}: ${data.OrderInfo.Accounts.join(', ')}` : data.OrderInfo.Account ? `Cuenta: ${data.OrderInfo.Account}` : 'Sin cuenta vinculada'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Pagador</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{data.OrderInfo.CardName} ({data.OrderInfo.CardCode})</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Fecha</div>
                <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{dateLabel(data.OrderInfo.DocDate)}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Estado SAP</div>
                <span style={{
                  display: 'inline-block',
                  padding: '0.3rem 0.9rem',
                  borderRadius: '100px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-mono)',
                  background: data.OrderInfo.DocumentStatus === 'bost_Open' ? 'rgba(var(--color-accent-warm-rgb), 0.15)' : 'rgba(var(--color-verde-e-rgb), 0.15)',
                  color: data.OrderInfo.DocumentStatus === 'bost_Open' ? 'var(--color-accent-warm)' : 'var(--color-verde-e)',
                }}>
                  {statusLabel(data.OrderInfo.DocumentStatus)}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.25rem' }}>Total</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{amountLabel(data.OrderInfo.DocTotal, data.OrderInfo.Currency)}</div>
              </div>
            </div>
          </div>

          {data.OrderInfo.Accounts?.length > 1 && <p className="trace-notice">Esta orden incluye varias cuentas. El total y los insumos corresponden a la orden completa.</p>}
          <p className="trace-context">Las existencias son actuales. Los movimientos recientes corresponden al artículo y pueden incluir otras cuentas.</p>
          {/* Artículos */}
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 1rem' }}>
            Artículos de la Orden
          </h2>

          {!data.Items.length && <p className="trace-empty">La orden no contiene artículos para rastrear.</p>}
          {data.Items.map((item, index) => (
            <div key={index} style={{ ...card, marginBottom: '1.25rem', borderLeft: '4px solid var(--color-azul-claro)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 800, color: '#004687' }}>
                    {item.ItemCode} - {item.ItemDescription}
                  </div>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.45rem 1.1rem',
                    borderRadius: '8px',
                    fontSize: '0.92rem',
                    fontWeight: 800,
                    fontFamily: 'var(--font-mono)',
                    background: '#EFF6FF',
                    color: '#004687',
                    border: '1.5px solid #93C5FD',
                    boxShadow: '0 1px 3px rgba(0, 70, 135, 0.08)'
                  }}>
                    <span>📦</span> Solicitado: <strong style={{ fontSize: '1.05rem', color: '#0077B6' }}>{item.RequestedQuantity}</strong> en <strong>{item.TargetWarehouse}</strong>
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                  <div style={sectionTitle}>📦 Inventario Actual</div>
                  {renderStockTable(item.StockByWarehouse)}
                </div>
                <div style={{ flex: '1 1 280px', minWidth: 0 }}>
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
