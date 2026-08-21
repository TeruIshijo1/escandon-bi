require('dotenv').config();
const sap = require('./services/sap.service');
async function check(docType, endpoint) {
  try {
    let t = [];
    for(let i=0; i<5; i++) {
      const skip = i * 20;
      const res = await sap.get(`/${endpoint}?$orderby=DocNum desc&$skip=${skip}&$top=20`);
      if(res.data && res.data.value) t = t.concat(res.data.value);
    }
    const filtered = t.filter(x => x.DocumentLines.some(l => l.ItemCode === 'FAR0366'));
    console.log(`Checked ${t.length} ${docType}. Found ${filtered.length} for FAR0366.`);
    filtered.forEach(x => {
      console.log(`${docType} DocNum: ${x.DocNum}, Date: ${x.DocDate}, Whs: ${x.DocumentLines.find(l=>l.ItemCode==='FAR0366').WarehouseCode}`);
    });
  } catch(e) { console.error(e.response ? e.response.data : e.message); }
}
async function run() {
  await check('Goods Issue', 'InventoryGenIssues');
  await check('Goods Receipt', 'InventoryGenReceipts');
  await check('Delivery', 'DeliveryNotes');
  await check('Invoices', 'Invoices');
}
run();
