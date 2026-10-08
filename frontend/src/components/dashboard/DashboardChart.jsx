import { Children, cloneElement, isValidElement, useState } from 'react';
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Bar, Line, Area, Pie, Cell } from 'recharts';
import './DashboardVisuals.css';

const numberFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });
const readValue = (row, key) => typeof key === 'function' ? key(row) : String(key || '').split('.').reduce((value, part) => value?.[part], row);
const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = value => /^\d{4}-\d{2}$/.test(String(value)) ? `${monthNames[Number(String(value).slice(5)) - 1]} ${String(value).slice(2, 4)}` : value;
const paletteColor = (name, index) => {
  const text = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/costos?|perdida|defuncion|mortalidad|cancelad|vencid/.test(text)) return 'var(--chart-danger)';
  if (/mora|riesgo|alerta|atraso/.test(text)) return 'var(--chart-warning)';
  return `var(--chart-${index % 6 + 1})`;
};

// A ranking gives long names their own line. The original data and click handlers
// stay attached to each row, so filtering works with the keyboard as well.
function Ranking({ chart, bar, axis, tooltip }) {
  const rows = bar.props.data || chart.props.data || [];
  const values = rows.map(row => Number(readValue(row, bar.props.dataKey)) || 0);
  const maximum = Math.max(0, ...values.map(Math.abs));
  const name = bar.props.name || bar.props.dataKey;
  const cells = Children.toArray(bar.props.children).filter(isValidElement);
  return (
    <ol className="dashboard-ranking" aria-label={bar.props.name || 'Comparación de resultados'}>
      {rows.length === 0 && <li className="dashboard-chart-empty">No hay datos para el periodo seleccionado.</li>}
      {rows.map((row, index) => {
        const value = values[index];
        const label = readValue(row, axis?.props.dataKey) ?? row.nombre ?? row.name ?? `Resultado ${index + 1}`;
        const entry = { ...row, payload: row, value };
        const formatted = tooltip?.props.formatter?.(value, name, entry, index, []) ?? numberFormat.format(value);
        const displayValue = Array.isArray(formatted) ? formatted[0] : formatted;
        const cell = cells[index];
        const interactive = !!(bar.props.onClick || cell?.props.onClick);
        const content = <>
          <span className="dashboard-ranking__position" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="dashboard-ranking__body">
            <span className="dashboard-ranking__summary">
              <span className="dashboard-ranking__label">{label}</span>
              <span className={`dashboard-ranking__value${value < 0 ? ' dashboard-ranking__value--negative' : ''}`}>{displayValue}</span>
            </span>
            <span className="dashboard-ranking__track" aria-hidden="true">
              <span className={`dashboard-ranking__bar${value < 0 ? ' dashboard-ranking__bar--negative' : ''}`} style={{ width: `${maximum ? Math.abs(value) / maximum * 100 : 0}%` }} />
            </span>
          </span>
        </>;
        return <li key={index} style={{ opacity: cell?.props.style?.opacity ?? bar.props.opacity ?? 1 }}>
          {interactive ? <button type="button" className="dashboard-ranking__row" onClick={event => {
            cell?.props.onClick?.(entry, index, event);
            bar.props.onClick?.(entry, index, event);
          }}>{content}</button> : <div className="dashboard-ranking__row">{content}</div>}
        </li>;
      })}
    </ol>
  );
}

