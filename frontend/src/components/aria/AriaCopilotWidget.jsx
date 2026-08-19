/**
 * AriaCopilotWidget.jsx — Copiloto de Inteligencia Analítica MAR-IA
 * Hospital Escandón BI Platform
 */
import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../../api/client';

function formatMarkdown(text) {
  if (!text) return '';
  let formatted = String(text);

  formatted = formatted
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  formatted = formatted.replace(/^### (.*$)/gim, '<div style="font-weight:700; font-size:0.88rem; color:#004687; margin:0.3rem 0 0.15rem;">$1</div>');
  formatted = formatted.replace(/^## (.*$)/gim, '<div style="font-weight:800; font-size:0.92rem; color:#004687; margin:0.4rem 0 0.2rem;">$1</div>');

  // Bold (**text** or __text__)
  formatted = formatted.replace(/\*\*([\s\S]+?)\*\*/g, '<strong style="font-weight:700; color:#004687;">$1</strong>');
  formatted = formatted.replace(/__([\s\S]+?)__/g, '<strong style="font-weight:700; color:#004687;">$1</strong>');

  // Italics (*text*)
  formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Inline Code / Highlights (`text`)
  formatted = formatted.replace(/`([^`]+)`/g, '<code style="background:rgba(0,70,135,0.08); color:#005FA9; padding:2px 5px; border-radius:4px; font-family:var(--font-mono); font-size:0.78rem; font-weight:600;">$1</code>');

  // Bullet Lists
  formatted = formatted.replace(/^\s*[-*]\s+(.*$)/gim, '<div style="display:flex; gap:6px; margin:2px 0 2px 6px;"><span style="color:#0088C9; font-weight:bold;">•</span><span>$1</span></div>');

  // Line breaks
  formatted = formatted.replace(/\n/g, '<br/>');

  return formatted;
}

export default function AriaCopilotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'maria',
      text: '¡Hola! Soy **MAR-IA**, tu asistente de inteligencia analítica del Hospital Escandón. 🏥✨\n\n¿En qué te puedo ayudar hoy con los datos en vivo?',
      kpis: null,
      table: null,
      suggestions: null, // Will be loaded dynamically
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const chatEndRef = useRef(null);

  // Load suggestions dynamically from API based on user's IA profile
  useEffect(() => {
    if (isOpen && !suggestionsLoaded) {
      (async () => {
        try {
          const data = await apiFetch('/aria/suggestions');
          if (data.success && data.suggestions) {
            setMessages(prev => {
              const updated = [...prev];
              if (updated[0] && updated[0].sender === 'maria') {
                updated[0] = { ...updated[0], suggestions: data.suggestions };
              }
              return updated;
            });
          }
          setSuggestionsLoaded(true);
        } catch (err) {
          console.error('[MAR-IA] Error loading suggestions:', err);
          // Fallback: show generic suggestion
          setMessages(prev => {
            const updated = [...prev];
            if (updated[0] && updated[0].sender === 'maria') {
              updated[0] = { ...updated[0], suggestions: ['📊 Muéstrame un resumen general'] };
            }
            return updated;
          });
          setSuggestionsLoaded(true);
        }
      })();
    }
  }, [isOpen, suggestionsLoaded]);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (textToSend) => {
    const q = textToSend || inputQuery;
    if (!q.trim() || loading) return;

    const userMsg = { sender: 'user', text: q };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputQuery('');
    setLoading(true);

    try {
      const data = await apiFetch('/aria/query', {
        method: 'POST',
        body: { query: q },
      });

      if (data.success && data.data) {
        const botMsg = {
          sender: 'maria',
          text: data.data.answer,
          kpis: data.data.kpis || null,
          table: data.data.table || null,
          suggestions: data.data.suggestions || null,
        };
        setMessages((prev) => [...prev, botMsg]);
      } else {
        setMessages((prev) => [
          ...prev,
          { sender: 'maria', text: 'No pude procesar tu consulta. Intenta nuevamente.' },
        ]);
      }
    } catch (err) {
      console.error('[MAR-IA Error]', err);
      setMessages((prev) => [
        ...prev,
        { sender: 'maria', text: 'Error de conexión con el servicio de MAR-IA.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: '8px', right: '8px', zIndex: 9999, fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Botón Flotante para Abrir Chat */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          title="Abrir MAR-IA"
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
          {/* Header */}
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
                  <span style={{ background: '#10B981', width: 6, height: 6, borderRadius: '50%' }}></span>
                  En Línea
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
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

          {/* Cuerpo de Mensajes */}
          <div style={{ flex: 1, padding: '16px', overflowY: 'auto', background: '#F8FAFC', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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

                {/* Tarjetas KPI renderizadas */}
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
                  </div>
                )}

                {/* Chips de Sugerencias Rápidas */}
                {msg.suggestions && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                    {msg.suggestions.map((sug, sIdx) => (
                      <button
                        key={sIdx}
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
              <div style={{ alignSelf: 'flex-start', background: '#FFFFFF', padding: '10px 14px', borderRadius: '12px', border: '1px solid #E2E8F0', fontSize: '0.85rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ animation: 'pulse 1s infinite' }}>🤖 MAR-IA está analizando los datos...</span>
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
              type="text"
              placeholder="Pregúntale a MAR-IA sobre el hospital..."
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
