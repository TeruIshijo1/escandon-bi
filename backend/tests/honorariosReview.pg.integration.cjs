// Comprueba persistencia y concurrencia en un esquema temporal de la BD propia de BI.
'use strict';
require('dotenv').config({path:require('path').join(__dirname,'../.env'),quiet:true});
const assert=require('node:assert/strict');
const {Pool}=require('pg');
const config={user:process.env.PGUSER||'postgres',host:process.env.PGHOST||'localhost',
  database:process.env.PGDATABASE||'escandon_bi',port:Number(process.env.PGPORT||5432),password:process.env.PGPASSWORD};
const schema=`test_honorarios_${Date.now()}`;
const admin=new Pool(config);
const pool=new Pool({...config,options:`-c search_path=${schema}`});
const configPath=require.resolve('../config/db');
require.cache[configPath]={id:configPath,filename:configPath,loaded:true,exports:{getDb:()=>({pool})}};
const {saveReview,readReviews}=require('../services/honorariosReview.service');
const user={id:123,nombre:'REVISOR DE PRUEBA',permisos:['interconsultas-jornadas']};
const data={rowId:'TEST-CITA-1',serviceDate:'2026-08-01',expectedRevision:0,
  decision:{action:'APROBAR',customAmount:225,vatRate:0.16,motivo:'Prueba aislada',fingerprint:'source'}};
(async()=>{
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const first=await saveReview(data,user);
    assert.equal(first.revision,1);
    const saved=await readReviews('2026-08-01','2026-08-31');
    assert.equal(saved[data.rowId].customAmount,225);
    const results=await Promise.allSettled([1,2].map(()=>saveReview({...data,expectedRevision:1,
      decision:{...data.decision,action:'EXCLUIR'}},user)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
    const final=await readReviews('2026-08-01','2026-08-31');
    assert.equal(final[data.rowId].action,'EXCLUIR');
    assert.equal(final[data.rowId].revision,2);
    assert.equal((await pool.query('SELECT count(*)::int n FROM bi_honorarios_review_history')).rows[0].n,2);
    await assert.rejects(saveReview({...data,rowId:'OTHER'}, {id:2,permisos:[]}),error=>error.status===403);
    console.log('PASS: persistencia PostgreSQL, historial, permiso del módulo y conflicto de dos revisores.');
  } finally {
    await pool.end();
    if(!/^test_honorarios_\d+$/.test(schema))throw new Error('Esquema de prueba inesperado');
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
