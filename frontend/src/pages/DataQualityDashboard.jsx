/**
 * DataQualityDashboard.jsx — Control de Calidad de Datos
 * Hospital Escandón BI Platform
 */
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../api/client';

export default function DataQualityDashboard() {
  const [stats, setStats] = useState({
    cleanliness_score: 100,
    pending_issues: 0,
    high_severity_pending: 0,
    resolved_issues: 0,
    total_issues: 0,
  });
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState('PENDIENTE');
  const [severityFilter, setSeverityFilter] = useState('');
  const [actionNotes, setActionNotes] = useState('');

  const fetchStatsAndIssues = async () => {
    setLoading(true);
    try {
      // Fetch stats
      const statsData = await apiFetch('/data-quality/stats');
      if (statsData.success) {
        setStats(statsData.data);
      }

      // Fetch issues
      const issuesData = await apiFetch('/data-quality/issues', { params: { limit: 100, status: statusFilter, severity: severityFilter } });
      if (issuesData.success) {
        setIssues(issuesData.data || []);
      }
    } catch (err) {
      console.error('Error al cargar calidad de datos:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleScanLiveDB = async () => {
    setScanning(true);
    try {
      const data = await apiFetch('/data-quality/scan', { method: 'POST' });
      if (data.success) {
        alert(`🔍 Escaneo completado. Se detectaron ${data.detectedNewIssues || 0} nuevos hallazgos en la base de datos.`);
      }
      fetchStatsAndIssues();
    } catch (err) {
      alert('Error de conexión al escanear la base de datos.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    fetchStatsAndIssues();
  }, [statusFilter, severityFilter]);

  const handleResolveIssue = async (id, status) => {
    try {
      const data = await apiFetch(`/data-quality/issues/${id}/resolve`, {
        method: 'POST',
        body: {
          status,
          notes: actionNotes || 'Resuelto desde el panel de control.',
        },
      });

      if (data.success) {
        setActionNotes('');
        fetchStatsAndIssues();
      } else {
        alert(data.message || 'Error al actualizar anomalía.');
      }
    } catch (err) {
      alert('Error de conexión al resolver anomalía.');
    }
  };

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'ALTA':
        return <span style={{ background: '#FEE2E2', color: '#991B1B', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>🔴 ALTA</span>;
      case 'MEDIA':
        return <span style={{ background: '#FEF3C7', color: '#92400E', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>🟡 MEDIA</span>;
      default:
        return <span style={{ background: '#E0E7FF', color: '#3730A3', padding: '4px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>🔵 BAJA</span>;
    }
  };

  const getRuleLabel = (rule) => {
    switch (rule) {
      case 'PRECIO_ZERO':
        return 'Precio $0.00 o Negativo';
      case 'CARGO_DUPLICADO':
        return 'Posible Cargo Duplicado';
      case 'CANTIDAD_ANOMALA':
        return 'Cantidad Atípica (>10)';
      case 'DEVOLUCION_PENDIENTE':
        return 'Devolución Pendiente';
      case 'FECHA_INVALIDA':
        return 'Fecha Futura / Inválida';
      default:
        return rule;
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: 'var(--content-max, 1280px)', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Encabezado */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', color: '#0F172A', fontWeight: '800' }}>
            🛡️ Motor de Control de Calidad de Datos
          </h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748B', fontSize: '0.95rem' }}>
            Inspección y filtrado automático de anomalías en la base de datos en vivo y reportes.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleScanLiveDB}
            disabled={scanning}
            style={{
              background: '#00974A',
              color: '#FFFFFF',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '8px',
              fontWeight: '600',
              cursor: scanning ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {scanning ? 'Escaneando...' : '🔍 Escanear Base en Vivo'}
          </button>
          <button
            onClick={fetchStatsAndIssues}
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
            🔄 Actualizar Estado
          </button>
        </div>
      </div>

      {/* Tarjetas de Métricas de Salud */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: '600', marginBottom: '8px' }}>SCORE DE LIMPIEZA</div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: stats.cleanliness_score >= 90 ? '#16A34A' : '#D97706' }}>
            {stats.cleanliness_score}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>Porcentaje de datos limpios de error</div>
        </div>

        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: '600', marginBottom: '8px' }}>ALERTAS PENDIENTES</div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#DC2626' }}>
            {stats.pending_issues}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>{stats.high_severity_pending} de severidad alta</div>
        </div>

        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: '600', marginBottom: '8px' }}>RESUELTAS / CORREGIDAS</div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#2563EB' }}>
            {stats.resolved_issues}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>Auditadas por el personal</div>
        </div>

        <div style={{ background: '#FFFFFF', padding: '20px', borderRadius: '12px', border: '1px solid #E2E8F0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: '600', marginBottom: '8px' }}>TOTAL HISTÓRICO</div>
          <div style={{ fontSize: '2rem', fontWeight: '900', color: '#475569' }}>
            {stats.total_issues}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginTop: '4px' }}>Eventos procesados por el motor</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ background: '#FFFFFF', padding: '16px 20px', borderRadius: '12px', border: '1px solid #E2E8F0', marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontWeight: '600', fontSize: '0.85rem', color: '#475569' }}>Estado:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', outline: 'none' }}
          >
            <option value="">TODOS</option>
            <option value="PENDIENTE">PENDIENTES</option>
            <option value="RESUELTO">RESUELTOS</option>
            <option value="IGNORADO">IGNORADOS</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontWeight: '600', fontSize: '0.85rem', color: '#475569' }}>Severidad:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #CBD5E1', outline: 'none' }}
          >
            <option value="">TODAS</option>
            <option value="ALTA">ALTA</option>
            <option value="MEDIA">MEDIA</option>
            <option value="BAJA">BAJA</option>
          </select>
        </div>
      </div>

      {/* Tabla de Anomalías */}
      <div style={{ background: '#FFFFFF', borderRadius: '12px', border: '1px solid #E2E8F0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Cargando registros de calidad...</div>
        ) : issues.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
            🎉 ¡Excelente! No se encontraron anomalías de calidad registradas bajo estos filtros.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569' }}>
                <th style={{ padding: '12px 16px' }}>ID</th>
                <th style={{ padding: '12px 16px' }}>Origen</th>
                <th style={{ padding: '12px 16px' }}>Regla Violada</th>
                <th style={{ padding: '12px 16px' }}>Severidad</th>
                <th style={{ padding: '12px 16px' }}>Producto / Paciente</th>
                <th style={{ padding: '12px 16px' }}>Fecha</th>
                <th style={{ padding: '12px 16px' }}>Estado</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr key={issue.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 'bold' }}>#{issue.id}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: '0.8rem', background: '#F1F5F9', padding: '3px 8px', borderRadius: '4px', fontWeight: '600' }}>
                      {issue.source}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: '600' }}>{getRuleLabel(issue.rule_failed)}</td>
                  <td style={{ padding: '12px 16px' }}>{getSeverityBadge(issue.severity)}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ fontWeight: '600', color: '#0F172A' }}>{issue.description}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                      Código: {issue.item_code} | Paciente: {issue.patient_id || 'N/A'}
                    </div>
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748B', fontSize: '0.8rem' }}>
                    {new Date(issue.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      color: issue.status === 'PENDIENTE' ? '#D97706' : issue.status === 'RESUELTO' ? '#16A34A' : '#64748B'
                    }}>
                      {issue.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                    {issue.status === 'PENDIENTE' && (
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button
                          onClick={() => handleResolveIssue(issue.id, 'RESUELTO')}
                          style={{ background: '#16A34A', color: '#FFF', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                        >
                          Aprobar / Corregir
                        </button>
                        <button
                          onClick={() => handleResolveIssue(issue.id, 'IGNORADO')}
                          style={{ background: '#94A3B8', color: '#FFF', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                        >
                          Ignorar
                        </button>
                      </div>
                    )}
                    {issue.status !== 'PENDIENTE' && (
                      <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{issue.resolved_by}</span>
                    )}
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
