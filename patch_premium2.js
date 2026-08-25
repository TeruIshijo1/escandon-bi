const fs = require('fs');
let code = fs.readFileSync('frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx', 'utf8');

const replacement = `{/* TAB 4: Configuración Dinámica de Reorden (UI Premium) */}
      {activeTab === 'dynamic_config' && (
        <div style={{ animation: 'fadeIn 0.4s ease-out' }}>
          {/* Header de la Pestaña */}
          <div style={{ background: 'linear-gradient(to right, #0f172a, #1e293b)', padding: '2rem', borderRadius: '16px', color: 'white', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
            <div>
              <h2 style={{ margin: '0 0 0.5rem 0', fontSize: '1.8rem', fontWeight: '800', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '2.2rem' }}>⚙️</span> 
                Configuración Dinámica
              </h2>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '1rem', maxWidth: '600px', lineHeight: '1.5' }}>
                Calculadora inteligente basada en el Consumo Real de SAP (Farmacia). 
                Calcula automáticamente los días mínimos (7), reorden (10.5) y máximos (14).
              </p>
            </div>
            <div>
              <button
                onClick={() => {
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
                style={{ padding: '0.8rem 1.5rem', background: '#10b981', color: 'white', border: '1px solid #059669', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.2s', boxShadow: '0 4px 6px -1px rgba(16,185,129,0.3)' }}
                onMouseEnter={(e) => e.target.style.transform = 'translateY(-2px)'}
                onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
              >
                📊 Descargar Excel (.csv)
              </button>
            </div>
          </div>

          {/* Búsqueda y Tabla */}
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="🔍 Buscar por código SAP o descripción..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid #cbd5e1', width: '100%', maxWidth: '400px', fontSize: '0.95rem', outline: 'none', transition: 'border-color 0.2s' }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#cbd5e1'}
              />
              <span style={{ marginLeft: '1rem', color: '#64748b', fontSize: '0.9rem', fontWeight: '500' }}>
                Mostrando cálculos para {mlDataset.filter(item => item.itemcode.toLowerCase().includes(searchTerm.toLowerCase()) || item.itemdescription.toLowerCase().includes(searchTerm.toLowerCase())).length} insumos de Farmacia.
              </span>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '600px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead style={{ background: '#f1f5f9', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '1rem', color: '#475569', fontWeight: '700', borderBottom: '2px solid #cbd5e1', whiteSpace: 'nowrap' }}>CÓDIGO SAP</th>
                    <th style={{ padding: '1rem', color: '#475569', fontWeight: '700', borderBottom: '2px solid #cbd5e1' }}>DESCRIPCIÓN</th>
                    <th style={{ padding: '1rem', color: '#475569', fontWeight: '700', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>CONSUMO MENS.</th>
                    <th style={{ padding: '1rem', color: '#475569', fontWeight: '700', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>DIARIO</th>
                    <th style={{ padding: '1rem', color: '#b91c1c', fontWeight: '800', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>MÍN (7 Días)</th>
                    <th style={{ padding: '1rem', color: '#047857', fontWeight: '800', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>REORDEN (10.5)</th>
                    <th style={{ padding: '1rem', color: '#0369a1', fontWeight: '800', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>MÁX (14 Días)</th>
                    <th style={{ padding: '1rem', color: '#475569', fontWeight: '700', borderBottom: '2px solid #cbd5e1', textAlign: 'center' }}>SINC. SAP</th>
                  </tr>
                </thead>
                <tbody>
                  {mlDataset
                    .filter(item => item.itemcode.toLowerCase().includes(searchTerm.toLowerCase()) || item.itemdescription.toLowerCase().includes(searchTerm.toLowerCase()))
                    .map((row, i) => {
                    const consDiario = row.consumo_promedio_diario || 0;
                    const min7 = Math.ceil(consDiario * 7);
                    const reo10 = Math.ceil(consDiario * 10.5);
                    const max14 = Math.ceil(consDiario * 14);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? 'white' : '#f8fafc', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f0f9ff'} onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#f8fafc'}>
                        <td style={{ padding: '1rem', fontWeight: '700', color: '#334155' }}>{row.itemcode}</td>
                        <td style={{ padding: '1rem', color: '#475569', maxWidth: '280px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.itemdescription}</td>
                        <td style={{ padding: '1rem', textAlign: 'center', fontWeight: '700', color: '#1e293b' }}>
                          <span style={{ background: '#e2e8f0', padding: '4px 10px', borderRadius: '6px' }}>{row.consumo_30d || 0}</span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center', color: '#64748b', fontWeight: '600' }}>{consDiario.toFixed(1)}</td>
                        
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{ background: '#fef2f2', color: '#b91c1c', padding: '6px 12px', borderRadius: '8px', fontWeight: '800', display: 'inline-block', minWidth: '40px', border: '1px solid #fecaca' }}>{min7}</span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{ background: '#ecfdf5', color: '#047857', padding: '6px 12px', borderRadius: '8px', fontWeight: '800', display: 'inline-block', minWidth: '40px', border: '1px solid #a7f3d0' }}>{reo10}</span>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{ background: '#f0f9ff', color: '#0369a1', padding: '6px 12px', borderRadius: '8px', fontWeight: '800', display: 'inline-block', minWidth: '40px', border: '1px solid #bae6fd' }}>{max14}</span>
                        </td>

                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <button 
                            onClick={async (e) => {
                              const btn = e.currentTarget;
                              btn.innerHTML = '⏳ Guardando...';
                              btn.style.opacity = '0.7';
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
                                  btn.innerHTML = '✅ Actualizado';
                                  btn.style.background = '#10b981';
                                  btn.style.color = 'white';
                                  btn.style.opacity = '1';
                                  btn.style.border = 'none';
                                  setTimeout(() => {
                                    btn.innerHTML = '🚀 Aplicar';
                                    btn.style.background = 'white';
                                    btn.style.color = '#3b82f6';
                                    btn.style.border = '1px solid #3b82f6';
                                  }, 3000);
                                  fetchReorderData(); // refresh background stats
                                } else {
                                  btn.innerHTML = '❌ Error';
                                  btn.style.background = '#ef4444';
                                  btn.style.color = 'white';
                                }
                              } catch (err) {
                                console.error(err);
                                btn.innerHTML = '❌ Error';
                              }
                            }}
                            style={{ padding: '0.4rem 0.8rem', background: 'white', color: '#3b82f6', border: '1px solid #3b82f6', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '700', transition: 'all 0.2s', width: '100px' }}
                            onMouseEnter={(e) => { if(e.target.innerHTML.includes('Aplicar')) { e.target.style.background = '#3b82f6'; e.target.style.color = 'white'; } }}
                            onMouseLeave={(e) => { if(e.target.innerHTML.includes('Aplicar')) { e.target.style.background = 'white'; e.target.style.color = '#3b82f6'; } }}
                          >
                            🚀 Aplicar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar Notita / Min / Max */}`;

const replaced = code.replace(/\{\/\* Modal Editar Notita \/ Min \/ Max \*\/\}/, replacement);

if (code !== replaced) {
  fs.writeFileSync('frontend/src/components/pharmacy/PuntoReordenFarmacia.jsx', replaced);
  console.log('UI Premium applied correctly');
} else {
  console.log('Regex failed to match Modal Editar');
}
