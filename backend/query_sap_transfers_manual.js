require('dotenv').config();
const sap = require('./services/sap.service');
async function run() {
  try {
    let t = [];
    for(let i=0; i<25; i++) {
      const skip = i * 20;
      const res = await sap.get(`/StockTransfers?$orderby=DocNum desc&$skip=${skip}&$top=20`);
      if(res.data && res.data.value) t = t.concat(res.data.value);
    }
    const filtered = t.filter(x => x.StockTransferLines.some(l => l.ItemCode === 'FAR0366'));
    console.log(`Checked ${t.length} transfers. Found ${filtered.length} for FAR0366.`);
    filtered.forEach(x => {
      console.log(`Transfer DocNum: ${x.DocNum}, Date: ${x.DocDate}, From: ${x.FromWarehouse}, To: ${x.ToWarehouse}`);
      const lines = x.StockTransferLines.filter(l => l.ItemCode === 'FAR0366');
      console.log(`Lines:`, lines.map(l => ({Qty: l.Quantity, ToWhs: l.WarehouseCode})));
    });
  } catch(e) {
    console.error(e.response ? e.response.data : e);
  }
}
run();
