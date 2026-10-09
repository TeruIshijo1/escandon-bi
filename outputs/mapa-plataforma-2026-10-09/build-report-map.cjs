const fs = require('fs');
const path = require('path');
const data = require('./catalogos-reportes-inventario.json');
const root = path.resolve(__dirname, '../..');
const all = [...data.manual, ...data.assistant];
const byId = new Map(all.map(e => [e.id, e]));
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const line = (p, needle) => { const i = read(p).split(/\r?\n/).findIndex(s => s.includes(needle)); return i < 0 ? 1 : i + 1; };
const ref = (p, needle = '', at) => `[${p}:${at || line(p, needle)}](D:/Escritorio/escandon-bi/${p}:${at || line(p, needle)})`;
const code = s => '`' + String(s ?? '').replace(/`/g, "'") + '`';
const flat = s => String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
const esc = s => flat(s).replace(/\|/g, '\\|');
const cols = e => e.fields.map(f => `${f.label === f.key ? '' : f.label + ' '}${code(f.key)}`).join('; ');
const definitions = data.definitions;
const sapDefs = definitions['sapReportCatalog.service.js'];
const vDefs = definitions['verticalReportCatalog.service.js'];
const resources = definitions['assistantResourceCatalog.service.js'];
const assistantV = definitions['assistantVerticalSources.service.js'];
const legacySql = {purchase_invoices:'sq_v6_pinv',purchase_orders:'sq_v6_por',goods_receipts_po:'sq_v6_grpo',goods_returns:'sq_v6_gret',purchase_requests:'sq_v6_prq',sales_invoices:'sq_v6_sinv',credit_memos:'sq_v6_scrm',business_partners:'sq_v6_bp'};
const legacyEndpoint = { stock_transfers: 'StockTransfers', transfer_requests: 'InventoryTransferRequests', goods_issues: 'InventoryGenExits', goods_receipts_inv: 'InventoryGenEntries' };
const tables = text => [...new Set([...(text || '').matchAll(/\b(?:FROM|JOIN)\s+([\w.]+)/gi)].map(m=>m[1]))].join(', ');
function sourceObjects(e) {
  if(resources[e.id]) { const {base,target}=resources[e.id];return base.source==='SAP'?'SAP /'+base.endpoint:`Vertical ${base.schema}.${base.object}${target?' + '+target.schema+'.'+target.object:''}`; }
  if(assistantV[e.id])return 'Vertical '+tables('FROM '+assistantV[e.id].from);
  if(vDefs[e.id])return 'Vertical '+tables('FROM '+vDefs[e.id].from);
  return e.source+' '+(sapDefs[e.id]?.endpoint || e.id);
}
function compactColumns(e) {
  if(e.composition) {
    const base=byId.get(e.composition.base), added=e.fields.filter(f=>!base.fields.some(b=>b.key===f.key));
    return `Todas las columnas de ${code(base.id)} (listadas en su fila); añade ${cols({fields:added})}`;
  }
  if(resources[e.id]?.target) {
    const {base,target}=resources[e.id];
    return `Todas las columnas de ${code(base.id)} (listadas en su fila); todas las columnas de ${code(target.id)} bajo prefijo ${code('related_'+target.object+'_')} y etiqueta «campo · ${target.title}». Claves completas resultantes: ${e.fields.filter(f=>f.key.startsWith('related_')).map(f=>code(f.key)).join(', ')}`;
  }
  return cols(e);
}
function origin(e) {
  const id = e.id;
  if (e.composition) {
    const base = byId.get(e.composition.base), target = byId.get(e.composition.target);
    const key = e.composition.target === 'customers' ? 'BPCode = CardCode' : 'ItemCode = ItemCode';
    return `Base ${code(base.id)} (${sourceObjects(base)}); SAP ${code(sapDefs[target.id].endpoint)}; relación exacta ${code(key)}; columnas de SAP con prefijo ${code('sap_' + target.id + '_')}; conserva sin vínculo y expone ${code('SAPLinkStatus')}`;
  }
  if (resources[id]) {
    const { base, target, relation } = resources[id];
    const baseName = base.source === 'SAP' ? 'SAP Service Layer /' + base.endpoint : `Vertical ${base.schema}.${base.object}`;
    return baseName + (target ? ` LEFT JOIN ${target.schema}.${target.object} por ${relation.columns.map(([a,b])=>`${base.object}.${a} = ${target.object}.${b}`).join(' AND ')}; campos relacionados con prefijo related_${target.object}_` : '') + '; clave/orden: ' + JSON.stringify(base.uniqueKeys[0] || [base.fields[0].key]);
  }
  if (assistantV[id]) return `Vertical ${flat(assistantV[id].from)}`;
  if (id === 'assistant_account_billing_collections' || id === 'assistant_account_case') return 'Vertical dbo.PC LEFT JOIN dbo.PT por PTNum; SAP Invoices cabecera U_PCNum y DocumentLines.U_PCNum; IncomingPayments.PaymentInvoices por DocEntry + InvoiceType=it_Invoice' + (id === 'assistant_account_case' ? '; Vertical PCIT por PCNum/PCITNum para cargos' : '');
  if (id === 'assistant_public_hospital_prices') return 'SAP Items(ItemCode,ItemName,ItemsGroupCode,ItemPrices.PriceList,Price,Currency) + ItemGroups(Number,GroupName); lista 1 Público General y 2 Hospitalización';
  if (vDefs[id]) return `Vertical ${flat(vDefs[id].from)}; expresiones: ${vDefs[id].fields.map(f=>`${f.key} ← ${flat(f.expression)}`).join('; ')}`;
  if (id === 'inventory') return "SAP SQLQueries sq_inv_all: OITM(ItemCode,ItemName,ItmsGrpCod,FirmCode,U_CLASI_MED_1,U_CLASI_MED_2,LastPurPrc) JOIN OITW(ItemCode,WhsCode,OnHand,AvgPrice) JOIN ITM1(ItemCode,PriceList,Price), listas 1/2; sólo InvntItem='Y' y OnHand>0. Memoria SAP y respaldo dw_sap_inventory_cache; grupos/fabricantes complementan nombres";
  if (id === 'batches') return 'SAP SQLQueries sq_bat_all: OBTN(ItemCode,DistNumber,InDate,ExpDate,SysNumber) JOIN OBTQ(ItemCode,SysNumber,WhsCode,Quantity), Quantity>0; caché SAP de lotes';
  if (legacySql[id]) {const q=data.staticSapQueries[legacySql[id]]; return `SAP SQLQueries ${legacySql[id]}; tablas ${tables(q)}; ${id==='business_partners'?"CardType IN ('S','C')":'cabecera.DocEntry = línea.DocEntry; filtro DocDate desde/hasta'}; TOP5000; campos SELECT corresponden a las columnas de esta fila`;}
  if (legacyEndpoint[id]) return `SAP Service Layer /${legacyEndpoint[id]}; DocEntry,DocNum,DocDate,Comments; ${id.includes('transfer') ? 'FromWarehouse,ToWarehouse,StockTransferLines(ItemCode,ItemDescription,Quantity,FromWarehouse,WarehouseCode,RemainingOpenQuantity)' : 'DocumentLines(ItemCode,ItemDescription,Quantity,Price,UnitPrice,LineTotal,WarehouseCode)'}`;
  if (sapDefs[id]) return `SAP Service Layer /${sapDefs[id].endpoint}; $select=${sapDefs[id].select}${sapDefs[id].sourceFilter ? '; condición ' + sapDefs[id].sourceFilter : ''}${id === 'item_prices' ? '; además PriceLists(PriceListNo,PriceListName) para el nombre de lista' : ''}`;
  throw new Error('Missing lineage: ' + id);
}
function evidence(e) {
  if(e.composition) return ref('backend/services/assistantReportComposition.service.js','catalog[id] =');
  if(resources[e.id]) return ref('backend/config/assistant-report-resources.json','"metadataDate"') + '; ' + ref('backend/services/assistantResourceCatalog.service.js','function add');
  if(assistantV[e.id]) return ref('backend/services/assistantVerticalSources.service.js',"define('"+e.id+"'");
  if(e.id==='assistant_account_billing_collections') return ref('backend/services/assistantAccountFinance.service.js','const catalog');
  if(e.id==='assistant_account_case') return ref('backend/services/assistantAccountCase.service.js','const catalog');
  if(e.id==='assistant_public_hospital_prices') return ref('backend/services/assistantPriceLists.service.js','const catalog');
  if(vDefs[e.id]) return ref('backend/services/verticalReportCatalog.service.js',"define('"+e.id+"'");
  if(e.id==='inventory'||e.id==='batches') return ref('backend/services/sapInventory.service.js',e.id==='inventory'?'const sqlInv':'const sqlBat')+'; '+ref('backend/services/sapQueryBuilder.service.js',"case '"+e.id+"'");
  if(legacySql[e.id]) return ref('backend/services/sapQueryBuilder.service.js',legacySql[e.id]+':');
  if(legacyEndpoint[e.id]) return ref('backend/services/sapQueryBuilder.service.js',"case '"+e.id+"'");
  return ref('backend/services/sapReportCatalog.service.js',"'"+e.id+"'");
}
function controls(e) {
  const def = vDefs[e.id] || assistantV[e.id];
  const resource = resources[e.id]?.base || resources[e.composition?.base]?.base;
  const date = def?.date || resource?.dateField || (e.requiresDateFilter ? (e.dateKey || 'DocDate') : null);
  const sumFields=(e.analysisCapabilities?.fields||[]).filter(f=>f.sumAllowed).map(f=>f.key);
  return `${e.requiresDateFilter ? 'Período obligatorio sobre ' + (e.dateFieldLabel || date) + (date ? ' (' + date + ')' : '') : 'Información actual; sin período'}; búsqueda; ${(e.filters||[]).join(', ') || 'sin filtros especiales'}${e.statusOptions?.length ? '; estados: '+e.statusOptions.map(s=>s.label+' ('+s.value+')').join(', ') : ''}${e.pointLookupFields?.length?'; consulta exacta '+e.pointLookupFields.join(', ')+(e.pointLookupRequired?' obligatoria':' opcional'):''}; recomendadas: ${e.defaultFields.join(', ')}; sumables en análisis: ${sumFields.join(', ')||'ninguno (admite conteos)'}; ${e.grain}`;
}
function kpis(e) {
  let text = 'Registros devueltos';
  if(e.assistantOnly) return text + '; sumas sólo si figuran como permitidas en el análisis';
  if(e.summary?.amountField) text += `; ${e.summary.amountLabel || 'Importe'} = SUM(${e.summary.amountField})`;
  if(e.summary?.quantityField) text += `; ${e.summary.quantityLabel || 'Cantidad'} = SUM(${e.summary.quantityField})`;
  if(legacySql[e.id] && e.id!=='business_partners') text+='; subtotal SUM(LineTotal); cantidad SUM(Quantity)';
  if(legacyEndpoint[e.id]) text+='; cantidad SUM(Quantity)'+(['goods_issues','goods_receipts_inv'].includes(e.id)?'; subtotal SUM(LineTotal)':'');
  if(e.id==='inventory')text+='; SUM(QuantityOnStock); margen teórico = (PricePG − costo)/PricePG ×100, costo = LastPurPrc positivo o AvgPrice';
  if(e.id==='business_partners')text+='; saldo SUM(Balance) de filas entregadas';
  if(e.id==='batches')text+='; SUM(Quantity); lotes vencidos y por vencer≤90 días';
  if(e.fields.some(f=>f.key==='DocStatus'))text+='; documentos abiertos únicos';
  return text;
}
const intro = `## Crear Reporte Personalizado y Mis reportes

**Ubicación:** menú «Crear Reporte Personalizado», ruta ${code('/mi-area/consultas-service-layer')}; la misma pantalla se llama «Mis reportes» cuando el usuario sólo dispone de reportes guardados/asignados. Evidencia: ${ref('frontend/src/App.jsx','path="mi-area/consultas-service-layer"')}, ${ref('frontend/src/components/mi-area/ConsultaServiceLayer.jsx',"onlySavedReports ? 'Mis reportes'")}.

Permite consultar documentos, cuentas, cargos, citas, médicos, servicios, inventarios, lotes, cartera y datos administrativos; elegir columnas; filtrar; contar/agrupar/sumar las medidas admitidas; ver tarjetas KPI y una tabla; descargar Excel; guardar una configuración y asignarla a personas autorizadas. El catálogo manual tiene **64 módulos: 39 SAP y 25 Vertical, en 19 categorías**. El asistente recibe además **632 capacidades declaradas**, para **696 identificadores totales**. La lista se filtra por permisos del usuario y no todos ven todo. La extracción se realizó sobre código con IO bloqueado; estos números describen capacidades de código y metadatos, no certifican que hoy existan filas, permisos en SAP o conexión disponible.

### Instructivo de consulta

1. Abra «Crear con asistente» y describa el tema, período y columnas. Por ejemplo: «Órdenes de venta SAP de septiembre, por orden, con paciente, folio de atención, cliente y total». Responda las aclaraciones. Revise el origen, período, columnas y condiciones antes de generar. «Nueva conversación» inicia otra solicitud. También puede abrir «Elegir un tema», buscar por nombre, filtrar por SAP/Vertical y categoría y seleccionar una tarjeta.
2. En «Configurar reporte», elija fechas cuando el tema las requiere y los filtros disponibles. Hay atajos Hoy, 7 días, Este mes, 30 días, 90 días y Todo el año. Los temas de información actual, como existencias o precios, no reconstruyen un corte histórico. Seleccione «Todas» o «Recomendadas» para columnas y pulse «Buscar información».
3. Revise la leyenda «Cada fila representa» antes de sumar. Un documento detallado repite el total de su cabecera en varias líneas; sume el subtotal de línea. Para una cifra por factura/orden, use el módulo de resumen. Cartera/saldos y estados reflejan su situación actual aunque se filtren documentos por fecha de emisión. Los cobros registrados y el cierre de una cuenta son conceptos separados.
4. La tabla muestra **100 registros por página**. Las búsquedas/filtros de columnas reducen la vista; en análisis agrupado, los KPI pueden corresponder al resultado completo anterior al filtro de vista. Para campos nuevos o cambios que requieren volver al origen, pulse «Consultar los nuevos datos». «Descargar Excel» descarga todas las filas filtradas cargadas y columnas visibles, no sólo la página actual. El archivo generado es HTML compatible con Excel con extensión ${code('.xls')}. El límite/truncamiento se conserva en el archivo. Evidencia: ${ref('frontend/src/components/mi-area/ConsultaServiceLayer.jsx','const PER_PAGE')}, ${ref('frontend/src/components/mi-area/ConsultaServiceLayer.jsx','const exportExcel')}.
5. «Guardar reporte» conserva título, descripción, módulo, columnas, filtros y análisis; no congela los registros originales. «Mis reportes» permite «Ver reporte», «Actualizar reporte», «Ajustar una copia» cuando se tiene acceso al tema, «Administrar accesos» para administración y «Eliminar reporte» conforme a sus permisos. Los reportes asignados se ejecutan con la configuración guardada; sus resultados sólo incluyen columnas autorizadas y se vuelve a comprobar el acceso al terminar. Evidencia: ${ref('backend/services/sapQueryBuilder.service.js','INSERT INTO usersapqueries')}, ${ref('backend/services/savedReportAccess.service.js','async function executeSavedQuery')}.

### De dónde proviene y qué significan los indicadores

**SAP:** documentos/catálogos de SAP Business One por Service Layer OData o consultas SQL registradas; los campos ${code('U_PCNum')}, ${code('U_PTNum')}, ${code('U_PTName')}, ${code('U_SONum')} y ${code('U_CLASI_MED_1/2')} son campos específicos del hospital. **Vertical:** tablas/vistas de SQL Server remoto; varias vistas ${code('UDR_*')} encapsulan lógica cuyo SQL de definición no está incluido en estos servicios. Se documenta la vista y las columnas realmente consultadas, sin atribuirles tablas internas no demostradas. **Propio de la plataforma:** PostgreSQL ${code('usersapqueries')}, ${code('usersapqueryassignments')} y ${code('usuarios')} para configuraciones y destinatarios, más cachés DW; las plantillas no son documentos de SAP/Vertical.

Los KPI normales cuentan filas entregadas, suman el importe o cantidad declarados para ese módulo, cuentan documentos abiertos deduplicados y, en lotes, filas vencidas/próximas a vencer. Importes iguales a cero y cantidades cero no generan tarjeta adicional en el constructor. Si el importe/moneda no está completo, puede omitirse la tarjeta de suma. Son cifras del conjunto cargado y su granularidad, no necesariamente del universo de la institución. Al ejecutar una plantilla guardada se devuelve la tarjeta «Registros»; no se conservan todas las tarjetas originales. Evidencia: ${ref('backend/services/sapQueryBuilder.service.js','// Los indicadores corresponden')}, ${ref('backend/services/savedReportAccess.service.js',"kpis: [{ label: 'Registros'")}.

El análisis conversacional admite hasta **8 condiciones, 4 agrupaciones, 6 medidas y 2 órdenes**: igual/distinto, comparaciones, entre, contiene, nulo/no nulo; ${code('count')}, ${code('countDistinct')} y ${code('sum')} únicamente en campos declarados como sumables. No suma precios unitarios, saldos repetidos por cargo ni monedas mezcladas como si fueran una sola. Rechaza un total cuando el origen quedó incompleto; muestra registros que cumplen, número de grupos y valores desconocidos. Evidencia: ${ref('backend/services/reportAnalysis.service.js','function getAnalysisCapabilities')}, ${ref('backend/services/reportAnalysis.service.js',"label: 'Registros que cumplen'")}.

**Límites de consulta:** período máximo 366 días; salida 1–10,000 filas (valor usual 10,000); caché 60 segundos; varias consultas SQL antiguas devuelven TOP 5,000; traslados/salidas/entradas OData antiguos cargan hasta 1,500 documentos antes de expandir líneas; SAP nuevo limita páginas y documentos inspeccionados y marca resultado incompleto; Vertical trae una fila adicional para detectar truncamiento. Cuando se alcanza un límite, reduzca período/filtros y consulte los demás intervalos. Un resumen sobre un conjunto truncado no equivale al total completo. Evidencia: ${ref('backend/services/sapQueryBuilder.service.js','const QUERY_CACHE_TTL_MS')}, ${ref('backend/services/sapQueryBuilder.service.js','Limitar rango máximo')}, ${ref('backend/services/sapReportCatalog.service.js','async function fetchPages')}, ${ref('backend/services/verticalReportCatalog.service.js','async function execute')}.

### Catálogo manual completo: 64 apartados

Cada fila es una tarjeta disponible en «Elegir un tema» si el perfil tiene el permiso correspondiente. «Columnas» enumera todos los datos seleccionables; «Filtros» incluye las recomendadas iniciales y el significado de una fila. Las expresiones técnicas se incluyen para comprobar trazabilidad.

`;
let out = intro;
for (const cat of data.summary.manualCategories) {
  out += `#### ${cat}\n\n| ID / nombre del apartado | Qué se consulta / KPI | Origen exacto | Columnas consultables | Filtros, recomendadas y granularidad | Evidencia |\n|---|---|---|---|---|---|\n`;
  for (const e of data.manual.filter(e=>e.category===cat)) out += `| ${code(e.id)} — ${esc(e.title)} | ${esc(e.description)}<br>${esc(kpis(e))} | ${esc(origin(e))} | ${esc(cols(e))} | ${esc(controls(e))} | ${evidence(e)} |\n`;
  out+='\n';
}
const narrative = read('outputs/mapa-plataforma-2026-10-09/reportes_ia-narrativa.md');
out += narrative + '\n';
out += `### Anexo: capacidades adicionales del asistente, 632 identificadores\n\nEstos temas están en ${code('getAssistantCatalog()')}, no son 632 tarjetas añadidas al selector manual. Pueden ser escogidos por el motor de lenguaje, siempre con permisos y validación del servidor. El manifiesto declara metadatos del 6 de octubre de 2026 y verificación de campos SAP del 8 de octubre de 2026; esta revisión del 9 de octubre no repitió consultas al hospital. Sus etiquetas genéricas «Información de…» no acreditan una interpretación clínica/administrativa adicional a sus campos. Todos los recursos tienen búsqueda y límite 1–10,000; fechas sólo donde se declara el campo. El período filtra ese campo, no recalcula estados/saldos actuales. Los recursos financieros no suman importes automáticamente. Las relaciones conservan filas sin vínculo y requieren como máximo una coincidencia del lado relacionado.\n\n`;
const groups = [
  ['Consultas especializadas de convenios, cuenta y precios', e=>!e.composition&&!resources[e.id]],
  ['Recursos de Vertical declarados por metadatos', e=>!e.composition&&resources[e.id]&&!resources[e.id].target&&e.source==='Vertical'],
  ['Recursos de SAP declarados por metadatos', e=>!e.composition&&resources[e.id]&&!resources[e.id].target&&e.source==='SAP'],
  ['Relaciones declaradas entre recursos de Vertical', e=>!e.composition&&resources[e.id]?.target],
  ['Combinaciones de Vertical con pagador/artículo de SAP', e=>!!e.composition]
];
for (const [name, filter] of groups) {
  const items=data.assistant.filter(filter);
  out+=`#### ${name} (${items.length})\n\n| ID / nombre declarado | Qué información / campos se pueden pedir | Origen / relación exacta | Filtros, columnas recomendadas y granularidad | Evidencia |\n|---|---|---|---|---|\n`;
  for(const e of items) out+=`| ${code(e.id)} — ${esc(e.title)} | ${esc(e.description)}<br>${esc(compactColumns(e))} | ${esc(origin(e))} | ${esc(controls(e))} | ${evidence(e)} |\n`;
  out+='\n';
}
out += `### Control de cobertura de reportes y asistentes\n\n- [x] 64 IDs manuales, 39 SAP/25 Vertical, 19 categorías, todos listados individualmente.\n- [x] 632 IDs adicionales: 5 especializados, 383 recursos Vertical, 33 recursos SAP, 48 relaciones Vertical y 163 combinaciones SAP/Vertical.\n- [x] Total 696 IDs de ${code('getAssistantCatalog()')}; ninguna capacidad extraída quedó sin origen/evidencia en estas tablas.\n- [x] Constructor, asistente de reportes, plantillas propias/asignadas, análisis, campos, filtros, KPI, Excel, permisos y límites.\n- [x] MAR-IA activo, 21 intents operativos, 12 perfiles IA, búsquedas dinámicas y resumen; API/componentes anteriores registrados separadamente.\n- [x] BI externo documentado como URL/configuración y origen del dataset no comprobado en repositorio.\n- [x] DataHub y motores/datasets ML compartidos, sin consultas al hospital.\n\n**Rutas cubiertas:** UI ${code('/mi-area/consultas-service-layer')}; API ${code('/api/sap-query/catalog')}, ${code('/api/sap-query/assistant')}, ${code('/api/sap-query/execute')}, ${code('/api/sap-query/saved')}, ${code('/api/sap-query/saved/access')}, ${code('/api/sap-query/saved/recipients')}, ${code('/api/sap-query/saved/:id/assignments')}, ${code('/api/sap-query/saved/:id')}, ${code('/api/aria/query')}, ${code('/api/aria/suggestions')}, ${code('/api/aria/permissions')}, ${code('/api/ai/query')}, ${code('/api/bi/available-reports')}, ${code('/api/bi/token/:reportId')}. Fuentes: ${ref('backend/routes/sapQueryBuilder.routes.js')}, ${ref('backend/routes/aria.routes.js')}, ${ref('backend/routes/ai.routes.js')}, ${ref('backend/routes/bi.routes.js')}.\n\n**Archivos/IDs de contraste:** ${code('sapQueryBuilder.service.js')}, ${code('sapReportCatalog.service.js')}, ${code('verticalReportCatalog.service.js')}, ${code('reportAssistant.service.js')}, ${code('reportIntent.service.js')}, ${code('reportLanguage.service.js')}, ${code('reportVocabulary.service.js')}, ${code('reportAnalysis.service.js')}, ${code('assistantReportComposition.service.js')}, ${code('assistantResourceCatalog.service.js')}, ${code('assistantResourceSelection.service.js')}, ${code('assistantVerticalSources.service.js')}, ${code('assistantAccountFinance.service.js')}, ${code('assistantAccountCase.service.js')}, ${code('assistantPriceLists.service.js')}, ${code('assistant-report-resources.json')}, ${code('assistant-sap-field-availability.json')}, ${code('savedReportAccess.service.js')}, ${code('aria/index.js')}, ${code('aria/reportQuery.service.js')}, ${code('aria/config/intents.js')}, ${code('aria/config/vocabulario.js')}, ${code('aria/core/permissions.js')}, ${code('aria/core/dynamicSearch.js')}, ${code('aria/core/llmClassifier.js')}, los 13 archivos ${code('aria/handlers/*.js')}, ${code('rag.service.js')}, ${code('datahub.service.js')}, ${code('mlDataset.service.js')}, ${code('mlRevenueDataset.service.js')}, ${code('mlPipeline.service.js')}, ${code('mlJobRunner.service.js')}, ${code('ConsultaServiceLayer.jsx')}, ${code('ReportAssistant.jsx')}, ${code('AriaCopilotWidget.jsx')}, ${code('AIAssistant.jsx')}, ${code('EmbeddedBI.jsx')}. Los IDs exactos se encuentran en la primera columna de cada tabla, por lo que se pueden buscar con Ctrl+F.\n`;
const expectedGroups=groups.map(([name,filter])=>[name,data.assistant.filter(filter).length]);
const total=expectedGroups.reduce((sum,[,n])=>sum+n,0);
if(total!==data.assistant.length)throw new Error('Assistant group coverage incomplete');
const tableIds=[...out.matchAll(/^\| `([^`]+)` —/gm)].map(m=>m[1]).filter(id=>byId.has(id));
if(tableIds.length!==all.length || new Set(tableIds).size!==all.length || all.some(e=>!tableIds.includes(e.id)))throw new Error('Table ID coverage incomplete');
fs.writeFileSync(path.join(__dirname,'reportes_ia.md'),out);
fs.writeFileSync(path.join(__dirname,'reportes-coverage.json'),JSON.stringify({manual:data.manual.length,assistant:data.assistant.length,total:all.length,tableIds:tableIds.length,groups:expectedGroups},null,2));
console.log(JSON.stringify({ids:tableIds.length,bytes:Buffer.byteLength(out),groups:expectedGroups}));
