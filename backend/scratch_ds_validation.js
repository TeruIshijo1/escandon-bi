const { querySiti } = require('./config/siti-api');

async function explore() {
  console.log("=== Exploring SITI Database for Data Science Validation ===");
  try {
    const tableRes = await querySiti(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    const tables = tableRes.data ? tableRes.data.map(t => t.table_name) : [];
    
    // Look for financial tables
    const potential = tables.filter(t => 
      t.toLowerCase().includes('factura') || 
      t.toLowerCase().includes('recibo') || 
      t.toLowerCase().includes('caja') || 
      t.toLowerCase().includes('pago') ||
      t.toLowerCase().includes('ingreso') ||
      t.toLowerCase().includes('paciente') ||
      t.toLowerCase().includes('admision') ||
      t.toLowerCase().includes('honmed')
    );
    console.log("Potential financial validation tables:", potential);

    const getCols = async (tableName) => {
        const res = await querySiti(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = '${tableName}'
        `);
        if (res.data) {
            console.log(`\nColumns for ${tableName}:`, res.data.map(c => c.column_name).join(', '));
        }
    };

    await getCols('Paciente');
    await getCols('HonMed');
    await getCols('ClasifPaciente');

  } catch (error) {
    console.error("Error exploring:", error);
  }
}

explore();
