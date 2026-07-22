import React, { useState, useEffect } from 'react';
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import ExportToolbar from '../shared/ExportToolbar';

// Highcharts TopoJSON de México
const geoUrl = "/mx-all.topo.json"; 

// Mapeo de estados del SITI y Nuevo Sistema al nombre en TopoJSON
const NORMALIZED_STATES = {
  'df': 'Distrito Federal',
  'cdmx': 'Distrito Federal',
  'ciudad de méxico': 'Distrito Federal',
  'edom': 'México',
  'estado de méxico': 'México',
  'mex': 'México',
  'hid': 'Hidalgo',
  'pue': 'Puebla',
  'ver': 'Veracruz',
  'mor': 'Morelos',
  'oax': 'Oaxaca',
  'mich': 'Michoacán',
  'michoacan': 'Michoacán',
  'nl': 'Nuevo León',
  'nuevo leon': 'Nuevo León',
  'qro': 'Querétaro',
  'queretaro': 'Querétaro',
  'que': 'Querétaro',
  'jal': 'Jalisco',
  'gto': 'Guanajuato',
  'slp': 'San Luis Potosí',
  'ags': 'Aguascalientes',
  'bc': 'Baja California',
  'bcs': 'Baja California Sur',
  'chih': 'Chihuahua',
  'coah': 'Coahuila',
  'col': 'Colima',
  'dgo': 'Durango',
  'gro': 'Guerrero',
  'nay': 'Nayarit',
  'qroo': 'Quintana Roo',
  'qr': 'Quintana Roo',
  'sin': 'Sinaloa',
  'son': 'Sonora',
  'tab': 'Tabasco',
  'tamps': 'Tamaulipas',
  'tlax': 'Tlaxcala',
  'tla': 'Tlaxcala',
  'yuc': 'Yucatán',
  'zac': 'Zacatecas',
  'camp': 'Campeche',
  'chis': 'Chiapas'
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
  targetId = "dashboard-mapa"
}) {
  const [tooltipContent, setTooltipContent] = useState("");

  const maxValue = Math.max(...estados.map(e => e.cantidad), 1);
  
  const colorScale = (val) => {
    // Interpolar entre #f8fafc y #2563eb
    const ratio = Math.min(Math.max(val / maxValue, 0), 1);
    const r = Math.round(248 + ratio * (37 - 248));
    const g = Math.round(250 + ratio * (99 - 250));
    const b = Math.round(252 + ratio * (235 - 252));
    return `rgb(${r}, ${g}, ${b})`;
  };

  // Preparar exportData
  const exportData = {
    "Top Estados": estados.map(e => ({ Estado: e.estado, Pacientes: e.cantidad })),
    "Top Municipios": ciudades.map(c => ({ Municipio: c.ciudad, Pacientes: c.cantidad }))
  };

  const formatNumber = (num) => new Intl.NumberFormat('es-MX').format(num || 0);

  return (
    <div id={targetId}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1e293b' }}>{title}</h2>
        <ExportToolbar 
          targetId={targetId} 
          fileNamePrefix={`Demografia_${title.replace(/\s+/g, '_')}`} 
          excelData={exportData}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
        
        {/* Mapa de México */}
        <div className="siti-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h3 style={{ marginBottom: '1rem', color: '#1e293b', alignSelf: 'flex-start' }}>Distribución por Estados</h3>
          <div style={{ width: '100%', height: '400px', background: '#f1f5f9', borderRadius: '12px', position: 'relative' }}>
            <ComposableMap
              projection="geoMercator"
              projectionConfig={{
                scale: 1200,
                center: [-102, 24] // Centro de México
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
                              strokeWidth: 1,
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
                top: 10,
                right: 10,
                background: 'rgba(0,0,0,0.7)',
                color: 'white',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.9rem',
                fontWeight: 'bold',
                pointerEvents: 'none'
              }}>
                {tooltipContent}
              </div>
            )}
          </div>
        </div>

        {/* Gráficas de Barras */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          <div className="siti-card" style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Top 10 Estados</h3>
            <div style={{ height: 'calc(100% - 2rem)', minHeight: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={estados} layout="vertical" margin={{ top: 5, right: 30, left: 80, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => formatNumber(v)} />
                  <YAxis type="category" dataKey="estado" width={80} tick={{ fontSize: 11 }} />
                  <RechartsTooltip formatter={(value) => formatNumber(value)} cursor={{fill: '#f1f5f9'}} />
                  <Bar dataKey="cantidad" name="Pacientes" fill="#2563eb" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="siti-card" style={{ flex: 1 }}>
            <h3 style={{ marginBottom: '1.5rem', color: '#1e293b' }}>Top 15 Municipios / Alcaldías</h3>
            <div style={{ height: 'calc(100% - 2rem)', minHeight: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ciudades} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => formatNumber(v)} />
                  <YAxis type="category" dataKey="ciudad" width={100} tick={{ fontSize: 11 }} />
                  <RechartsTooltip formatter={(value) => formatNumber(value)} cursor={{fill: '#f1f5f9'}} />
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
