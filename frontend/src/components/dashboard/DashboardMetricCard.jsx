import './DashboardVisuals.css';

export default function DashboardMetricCard({ title, value, subtitle, color = '#0088c9', icon, isText = false }) {
  const negative = typeof value === 'number' ? value < 0 : typeof value === 'string' && /^[-−]/.test(value.trim());
  return (
    <div className={`dashboard-metric-card${negative ? ' dashboard-metric-card--negative' : ''}`} style={{ '--metric-accent': color }}>
      <div className="dashboard-metric-top">
        <div className="dashboard-metric-label">{title}</div>
        {icon && <div className="dashboard-metric-icon" aria-hidden="true">{icon}</div>}
      </div>
      <div className={`dashboard-metric-value${isText ? ' dashboard-metric-value--text' : ''}${negative ? ' dashboard-metric-value--negative' : ''}`}>{value}</div>
      {subtitle && <div className="dashboard-metric-note">{subtitle}</div>}
    </div>
  );
}
