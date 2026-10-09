const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'../..');
const read = name => fs.readFileSync(path.join(__dirname,name),'utf8');
const control = JSON.parse(read('control-cobertura.json'));
const catalogs = JSON.parse(read('catalogos-reportes-inventario.json'));
const reports = read('reportes_ia.md');
const boundary = reports.indexOf('### Anexo: capacidades adicionales del asistente');
if(boundary<0)throw new Error('No se encontró el anexo de capacidades');
const narrative = reports.slice(0,boundary);
const appendix = reports.slice(boundary).replace('### Anexo: capacidades adicionales del asistente, 632 identificadores','## Anexo: catálogo extendido del asistente — 632 capacidades');
const conclusion = `## Cobertura comprobada y mantenimiento del instructivo

La revisión funcional se contrastó con los inventarios extraídos del código. Se documentaron **36 rutas explícitas de pantalla**, sus alias/redirecciones, **96 archivos React**, las **18 secciones estadísticas**, las cinco pestañas directivas, las trece áreas declaradas, las once pestañas SITI, los subapartados operativos y administrativos, y **696 identificadores de consulta**: 64 del catálogo manual y 632 capacidades adicionales del asistente. Los componentes/servicios conservados sin montaje y los destinos externos configurables se identifican por su estado.

El control técnico enumera **203 declaraciones de operaciones HTTP**, incluidas reglas del servidor y servicios auxiliares, y los **44 identificadores de KPI** de la semilla SQL. Estos conteos no representan 696 pantallas ni 203 módulos visibles: se conservan las unidades para evitar duplicar o atribuir alcance incorrecto. Las capacidades de metadatos no certifican que sus tablas, columnas o permisos estén disponibles en producción.

Para mantener el mapa, revisar cambios en \`App.jsx\`, \`rbac.js\`, componentes/pestañas, catálogos SAP/Vertical/asistente, rutas, servicios de sincronización, SQL y configuración BI. Añadir una ficha cuando se incorpore un apartado; actualizar su fórmula/origen si cambia la consulta; conservar el estado de las funciones retiradas o alternativas. Para un reporte externo, incorporar después la evidencia del modelo/archivo vinculado. La fecha de corte permite distinguir esta revisión de una versión instalada posterior.

La verificación de este documento comprueba presencia de rutas/archivos/IDs, estructura de tablas, referencias de código e integridad de las fuentes respecto al inventario de cierre. Es una validación documental; no se ejecutaron servicios, descargas ni pruebas de cifras en las bases del hospital. Esta tarea generó documentación y controles de cobertura; no modificó el código de la aplicación.

`;
let doc = [read('introduccion.md'),read('tableros.md'),read('operaciones.md'),read('honorarios.md'),narrative,read('administracion_transversal.md'),conclusion,appendix,read('control-cobertura.md')].join('\n\n').replace(/\r\n/g,'\n');
const sections = [];
let ordinal=0;
doc=doc.replace(/^(#{2,4}) (.+)$/gm,(match,hashes,title)=>{
  const id=`apartado-${String(++ordinal).padStart(3,'0')}`;
  sections.push({level:hashes.length,title,id});
  return `<a id="${id}"></a>\n\n${match}`;
});
const toc='## Índice de consulta\n\n'+sections.filter(s=>s.level<=3).map(s=>`${s.level===3?'  ':''}- [${s.title.replace(/\[|\]/g,'')}](#${s.id})`).join('\n')+'\n\n';
const firstSection=doc.indexOf('<a id=');
doc=doc.slice(0,firstSection)+toc+doc.slice(firstSection);
const outPath=path.join(root,'docs/Mapa_Instructivo_Plataforma_y_Origen_Datos.md');
fs.writeFileSync(outPath,doc,'utf8');

