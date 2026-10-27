import React, { useState } from 'react';
import '../styles/SistemasAcuerdos.css';

export default function AutomatizacionesBI() {
  const [syncingTask, setSyncingTask] = useState(null);
  const [taskMsg, setTaskMsg] = useState(null);

  const automations = [
    {
      id: 'stats',
      name: 'Sincronización de Estadísticas Hospitalarias',
      frequency: 'Cada 15 minutos (mes en curso) / 24 horas (meses cerrados)',
      description: 'Sincroniza y consolida los episodios, ingresos, egresos y estancia desde Vertical hacia el Data Warehouse de PostgreSQL.',
      status: 'ACTIVO',
      lastRun: 'Hace 8 minutos',
      nextRun: 'En 7 minutos',
      icon: '📈'
    },
    {
      id: 'sap',
      name: 'Conector SAP B1 Service Layer (Inventarios & Almacén)',
      frequency: 'Cada 30 minutos',
      description: 'Extrae stocks, movimientos, costos promedio, lotes y traslados entre farmacia, quirófano y almacén general.',
      status: 'ACTIVO',
      lastRun: 'Hace 14 minutos',
      nextRun: 'En 16 minutos',
      icon: '📦'
    },
    {
      id: 'ml_reorden',
      name: 'Modelo Predictivo ML de Reorden y Agotamiento',
      frequency: 'Diario a las 04:00 hrs',
      description: 'Ejecuta el pipeline de Machine Learning para calcular días de cobertura por SKU y fechas estimadas de agotamiento.',
      status: 'ACTIVO',
      lastRun: 'Hoy a las 04:00 hrs',
      nextRun: 'Mañana a las 04:00 hrs',
      icon: '🤖'
    },
    {
      id: 'quirofano',
      name: 'ETL Quirófano y Productividad Médica',
      frequency: 'Diario a las 03:00 hrs',
      description: 'Calcula tiempos quirúrgicos, ocupación de salas, variaciones por cirujano y costos de kits médicos.',
      status: 'ACTIVO',
      lastRun: 'Hoy a las 03:00 hrs',
      nextRun: 'Mañana a las 03:00 hrs',
      icon: '🔪'
    },
    {
      id: 'reaperturas_backup',
      name: 'Auditoría y Respaldo Transaccional de Vertical',
      frequency: 'Bajo demanda transaccional',
      description: 'Genera snapshot de seguridad en D:\\Escritorio\\Reaperturas antes de cualquier modificación a cuentas en Vertical.',
      status: 'EN ESPERA',
      lastRun: '20-Oct-2026 15:00 hrs',
      nextRun: 'En próximo evento',
      icon: '🛡️'
    }
  ];

  const handleManualTrigger = (id, name) => {
    setSyncingTask(id);
    setTaskMsg(null);
    setTimeout(() => {
      setSyncingTask(null);
      setTaskMsg(`Tarea '${name}' ejecutada y verificada exitosamente.`);
    }, 1800);
  };

  return (
    <div className="sistemas-acuerdos-container">
      <div className="sistemas-header">
        <div className="sistemas-header-title">
          <span style={{ fontSize: '2rem' }}>🤖</span>
          <div>
            <h1>Panel de Automatizaciones BI</h1>
            <p>Monitoreo de tareas programadas en segundo plano, sincronizadores de datos y pipelines de inteligencia</p>
          </div>
        </div>
      </div>

      {taskMsg && (
        <div className="alert-box success">
          <span>✅ {taskMsg}</span>
          <button className="alert-close" onClick={() => setTaskMsg(null)}>✕</button>
        </div>
      )}

      <div className="sistemas-metrics-grid">
        <div className="metric-card healthy">
          <div className="metric-title">Automatizaciones Activas</div>
          <div className="metric-value">5 / 5</div>
          <div className="metric-sub">Todos los servicios operando normalmente</div>
        </div>
        <div className="metric-card primary">
          <div className="metric-title">Frecuencia Principal</div>
          <div className="metric-value">15 min</div>
          <div className="metric-sub">Sincronizador continuo de estadísticas</div>
        </div>
        <div className="metric-card warning">
          <div className="metric-title">Modelos ML</div>
          <div className="metric-value">1 Activo</div>
          <div className="metric-sub">Predicción de punto de reorden de insumos</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
        {automations.map(job => (
          <div
            key={job.id}
            style={{
              background: 'var(--bg-card, #1e293b)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '10px',
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '1.6rem' }}>{job.icon}</span>
                <span style={{
                  fontSize: '0.72rem',
                  fontWeight: 'bold',
                  padding: '0.2rem 0.5rem',
                  borderRadius: '999px',
                  background: job.status === 'ACTIVO' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                  color: job.status === 'ACTIVO' ? '#6ee7b7' : '#cbd5e1',
                  border: `1px solid ${job.status === 'ACTIVO' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`
                }}>
                  {job.status}
                </span>
              </div>
              <h3 style={{ fontSize: '1.05rem', margin: '0 0 0.4rem 0', fontWeight: '600' }}>{job.name}</h3>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 0.8rem 0', lineHeight: 1.4 }}>
                {job.description}
              </p>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1rem' }}>
                <div>⏱️ <strong>Frecuencia:</strong> {job.frequency}</div>
                <div>🕒 <strong>Última ejecución:</strong> {job.lastRun}</div>
                <div>⏳ <strong>Siguiente:</strong> {job.nextRun}</div>
              </div>
            </div>

            <button
              className="pill-btn"
              style={{
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                width: '100%',
                padding: '0.6rem',
                fontWeight: '600',
                cursor: syncingTask === job.id ? 'not-allowed' : 'pointer'
              }}
              disabled={syncingTask === job.id}
              onClick={() => handleManualTrigger(job.id, job.name)}
            >
              {syncingTask === job.id ? '⏳ Ejecutando sincronización...' : '⚡ Ejecutar Ahora'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