function styleChild(child, seriesIndex = 0, pieChart = false, size = {}) {
  if (!isValidElement(child)) return child;
  const props = child.props;
  if (child.type === XAxis || child.type === YAxis) {
    const tick = props.tick === false || isValidElement(props.tick) || typeof props.tick === 'function'
      ? props.tick : { ...props.tick, fontSize: 12, fill: 'var(--dash-muted)' };
    return cloneElement(child, { axisLine: false, tickLine: false, minTickGap: 26, ...(child.type === XAxis ? { tickFormatter: monthLabel } : {}), ...props, tick, tickMargin: Math.max(props.tickMargin || 0, 10) });
  }
  if (child.type === CartesianGrid) return cloneElement(child, { ...props, stroke: 'var(--dash-grid)', strokeDasharray: '3 5', opacity: .7 });
  if (child.type === Tooltip) return cloneElement(child, {
    labelFormatter: monthLabel, ...props, wrapperStyle: { ...props.wrapperStyle, zIndex: 20 },
    contentStyle: { ...props.contentStyle, background: 'var(--dash-surface)', border: '1px solid var(--dash-border)', borderRadius: 12, padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,20,40,.12)', fontSize: 13 },
    labelStyle: { ...props.labelStyle, color: 'var(--dash-text)', fontWeight: 700, marginBottom: 6 },
    itemStyle: { ...props.itemStyle, color: 'var(--dash-secondary)', padding: '3px 0' },
  });
  if (child.type === Legend) return cloneElement(child, {
    ...props, height: undefined, ...(pieChart ? { layout: 'horizontal', verticalAlign: 'bottom', align: 'center' } : {}), iconSize: 9, wrapperStyle: { ...props.wrapperStyle, fontSize: 13, lineHeight: '22px', paddingTop: 12 },
  });
  const color = paletteColor(props.name || props.dataKey, seriesIndex);
  const firstRow = props.data?.[0] || {};
  const nameKey = props.nameKey || ['nombre', 'name', 'grupo', 'metodo', 'genero', 'estatus', 'status'].find(key => typeof firstRow[key] === 'string');
  const cells = Children.map(props.children, (cell, index) => {
    const row = props.data?.[index] || {};
    const label = row[nameKey];
    return isValidElement(cell) && cell.type === Cell ? cloneElement(cell, { fill: paletteColor(label, index) }) : cell;
  });
  if (child.type === Bar) return cloneElement(child, { maxBarSize: 44, ...props, fill: color, fillOpacity: props.fillOpacity ?? Number(props.fill?.match?.(/,\s*([\d.]+)\s*\)$/)?.[1] || 1) }, cells);
  if (child.type === Line || child.type === Area) {
    const dot = props.dot && typeof props.dot === 'object' && !isValidElement(props.dot) ? { ...props.dot, fill: color, stroke: 'var(--dash-surface)' } : props.dot;
    return cloneElement(child, { ...props, stroke: color, strokeWidth: Math.max(props.strokeWidth || 0, 2.5), dot,
      ...(child.type === Area ? { fill: color, fillOpacity: Math.min(props.fillOpacity ?? .16, .16) } : {}),
    });
  }
  if (child.type === Pie) {
    const horizontalSpace = props.label ? 110 : 32;
    const verticalSpace = props.label ? 140 : 80;
    const maxRadius = size.width && size.height ? Math.max(30, Math.min((size.width - horizontalSpace) / 2, (size.height - verticalSpace) / 2)) : Infinity;
    const outerRadius = typeof props.outerRadius === 'number' ? Math.min(props.outerRadius, maxRadius) : props.outerRadius;
    const innerRadius = typeof props.innerRadius === 'number' && typeof props.outerRadius === 'number' ? props.innerRadius * outerRadius / props.outerRadius : props.innerRadius;
    return cloneElement(child, { ...props, nameKey, outerRadius, innerRadius, fill: color, stroke: 'var(--dash-surface)', strokeWidth: 2 }, cells);
  }
  return child;
}

export default function DashboardChart({ children, className = '', ...props }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const chart = Children.only(children);
  const parts = Children.toArray(chart.props.children);
  const bars = parts.filter(child => child.type === Bar);
  if (chart.props.layout === 'vertical' && bars.length === 1 && !bars[0].props.stackId) {
    return <Ranking chart={chart} bar={bars[0]} axis={parts.find(child => child.type === YAxis)} tooltip={parts.find(child => child.type === Tooltip)} />;
  }
  const hasAxes = parts.some(child => child.type === XAxis || child.type === YAxis);
  const originalMargin = chart.props.margin || {};
  const margin = hasAxes ? { ...originalMargin, top: Math.max(originalMargin.top || 0, 12), right: Math.max(originalMargin.right || 0, 28), left: Math.max(originalMargin.left || 0, 0), bottom: Math.max(originalMargin.bottom || 0, 8) } : originalMargin;
  let seriesIndex = 0;
  const pieChart = parts.some(child => child.type === Pie);
  // A shared palette and safe margins keep the last axis label visible.
  return <ResponsiveContainer width="100%" height="100%" minWidth={0} {...props} onResize={(width, height) => {
    setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    props.onResize?.(width, height);
  }} className={`dashboard-chart ${className}`}>
    {cloneElement(chart, { ...chart.props, margin }, parts.map(child => styleChild(child, [Bar, Line, Area, Pie].includes(child.type) ? seriesIndex++ : 0, pieChart, size)))}
  </ResponsiveContainer>;
}
