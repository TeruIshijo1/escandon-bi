const { connectDB, getDb } = require('./config/db');

const states = [
  { Estado: 'CDMX', Municipios: ['Miguel Hidalgo', 'Cuauhtémoc', 'Benito Juárez', 'Álvaro Obregón', 'Coyoacán'] },
  { Estado: 'Estado de México', Municipios: ['Naucalpan', 'Huixquilucan', 'Tlalnepantla', 'Ecatepec', 'Atizapán'] },
  { Estado: 'Jalisco', Municipios: ['Guadalajara', 'Zapopan'] },
  { Estado: 'Nuevo León', Municipios: ['Monterrey', 'San Pedro Garza García'] }
];

async function updateSQLiteDemographics() {
  await connectDB();
  const db = getDb();
  
  console.log("Adding demographic columns to Pacientes table...");
  try {
    db.prepare(`ALTER TABLE Pacientes ADD COLUMN CodigoPostal TEXT`).run();
    db.prepare(`ALTER TABLE Pacientes ADD COLUMN Estado TEXT`).run();
    db.prepare(`ALTER TABLE Pacientes ADD COLUMN Municipio TEXT`).run();
    console.log("Columns added successfully.");
  } catch(e) {
    console.log("Columns might already exist: " + e.message);
  }

  const pacientes = db.prepare(`SELECT PacienteId FROM Pacientes`).all();
  console.log(`Found ${pacientes.length} patients. Assigning random geographic data...`);

  const updateStmt = db.prepare(`UPDATE Pacientes SET CodigoPostal = ?, Estado = ?, Municipio = ? WHERE PacienteId = ?`);
  
  db.transaction(() => {
    for (const p of pacientes) {
      // 70% CDMX, 20% Edomex, 10% Otros
      const r = Math.random();
      let stateObj;
      if (r < 0.7) {
        stateObj = states[0];
      } else if (r < 0.9) {
        stateObj = states[1];
      } else {
        stateObj = states[Math.floor(Math.random() * 2) + 2];
      }

      const municipio = stateObj.Municipios[Math.floor(Math.random() * stateObj.Municipios.length)];
      // Fake zip code between 10000 and 50000
      const cp = Math.floor(Math.random() * (50000 - 10000 + 1) + 10000).toString();

      updateStmt.run(cp, stateObj.Estado, municipio, p.PacienteId);
    }
  })();

  console.log("Geographic data populated successfully.");
}

updateSQLiteDemographics().catch(console.error);