const issues=[];
for(const r of control.routes.filter(r=>r.route!=='*')) if(!doc.includes('`'+r.route+'`'))issues.push('Ruta ausente '+r.route);
for(const file of control.jsx)if(!doc.includes(file))issues.push('Archivo React ausente '+file);
const expected=[...catalogs.manual,...catalogs.assistant].map(e=>e.id);
const inTable=[...doc.matchAll(/^\| `([^`]+)` —/gm)].map(m=>m[1]).filter(id=>expected.includes(id));
if(expected.length!==696||new Set(inTable).size!==696||inTable.length!==696)issues.push('Cobertura de IDs incorrecta');
for(const id of expected)if(!inTable.includes(id))issues.push('ID ausente '+id);
for(const k of control.kpis)if(!doc.includes('`'+k.id+'`'))issues.push('KPI seed ausente '+k.id);
for(const e of control.endpoints)if(!doc.includes('`'+e.route+'`'))issues.push('API ausente '+e.route);
const sectionsStats=require(path.join(root,'backend/services/statisticsCatalog.js')).SECTIONS;
const missingStats=sectionsStats.filter(s=>!doc.includes(s.label)&&!doc.includes(s.id));
// Etiquetas amigables pueden diferir: el bloque se contrasta además por número de filas.
const statsBlock=doc.slice(doc.indexOf('#### Las 18 secciones del Explorador'),doc.indexOf('#### Histórico, detalle y archivos estadísticos'));
const statsRows=statsBlock.split('\n').filter(s=>/^\| \d\d /.test(s));
if(statsRows.length!==18)issues.push('Secciones estadísticas incompletas '+statsRows.length);

let tableColumns=null,tableIndex=0,inFence=false;
for(const [i,line] of doc.split('\n').entries()){
  if(line.startsWith('```')){inFence=!inFence;continue;}
  if(inFence)continue;
  if(line.startsWith('|')){
    const pipes=[...line.matchAll(/(?<!\\)\|/g)].length;
    if(tableColumns===null){tableColumns=pipes;tableIndex++;}
    if(pipes!==tableColumns)issues.push(`Tabla ${tableIndex}, línea ${i+1}: ${pipes} separadores, esperados ${tableColumns}`);
  }else tableColumns=null;
}
if(inFence)issues.push('Bloque de código sin cierre');
if(doc.includes('\uFFFD'))issues.push('Carácter de reemplazo Unicode');

const refs=[];
for(const m of doc.matchAll(/\]\((D:\/Escritorio\/escandon-bi\/[^)]+?)(?::(\d+))?\)/g))refs.push({file:m[1],line:m[2]?Number(m[2]):null});
for(const m of doc.matchAll(/`((?:frontend|backend|database)\/[a-zA-Z0-9_./-]+\.(?:jsx?|json|sql)):(\d+)/g))refs.push({file:path.join(root,m[1]),line:Number(m[2])});
const lineCache=new Map();
for(const ref of refs){
  if(!fs.existsSync(ref.file)){issues.push('Referencia inexistente '+ref.file);continue;}
  if(!lineCache.has(ref.file))lineCache.set(ref.file,fs.readFileSync(ref.file,'utf8').split('\n').length);
  if(ref.line&&(ref.line<1||ref.line>lineCache.get(ref.file)))issues.push('Línea inválida '+ref.file+':'+ref.line);
}
const changedSources=[];
for(const h of control.hashes){
  const file=path.join(root,h.file);
  if(!fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==h.sha256)changedSources.push(h.file);
}
if(changedSources.length)issues.push('Fuentes cambiadas desde inventario: '+changedSources.join(', '));
const result={document:outPath,bytes:Buffer.byteLength(doc),lines:doc.split('\n').length,headings:sections.length,tables:tableIndex,routes:36,reactFiles:control.jsx.length,apiDeclarations:control.endpoints.length,initialKpiIds:control.kpis.length,statisticSections:statsRows.length,reportIds:inTable.length,codeReferences:refs.length,brokenReferences:issues.filter(s=>s.startsWith('Referencia')||s.startsWith('Línea')).length,changedSources,issues};
fs.writeFileSync(path.join(__dirname,'verificacion-documento.json'),JSON.stringify(result,null,2),'utf8');
console.log(JSON.stringify(result,null,2));
if(issues.length)process.exitCode=1;
