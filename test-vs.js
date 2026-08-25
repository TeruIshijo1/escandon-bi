const sapService = require('./backend/services/sap.service');
(async () => {
  try {
    await sapService._ensureSession();
    const res = await sapService.get(/SQLQueries('VidasSalvChoqueDet')/List?startDate='2026-08-01');
    console.log(res.data.value.slice(0, 3).map(v => v.FechaPrimeraOV));
    process.exit(0);
  } catch (e) {
    console.error(e.message, e.response?.data);
    process.exit(1);
  }
})();
