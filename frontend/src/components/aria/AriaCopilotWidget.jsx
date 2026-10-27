

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../api/client';
import useEscapeKey from '../../hooks/useEscapeKey';
import { userMessage } from '../../utils/userMessages';

const greeting = '¡Hola! Soy **MAR-IA**, tu asistente de inteligencia analítica del Hospital Escandón. 🏥✨\n\nPuedes consultar indicadores o describir el reporte que necesitas. Si falta un dato, te ayudaré a completarlo.';
const initialMessage = suggestions => ({ sender: 'maria', text: greeting, suggestions, historyText: null });
const actionStyle = { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE', borderRadius: '16px', padding: '6px 12px', fontSize: '0.75rem', fontWeight: '600', cursor: 'pointer', textAlign: 'left' };
const validPlan = plan => plan && typeof plan.entity === 'string' && Array.isArray(plan.selectedFields) && plan.selectedFields.length > 0 && plan.selectedFields.every(key => typeof key === 'string') && plan.filters && typeof plan.filters === 'object' && !Array.isArray(plan.filters);
const dateLabel = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : 'Por definir';

function formatMarkdown(text) {
  if (!text) return '';
  let formatted = String(text);

  formatted = formatted
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  formatted = formatted.replace(/^### (.*$)/gim, '<div style="font-weight:700; font-size:0.88rem; color:#004687; margin:0.3rem 0 0.15rem;">$1</div>');
  formatted = formatted.replace(/^## (.*$)/gim, '<div style="font-weight:800; font-size:0.92rem; color:#004687; margin:0.4rem 0 0.2rem;">$1</div>');

  formatted = formatted.replace(/\*\*([\s\S]+?)\*\*/g, '<strong style="font-weight:700; color:#004687;">$1</strong>');
  formatted = formatted.replace(/__([\s\S]+?)__/g, '<strong style="font-weight:700; color:#004687;">$1</strong>');

  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  formatted = formatted.replace(/`([^`]+)`/g, '<code style="background:rgba(0,70,135,0.08); color:#005FA9; padding:2px 5px; border-radius:4px; font-family:var(--font-mono); font-size:0.78rem; font-weight:600;">$1</code>');

  formatted = formatted.replace(/^\s*[-*]\s+(.*$)/gim, '<div style="display:flex; gap:6px; margin:2px 0 2px 6px;"><span style="color:#0088C9; font-weight:bold;">•</span><span>$1</span></div>');

  formatted = formatted.replace(/\n/g, '<br/>');

  return formatted;
}

export default function AriaCopilotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([initialMessage(null)]);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [context, setContext] = useState(null);
  const [pending, setPending] = useState(null);
  const [connectionError, setConnectionError] = useState(false);
  const chatEndRef = useRef(null);
  const requestRef = useRef(0);
  const controllerRef = useRef(null);
  const suggestionsRef = useRef(null);
  const inputRef = useRef(null);
  const latestAssistantIndex = messages.reduce((latest, message, index) => message.sender === 'maria' ? index : latest, -1);

  const cancelRequest = () => {
    requestRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  };
  const closeChat = () => { cancelRequest(); setIsOpen(false); };
  useEscapeKey(closeChat, isOpen);
  useEffect(() => () => { requestRef.current += 1; controllerRef.current?.abort(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    if (isOpen && !suggestionsLoaded) {
      (async () => {
        try {
          const data = await apiFetch('/aria/suggestions', { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (data.success && Array.isArray(data.suggestions)) {
            suggestionsRef.current = data.suggestions.filter(suggestion => typeof suggestion === 'string').slice(0, 6);
            setMessages(prev => {
              const updated = [...prev];
              if (updated[0] && updated[0].sender === 'maria') {
                updated[0] = { ...updated[0], suggestions: suggestionsRef.current };
              }
              return updated;
            });
          }
          setSuggestionsLoaded(true);
        } catch {
          if (controller.signal.aborted) return;
           
          suggestionsRef.current = ['📊 Muéstrame un resumen general'];
          setMessages(prev => {
            const updated = [...prev];
            if (updated[0] && updated[0].sender === 'maria') {
              updated[0] = { ...updated[0], suggestions: suggestionsRef.current };
            }
            return updated;
          });
          setSuggestionsLoaded(true);
        }
      })();
    }
    return () => controller.abort();
  }, [isOpen, suggestionsLoaded]);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, loading]);

  const startOver = () => {
    cancelRequest();
    setMessages([initialMessage(suggestionsRef.current)]);
    setContext(null);
    setPending(null);
    setInputQuery('');
    setConnectionError(false);
    inputRef.current?.focus();
  };

  const handleSendMessage = async (textToSend) => {
    const q = (textToSend || inputQuery).trim();
    if (!q.trim() || loading) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;

    const history = messages.filter(message => typeof message.historyText === 'string').slice(-8).map(message => ({ role: message.sender === 'user' ? 'user' : 'assistant', content: message.historyText.slice(0, 1500) }));
    const reportContext = context ? { entity: context.entity, selectedFields: context.selectedFields, filters: context.filters,
      ...(context.analysis ? { analysis: context.analysis } : {}) } : null;
    const userMsg = { sender: 'user', text: q, historyText: q };
    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setLoading(true);
    setConnectionError(false);

    try {
      const data = await apiFetch('/aria/query', {
        method: 'POST',
        body: { query: q, history, context: reportContext, pending },
        signal: controller.signal,
      });
      if (requestId !== requestRef.current || controller.signal.aborted) return;
      if (data.success && data.data) {
        const response = data.data;
        const report = response.report;
        if (report && !['ready', 'clarification', 'unsupported', 'error'].includes(report.status)) throw new Error('No pude interpretar la respuesta. Intenta de nuevo.');
        const plan = validPlan(report?.plan) ? report.plan : null;
        if (report?.plan && !plan) throw new Error('No pude conservar la configuración del reporte. Inicia una nueva conversación.');
        const choices = Array.isArray(report?.choices) ? report.choices.filter(choice => typeof choice?.id === 'string' && typeof choice.title === 'string').slice(0, 4) : [];
        const options = Array.isArray(report?.options) ? report.options.filter(option => typeof option?.label === 'string' && typeof option.message === 'string' && option.message.length <= 1500).slice(0, 4) : [];

        setContext(plan);
        setPending(report?.pending || null);
        const text = typeof response.answer === 'string' ? response.answer : 'No pude preparar una respuesta. Intenta de nuevo.';
        const hasResults = (Array.isArray(response.kpis) && response.kpis.length > 0) || (Array.isArray(response.table?.rows) && response.table.rows.length > 0) || report?.status === 'ready';
        const historyText = hasResults ? plan ? `Configuración del reporte «${plan.entityTitle || 'seleccionado'}». Columnas: ${(plan.fieldLabels || []).join(', ')}.` : 'La consulta anterior fue atendida.' : text;
        const botMsg = {
          sender: 'maria',
          text, historyText,
          kpis: Array.isArray(response.kpis) ? response.kpis : null,
          table: response.table && Array.isArray(response.table.headers) && Array.isArray(response.table.rows) ? { ...response.table, rows: response.table.rows.slice(0, 20) } : null,
          suggestions: Array.isArray(response.suggestions) ? response.suggestions.filter(suggestion => typeof suggestion === 'string').slice(0, 6) : null,
          report: report ? { ...report, plan, choices, options } : null,
          notice: typeof response.notice === 'string' ? response.notice : '',
        };
        setMessages((prev) => [...prev, botMsg]);
      } else {
        throw new Error('No pude procesar tu consulta. Intenta nuevamente.');
      }
    } catch (err) {
      if (requestId !== requestRef.current || controller.signal.aborted || err.name === 'AbortError') return;
      setConnectionError(true);
      setMessages((prev) => [
        ...prev,
        { sender: 'maria', text: userMessage(err), historyText: null, retryQuery: q },
      ]);
    } finally {
      if (requestId === requestRef.current) { setLoading(false); controllerRef.current = null; inputRef.current?.focus({ preventScroll: true }); }
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: '8px', right: '8px', zIndex: 9999, fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Botón Flotante para Abrir Chat */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          title="Abrir MAR-IA"
          aria-label="Abrir MAR-IA"
          style={{
            background: 'linear-gradient(135deg, #004687 0%, #0088C9 100%)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            fontSize: '1.2rem',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0, 70, 135, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <span>🤖</span>
        </button>
      )}

      {/* Ventana Modal de Chat */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="MAR-IA"
          style={{
            position: 'fixed',
            bottom: '16px',
            right: '16px',
            width: 'calc(100vw - 32px)',
            maxWidth: '420px',
            height: 'min(580px, calc(100vh - 30px))',
            maxHeight: 'calc(100vh - 30px)',
            background: '#FFFFFF',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(0, 70, 135, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 9999,
          }}
        >
          {/* Encabezado */}
          <div
            style={{
              background: 'linear-gradient(135deg, #004687 0%, #002B54 100%)',
              color: '#FFFFFF',
              padding: '14px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.2rem',
                }}
              >
                🤖
              </div>
              <div>
                <div style={{ fontWeight: '800', fontSize: '1rem', letterSpacing: '0.02em' }}>MAR-IA</div>
                <div style={{ fontSize: '0.72rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ background: connectionError ? '#FBBF24' : '#10B981', width: 6, height: 6, borderRadius: '50%' }}></span>
                  {loading ? 'Preparando tu respuesta' : connectionError ? 'Revisa tu conexión' : 'Lista para ayudarte'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="button" onClick={startOver} disabled={messages.length === 1 && !loading} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.3)', color: '#FFFFFF', borderRadius: '6px', padding: '5px 7px', fontSize: '0.7rem', cursor: 'pointer' }}>Nueva conversación</button>
            <button
              onClick={closeChat}
              aria-label="Cerrar MAR-IA"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '1.2rem',
                cursor: 'pointer',
                opacity: 0.8,
              }}
            >
              ✕
            </button>
            </div>
          </div>

          {/* Cuerpo de Mensajes */}
          <div role="log" aria-label="Conversación con MAR-IA" aria-live="polite" aria-relevant="additions text" style={{ flex: 1, padding: '16px', overflowY: 'auto', background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messages.map((msg, index) => (
              <div
                key={index}
                style={{
                  alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '88%',
                }}
              >
                <div
                  style={{
                    background: msg.sender === 'user' ? '#004687' : '#FFFFFF',
                    color: msg.sender === 'user' ? '#FFFFFF' : '#0F172A',
                    padding: '12px 14px',
                    borderRadius: msg.sender === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                    fontSize: '0.88rem',
                    lineHeight: '1.45',
                    border: msg.sender === 'user' ? 'none' : '1px solid #E2E8F0',
                  }}
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.text) }}
                />

                {msg.notice && <p role="status" style={{ fontSize: '0.75rem', color: '#475569', margin: '7px 0 0' }}>{msg.notice}</p>}

                {msg.report?.plan && <div aria-label="Configuración del reporte" style={{ marginTop: '8px', padding: '10px', border: '1px solid #BFDBFE', background: '#EFF6FF', borderRadius: '8px', fontSize: '0.75rem', color: '#1E3A5F' }}>
                  <strong>{msg.report.plan.entityTitle || 'Tu reporte'}</strong>
                  {(msg.report.plan.requiresDateFilter || msg.report.plan.filters.fechaDesde || msg.report.plan.filters.fechaHasta) && <div style={{ marginTop: '4px' }}>Período: {dateLabel(msg.report.plan.filters.fechaDesde)}{msg.report.plan.filters.fechaHasta ? ` al ${dateLabel(msg.report.plan.filters.fechaHasta)}` : ''}</div>}
                  {!!msg.report.plan.fieldLabels?.length && <div style={{ marginTop: '4px' }}>Columnas: {msg.report.plan.fieldLabels.join(', ')}</div>}
                  {msg.report.plan.analysisSummary?.description && <div style={{ marginTop: '4px' }}>Análisis: {msg.report.plan.analysisSummary.description}</div>}
                  {Array.isArray(msg.report.plan.appliedFilters) && msg.report.plan.appliedFilters.map((filter, filterIndex) => <div key={filterIndex} style={{ marginTop: '4px' }}>{filter.label}: {filter.value}</div>)}
                  {msg.report.limited && <p style={{ margin: '6px 0 0' }}>El reporte alcanzó el límite de consulta. Ajusta el período o los filtros para revisar el resto.</p>}
                </div>}

                {msg.kpis && msg.kpis.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px', marginTop: '8px' }}>
                    {msg.kpis.map((kpi, kIdx) => (
                      <div key={kIdx} style={{ background: '#FFFFFF', padding: '8px 10px', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                        <div style={{ fontSize: '0.68rem', color: '#64748B', fontWeight: '600' }}>{kpi.label}</div>
                        <div style={{ fontSize: '1rem', fontWeight: '800', color: kpi.color || '#004687' }}>{kpi.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tabla formateada en chat */}
                {msg.table && msg.table.rows && (
                  <div style={{ marginTop: '8px', overflowX: 'auto', background: '#FFFFFF', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
                    <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: '#F1F5F9', color: '#475569' }}>
                          {msg.table.headers.map((h, hIdx) => (
                            <th key={hIdx} style={{ padding: '6px 8px', fontWeight: '700' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.table.rows.map((row, rIdx) => (
                          <tr key={rIdx} style={{ borderBottom: '1px solid #F8FAFC' }}>
                            {row.map((cell, cIdx) => (
                              <td key={cIdx} style={{ padding: '6px 8px', color: '#1E293B' }}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {Number.isInteger(msg.report?.rowCount) && msg.report.rowCount > msg.table.rows.length && <p style={{ margin: '6px 8px', fontSize: '0.72rem', color: '#475569' }}>Vista previa: {msg.table.rows.length} de {msg.report.rowCount.toLocaleString('es-MX')} registros.</p>}
                  </div>
                )}

                {index === latestAssistantIndex && !!msg.report?.choices?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>{msg.report.choices.map(choice => <button key={choice.id} type="button" disabled={loading} onClick={() => handleSendMessage(`Quiero el reporte «${choice.title}».`)} style={actionStyle}>{choice.title}</button>)}</div>}
                {index === latestAssistantIndex && !!msg.report?.options?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>{msg.report.options.map((option, optionIndex) => <button key={optionIndex} type="button" disabled={loading} onClick={() => handleSendMessage(option.message)} style={actionStyle}>{option.label}</button>)}</div>}
                {index === latestAssistantIndex && (msg.retryQuery || (msg.report?.status === 'error' && msg.report.plan)) && <button type="button" disabled={loading} onClick={() => handleSendMessage(msg.retryQuery || 'Genera de nuevo el reporte.')} style={{ ...actionStyle, marginTop: '8px' }}>{msg.report?.status === 'error' ? 'Reintentar reporte' : 'Reintentar consulta'}</button>}

                {/* Chips de Sugerencias Rápidas */}
                {msg.suggestions && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                    {msg.suggestions.map((sug, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        disabled={loading}
                        onClick={() => handleSendMessage(sug)}
                        style={{
                          background: '#EFF6FF',
                          color: '#1D4ED8',
                          border: '1px solid #BFDBFE',
                          borderRadius: '16px',
                          padding: '6px 12px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div role="status" style={{ alignSelf: 'flex-start', background: '#FFFFFF', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', fontSize: '0.85rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ animation: 'pulse 1s infinite' }}>🤖 MAR-IA está preparando tu respuesta…</span>
                <button type="button" onClick={cancelRequest} style={actionStyle}>Cancelar consulta</button>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Formulario de Entrada */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{
              padding: '12px',
              background: '#FFFFFF',
              borderTop: '1px solid #E2E8F0',
              display: 'flex',
              gap: '8px',
            }}
          >
            <input
              ref={inputRef}
              type="text"
              aria-label="Consulta a MAR-IA"
              placeholder="Pregúntale a MAR-IA sobre el hospital..."
              maxLength={1500}
              disabled={loading}
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid #CBD5E1',
                outline: 'none',
                fontSize: '0.85rem',
              }}
            />
            <button
              type="submit"
              disabled={loading || !inputQuery.trim()}
              style={{
                background: '#004687',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '8px',
                padding: '0 16px',
                fontWeight: '700',
                cursor: loading || !inputQuery.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !inputQuery.trim() ? 0.6 : 1,
              }}
            >
              Enviar
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
