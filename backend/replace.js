const fs = require('fs');

let c = fs.readFileSync('services/dashboardSync.service.js', 'utf8');

c = c.replace(
  /SELECT No_Cita, No_Medico, Medico, Especialidad, NoPaciente, Paciente, DesdeFecha, HastaFecha, PCAP_ST_Descripcion[\s]+FROM UDR_CONSULTAS_PROG[\s]+WHERE DesdeFecha >= @startDate/,
  `SELECT c.No_Cita, c.No_Medico, c.Medico, c.Especialidad, c.NoPaciente, c.Paciente, c.DesdeFecha, c.HastaFecha, c.PCAP_ST_Descripcion, cd.PS
      FROM UDR_CONSULTAS_PROG c
      LEFT JOIN UDR_CD cd ON c.No_Cita = cd.Numero_Cita
      WHERE c.DesdeFecha >= @startDate`
);

c = c.replace(
  /\(no_cita, no_medico, medico, especialidad, nopaciente, paciente, desdefecha, hastafecha, pcap_st_descripcion, sync_date\)/,
  `(no_cita, no_medico, medico, especialidad, nopaciente, paciente, desdefecha, hastafecha, pcap_st_descripcion, ps, sync_date)`
);

c = c.replace(
  /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, CURRENT_TIMESTAMP\)/,
  `VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)`
);

c = c.replace(
  /pcap_st_descripcion = EXCLUDED.pcap_st_descripcion,[\s]+sync_date = CURRENT_TIMESTAMP;/,
  `pcap_st_descripcion = EXCLUDED.pcap_st_descripcion,\n        ps = EXCLUDED.ps,\n        sync_date = CURRENT_TIMESTAMP;`
);

c = c.replace(
  /r\.No_Cita, r\.No_Medico, r\.Medico, r\.Especialidad, r\.NoPaciente, r\.Paciente, r\.DesdeFecha, r\.HastaFecha, r\.PCAP_ST_Descripcion\s*\]\);/,
  `r.No_Cita, r.No_Medico, r.Medico, r.Especialidad, r.NoPaciente, r.Paciente, r.DesdeFecha, r.HastaFecha, r.PCAP_ST_Descripcion, r.PS\n    ]);`
);

fs.writeFileSync('services/dashboardSync.service.js', c);
console.log('done');
