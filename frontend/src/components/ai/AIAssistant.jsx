/**
 * AIAssistant.jsx — Asistente de IA (chat flotante)
 * Hospital Escandón BI Platform v4.0
 * Rediseño premium con consistencia tipográfica
 */
import { useState, useRef, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../api/config';

const SUGGESTED_QUESTIONS = [
  '¿Cuál es la ocupación de camas hoy?',
  '¿Cuántos pacientes hay en UCI?',
  '¿Qué área tiene mayor rotación este mes?',
  '¿Cuál es la tasa de mortalidad del mes?',
  'Resumen de cirugías de la semana',
];

export default function AIAssistant() {
  const { user }     = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role:    'assistant',
      content: `Hola, soy **Mar-IA**. Puedo responder preguntas sobre los datos clínicos del hospital, apoyarte en la navegación de la plataforma, y proveer indicadores en tiempo real. ¿En qué puedo ayudarte hoy?`,
    },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const messagesEndRef         = useRef(null);
  const fileInputRef           = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleToggle = () => setOpen(true);
    window.addEventListener('toggle-aria', handleToggle);
    window.addEventListener('toggle-maria', handleToggle);
    return () => {
      window.removeEventListener('toggle-aria', handleToggle);
      window.removeEventListener('toggle-maria', handleToggle);
    };
  }, []);

  const sendMessage = async (text, withScreen = false) => {
    const question = (text || input).trim();
    if (!question || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setLoading(true);

    let screenImage = null;
    if (withScreen) {
      try {
        const canvas = await html2canvas(document.body, { 
          useCORS: true, 
          ignoreElements: (el) => el.classList.contains('ai-panel') 
        });
        screenImage = canvas.toDataURL('image/jpeg', 0.5);
      } catch (e) {
        console.error('Error taking screenshot', e);
      }
    }

    try {
      const token = sessionStorage.getItem('escandon_token');
      const formData = new FormData();
      formData.append('question', question);
      
      let contextStr = window.location.pathname;
      const h1Text = document.querySelector('h1')?.innerText;
      if (h1Text) {
        contextStr += ` | Pantalla activa: ${h1Text}`;
      }
      formData.append('currentContext', contextStr);
      if (selectedFile) formData.append('file', selectedFile);
      if (screenImage) formData.append('screenImage', screenImage);

      const res = await fetch(`${API_BASE}/ai/query`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const json = await res.json();
      if (json.ok) {
        setMessages(prev => [
          ...prev,
          {
            role:    'assistant',
            content: json.answer,
            sources: json.sources,
            intent:  json.intent,
          },
        ]);
        setSelectedFile(null);
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `Lo siento, ocurrió un error: ${json.error || 'Intenta de nuevo.'}` },
        ]);
      }
    } catch (err) {
      console.error('[Mar-IA]', err);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Lo siento, no pude conectarme con el servicio de IA. Verifica tu conexión.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input, false); }
  };

  return (
    <>
      <style>{`
        .ai-fab:focus {
          outline: none;
        }
        .ai-message.assistant strong,
        .ai-message.user strong {
          font-weight: 700;
          color: inherit;
        }
        .ai-chat-input-focus:focus {
          border-color: var(--color-verde-e) !important;
          box-shadow: 0 0 0 3px rgba(0, 151, 74, 0.12) !important;
          background: #FFFFFF !important;
        }
      `}</style>

      {/* FAB */}
      <button className="ai-fab" onClick={() => setOpen(o => !o)} title="Asistente Mar-IA">
        {open ? '✕' : '🤖'}
      </button>

      {/* Panel */}
      {open && (
        <div className="ai-panel" style={{ boxShadow: 'var(--shadow-xl)', borderRadius: '16px', border: '1px solid rgba(0,70,135,0.08)' }}>
          {/* Header */}
          <div className="ai-panel-header" style={{ background: 'linear-gradient(135deg, var(--color-azul-fuerte) 0%, #083b66 100%)' }}>
            <span style={{ fontSize:'1.4rem' }}>🤖</span>
            <div style={{ flex:1 }}>
              <div className="ai-panel-title" style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '0.85rem' }}>Mar-IA — Asistente Inteligente</div>
              <div className="ai-panel-subtitle" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', opacity: 0.7 }}>Hospital Escandón · BI Assistant</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background:'none', border:'none', color:'rgba(255,255,255,0.7)', cursor:'pointer', fontSize:'1.1rem', display: 'flex', alignItems: 'center' }}
            >✕</button>
          </div>

          {/* Mensajes */}
          <div className="ai-messages" style={{ background: '#FAFBFD' }}>
            {messages.map((msg, i) => (
              <div key={i} className={`ai-message ${msg.role}`} style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', padding: '0.75rem 0.9rem', borderRadius: '12px' }}>
                <span dangerouslySetInnerHTML={{
                  __html: msg.content
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\n/g, '<br/>'),
                }} />
                {msg.sources && (
                  <div style={{ marginTop:'0.4rem', fontSize:'0.66rem', opacity:0.7, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    📊 Fuente: {msg.sources.join(', ')}
                  </div>
                )}
              </div>
            ))}

            {/* Preguntas sugeridas (solo si pocos mensajes) */}
            {messages.length < 3 && (
              <div style={{ display:'flex', flexDirection:'column', gap:'0.45rem', marginTop: '0.5rem' }}>
                <span style={{ fontSize:'0.64rem', color:'var(--text-muted)', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.06em', fontFamily: 'var(--font-display)' }}>Preguntas sugeridas</span>
                {SUGGESTED_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    style={{
                      background:  'rgba(0,70,135,0.04)',
                      border:      '1px solid rgba(0,70,135,0.08)',
                      borderRadius: 10,
                      padding:     '0.45rem 0.75rem',
                      fontSize:    '0.76rem',
                      color:       'var(--color-azul-fuerte)',
                      cursor:      'pointer',
                      textAlign:   'left',
                      fontFamily:  "var(--font-body)",
                      fontWeight:  500,
                      transition:  'all var(--transition-fast)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,70,135,0.08)'; e.currentTarget.style.borderColor = 'var(--color-azul-claro)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,70,135,0.04)'; e.currentTarget.style.borderColor = 'rgba(0,70,135,0.08)'; }}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {/* Indicador de escritura */}
            {loading && (
              <div className="ai-message assistant" style={{ display:'flex', gap:'0.3rem', alignItems:'center', padding: '0.6rem 0.85rem' }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width:        6, height:6,
                    background:  'var(--color-azul-claro)',
                    borderRadius:'50%',
                    animation:   `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                  }} />
                ))}
                <style>{`@keyframes bounce{0%,80%,100%{transform:scale(0.6)}40%{transform:scale(1)}}`}</style>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="ai-input-row" style={{ flexDirection: 'column', padding: '0.85rem', borderTop: '1px solid rgba(0,70,135,0.06)', gap: '0.5rem', background: '#FFFFFF' }}>
            {selectedFile && (
              <div style={{ fontSize: '0.72rem', color: 'var(--color-azul-fuerte)', background: 'rgba(0,70,135,0.06)', border: '1px solid rgba(0,70,135,0.1)', padding: '0.25rem 0.6rem', borderRadius: '8px', alignSelf: 'flex-start', display: 'flex', gap: '0.5rem', alignItems: 'center', fontFamily: 'var(--font-mono)' }}>
                📎 {selectedFile.name}
                <button onClick={() => setSelectedFile(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-danger)', fontSize: '0.8rem', display: 'flex', alignItems: 'center' }}>✕</button>
              </div>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={(e) => setSelectedFile(e.target.files[0])} accept=".xlsx,.xls,.csv" />
              <button 
                onClick={() => fileInputRef.current?.click()}
                title="Adjuntar Archivo Excel"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.65, transition: 'opacity 0.2s' }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = 0.65}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              </button>
              <button 
                onClick={() => sendMessage(input, true)}
                title="Analizar pantalla (Visión)"
                disabled={loading || !input.trim()}
                style={{ background: 'transparent', border: 'none', cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer', fontSize: '1.1rem', padding: '0.2rem', opacity: (loading || !input.trim()) ? 0.35 : 0.65, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'opacity 0.2s' }}
                onMouseEnter={e => { if(!loading && input.trim()) e.currentTarget.style.opacity = 1; }}
                onMouseLeave={e => { if(!loading && input.trim()) e.currentTarget.style.opacity = 0.65; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <input
                className="ai-input ai-chat-input-focus"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pregunta a Mar-IA..."
                disabled={loading}
                style={{ flex: 1, border: '1px solid #E2E8F0', borderRadius: '10px', padding: '0.55rem 0.85rem', fontSize: '0.82rem', outline: 'none', background: '#F8FAFC', fontFamily: 'var(--font-body)', transition: 'all var(--transition-fast)' }}
              />
              <button
                onClick={() => sendMessage(input, false)}
                disabled={loading || !input.trim()}
                style={{
                  background:    input.trim() && !loading ? 'var(--color-verde-e)' : 'rgba(0,70,135,0.06)',
                  border:        'none',
                  borderRadius:   10,
                  width:          34,
                  height:         34,
                  cursor:         input.trim() && !loading ? 'pointer' : 'not-allowed',
                  color:          input.trim() && !loading ? 'white' : '#8A97A8',
                  fontSize:      '0.85rem',
                  display:       'flex',
                  alignItems:    'center',
                  justifyContent:'center',
                  transition:    'all var(--transition-fast)',
                  flexShrink:     0,
                  boxShadow:      input.trim() && !loading ? '0 2px 8px rgba(0, 151, 74, 0.25)' : 'none',
                }}
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
