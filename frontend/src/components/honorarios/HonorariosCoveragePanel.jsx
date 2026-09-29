import React from 'react';

export default function HonorariosCoveragePanel({ coverage }) {
  const candidateCount = Number(coverage?.candidates) || 0;
  if (!candidateCount) return null;

  const recovered = Number(coverage?.recoveredAppointments) || 0;
  const needsReview = Number(coverage?.pendingAppointments) || 0;
  const duplicates = Number(coverage?.duplicateCandidates) || 0;

  return (
    <details className="hon-card hon-optional-details" style={{ padding: '0.6rem 0.9rem', marginBottom: '0.85rem', fontSize: '0.8rem' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-secondary, #475569)' }}>
        Citas adicionales revisadas: {candidateCount.toLocaleString()} · {recovered.toLocaleString()} con datos completos · {needsReview.toLocaleString()} con observaciones
      </summary>
      <div style={{ marginTop: '0.45rem', color: 'var(--text-muted, #64748b)' }}>
        Todas las citas recuperadas aparecen en “Por revisar” hasta que una persona autorizada decida. Las que tienen observaciones requieren validación antes de aprobarse.
        {duplicates > 0 && ` ${duplicates.toLocaleString()} posibles duplicados no se agregaron al reporte.`}
      </div>
    </details>
  );
}
