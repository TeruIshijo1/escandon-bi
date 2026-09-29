import React, { useState } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import ExportToolbar from '../shared/ExportToolbar';

// Highcharts TopoJSON de México
const geoUrl = "/mx-all.topo.json"; 

// Mapeo de estados del SITI y Nuevo Sistema al nombre exacto en el TopoJSON
const NORMALIZED_STATES = {
  'df': 'Distrito Federal',
  'cdmx': 'Distrito Federal',
  'ciudad de méxico': 'Distrito Federal',
  'ciudad de mexico': 'Distrito Federal',
  'distrito federal': 'Distrito Federal',
  'edom': 'México',
  'estado de méxico': 'México',
  'estado de mexico': 'México',
  'mex': 'México',
  'méxico': 'México',
  'mexico': 'México',
  'hid': 'Hidalgo',
  'hgo': 'Hidalgo',
  'hidalgo': 'Hidalgo',
  'pue': 'Puebla',
  'puebla': 'Puebla',
  'ver': 'Veracruz',
  'veracruz': 'Veracruz',
  'mor': 'Morelos',
  'morelos': 'Morelos',
  'oax': 'Oaxaca',
  'oaxaca': 'Oaxaca',
  'mich': 'Michoacán',
  'michoacan': 'Michoacán',
  'michoacán': 'Michoacán',
  'nl': 'Nuevo León',
  'nuevo leon': 'Nuevo León',
  'nuevo león': 'Nuevo León',
  'qro': 'Querétaro',
  'queretaro': 'Querétaro',
  'querétaro': 'Querétaro',
  'que': 'Querétaro',
  'jal': 'Jalisco',
  'jalisco': 'Jalisco',
  'gto': 'Guanajuato',
  'guanajuato': 'Guanajuato',
  'slp': 'San Luis Potosí',
  'san luis potosí': 'San Luis Potosí',
  'san luis potosi': 'San Luis Potosí',
  'ags': 'Aguascalientes',
  'aguascalientes': 'Aguascalientes',
  'bc': 'Baja California',
  'bcn': 'Baja California',
  'baja california': 'Baja California',
  'bcs': 'Baja California Sur',
  'baja california sur': 'Baja California Sur',
  'chih': 'Chihuahua',
  'chihuahua': 'Chihuahua',
  'coah': 'Coahuila',
  'coahuila': 'Coahuila',
  'col': 'Colima',
  'colima': 'Colima',
  'dgo': 'Durango',
  'durango': 'Durango',
  'gro': 'Guerrero',
  'guer': 'Guerrero',
  'guerrero': 'Guerrero',
  'nay': 'Nayarit',
  'nayarit': 'Nayarit',
  'qroo': 'Quintana Roo',
  'qr': 'Quintana Roo',
  'quin': 'Quintana Roo',
  'quintana roo': 'Quintana Roo',
  'sin': 'Sinaloa',
  'sinaloa': 'Sinaloa',
  'son': 'Sonora',
  'sonora': 'Sonora',
  'tab': 'Tabasco',
  'tabasco': 'Tabasco',
  'tamps': 'Tamaulipas',
  'tams': 'Tamaulipas',
  'tamaulipas': 'Tamaulipas',
  'tlax': 'Tlaxcala',
  'tla': 'Tlaxcala',
  'tlaxcala': 'Tlaxcala',
  'yuc': 'Yucatán',
  'yucatan': 'Yucatán',
  'zac': 'Zacatecas',
  'zacatecas': 'Zacatecas',
  'camp': 'Campeche',
  'campeche': 'Campeche',
  'chis': 'Chiapas',
  'chiapas': 'Chiapas'
};

function normalizeStateName(dbName) {
  if (!dbName) return "";
  const lower = dbName.toLowerCase().trim();
  return NORMALIZED_STATES[lower] || dbName.trim();
}

