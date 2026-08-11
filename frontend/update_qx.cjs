const fs = require('fs');
let code = fs.readFileSync('d:/Escritorio/escandon-bi/frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx', 'utf8');

// 1. Add selectedStatus state
code = code.replace(
  "const [selectedRoom, setSelectedRoom] = useState('Todos');",
  "const [selectedRoom, setSelectedRoom] = useState('Todos');\n  const [selectedStatus, setSelectedStatus] = useState('Todos');"
);

// 2. Destructure statusUsage
code = code.replace(
  "    roomUsage,",
  "    roomUsage,\n    statusUsage,"
);

code = code.replace(
  "  }, [data, selectedRoom, selectedProcedure, selectedYear, selectedMonth, selectedMedico]);",
  "  }, [data, selectedRoom, selectedProcedure, selectedYear, selectedMonth, selectedMedico, selectedStatus]);"
);

// 3. Add to dependencies and returned object
code = code.replace(
  "      roomUsage, ",
  "      roomUsage, \n      statusUsage,"
);

// 4. Update the filtering logic for selectedStatus
code = code.replace(
  "      if (selectedRoom !== 'Todos' && d.Quirofano !== selectedRoom) return false;",
  "      if (selectedRoom !== 'Todos' && d.Quirofano !== selectedRoom) return false;\n      if (selectedStatus !== 'Todos' && d.Notas !== selectedStatus) return false;"
);

// 5. Generate statusUsage
code = code.replace(
  "    const roomsCount = {};",
  "    const roomsCount = {};\n    const statusCount = {};"
);
code = code.replace(
  "    dataForRooms.forEach(d => {",
  "    dataForRooms.forEach(d => {\n      if (d.Notas) statusCount[d.Notas] = (statusCount[d.Notas] || 0) + 1;"
);
code = code.replace(
  "    const roomUsage = Object.entries(roomsCount).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);",
  "    const roomUsage = Object.entries(roomsCount).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);\n    const statusUsage = Object.entries(statusCount).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);"
);

// 6. Remove 'Duración Promedio' block (lines 226-239 roughly)
code = code.replace(
  /\{\/\* Duración Promedio \*\/\}[\s\S]*?\{\/\* Médicos Activos \*\/\}/,
  '{/* Médicos Activos */}'
);

// 7. Replace 'Uso de Salas' with 'Estado de Registro'
code = code.replace(
  /\{\/\* Uso de Salas \(Dona\) \*\/\}[\s\S]*?\{\/\* Top Procedimientos \*\/\}/,
  `{/* Estado de Registro (Dona) */}
        <div data-html2canvas-ignore="false" style={{ background: 'white', padding: '1.25rem', borderRadius: 12, boxShadow: 'var(--shadow-xs)', border: '1px solid rgba(0,0,0,0.04)', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem', color: '#475569', fontWeight: 600, textAlign: 'center' }}>Estado de Registro (SAP vs Bitácora)</h3>
          <div style={{ width: '100%', flex: 1, minHeight: 250 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={statusUsage}
                  cx="50%"
                  cy="50%"
                  innerRadius="50%"
                  outerRadius="70%"
                  dataKey="value"
                  isAnimationActive={false}
                  onClick={(entry) => setSelectedStatus(selectedStatus === entry.name ? 'Todos' : entry.name)}
                  style={{ cursor: 'pointer' }}
                  label={({ name, percent, value }) => {
                    if (percent < 0.05) return null;
                    return \`\${value} (\${(percent * 100).toFixed(1)}%)\`;
                  }}
                  labelLine={true}
                >
                  {statusUsage.map((entry, index) => (
                    <Cell 
                      key={\`cell-\${index}\`} 
                      fill={entry.name === 'Cirugía Registrada' ? '#10B981' : '#EF4444'} 
                      opacity={selectedStatus !== 'Todos' ? (selectedStatus === entry.name ? 1 : 0.3) : 1}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [value, 'Cirugías']} />
                <Legend 
                  iconType="circle" 
                  wrapperStyle={{ fontSize: '10px' }} 
                  onClick={(e) => setSelectedStatus(selectedStatus === e.value ? 'Todos' : e.value)}
                  style={{ cursor: 'pointer' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Procedimientos */}`
);

// 8. Update table columns (remove Duracion, replace with Notas)
code = code.replace(
  '<th style={{ padding: \'0.75rem 1rem\', fontWeight: 600, textAlign: \'right\' }}>Duración</th>',
  '<th style={{ padding: \'0.75rem 1rem\', fontWeight: 600 }}>Estado (SAP)</th>'
);

code = code.replace(
  /<td style=\{\{ padding: '0\.75rem 1rem', color: '#004687', fontWeight: 600, textAlign: 'right' \}\}>\{durText\}<\/td>/,
  "<td style={{ padding: '0.75rem 1rem', color: row.Notas === 'Cirugía Registrada' ? '#10B981' : '#EF4444', fontWeight: 600, fontSize: '0.75rem' }}>{row.Notas}</td>"
);

// 9. Add clear filter
code = code.replace(
  "setSelectedMedico('Todos');",
  "setSelectedMedico('Todos');\n    setSelectedStatus('Todos');"
);

fs.writeFileSync('d:/Escritorio/escandon-bi/frontend/src/components/dashboard/DashboardQuirofanoNativo.jsx', code);
