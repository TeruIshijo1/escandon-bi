import React, { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../api/config';
import { authHeaders } from '../../api/auth';
import { userMessage } from '../../utils/userMessages';
import ReportBuilderIcon from './ReportBuilderIcon';
import { formatReportNumeric } from '../../utils/reportValueFormatting';
import './ReportAssistant.css';

const initialMessage = { role: 'assistant', content: 'Cuéntame qué necesitas con tus propias palabras, aunque no aparezca en “Elegir un tema”. Puedes pedir información específica o relacionar SAP con Vertical. Usaré los datos y relaciones disponibles para tu usuario; si falta algo, te haré una pregunta o te explicaré qué puedo consultar.' };
const formatDate = value => value ? value.split('-').reverse().join('/') : '';
const examples = [
  { title: 'Cirugías del mes pasado', text: 'Pásame las cirugías del mes pasado con el nombre del paciente, el doctor y qué le hicieron.' },
  { title: 'Lo que hay en farmacia', text: 'Quiero lo que hay en farma con el nombre del producto, cuánto queda y su costo.' },
  { title: 'Citas de esta semana', text: 'Muéstrame las citas de esta semana con el paciente, el doctor y la fecha.' },
];

export const hasReportAnalysis = analysis => Boolean(analysis && ['predicates', 'groupBy', 'measures', 'orderBy'].some(key => Array.isArray(analysis[key]) && analysis[key].length));

export const getReportPointLookup = (entity, analysis) => {
  for (const predicate of analysis?.predicates || []) {
    if (predicate.op !== 'eq' || !entity?.pointLookupFields?.includes(predicate.field)) continue;
    const value = Number(predicate.value);
    if (Number.isSafeInteger(value) && value > 0 && value <= 2147483647) return { field: predicate.field, value };
  }
  return null;
};

const describeAnalysis = (analysis, entity) => {
  const label = key => entity?.fields?.find(field => field.key === key)?.label || 'Dato del reporte';
  const valueLabel = (value, key) => {
    const field = entity?.fields?.find(field => field.key === key);
    if (value == null) return 'sin dato';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    return ['money', 'number', 'percent'].includes(field?.type) ? formatReportNumeric(value, field.type) : String(value);
  };
  const operators = { eq: 'igual a', ne: 'diferente de', gt: 'mayor que', gte: 'mayor o igual que', lt: 'menor que', lte: 'menor o igual que', contains: 'contiene', isNull: 'sin dato', notNull: 'con dato' };
  const measureLabels = (analysis.measures || []).map(measure => measure.op === 'count' ? 'Número de registros' : `${measure.op === 'countDistinct' ? 'Valores distintos de' : 'Suma de'} ${label(measure.field)}`);
  return {
    conditions: (analysis.predicates || []).map(predicate => predicate.op === 'between' ? `${label(predicate.field)} entre ${(predicate.values || []).map(value => valueLabel(value, predicate.field)).join(' y ')}` : `${label(predicate.field)} ${operators[predicate.op] || 'con condición'}${['isNull', 'notNull'].includes(predicate.op) ? '' : ` ${valueLabel(predicate.value, predicate.field)}`}`),
    groups: (analysis.groupBy || []).map(label), measures: measureLabels,
    order: (analysis.orderBy || []).map(order => `${/^metric_\d+$/.test(order.field) ? measureLabels[Number(order.field.slice(7))] || 'Resultado calculado' : label(order.field)}: ${order.direction === 'desc' ? 'de mayor a menor' : 'de menor a mayor'}`),
  };
};

export const ReportAnalysisSummary = ({ analysis, summary, entity, scope, grain, onRemove, label = 'Análisis del reporte' }) => {
  if (!hasReportAnalysis(analysis)) return null;
  const details = summary || describeAnalysis(analysis, entity);
  const hasUnknown = typeof scope?.unknownValues === 'number' ? scope.unknownValues > 0 : scope?.unknownValues && Object.values(scope.unknownValues).some(value => Number(value) > 0);
  return <section aria-label={label} style={{ margin: '1rem 0', padding: '1rem', border: '1px solid var(--report-border)', borderRadius: 10, background: 'var(--report-soft)', color: 'var(--report-text)', fontSize: '.8rem' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}><strong>{label}</strong>{onRemove && <button type="button" className="report-catalog__chip" onClick={onRemove}>Quitar análisis</button>}</div>
    {details.description && <p>{details.description}</p>}
    <dl style={{ margin: '.75rem 0', display: 'grid', gap: '.6rem' }}>{[['conditions', 'Condiciones'], ['groups', 'Agrupado por'], ['measures', 'Cálculos'], ['order', 'Orden']].map(([key, title]) => Array.isArray(details[key]) && details[key].length > 0 && <div key={key}><dt style={{ fontWeight: 700 }}>{title}</dt><dd style={{ margin: '.2rem 0 0' }}>{details[key].join(' · ')}</dd></div>)}</dl>
    {grain && <p><strong>Cada fila representa:</strong> {grain}</p>}
    {scope?.complete === true && <p><strong>Datos completos:</strong> {formatReportNumeric(scope.sourceRows, 'number', 'Sin dato')} registros consultados; {formatReportNumeric(scope.matchingRows, 'number', 'Sin dato')} cumplen las condiciones.{scope.groups != null && ` ${formatReportNumeric(scope.groups, 'number', 'Sin dato')} ${scope.groups === 1 ? 'grupo' : 'grupos'} en el resultado.`}{analysis.measures?.length > 0 && ' Los totales del reporte se calculan sobre los registros que cumplen las condiciones.'}</p>}
    {scope?.note && <p>{scope.note}</p>}
    {hasUnknown && <p>Los datos faltantes se conservan como desconocidos y no se convierten en cero.</p>}
  </section>;
};

export default function ReportAssistant({ assistantCatalog, catalogLoading, catalogError, onGenerate, onViewReport, onManual, onReset }) {
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
  const unavailable = catalogLoading || Boolean(catalogError) || !assistantCatalog.length;
  const visiblePlan = lastPlan || manualDraft;
  const visibleEntity = assistantCatalog.find(entity => entity.id === visiblePlan?.entity);
  const pointLookup = getReportPointLookup(visibleEntity, visiblePlan?.analysis);
  const exactWithoutPeriod = pointLookup && !visiblePlan?.filters?.fechaDesde && !visiblePlan?.filters?.fechaHasta;
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
  }, [assistantCatalog]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, busy, phase]);

  async function generate(plan, requestId) {
    setPhase('Consultando la información de tu reporte…');
    const result = await onGenerate(plan);
    if (requestId !== requestRef.current) return;
    if (!result) throw new Error('La selección cambió antes de terminar. Puedes pedir el reporte de nuevo.');
    if (result.analysis) {
      const canonicalPlan = { ...plan, analysis: result.analysis, analysisSummary: result.analysisSummary || plan.analysisSummary };
      setContext(canonicalPlan); setLastPlan(canonicalPlan);
    }
    setGenerated(true);
    const unit = plan.analysis?.groupBy?.length ? result.total === 1 ? 'grupo' : 'grupos' : result.total === 1 ? 'registro' : 'registros';
    setMessages(previous => [...previous, { role: 'assistant', content: result.total ? `Tu reporte está listo con ${result.total.toLocaleString('es-MX')} ${unit}${result.truncated ? '. Se alcanzó el límite de resultados; ajusta las fechas o los filtros para revisar el resto' : ''}. Puedes revisarlo abajo, descargarlo en Excel o pedirme un ajuste.` : 'El reporte está listo, pero no encontré registros con ese período y esos filtros. Puedes probar otras fechas o cambiar la búsqueda.' }]);
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
      const entity = result.plan && assistantCatalog.find(item => item.id === result.plan.entity);
      if (result.plan && (!entity || !Array.isArray(result.plan.selectedFields) || !result.plan.selectedFields.length || result.plan.selectedFields.some(key => !entity.fields.some(field => field.key === key)))) throw new Error('El tema o las columnas ya no están disponibles. Elige otro tema e intenta de nuevo.');
      const choices = (result.choices || []).filter(choice => assistantCatalog.some(entity => entity.id === choice.id));
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
          <strong>{visibleEntity?.title || visiblePlan.entityTitle}</strong>
          <dl><div><dt>Información</dt><dd>{visibleEntity?.source || visiblePlan.source || 'SAP'}</dd></div>
            {exactWithoutPeriod ? <div><dt>Consulta exacta sin período</dt><dd>{visibleEntity.fields.find(field => field.key === pointLookup.field)?.label}: {pointLookup.value}</dd></div> : (visiblePlan.requiresDateFilter || visiblePlan.filters?.fechaDesde) && <div><dt>Período</dt><dd>{formatDate(visiblePlan.filters.fechaDesde) || 'Por definir'}{visiblePlan.filters.fechaHasta && ` al ${formatDate(visiblePlan.filters.fechaHasta)}`}</dd></div>}
            {(visiblePlan.appliedFilters || []).filter(filter => filter.label !== 'Texto buscado').map(filter => <div key={filter.label}><dt>{filter.label}</dt><dd>{filter.value}</dd></div>)}
          </dl>
          <span className="report-assistant__columns-label">Columnas incluidas</span><ul>{(visiblePlan.selectedFields || []).map(key => <li key={key}><ReportBuilderIcon name="check" />{visibleEntity?.fields.find(field => field.key === key)?.label}</li>)}</ul>
          {visiblePlan.filters.busqueda && <p className="report-assistant__search-summary">Búsqueda: {visiblePlan.filters.busqueda}</p>}
          <ReportAnalysisSummary analysis={visiblePlan.analysis} summary={visiblePlan.analysisSummary} entity={visibleEntity} label="Análisis solicitado" />
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
