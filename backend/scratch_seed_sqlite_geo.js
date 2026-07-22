const { connectDB, getDb } = require('./config/db');

const states = [
  { Estado: 'CDMX', Municipios: ['Miguel Hidalgo', 'Cuauhtémoc', 'Benito Juárez', 'Álvaro Obregón', 'Coyoacán'] },
  { Estado: 'Estado de México', Municipios: ['Naucalpan', 'Huixquilucan', 'Tlalnepantla', 'Ecatepec', 'Atizapán'] },
  { Estado: 'Jalisco', Municipios: ['Guadalajara', 'Zapopan'] },
  { Estado: 'Nuevo León', Municipios: ['Monterrey', 'San Pedro Garza García'] }
];

async function seedPacientes() {
  await connectDB();
  const db = getDb();

  const insertStmt = db.prepare(`
    INSERT INTO Pacientes (NumeroExpediente, NombreCompleto, FechaNacimiento, Sexo, CodigoPostal, Estado, Municipio) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  db.transaction(() => {
    for (let i = 1; i <= 200; i++) {
      const r = Math.random();
      let stateObj;
      if (r < 0.7) stateObj = states[0];
      else if (r < 0.9) stateObj = states[1];
      else stateObj = states[Math.floor(Math.random() * 2) + 2];

      const municipio = stateObj.Municipios[Math.floor(Math.random() * stateObj.Municipios.length)];
      const cp = Math.floor(Math.random() * (50000 - 10000 + 1) + 10000).toString();
      const numExp = 'EXP-' + (10000 + i);
      const name = 'Paciente Muestra ' + i;
      const sexo = Math.random() > 0.5 ? 'M' : 'F';

      insertStmt.run(numExp, name, '1980-01-01', sexo, cp, stateObj.Estado, municipio);
    }
  })();
  console.log("Seeded 200 dummy patients with geographic data.");
}

seedPacientes().catch(console.error);
