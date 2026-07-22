/**
 * AriaCopilotWidget.jsx — Copiloto de Inteligencia Analítica Local MAR-IA
 * Hospital Escandón BI Platform
 */
import React, { useState, useEffect, useRef } from 'react';

export default function AriaCopilotWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      sender: 'maria',
      text: '¡Hola! Soy **MAR-IA**, tu asistente de inteligencia analítica local del Hospital Escandón. 🏥✨\n\n¿En qué te puedo ayudar hoy con los datos en vivo?',
      kpis: null,
      table: null,
      suggestions: [
        '🛏️ ¿Cómo está la ocupación de camas por área?',
        '🔍 ¿Cuáles son las partidas con faltantes hoy?',
        '💰 ¿Quién es el paciente con mayor gasto acumulado?',
        '💊 ¿Cuáles son los 5 insumos más consumidos?',
        '🛡️ ¿Qué anomalías de calidad se detectaron?',
      ],
    },
  ]);
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSendMessage = async (textToSend) => {
    const q = textToSend || inputQuery;
    if (!q.trim() || loading) return;

    // Agregar mensaje del usuario
    const userMsg = { sender: 'user', text: q };
    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputQuery('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token') || sessionStorage.getItem('escandon_token');
      const res = await fetch('/api/aria/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: q }),
      });

      const data = await res.json();
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
      setMessages((prev) => [
        ...prev,
        { sender: 'maria', text: 'Error de conexión con el servicio local de MAR-IA.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999, fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Botón Flotante para Abrir Chat */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          style={{
            background: 'linear-gradient(135deg, #004687 0%, #0088C9 100%)',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '50px',
            padding: '12px 20px',
            fontSize: '0.92rem',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(0, 70, 135, 0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          <span style={{ fontSize: '1.2rem' }}>🤖</span>
          <span>MAR-IA Copilot</span>
          <span style={{ background: '#10B981', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }}></span>
        </button>
      )}

      {/* Ventana Modal de Chat */}
      {isOpen && (
        <div
          style={{
            width: '420px',
            height: '580px',
            background: '#FFFFFF',
            borderRadius: '16px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(0, 70, 135, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
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
                <div style={{ fontWeight: '800', fontSize: '1rem', letterSpacing: '0.02em' }}>MAR-IA Copilot</div>
                <div style={{ fontSize: '0.72rem', color: '#93C5FD', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ background: '#10B981', width: 6, height: 6, borderRadius: '50%' }}></span>
                  Inteligencia Local • 100% Gratuito
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
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {msg.text}
                </div>

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
