/**
 * InteroperabilidadConfig.jsx — Ingesta Automática y Conectores HL7/FHIR (Opción 5)
 * Hospital Escandón BI Platform
 */
import React, { useState, useEffect } from 'react';

export default function InteroperabilidadConfig() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [protocol, setProtocol] = useState('HL7v2');
  const [withAnomaly, setWithAnomaly] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/interop/logs?limit=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        setLogs(data.data || []);
      }
    } catch (err) {
      console.error('Error al cargar bitácora de interoperabilidad:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleSimulate = async () => {
    setSimulating(true);
    setLastResult(null);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/interop/simulate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ protocol, withAnomaly }),
      });

      const data = await res.json();
      setLastResult(data);
      fetchLogs();
    } catch (err) {
      alert('Error de conexión al disparar evento simulado.');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#0F172A', fontWeight: '800' }}>
            🔌 Conectores de Interoperabilidad HL7 / FHIR (Opción 5)
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748B', fontSize: '0.95rem' }}>
            Recepción e ingesta automática de consumos clínicos y cobros sin necesidad de subir archivos Excel.
          </p>
        </div>
        <button
          onClick={fetchLogs}
          style={{
            background: '#004687',
            color: '#FFFFFF',
            border: 'none',
            padding: '10px 18px',
            borderRadius: '8px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          🔄 Actualizar Eventos
        </button>
      </div>

      {/* Tarjetas de Estado de Conectores */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '2rem' }}>🌐</div>
          <div>
            <div style={{ fontWeight: '700', color: '#0F172A' }}>Escuchador HL7 v2 (DFT^P03)</div>
            <div style={{ fontSize: '0.8rem', color: '#16A34A', fontWeight: '600', marginTop: '2px' }}>● ACTIVO — Escuchando puerto /api/interop/hl7/dft</div>
          </div>
        </div>

        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ fontSize: '2rem' }}>🔥</div>
          <div>
            <div style={{ fontWeight: '700', color: '#0F172A' }}>API Webhook FHIR R4 (ChargeItem)</div>
            <div style={{ fontSize: '0.8rem', color: '#16A34A', fontWeight: '600', marginTop: '2px' }}>● ACTIVO — Endpoint REST habilitado</div>
          </div>
        </div>
      </div>

      {/* Panel de Simulación de Eventos */}
      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '20px', borderRadius: '12px', marginBottom: '24px' }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', color: '#0F172A' }}>
          🚀 Simulador de Eventos en Tiempo Real
        </h3>
        <p style={{ margin: '0 0 16px 0', color: '#64748B', fontSize: '0.9rem' }}>
          Prueba la ingesta automática enviando un evento HL7 o FHIR generado al instante.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <label style={{ fontWeight: '600', fontSize: '0.85rem', color: '#475569', marginRight: '12px' }}>Protocolo:</label>
            <label style={{ marginRight: '16px', cursor: 'pointer' }}>
              <input type="radio" name="proto" value="HL7v2" checked={protocol === 'HL7v2'} onChange={() => setProtocol('HL7v2')} /> HL7 v2
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input type="radio" name="proto" value="FHIR_R4" checked={protocol === 'FHIR_R4'} onChange={() => setProtocol('FHIR_R4')} /> FHIR R4
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              id="anomalyCheck"
              checked={withAnomaly}
              onChange={(e) => setWithAnomaly(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="anomalyCheck" style={{ fontWeight: '600', fontSize: '0.85rem', color: '#DC2626', cursor: 'pointer' }}>
              Inyectar anomalía de calidad (Precio $0 o Cantidad &gt; 50)
            </label>
          </div>

          <button
            onClick={handleSimulate}
            disabled={simulating}
            style={{
              background: '#2563EB',
              color: '#FFF',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: '700',
              cursor: simulating ? 'wait' : 'pointer',
            }}
          >
            {simulating ? 'Procesando...' : '⚡ Disparar Evento Automático'}
          </button>
        </div>

        {/* Resultado de Simulación */}
        {lastResult && (
          <div style={{ background: '#FFFFFF', padding: '16px', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.85rem' }}>
            <div style={{ fontWeight: 'bold', color: lastResult.result?.status === 'ALERTA_CALIDAD' ? '#D97706' : '#16A34A', marginBottom: '6px' }}>
              {lastResult.message} Status: [{lastResult.result?.status}]
            </div>
            <div style={{ color: '#475569' }}>
              <strong>Paciente:</strong> {lastResult.result?.parsedRecord?.patient_id} | 
              <strong> Insumo:</strong> {lastResult.result?.parsedRecord?.description} | 
              <strong> Precio:</strong> ${lastResult.result?.parsedRecord?.price} | 
              <strong> Cantidad:</strong> {lastResult.result?.parsedRecord?.quantity}
            </div>
            {lastResult.result?.qualityIssues?.length > 0 && (
              <div style={{ marginTop: '8px', padding: '8px', background: '#FEE2E2', borderRadius: '6px', color: '#991B1B', fontWeight: 'bold' }}>
                ⚠️ Inspección de Calidad Detectada: {lastResult.result.qualityIssues.map(q => q.message).join(' ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bitácora de Eventos Recibidos */}
      <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0', fontWeight: '700', color: '#0F172A' }}>
          📋 Bitácora de Ingesta en Tiempo Real (Últimos Eventos)
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Cargando bitácora de eventos...</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
            No hay eventos registrados. Dispara un evento con el simulador arriba.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569' }}>
                <th style={{ padding: '12px 16px' }}>ID</th>
                <th style={{ padding: '12px 16px' }}>Protocolo</th>
                <th style={{ padding: '12px 16px' }}>Tipo Evento</th>
                <th style={{ padding: '12px 16px' }}>Paciente</th>
                <th style={{ padding: '12px 16px' }}>Estado Ingesta</th>
                <th style={{ padding: '12px 16px' }}>Fecha / Hora</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold' }}>#{log.id}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: '0.75rem', background: log.protocol === 'HL7v2' ? '#E0F2FE' : '#F3E8FF', color: log.protocol === 'HL7v2' ? '#0369A1' : '#6B21A8', padding: '3px 8px', borderRadius: '4px', fontWeight: 'bold' }}>
                      {log.protocol}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600' }}>{log.event_type}</td>
                  <td style={{ padding: '12px 16px', color: '#0F172A', fontWeight: '500' }}>{log.patient_id || 'N/A'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      padding: '4px 8px',
                      borderRadius: '12px',
                      background: log.status === 'PROCESADO' ? '#DCFCE7' : log.status === 'ALERTA_CALIDAD' ? '#FEF3C7' : '#FEE2E2',
                      color: log.status === 'PROCESADO' ? '#15803D' : log.status === 'ALERTA_CALIDAD' ? '#B45309' : '#B91C1C',
                    }}>
                      {log.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748B', fontSize: '0.8rem' }}>
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
