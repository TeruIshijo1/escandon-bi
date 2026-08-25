const sapService = require('./backend/services/sap.service');
(async () => {
  try {
    await sapService._ensureSession();
    const sapSqlText = \
      SELECT T0.DocNum AS "FolioSAP", T0.DocDate AS "Fecha", T1.ItemCode AS "CodigoArticulo", T1.Dscription AS "Descripcion", T1.Quantity AS "Cantidad", T1.Price AS "PrecioUnitario", T1.LineTotal AS "TotalLinea" FROM OINV T0 INNER JOIN INV1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.U_PCNum = '123' AND T0.CANCELED = 'N' UNION ALL SELECT T0.DocNum AS "FolioSAP", T0.DocDate AS "Fecha", T1.ItemCode AS "CodigoArticulo", T1.Dscription AS "Descripcion", T1.Quantity AS "Cantidad", T1.Price AS "PrecioUnitario", T1.LineTotal AS "TotalLinea" FROM ORDR T0 INNER JOIN RDR1 T1 ON T0.DocEntry = T1.DocEntry WHERE T0.U_PCNum = '123' AND T0.CANCELED = 'N'\;
    const queryName = 'TestEscandonBI';
    try {
      await sapService.post('/SQLQueries', { SqlCode: queryName, SqlName: queryName, SqlText: sapSqlText });
    } catch(e) {
      await sapService.patch(/SQLQueries('\$queryName'), { SqlText: sapSqlText });
    }
    const res = await sapService.get(/SQLQueries('\$queryName')/List);
    console.log(res.data.value.length);
    process.exit(0);
  } catch (e) {
    console.error(e.message, e.response?.data);
    process.exit(1);
  }
})();
