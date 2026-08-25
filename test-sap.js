const sapService = require('./backend/services/sap.service');
(async () => {
  try {
    const res = await sapService.get(/Invoices? + $ + 	op=1& + $ + select=DocNum,U_PCNum,DocumentLines& + $ + ilter=U_PCNum ne null);
    console.log(JSON.stringify(res.data.value.map(v => ({DocNum: v.DocNum, U_PCNum: v.U_PCNum, lines: v.DocumentLines.length})), null, 2));
    process.exit(0);
  } catch (e) {
    console.error(e.message, e.response?.data);
    process.exit(1);
  }
})();
