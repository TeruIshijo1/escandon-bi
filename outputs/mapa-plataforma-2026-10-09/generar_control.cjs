const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const walk = dir => fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const sourcePaths = ['frontend/src','backend/routes','backend/services','backend/config','backend/models','backend/middleware','database'].flatMap(dir => fs.existsSync(path.join(root,dir)) ? walk(dir) : []).filter(p => /\.(jsx?|json|sql)$/.test(p));
const hashes = sourcePaths.map(file => ({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const app = read('frontend/src/App.jsx');
const routes = [...app.matchAll(/\bpath\s*=\s*"([^"]+)"/g)].map(m=>({route:m[1]==='*'?'*':`/${m[1].replace(/^\//,'')}`,line:app.slice(0,m.index).split('\n').length}));
routes.unshift({route:'/',line:app.slice(0,app.indexOf('<Route index')).split('\n').length});
const backendPrefixes = {auth:'/api/auth',dashboard:'/api/dashboard',export:'/api/export',ai:'/api/ai',aria:'/api/aria',bi:'/api/bi',admin:'/api/admin',siti:'/api/siti',audit:'/api/audit',dataQuality:'/api/data-quality',pharmacy:'/api/pharmacy',almacen:'/api/almacen',honorarios:'/api/honorarios',sap:'/api/sap',sapQueryBuilder:'/api/sap-query',finanzas:'/api/finanzas',cex:'/api/cex',statistics:'/api/dashboard'};
const endpoints = [];
for(const file of walk('backend/routes').filter(p=>p.endsWith('.js'))){
  const src = read(file), family = path.basename(file,'.routes.js');
  for(const m of src.matchAll(/router\.(get|post|put|delete|patch|all)\s*\(\s*(['"`])([^'"`]+)\2/g)) endpoints.push({method:m[1].toUpperCase(),route:(backendPrefixes[family]||'[no montado]')+m[3],file,line:src.slice(0,m.index).split('\n').length,family});
}
const server = read('backend/server.js');
for(const m of server.matchAll(/app\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\2/g)) endpoints.push({method:m[1].toUpperCase(),route:m[3],file:'backend/server.js',line:server.slice(0,m.index).split('\n').length,family:'server'});
const jsx = walk('frontend/src').filter(p=>p.endsWith('.jsx'));
const kpiSources = ['database/04_kpi_config.sql','backend/config/pg-db.js','backend/config/init-db.js'];
const kpis=[];
for(const file of kpiSources){
  const src=read(file);
  for(const m of src.matchAll(/\(\s*['"]((?:directivo|mando|area|stats|audit|home)\.[a-zA-Z0-9_.-]+)['"]/g)) {
    if(!kpis.some(k=>k.id===m[1])) kpis.push({id:m[1],file,line:src.slice(0,m.index).split('\n').length});
  }
}
const payload={date:'2026-10-09',routes,endpoints,jsx,kpis,hashes};
fs.writeFileSync(path.join(__dirname,'control-cobertura.json'),JSON.stringify(payload,null,2),'utf8');
const md=['## Anexo de control: rutas, archivos de pantalla y servicios registrados','',
'Este control se extrajo del código para contrastar la cobertura del instructivo. Una ruta o capacidad declarada no demuestra que tenga registros, permisos o conexión disponibles. Las filas son un índice técnico; las explicaciones funcionales están en los capítulos anteriores.','',
`### Rutas de pantalla (${routes.filter(r=>r.route!=='*').length} rutas explícitas y reglas de redirección)`, '', '| Ruta | Evidencia |','|---|---|',...routes.map(r=>`| \`${r.route}\` | \`frontend/src/App.jsx:${r.line}\` |`),'',
`### Pantallas y componentes React (${jsx.length} archivos)`, '', '| Archivo | Familia funcional |','|---|---|',...jsx.map(file=>`| \`${file}\` | ${file.includes('/pages/')?'Pantalla; revisar su ruta en el índice':file.includes('/components/')?file.split('/components/')[1].split('/')[0]:'Acceso, montaje o contexto'} |`),'',
`### Operaciones HTTP declaradas (${endpoints.length})`, '',
'Incluye los 18 archivos de rutas y las operaciones directas del servidor. `statistics.routes.js` se monta dentro de `/api/dashboard`. `/api/files` sirve adjuntos autenticados; no es una pantalla adicional. Las dos rutas comodín son reglas de entrega del frontend.','',
'| Método | Operación | Evidencia |','|---|---|---|',...endpoints.map(e=>`| ${e.method} | \`${e.route.replace(/\|/g,'\\|')}\` | \`${e.file}:${e.line}\` |`),'',
`### Identificadores iniciales de KPI configurables (${kpis.length})`, '',
'Son identificadores de configuración de nombre, icono y enlace; su presencia no prueba que el indicador se renderice en la pantalla actual ni que el reporte externo esté configurado. El usuario puede consultar los elementos registrados en Administración → Configuración. Cada KPI nativo y su cálculo se explican en el capítulo de tableros.','',
'| Identificador | Declaración inicial |','|---|---|',...kpis.map(k=>`| \`${k.id}\` | \`${k.file}:${k.line}\` |`),''];
fs.writeFileSync(path.join(__dirname,'control-cobertura.md'),md.join('\n'),'utf8');
console.log(JSON.stringify({routes:routes.filter(r=>r.route!=='*').length,jsx:jsx.length,endpoints:endpoints.length,kpis:kpis.length,sourceFiles:hashes.length}));
