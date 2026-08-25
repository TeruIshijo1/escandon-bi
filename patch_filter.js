const fs = require('fs');
let code = fs.readFileSync('backend/routes/pharmacy.routes.js', 'utf8');

// Filter ml-dataset for Farmacia
code = code.replace(/res\.json\(\{ ok: true, data: pgRes\.rows, count: pgRes\.rowCount \}\);/,
  `
      // SOLO MOSTRAR FARMACIA:
      const sapInventoryService = require('../services/sapInventory.service');
      const farItems = new Set(sapInventoryService.getInventoryCache().filter(i => i.WhsCode === 'FAR').map(i => i.ItemCode));
      const filteredData = pgRes.rows.filter(r => farItems.has(r.itemcode));
      res.json({ ok: true, data: filteredData, count: filteredData.length });
`);

// Filter punto-reorden for Farmacia
code = code.replace(/res\.json\(\{\s*ok: true,\s*data: reorderList,/,
  `
      // SOLO MOSTRAR FARMACIA:
      reorderList = reorderList.filter(r => {
          const sapItemAll = sapInventoryService.getInventoryCache().filter(i => i.ItemCode === r.ItemCode && i.WhsCode === 'FAR');
          return sapItemAll.length > 0;
      });
      res.json({
        ok: true,
        data: reorderList,
`);

fs.writeFileSync('backend/routes/pharmacy.routes.js', code);
console.log('Filtered by FAR in backend.');
