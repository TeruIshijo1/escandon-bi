const fs = require('fs');
const code = fs.readFileSync('routes/export.routes.js', 'utf8');
const exec = "require('dotenv').config();\n" + code.replace(/module\.exports[\s\S]*/, '') + "\nresolveReportData('consulta-externa', {}).then(res => console.log('OK', res.titulo, res.columnas.length)).catch(console.error).finally(()=>process.exit(0));";
fs.writeFileSync('test_export2.js', exec);
