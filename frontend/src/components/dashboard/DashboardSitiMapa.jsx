import React, { useState, useEffect } from 'react';
import { API_BASE } from '../../api/config';
import PremiumLoader from '../shared/PremiumLoader';
import DashboardMapaGeografico from './DashboardMapaGeografico';

export default function DashboardSitiMapa() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState('2025');

  useEffect(() => {
    setLoading(true);
    const token = sessionStorage.getItem('escandon_token');
    const headers = { Authorization: `Bearer ${token}` };
    const query = year !== 'Histórico' ? `?year=${year}` : '';

    fetch(`${API_BASE}/siti/demografia${query}`, { headers })
      .then(res => res.json())
      .then(res => {
        if (res.success) {
          setData(res);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, [year]);

  // Generar lista de años del 2025 al 2010 + Histórico
  const years = [];
  for (let i = 2025; i >= 2010; i--) years.push(i.toString());
  years.push('Histórico');

  const filterControls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Año:</label>
      <select 
        value={year} 
        onChange={(e) => setYear(e.target.value)}
        style={{ 
          padding: '6px 12px', 
          borderRadius: '8px', 
          border: '1px solid #cbd5e1', 
          background: 'white', 
          color: '#0f172a',
          fontWeight: '600',
          fontSize: '0.9rem',
          cursor: 'pointer',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
        }}
      >
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );

  if (loading && !data) return <PremiumLoader message="Cargando demografía geográfica..." />;
  if (!data) return <div className="p-8 text-center text-red-500">Error al cargar datos geográficos.</div>;

  const formatNumber = (num) => new Intl.NumberFormat('es-MX').format(num || 0);
  const topEstado = data.estados && data.estados.length > 0 ? data.estados[0] : null;
  const topCiudad = data.ciudades && data.ciudades.length > 0 ? data.ciudades[0] : null;

  const totalPacientesNum = data.totalPacientes || (data.estados || []).reduce((acc, c) => acc + c.cantidad, 0);

  const kpis = [
    {
      title: `Pacientes Únicos (${year})`,
      value: formatNumber(totalPacientesNum),
      bg: 'linear-gradient(135deg, #1e40af, #3b82f6)',
      color: '#ffffff',
      subtitle: 'Sin recurrentes (1 conteo por paciente)'
    },
    {
      title: 'Estado con Mayor Afluencia',
      value: topEstado ? `${topEstado.estado}` : 'N/A',
      bg: 'linear-gradient(135deg, #0f766e, #14b8a6)',
      color: '#ffffff',
      subtitle: topEstado ? `${formatNumber(topEstado.cantidad)} pacientes (${((topEstado.cantidad / (totalPacientesNum || 1)) * 100).toFixed(1)}%)` : ''
    },
    {
      title: 'Municipio / Alcaldía Principal',
      value: topCiudad ? `${topCiudad.ciudad}` : 'N/A',
      bg: 'linear-gradient(135deg, #d97706, #f59e0b)',
      color: '#ffffff',
      subtitle: topCiudad ? `${formatNumber(topCiudad.cantidad)} pacientes` : ''
    }
  ];

  // Identificar líderes demográficos
  const topGenero = (data.distribucionGenero || []).sort((a, b) => b["Total Atenciones"] - a["Total Atenciones"])[0] || null;
  const topEdad = (data.distribucionEdad || []).filter(e => e["Rango de Edad"] !== 'No especificado').sort((a, b) => b["Total Atenciones"] - a["Total Atenciones"])[0] || null;

  // Mapeos para matriz mensual ejecutiva
  const MONTH_SHORT_MAP = {
    'Enero': 'Ene', 'Febrero': 'Feb', 'Marzo': 'Mar', 'Abril': 'Abr',
    'Mayo': 'May', 'Junio': 'Jun', 'Julio': 'Jul', 'Agosto': 'Ago',
    'Septiembre': 'Sep', 'Octubre': 'Oct', 'Noviembre': 'Nov', 'Diciembre': 'Dic'
  };
  const MONTH_COLS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  // Generador de Matriz Ejecutiva Horizontal (Meses en Columnas)
  const buildPivotMatrix = (detailList, rowKey, rowHeaderName) => {
    if (!detailList || detailList.length === 0) return [];
    
    const groups = {};
    let totalGeneral = 0;
    const monthlyTotals = { 'Ene': 0, 'Feb': 0, 'Mar': 0, 'Abr': 0, 'May': 0, 'Jun': 0, 'Jul': 0, 'Ago': 0, 'Sep': 0, 'Oct': 0, 'Nov': 0, 'Dic': 0 };

    detailList.forEach(item => {
      const name = item[rowKey] || 'No especificado';
      const mesName = item["Mes"];
      const mesShort = MONTH_SHORT_MAP[mesName] || mesName;
      const count = parseInt(item["Pacientes"] || item["Total Atenciones"] || 0);

      if (!groups[name]) {
        groups[name] = { [rowHeaderName]: name };
        MONTH_COLS.forEach(m => groups[name][m] = 0);
        groups[name]["Total Anual"] = 0;
      }

      if (groups[name][mesShort] !== undefined) {
        groups[name][mesShort] += count;
      }
      groups[name]["Total Anual"] += count;
      totalGeneral += count;
      if (monthlyTotals[mesShort] !== undefined) {
        monthlyTotals[mesShort] += count;
      }
    });

    const rows = Object.values(groups).sort((a, b) => b["Total Anual"] - a["Total Anual"]);

    rows.forEach(r => {
      r["% Participación"] = totalGeneral > 0 ? `${((r["Total Anual"] / totalGeneral) * 100).toFixed(2)}%` : '0%';
    });

    const totalRow = { [rowHeaderName]: 'TOTAL GENERAL' };
    MONTH_COLS.forEach(m => totalRow[m] = monthlyTotals[m]);
    totalRow["Total Anual"] = totalGeneral;
    totalRow["% Participación"] = '100.0%';

    return [...rows, totalRow];
  };

  // Extraer las tablas oficiales calculadas dinámicamente por la API SITI
  const poblacionServiciosList = data.poblacionServiciosOficial || [];
  const estadisticasEdadesSexoList = data.estadisticasEdadesSexoOficial || [];

  // Construir reporte ejecutivo y visual estructurado para Excel
  const customExportData = {
    [`1. Población y Servicios (${year})`]: poblacionServiciosList,

    [`2. Est. Edades y Sexo (${year})`]: estadisticasEdadesSexoList,

    [`3. Matriz Alcaldías y Municipios`]: buildPivotMatrix(data.detalleMensualCiudades, 'Municipio', 'Alcaldía / Municipio'),

    [`4. Matriz Estados`]: buildPivotMatrix(data.detalleMensualEstados, 'Estado', 'Estado'),

    [`5. Resumen Ejecutivo (${year})`]: [
      {
        "Filtro Año": year,
        "Pacientes Únicos Atendidos": totalPacientesNum,
        "Estado Principal": topEstado ? topEstado.estado : 'N/A',
        "Pacientes Estado": topEstado ? topEstado.cantidad : 0,
        "% Estado": topEstado && totalPacientesNum > 0 ? `${((topEstado.cantidad / totalPacientesNum) * 100).toFixed(2)}%` : '0%',
        "Alcaldía / Municipio Principal": topCiudad ? topCiudad.ciudad : 'N/A',
        "Pacientes Municipio": topCiudad ? topCiudad.cantidad : 0,
        "% Municipio": topCiudad && totalPacientesNum > 0 ? `${((topCiudad.cantidad / totalPacientesNum) * 100).toFixed(2)}%` : '0%',
        "Grupo de Edad Mayoritario": topEdad ? topEdad["Rango de Edad"] : 'N/A',
        "Pacientes Grupo Edad": topEdad ? topEdad["Total Atenciones"] : 0,
        "% Grupo Edad": topEdad && totalPacientesNum > 0 ? topEdad["Participación %"] : '0%',
        "Género Mayoritario": topGenero ? topGenero["Género"] : 'N/A',
        "Pacientes Género": topGenero ? topGenero["Total Atenciones"] : 0,
        "% Género": topGenero && totalPacientesNum > 0 ? topGenero["Participación %"] : '0%'
      }
    ]
  };

  return (
    <div style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      <DashboardMapaGeografico 
        estados={data.estados || []} 
        ciudades={data.ciudades || []} 
        title={`Demografía Geográfica Histórica (SITI) - ${year}`}
        targetId="dashboard-siti-mapa"
        filterControls={filterControls}
        kpis={kpis}
        customExportData={customExportData}
        customFileNamePrefix={`Demografia_SITI_${year}`}
      />

      {/* Widgets Visuales de Género y Rangos de Edad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem', marginTop: '1.5rem', marginBottom: '2rem' }}>
        
        {/* Distribución por Género */}
        <div className="siti-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 1.25rem', color: '#1e293b', fontSize: '1.1rem', fontWeight: 'bold' }}>
            👥 Distribución por Género ({year})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {(data.distribucionGenero || []).map((g, idx) => {
              const pctNum = parseFloat(g["Participación %"]) || 0;
              const color = g["Género"] === 'Femenino' ? '#ec4899' : (g["Género"] === 'Masculino' ? '#2563eb' : '#94a3b8');
              return (
                <div key={idx}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: 600 }}>
                    <span style={{ color: '#334155' }}>{g["Género"]}</span>
                    <span style={{ color: '#0f172a' }}>{formatNumber(g["Total Atenciones"])} ({g["Participación %"]})</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${pctNum}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease-out' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Distribución por Rangos de Edad */}
        <div className="siti-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 1.25rem', color: '#1e293b', fontSize: '1.1rem', fontWeight: 'bold' }}>
            🎂 Distribución por Rangos de Edad ({year})
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {(data.distribucionEdad || []).map((e, idx) => {
              const pctNum = parseFloat(e["Participación %"]) || 0;
              const colors = ['#06b6d4', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'];
              const color = colors[idx % colors.length];
              return (
                <div key={idx}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '0.85rem', fontWeight: 600 }}>
                    <span style={{ color: '#334155' }}>{e["Rango de Edad"]}</span>
                    <span style={{ color: '#0f172a' }}>{formatNumber(e["Total Atenciones"])} ({e["Participación %"]})</span>
                  </div>
                  <div style={{ width: '100%', height: '7px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ width: `${pctNum}%`, height: '100%', background: color, borderRadius: '4px', transition: 'width 0.5s ease-out' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Tabla Oficial Dinámica de Población y Servicios Brindados */}
      <div className="siti-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.15rem', fontWeight: 'bold' }}>
              📋 Población y Servicios Brindados ({year})
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Clasificación institucional por Programas y Proyectos (Población Recurrente, Eventual y Total de Servicios) calculada en tiempo real desde SITI
            </p>
          </div>
          <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600 }}>
            Dinámico SITI {year}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold' }}>Programas y Proyectos</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>Población Recurrente</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>Población Eventual</th>
                <th style={{ padding: '10px 14px', color: '#1e40af', fontWeight: 'bold', textAlign: 'right', background: '#eff6ff' }}>Población Total</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold' }}>Servicios Otorgados</th>
                <th style={{ padding: '10px 14px', color: '#0f766e', fontWeight: 'bold', textAlign: 'right', background: '#f0fdf4' }}>Total Servicios</th>
              </tr>
            </thead>
            <tbody>
              {poblacionServiciosList.map((row, idx) => {
                const isHeader = !row["Población Recurrente"] && !row["Población Total"] && !row["Total Servicios"];
                const isGranTotal = row["Programa / Proyecto"]?.includes("GRAN TOTAL");

                if (isHeader) {
                  return (
                    <tr key={idx} style={{ background: '#f1f5f9', fontWeight: 'bold', color: '#0f172a' }}>
                      <td colSpan="6" style={{ padding: '8px 14px' }}>{row["Programa / Proyecto"]}</td>
                    </tr>
                  );
                }

                if (isGranTotal) {
                  return (
                    <tr key={idx} style={{ background: '#0f172a', color: '#ffffff', fontWeight: 'bold', borderTop: '2px solid #0f172a' }}>
                      <td style={{ padding: '12px 14px' }}>{row["Programa / Proyecto"]}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["Población Recurrente"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["Población Eventual"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#93c5fd', fontSize: '0.98rem' }}>{formatNumber(row["Población Total"])}</td>
                      <td style={{ padding: '12px 14px', color: '#cbd5e1' }}>{row["Servicios Otorgados"]}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#86efac', fontSize: '0.98rem' }}>{formatNumber(row["Total Servicios"])}</td>
                    </tr>
                  );
                }

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '9px 14px 9px 28px', color: '#334155' }}>{row["Programa / Proyecto"]}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["Población Recurrente"])}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["Población Eventual"])}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 'bold', background: '#f8fafc' }}>{formatNumber(row["Población Total"])}</td>
                    <td style={{ padding: '9px 14px', color: '#475569' }}>{row["Servicios Otorgados"]}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: 'bold', background: '#fcfdfa' }}>{formatNumber(row["Total Servicios"])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabla Oficial de Estadísticas de Edades y Sexo por Programa */}
      <div className="siti-card" style={{ background: '#ffffff', borderRadius: '12px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.15rem', fontWeight: 'bold' }}>
              📊 Estadísticas de Edades y Sexo por Programa ({year})
            </h3>
            <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Distribución cruzada calculada en tiempo real de grupos de edad y género entre los 5 programas y servicios del hospital
            </p>
          </div>
          <span style={{ background: '#f0fdf4', color: '#166534', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600 }}>
            Dinámico SITI {year}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold' }}>Grupo / Segmento</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>1.1 Procedimientos Qx</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>1.2 Hospitalización</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>1.3 Estudios Diagnóstico</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>2.1 Consulta Externa</th>
                <th style={{ padding: '10px 14px', color: '#334155', fontWeight: 'bold', textAlign: 'right' }}>2.2 Admisión Urgencias</th>
                <th style={{ padding: '10px 14px', color: '#1e40af', fontWeight: 'bold', textAlign: 'right', background: '#eff6ff' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {estadisticasEdadesSexoList.map((row, idx) => {
                const seg = row["Grupo / Segmento"] || '';
                const isSeparator = seg.includes("DISTRIBUCIÓN");
                const isTotalProg = seg.includes("TOTAL POR PROGRAMA") || seg.includes("TOTAL POR EDADES");
                const isTotalGen = seg.includes("TOTAL GÉNERO") || seg.includes("TOTAL GENERAL");
                const isFem = seg === "FEMENINO" || seg === "FEM";
                const isMas = seg === "MASCULINO" || seg === "MAS";

                if (isSeparator) {
                  return (
                    <tr key={idx} style={{ background: '#f8fafc', fontWeight: 'bold', color: '#475569' }}>
                      <td colSpan="7" style={{ padding: '8px 14px', borderTop: '2px solid #cbd5e1' }}>{seg}</td>
                    </tr>
                  );
                }

                if (isTotalProg) {
                  return (
                    <tr key={idx} style={{ background: '#f1f5f9', fontWeight: 'bold', borderTop: '2px solid #cbd5e1' }}>
                      <td style={{ padding: '10px 14px', color: '#0f172a' }}>{seg}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{formatNumber(row["1.1 Procedimientos quirúrgicos"])}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{formatNumber(row["1.2 Hospitalización"])}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{formatNumber(row["1.3 Estudios aux y de diagnóstico"])}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{formatNumber(row["2.1 Consulta externa"])}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>{formatNumber(row["2.2 Atención en Admisión Continua"])}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#1e40af', background: '#e0e7ff' }}>{formatNumber(row["TOTAL"])}</td>
                    </tr>
                  );
                }

                if (isTotalGen) {
                  return (
                    <tr key={idx} style={{ background: '#0f172a', color: '#ffffff', fontWeight: 'bold', borderTop: '2px solid #0f172a' }}>
                      <td style={{ padding: '12px 14px' }}>{seg}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["1.1 Procedimientos quirúrgicos"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["1.2 Hospitalización"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["1.3 Estudios aux y de diagnóstico"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["2.1 Consulta externa"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>{formatNumber(row["2.2 Atención en Admisión Continua"])}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#86efac', fontSize: '0.98rem' }}>{formatNumber(row["TOTAL"])}</td>
                    </tr>
                  );
                }

                return (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ 
                      padding: '9px 14px', 
                      fontWeight: isFem || isMas ? 600 : 'normal',
                      color: isFem ? '#ec4899' : (isMas ? '#2563eb' : '#334155')
                    }}>
                      {seg}
                    </td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["1.1 Procedimientos quirúrgicos"])}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["1.2 Hospitalización"])}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["1.3 Estudios aux y de diagnóstico"])}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["2.1 Consulta externa"])}</td>
                    <td style={{ padding: '9px 14px', textAlign: 'right' }}>{formatNumber(row["2.2 Atención en Admisión Continua"])}</td>
                    <td style={{ 
                      padding: '9px 14px', 
                      textAlign: 'right', 
                      fontWeight: 'bold', 
                      background: isFem ? '#fdf2f8' : (isMas ? '#eff6ff' : '#f8fafc'),
                      color: isFem ? '#be185d' : (isMas ? '#1d4ed8' : '#0f172a')
                    }}>
                      {formatNumber(row["TOTAL"])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
