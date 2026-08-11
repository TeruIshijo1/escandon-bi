const fs = require('fs');
const path = 'd:/Escritorio/escandon-bi/frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx';
let code = fs.readFileSync(path, 'utf8');

const targetStr = `{/* Médicos Activos */}`;

const replacementStr = `{/* Duración Promedio */}
        <div style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', position: 'relative' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748B', fontWeight: 600, marginBottom: '0.25rem' }}>Duración Promedio (min)</div>
          <div style={{ fontSize: '2.2rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#0D1B2A', lineHeight: 1 }}>
            {kpis.avgDuration}
          </div>
          <div style={{ height: 60, marginTop: '1rem', marginLeft: '-1.25rem', marginRight: '-1.25rem', marginBottom: '-1.25rem' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <Line type="monotone" dataKey="Promedio_Duracion_Cirugia" stroke="#E8853D" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Médicos Activos */}`;

if (code.includes(targetStr) && !code.includes('Duración Promedio (min)')) {
  code = code.replace(targetStr, replacementStr);
  fs.writeFileSync(path, code);
  console.log('Frontend Duracion KPI restored successfully');
} else {
  console.log('Frontend target not found or already restored');
}

// Also put back Duración column in table
const thTarget = `<th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Estado (SAP)</th>`;
const thReplacement = `<th style={{ padding: '0.75rem 1rem', fontWeight: 600, textAlign: 'right' }}>Duración</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Estado (SAP)</th>`;
if (code.includes(thTarget) && !code.includes('textAlign: \'right\' }}>Duración</th>')) {
  code = code.replace(thTarget, thReplacement);
  fs.writeFileSync(path, code);
}

const tdTarget = `<td style={{ padding: '0.75rem 1rem', color: row.Notas === 'Cirugía Registrada' ? '#10B981' : '#EF4444', fontWeight: 600, fontSize: '0.75rem' }}>{row.Notas}</td>`;
const tdReplacement = `<td style={{ padding: '0.75rem 1rem', color: '#004687', fontWeight: 600, textAlign: 'right' }}>{durText}</td>
                    <td style={{ padding: '0.75rem 1rem', color: row.Notas === 'Cirugía Registrada' ? '#10B981' : '#EF4444', fontWeight: 600, fontSize: '0.75rem' }}>{row.Notas}</td>`;
if (code.includes(tdTarget) && !code.includes('>{durText}</td>')) {
  code = code.replace(tdTarget, tdReplacement);
  fs.writeFileSync(path, code);
  console.log('Frontend columns restored');
}
