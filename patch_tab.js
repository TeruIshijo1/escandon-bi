const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx', 'utf8');

// Add the 4th tab button
code = code.replace(
  "🔮 Pronóstico de Desabasto e Inventario (IA)\n          </button>\n        </div>",
  "🔮 Pronóstico de Desabasto e Inventario (IA)\n          </button>\n          <button \n            onClick={() => setActiveTab('dynamic_config')}\n            className={activeTab === 'dynamic_config' ? 'active' : ''}\n            style={{ padding: '0.75rem 1.25rem', border: 'none', background: activeTab === 'dynamic_config' ? '#1e293b' : 'transparent', color: activeTab === 'dynamic_config' ? 'white' : '#64748b', fontWeight: 'bold', cursor: 'pointer', borderRadius: '8px' }}\n          >\n            ⚙️ Configuración Dinámica (Farmacia)\n          </button>\n        </div>"
);

// Add the Dynamic Config View
const dynamicConfigView = `
          {/* TAB 4: Configuración Dinámica de Reorden */}
          {activeTab === 'dynamic_config' && (
            <div style={{ animation: 'fadeIn 0.3s ease-in-out' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.15rem' }}>
                  ⚙️ Cálculos Dinámicos de Puntos de Reorden (Basado en Consumo Real SAP)
                </h3>
                <button
                  onClick={() => {
                    // Export to CSV
                    const headers = ['CÓDIGO SAP', 'DESCRIPCIÓN', 'CONSUMO MENSUAL', 'CONSUMO DIARIO', 'PUNTO MIN (7 DÍAS)', 'PUNTO REORDEN (10.5 DÍAS)', 'PUNTO MAX (14 DÍAS)'];
                    const rows = [headers.join(',')];
                    mlDataset.forEach(row => {
                      const consDiario = row.consumo_promedio_diario || 0;
                      rows.push(\`"\${row.itemcode}","\${row.itemdescription}",\${row.consumo_30d},\${consDiario.toFixed(2)},\${Math.ceil(consDiario * 7)},\${Math.ceil(consDiario * 10.5)},\${Math.ceil(consDiario * 14)}\`);
                    });
                    const blob = new Blob([rows.join('\\n')], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'configuracion_dinamica_farmacia.csv';
                    link.click();
                  }}
                  style={{ padding: '0.65rem 1.25rem', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  📊 Exportar a Excel
                </button>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: '650px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                  <thead style={{ background: '#f1f5f9', position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr>
                      <th style={{ padding: '0.85rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1' }}>CÓDIGO SAP</th>
                      <th style={{ padding: '0.85rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1' }}>DESCRIPCIÓN</th>
                      <th style={{ padding: '0.85rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>CONSUMO MENSUAL</th>
                      <th style={{ padding: '0.85rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>CONSUMO DIARIO</th>
                      <th style={{ padding: '0.85rem', color: '#0369a1', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>PUNTO MÍN (7 DÍAS)</th>
                      <th style={{ padding: '0.85rem', color: '#059669', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>PUNTO REORDEN (10.5 DÍAS)</th>
                      <th style={{ padding: '0.85rem', color: '#ca8a04', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>PUNTO MÁX (14 DÍAS)</th>
                      <th style={{ padding: '0.85rem', color: '#475569', fontWeight: 'bold', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>ACCIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mlDataset.map((row, i) => {
                      const consDiario = row.consumo_promedio_diario || 0;
                      const min7 = Math.ceil(consDiario * 7);
                      const reo10 = Math.ceil(consDiario * 10.5);
                      const max14 = Math.ceil(consDiario * 14);
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                          <td style={{ padding: '0.75rem', fontWeight: 'bold', color: '#334155' }}>{row.itemcode}</td>
                          <td style={{ padding: '0.75rem', color: '#475569', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.itemdescription}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold', color: '#1e293b' }}>{row.consumo_30d || 0}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'center', color: '#64748b' }}>{consDiario.toFixed(2)}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold', color: '#0369a1' }}>{min7}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold', color: '#059669', background: '#ecfdf5' }}>{reo10}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'center', fontWeight: 'bold', color: '#ca8a04' }}>{max14}</td>
                          <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                            <button 
                              onClick={async () => {
                                try {
                                  const res = await fetch(\`\${API_BASE}/pharmacy/punto-reorden/\${encodeURIComponent(row.itemcode)}\`, {
                                    method: 'PUT',
                                    headers: {
                                      'Content-Type': 'application/json',
                                      ...authHeaders()
                                    },
                                    body: JSON.stringify({ minStock: min7, maxStock: max14 })
                                  });
                                  if(res.ok) {
                                    alert('Valores dinámicos aplicados a SAP correctamente.');
                                    fetchReorderData(); // refresh
                                  } else {
                                    alert('Error al aplicar valores.');
                                  }
                                } catch (err) {
                                  console.error(err);
                                }
                              }}
                              style={{ padding: '0.4rem 0.8rem', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                              Aplicar a SAP
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
`;

code = code.replace(/\{\/\* Modal Editar Min\/Max \*\/\}/, dynamicConfigView + '\n\n        {/* Modal Editar Min/Max */}');

fs.writeFileSync('frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx', code);
console.log('Tab 4 added successfully');
