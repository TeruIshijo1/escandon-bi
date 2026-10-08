import React, { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import { userMessage } from '../../utils/userMessages';
import ReportBuilderIcon from './ReportBuilderIcon';
import './ReportAssistant.css';

const initialMessage = { role: 'assistant', content: 'Cuéntame qué necesitas con tus propias palabras. Por ejemplo: “Pásame las cirugías del mes pasado, con el nombre del paciente y del doctor”. Si algo no queda claro, te haré una pregunta.' };
const formatDate = value => value ? value.split('-').reverse().join('/') : '';
const examples = [
  { title: 'Cirugías del mes pasado', text: 'Pásame las cirugías del mes pasado con el nombre del paciente, el doctor y qué le hicieron.' },
  { title: 'Lo que hay en farmacia', text: 'Quiero lo que hay en farma con el nombre del producto, cuánto queda y su costo.' },
  { title: 'Citas de esta semana', text: 'Muéstrame las citas de esta semana con el paciente, el doctor y la fecha.' },
];

export default function ReportAssistant({ catalog, catalogLoading, catalogError, onGenerate, onViewReport, onManual, onReset }) {
  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [context, setContext] = useState(null);
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState('');
  const [engine, setEngine] = useState('ai');
  const [lastPlan, setLastPlan] = useState(null);
  const [manualDraft, setManualDraft] = useState(null);
  const [generated, setGenerated] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const controllerRef = useRef(null);
  const conversationRef = useRef(null);
  const inputRef = useRef(null);
  const unavailable = catalogLoading || Boolean(catalogError) || !catalog.length;
  const visiblePlan = lastPlan || manualDraft;
  const latestAssistantIndex = messages.reduce((latest, message, index) => message.role === 'assistant' ? index : latest, -1);

  useEffect(() => {
    requestRef.current += 1;
    controllerRef.current?.abort();
    setBusy(false);
    setContext(null);
    setPending(null);
    setLastPlan(null);
    setManualDraft(null);
    setGenerated(false);
    setMessages([initialMessage]);
    setEngine('ai');
    setNotice('');
    setError('');
    return () => { requestRef.current += 1; controllerRef.current?.abort(); };
  }, [catalog]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, busy, phase]);

  async function generate(plan, requestId) {
    setPhase('Consultando la información de tu reporte…');
    const result = await onGenerate(plan);
    if (requestId !== requestRef.current) return;
    if (!result) throw new Error('La selección cambió antes de terminar. Puedes pedir el reporte de nuevo.');
    setGenerated(true);
    setMessages(previous => [...previous, { role: 'assistant', content: result.total ? `Tu reporte está listo con ${result.total.toLocaleString('es-MX')} ${result.total === 1 ? 'registro' : 'registros'}${result.truncated ? '. Se alcanzó el límite de resultados; ajusta las fechas o los filtros para revisar el resto' : ''}. Puedes revisarlo abajo, descargarlo en Excel o pedirme un ajuste.` : 'El reporte está listo, pero no encontré registros con ese período y esos filtros. Puedes probar otras fechas o cambiar la búsqueda.' }]);
  }

  async function sendMessage(text = input) {
    const message = text.trim();
    if (!message || busy || unavailable) return;
    const requestId = ++requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    // Keep the recent conversation only. Query results never enter this history.
    const history = messages.slice(1).slice(-6).map(({ role, content }) => ({ role, content: content.slice(0, 1500) }));
    setMessages(previous => [...previous, { role: 'user', content: message }]);
    setInput('');
    setBusy(true);
    setError('');
    setGenerated(false);
    setLastPlan(null);
    setManualDraft(null);
    onReset?.();
    setPhase('Preparando tu reporte…');
    try {
      const response = await fetch(`${API_BASE}/sap-query/assistant`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, context, pending }), signal: controller.signal,
      });
      const result = await response.json();
      if (requestId !== requestRef.current) return;
      if (!response.ok || !result.ok) throw new Error(userMessage(result.error || 'No pude preparar el reporte. Intenta de nuevo.'));
      if (!['ready', 'clarification', 'unsupported'].includes(result.status)) throw new Error('No pude interpretar esa respuesta. Intenta de nuevo o elige un tema manualmente.');
      const entity = result.plan && catalog.find(item => item.id === result.plan.entity);
      if (result.plan && (!entity || !Array.isArray(result.plan.selectedFields) || !result.plan.selectedFields.length || result.plan.selectedFields.some(key => !entity.fields.some(field => field.key === key)))) throw new Error('El tema o las columnas ya no están disponibles. Elige otro tema e intenta de nuevo.');
      const choices = (result.choices || []).filter(choice => catalog.some(entity => entity.id === choice.id));
      const options = Array.isArray(result.options) ? result.options.filter(option => typeof option.label === 'string' && typeof option.message === 'string' && option.message.length <= 1500).slice(0, 4) : [];
      setEngine(result.engine || 'ai');
      setNotice(result.notice || '');
      setMessages(previous => [...previous, { role: 'assistant', content: result.message, choices, options }]);
      setPending(result.pending || null);
      setManualDraft(result.plan || null);
      if (result.plan) setContext(result.plan);
      else if (result.status === 'clarification' && choices.length) setContext(null);
      if (result.status === 'ready' && result.plan) {
        setLastPlan(result.plan);
        await generate(result.plan, requestId);
      }
    } catch (err) {
      if (requestId === requestRef.current && err.name !== 'AbortError') setError(userMessage(err.message));
    } finally {
      if (requestId === requestRef.current) { setBusy(false); setPhase(''); controllerRef.current = null; inputRef.current?.focus({ preventScroll: true }); }
    }
  }

  function startOver() {
    requestRef.current += 1;
    controllerRef.current?.abort();
    setMessages([initialMessage]); setContext(null); setPending(null); setLastPlan(null); setManualDraft(null); setGenerated(false);
    setInput(''); setError(''); setBusy(false); setPhase(''); setNotice(''); setEngine('ai');
    onReset?.();
    inputRef.current?.focus({ preventScroll: true });
  }

  function continueManually(draft = lastPlan || manualDraft) {
    setGenerated(false);
    onManual(draft);
  }

  async function retryGeneration() {
    if (!lastPlan || busy) return;
    const requestId = ++requestRef.current;
    setBusy(true); setError('');
    try { await generate(lastPlan, requestId); }
    catch (err) { if (requestId === requestRef.current) setError(userMessage(err.message)); }
    finally { if (requestId === requestRef.current) { setBusy(false); setPhase(''); } }
  }

  return <section className="report-assistant" aria-label="Asistente para crear reportes">
    <div className="report-assistant__heading">
      <div className="report-builder__section-title"><span className="report-assistant__icon"><ReportBuilderIcon name="chat" /></span><div><h2>Describe el reporte que necesitas</h2><p>Escríbelo como lo dirías al pedir ayuda a un compañero.</p></div></div>
      <button type="button" className="report-assistant__reset" onClick={startOver} disabled={busy || messages.length === 1}><ReportBuilderIcon name="refresh" /> Nueva conversación</button>
    </div>
    <div className="report-assistant__body">
      <div className="report-assistant__chat">
        <div className="report-assistant__conversation" ref={conversationRef} role="log" aria-label="Conversación del reporte" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
          {messages.map((message, index) => <div key={index} className={`report-assistant__message report-assistant__message--${message.role}`}>
            {message.role === 'assistant' && <span className="report-assistant__avatar"><ReportBuilderIcon name="chat" /></span>}
            <div><span className="report-assistant__sender">{message.role === 'user' ? 'Tú' : engine === 'guided' ? 'Guía de reportes' : 'Asistente de reportes'}</span><p>{message.content}</p>
              {index === latestAssistantIndex && !!message.choices?.length && <div className="report-assistant__choices">{message.choices.map(choice => <button key={choice.id} type="button" disabled={busy} onClick={() => sendMessage(`Quiero el reporte «${choice.title}».`)}>{choice.title}<ReportBuilderIcon name="arrow" /></button>)}</div>}
              {index === latestAssistantIndex && !!message.options?.length && <div className="report-assistant__choices">{message.options.map((option, optionIndex) => <button key={optionIndex} type="button" disabled={busy} onClick={() => sendMessage(option.message)}>{option.label}<ReportBuilderIcon name="arrow" /></button>)}</div>}
            </div>
          </div>)}
          {busy && <div className="report-assistant__working" role="status"><span className="report-assistant__pulse" />{phase}</div>}
        </div>
        {messages.length === 1 && !unavailable && <div className="report-assistant__examples"><span>Puedes empezar con algo como:</span>{examples.map(example => <button type="button" key={example.title} onClick={() => { setInput(example.text); inputRef.current?.focus(); }}>{example.title}<ReportBuilderIcon name="arrow" /></button>)}</div>}
        {notice && <p className="report-assistant__notice" role="status">{notice}</p>}
        {error && <div className="report-assistant__error" role="alert"><span>{error}</span>{lastPlan && <button type="button" onClick={retryGeneration} disabled={busy}>Reintentar reporte</button>}</div>}
        {unavailable && <p className="report-assistant__notice" role="status">{catalogLoading ? 'Cargando los temas disponibles…' : catalogError || 'No tienes temas disponibles para crear reportes.'} {!catalogLoading && <button type="button" onClick={() => continueManually(null)}>Ver temas disponibles</button>}</p>}
        <form className="report-assistant__composer" onSubmit={event => { event.preventDefault(); sendMessage(); }}>
          <label htmlFor="report-assistant-message">¿Qué información necesitas?</label>
          <textarea ref={inputRef} id="report-assistant-message" value={input} onChange={event => setInput(event.target.value)} maxLength={1500} rows={3} disabled={busy || unavailable} placeholder="Ej. Necesito las cirugías del mes pasado con paciente, médico y procedimiento." onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); sendMessage(); } }} />
          <div className="report-assistant__composer-footer"><span>Enter para enviar · Shift + Enter para otra línea</span><button type="submit" className="report-builder__button report-builder__button--primary" disabled={busy || unavailable || input.trim().length < 2}><ReportBuilderIcon name="send" />{busy ? 'Preparando…' : 'Enviar solicitud'}</button></div>
        </form>
      </div>
      <aside className="report-assistant__summary" aria-label="Configuración del reporte conversado">
        <span className="report-assistant__summary-icon"><ReportBuilderIcon name="report" /></span>
        <h3>{lastPlan ? 'Tu reporte' : visiblePlan ? 'Estamos preparando tu reporte' : 'De tu idea al reporte'}</h3>
        {visiblePlan ? <>
          <strong>{visiblePlan.entityTitle || catalog.find(entity => entity.id === visiblePlan.entity)?.title}</strong>
          <dl><div><dt>Información</dt><dd>{visiblePlan.source || catalog.find(entity => entity.id === visiblePlan.entity)?.source || 'SAP'}</dd></div>
            {(visiblePlan.requiresDateFilter || visiblePlan.filters?.fechaDesde) && <div><dt>Período</dt><dd>{formatDate(visiblePlan.filters.fechaDesde) || 'Por definir'}{visiblePlan.filters.fechaHasta && ` al ${formatDate(visiblePlan.filters.fechaHasta)}`}</dd></div>}
            {(visiblePlan.appliedFilters || []).filter(filter => filter.label !== 'Texto buscado').map(filter => <div key={filter.label}><dt>{filter.label}</dt><dd>{filter.value}</dd></div>)}
          </dl>
          <span className="report-assistant__columns-label">Columnas incluidas</span><ul>{(visiblePlan.selectedFields || []).map(key => <li key={key}><ReportBuilderIcon name="check" />{catalog.find(entity => entity.id === visiblePlan.entity)?.fields.find(field => field.key === key)?.label}</li>)}</ul>
          {visiblePlan.filters.busqueda && <p className="report-assistant__search-summary">Búsqueda: {visiblePlan.filters.busqueda}</p>}
          {generated && <button type="button" className="report-builder__button report-builder__button--primary" onClick={onViewReport}>Ver reporte <ReportBuilderIcon name="arrow" /></button>}
          <button type="button" className="report-assistant__manual" disabled={busy} onClick={() => continueManually()}>{lastPlan ? 'Ajustar filtros y columnas' : 'Elegir filtros y columnas'}</button>
        </> : <>
          <p>Indica qué quieres consultar y qué datos te interesa incluir.</p>
          <ol><li>Describe tu solicitud.</li><li>Responde si falta algún dato.</li><li>Revisa y descarga tu reporte.</li></ol>
          <p className="report-assistant__hint">Después puedes pedir: “agrega la fecha” o “cambia al mes pasado”.</p>
          <button type="button" className="report-assistant__manual" disabled={busy} onClick={() => continueManually(null)}>Prefiero elegir un tema</button>
        </>}
      </aside>
    </div>
  </section>;
}
