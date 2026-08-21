require('dotenv').config();
const sap = require('./services/sap.service');
async function run() {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    const dateStr = today.toISOString().split('T')[0];
    const r = await sap.fetchAllPages(`/StockTransfers?$filter=DocDate ge '${dateStr}'`);
    console.log(`Fetched ${r.length} transfers for today.`);
    const filtered = r.filter(x => x.StockTransferLines.some(l => l.ItemCode === 'FAR0366'));
    const simplified = filtered.map(x => ({
      Num: x.DocNum,
      Time: x.DocTime,
      From: x.FromWarehouse,
      To: x.ToWarehouse,
      Comments: x.Comments,
      Lines: x.StockTransferLines.filter(l => l.ItemCode === 'FAR0366').map(l => ({
        Qty: l.Quantity,
        From: l.FromWarehouseCode,
        To: l.WarehouseCode
      }))
    }));
    console.log("Transfers today with FAR0366:", JSON.stringify(simplified, null, 2));

    const issues = await sap.fetchAllPages(`/InventoryGenIssues?$filter=DocDate ge '${dateStr}'`);
    const filteredIssues = issues.filter(x => x.DocumentLines.some(l => l.ItemCode === 'FAR0366'));
    console.log("Inventory issues today with FAR0366:", JSON.stringify(filteredIssues.map(x=>({Num: x.DocNum, Time: x.DocTime, Whs: x.DocumentLines.find(l=>l.ItemCode==='FAR0366').WarehouseCode, Qty: x.DocumentLines.find(l=>l.ItemCode==='FAR0366').Quantity})), null, 2));

    const receipts = await sap.fetchAllPages(`/InventoryGenReceipts?$filter=DocDate ge '${dateStr}'`);
    const filteredReceipts = receipts.filter(x => x.DocumentLines.some(l => l.ItemCode === 'FAR0366'));
    console.log("Inventory receipts today with FAR0366:", JSON.stringify(filteredReceipts.map(x=>({Num: x.DocNum, Time: x.DocTime, Whs: x.DocumentLines.find(l=>l.ItemCode==='FAR0366').WarehouseCode, Qty: x.DocumentLines.find(l=>l.ItemCode==='FAR0366').Quantity})), null, 2));
  } catch(e) {
    console.error(e.response ? e.response.data : e.message);
  }
}
run();
