require('dotenv').config({ path: './.env' });
const sapService = require('./services/sap.service');
const fs = require('fs');

async function search() {
  try {
    const res1 = await sapService.get("/Orders?$filter=DocNum eq 43424");
    if (res1.data.value && res1.data.value.length > 0) {
      fs.writeFileSync("order_43424.json", JSON.stringify(res1.data.value[0], null, 2));
    }
    
    const res2 = await sapService.get("/Orders?$filter=DocNum eq 43435");
    if (res2.data.value && res2.data.value.length > 0) {
      fs.writeFileSync("order_43435.json", JSON.stringify(res2.data.value[0], null, 2));
    }
    console.log("Exported both orders");
  } catch (err) {
    console.error(err);
  }
}
search();