export default function DashboardMapaGeografico({ 
  estados = [], 
  ciudades = [], 
  title = "Mapa Demográfico",
  targetId = "dashboard-mapa",
  filterControls = null,
  kpis = null,
  customExportData = null,
  customFileNamePrefix = null
}) {
  const [tooltipContent, setTooltipContent] = useState("");

  const maxValue = Math.max(...estados.map(e => e.cantidad), 1);
  
  const colorScale = (val) => {
    // Interpolar entre #e0e7ff y #1d4ed8
    const ratio = Math.min(Math.max(val / maxValue, 0), 1);
    const r = Math.round(224 + ratio * (29 - 224));
    const g = Math.round(231 + ratio * (78 - 231));
    const b = Math.round(255 + ratio * (216 - 255));
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Preparar exportData por defecto si no viene customExportData
  const exportData = customExportData || {
    "Top Estados": estados.map(e => ({ Estado: e.estado, Pacientes: e.cantidad })),
    "Top Municipios": ciudades.map(c => ({ Municipio: c.ciudad, Pacientes: c.cantidad }))
  };

  const fileNamePrefix = customFileNamePrefix || `Demografia_${title.replace(/\s+/g, '_')}`;

  const formatNumber = (num) => new Intl.NumberFormat('es-MX').format(num || 0);

  return (
    <div id={targetId}>
      {/* Barra superior con Título, Filtros y Botón de Exportar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>{title}</h2>
          {filterControls}
        </div>
        <ExportToolbar 
          targetId={targetId} 
          fileNamePrefix={fileNamePrefix} 
          excelData={exportData}
        />
      </div>

      {/* KPIs si existen */}
      {kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {kpis.map((kpi, idx) => (
            <div key={idx} className="siti-card" style={{ background: kpi.bg || '#ffffff', color: kpi.color || '#1e293b', padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.85 }}>{kpi.title}</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 'bold', marginTop: '0.25rem' }}>{kpi.value}</div>
              {kpi.subtitle && <div style={{ fontSize: '0.75rem', opacity: 0.75, marginTop: '0.25rem' }}>{kpi.subtitle}</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Mapa de México */}
        <div className="siti-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '480px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: '#1e293b', fontWeight: 600 }}>Distribución por Estados</h3>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Pasa el cursor sobre un estado</span>
          </div>
          <div style={{ width: '100%', height: '420px', background: '#f8fafc', borderRadius: '12px', position: 'relative', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{
                scale: 1300,
                center: [-102, 23.5] // Centro geográfico de México
              }}
              style={{ width: "100%", height: "100%" }}
            >
              <ZoomableGroup>
                <Geographies geography={geoUrl}>
                  {({ geographies }) => {
                    if (!geographies || geographies.length === 0) return null;
                    return geographies.map(geo => {
                      const geoName = geo.properties.name || "";
                      const d = estados.find(s => {
                        const normalizedDB = normalizeStateName(s.estado);
                        return normalizedDB && geoName && normalizedDB.toLowerCase() === geoName.toLowerCase();
                      });
                      return (
                        <Geography
                          key={geo.rsmKey}
                          geography={geo}
                          onMouseEnter={() => {
                            setTooltipContent(`${geoName}: ${d ? formatNumber(d.cantidad) : 0} pacientes`);
                          }}
                          onMouseLeave={() => {
                            setTooltipContent("");
                          }}
                          style={{
                            default: {
                              fill: d ? colorScale(d.cantidad) : "#e2e8f0",
                              outline: "none",
                              stroke: "#cbd5e1",
                              strokeWidth: 0.5
                            },
                            hover: {
                              fill: "#f59e0b",
                              outline: "none",
                              stroke: "#fff",
                              strokeWidth: 1.5,
                              cursor: "pointer"
                            },
                            pressed: {
                              fill: "#d97706",
                              outline: "none"
                            }
                          }}
                        />
                      );
                    });
                  }}
                </Geographies>
              </ZoomableGroup>
            </ComposableMap>
            {tooltipContent && (
              <div style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(4px)',
                color: 'white',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: '600',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                pointerEvents: 'none'
              }}>
                {tooltipContent}
              </div>
            )}
          </div>
        </div>

        {/* Gráficas de Barras */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          
          <div className="siti-card" style={{ flex: 1, minHeight: '230px' }}>
            <h3 style={{ marginBottom: '1rem', color: '#1e293b', fontWeight: 600 }}>Top 10 Estados</h3>
            <div style={{ height: 'calc(100% - 2.5rem)', minHeight: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={estados} layout="vertical" margin={{ top: 5, right: 30, left: 90, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => formatNumber(v)} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="estado" width={90} tick={{ fontSize: 11, fill: '#334155' }} />
                  <RechartsTooltip 
                    formatter={(value) => [formatNumber(value), 'Pacientes']} 
                    cursor={{fill: '#f1f5f9'}} 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                  <Bar dataKey="cantidad" name="Pacientes" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="siti-card" style={{ flex: 1, minHeight: '230px' }}>
            <h3 style={{ marginBottom: '1rem', color: '#1e293b', fontWeight: 600 }}>Top 15 Municipios / Alcaldías</h3>
            <div style={{ height: 'calc(100% - 2.5rem)', minHeight: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ciudades} layout="vertical" margin={{ top: 5, right: 30, left: 110, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => formatNumber(v)} stroke="#94a3b8" />
                  <YAxis type="category" dataKey="ciudad" width={110} tick={{ fontSize: 11, fill: '#334155' }} />
                  <RechartsTooltip 
                    formatter={(value) => [formatNumber(value), 'Pacientes']} 
                    cursor={{fill: '#f1f5f9'}} 
                    contentStyle={{ borderRadius: '8px', border: '1px solid #cbd5e1' }}
                  />
                  <Bar dataKey="cantidad" name="Pacientes" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
