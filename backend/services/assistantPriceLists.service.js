'use strict';
const sap = require('./sap.service');
const id = 'assistant_public_hospital_prices';
const fields = [
  { key:'ItemCode',label:'Código de artículo',type:'string' }, { key:'ItemName',label:'Artículo / servicio',type:'string' },
  { key:'ItemGroupName',label:'Grupo de artículos',type:'string' }, { key:'PricePublic',label:'Precio Público General',type:'money' },
  { key:'PriceHospital',label:'Precio Hospitalización',type:'money' }, { key:'CurrencyPublic',label:'Moneda Público General',type:'string' },
  { key:'CurrencyHospital',label:'Moneda Hospitalización',type:'string' }
].map(field=>({...field,width:220}));
const catalog = { [id]: { id, title:'Precios Público General y Hospitalización',source:'SAP',assistantOnly:true,
  category:'Precios y Condiciones Comerciales',description:'Una fila por artículo con grupo, precio de Público General (lista 1) y Hospitalización (lista 2). Conserva precios en cero y listas ausentes.',
  aliases:['listas de precios publico general y hospitalizacion','precios publico general y hospitalizacion','precios de publico general y hospitalizacion','precios publico y hospitalizacion'],
  fields,defaultFields:['ItemCode','ItemName','ItemGroupName','PricePublic','PriceHospital'],filters:[],requiresDateFilter:false,summary:{},
  grain:'Una fila por artículo. Los precios son unitarios y actuales: Público General = lista 1; Hospitalización = lista 2. No se suman precios unitarios.',
  requiredPermissions:['item_prices','item_groups'] } };
async function pages(collection, select, order, map, limit, search='') {
  let path=`/${collection}?$select=${encodeURIComponent(select)}&$orderby=${encodeURIComponent(order)}`;
  const seen=new Set(),rows=[];
  let scanned=0;
  while(path) {
    if (seen.has(path)) throw new Error('SAP repitió una página de la lista de precios.');
    if (seen.size>=100) return {rows,truncated:true};
    seen.add(path);
    const result=await sap.get(path,{Prefer:'odata.maxpagesize=200'});
    if (!Array.isArray(result.data?.value)) throw new Error('No se pudo consultar la lista de precios de SAP.');
    for(const item of result.data.value) {
      scanned++;const row=map(item);
      if (!search || Object.values(row).some(value=>value!=null&&String(value).toLocaleLowerCase('es-MX').includes(search)))rows.push(row);
      if(rows.length>limit)return {rows:rows.slice(0,limit),truncated:true};
    }
    const link=result.data['@odata.nextLink']||result.data['odata.nextLink'];
    if(link&&scanned>=20000)return {rows,truncated:true};
    path=link?String(link).replace(/^https?:\/\/[^/]+\/b1s\/v[12]\//,'/').replace(/^\/?b1s\/v[12]\//,'/'):null;
    if(path&&!path.startsWith('/'))path=`/${path}`;
    if(path&&!path.startsWith(`/${collection}?`))throw new Error('SAP devolvió una página no válida para las listas de precios.');
  }
  return {rows,truncated:false};
}
async function execute(entity,options={}) {
  if(entity!==id)throw new Error('La lista de precios solicitada no está disponible.');
  const limit=options.limit??10000;
  if(!Number.isInteger(limit)||limit<1||limit>10000||options.busqueda!=null&&(typeof options.busqueda!=='string'||options.busqueda.length>200))throw new Error('Los filtros de la lista de precios no son válidos.');
  const groups=await pages('ItemGroups','Number,GroupName','Number asc',row=>row,10000);
  if(groups.truncated)throw new Error('No se pudieron consultar todos los grupos de artículos.');
  const groupNames=new Map(groups.rows.map(group=>[Number(group.Number),group.GroupName]));
  const result = await pages('Items','ItemCode,ItemName,ItemsGroupCode,ItemPrices','ItemCode asc',item=> {
    if(!Array.isArray(item.ItemPrices))throw new Error('SAP no entregó las listas de precios del artículo.');
    const price=number=>item.ItemPrices.filter(price=>Number(price.PriceList)===number);
    if(price(1).length>1||price(2).length>1)throw new Error('Hay precios duplicados para el mismo artículo y lista; no pude elegir uno de forma segura.');
    const publicPrice=price(1)[0],hospitalPrice=price(2)[0];
    const amount=value=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
    return {ItemCode:item.ItemCode,ItemName:item.ItemName,ItemGroupName:groupNames.get(Number(item.ItemsGroupCode))??null,
      PricePublic:amount(publicPrice?.Price),PriceHospital:amount(hospitalPrice?.Price),CurrencyPublic:publicPrice?.Currency??null,CurrencyHospital:hospitalPrice?.Currency??null};
  },limit,(options.busqueda||'').trim().toLocaleLowerCase('es-MX'));
  result.rows.sort((a,b)=>String(a.ItemGroupName||'').localeCompare(String(b.ItemGroupName||''),'es-MX') || String(a.ItemCode).localeCompare(String(b.ItemCode),'es-MX'));
  return result;
}
module.exports={catalog,execute};
