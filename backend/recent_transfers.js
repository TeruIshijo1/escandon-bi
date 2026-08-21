require('dotenv').config();
const sap = require('./services/sap.service');
async function run() {
  try {
    const r = await sap.get('/StockTransfers?$orderby=DocEntry desc&$top=20');
    if(r.data && r.data.value) {
       const transfers = r.data.value.map(t => {
         return {
           DocNum: t.DocNum,
           DocDate: t.DocDate,
           From: t.FromWarehouse,
           To: t.ToWarehouse,
           Comments: t.Comments,
           Lines: t.StockTransferLines.map(l => ({Item: l.ItemCode, Qty: l.Quantity}))
         };
       });
       console.log("Transfers:", JSON.stringify(transfers, null, 2));
    }
  } catch(e) {
    console.error(e);
  }
}
run();
