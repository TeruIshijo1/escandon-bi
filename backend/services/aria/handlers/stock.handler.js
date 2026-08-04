'use strict';

const sapService = require('../../sap.service');
const { normalizeText } = require('../utils/nlp');

async function queryStockInsumo(normalizedQuery) {
  try {
    const FILLER_WORDS = new Set([
      'busca', 'buscar', 'quien', 'como', 'cuanto', 'donde', 'dime', 'dame', 'sobre', 'para',
      'este', 'esta', 'estos', 'estas', 'del', 'los', 'las', 'con', 'por', 'que', 'una', 'uno',
      'unos', 'unas', 'insumo', 'medicamento', 'material', 'stock', 'actual', 'inventario', 'existencia', 'hay',
      'de', 'el', 'la', 'en', 'farmacia'
    ]);

    const rawTokens = normalizedQuery.split(/\s+/);
    const searchTerms = rawTokens.filter(w => w.length >= 3 && !FILLER_WORDS.has(w));
    
    if (searchTerms.length === 0) {
      return {
        topic: 'Consulta de Stock',
        answer: 'Por favor, indícame el código o nombre del insumo que deseas buscar. Ejemplo: "Stock de paracetamol" o "Stock de FAR0152".',
      };
    }

    const keyword = searchTerms.join(' ').toUpperCase(); // Para SAP solemos usar mayúsculas

    // Construir la consulta a SAP Service Layer (ItemCode o ItemName)
    const filter = `contains(ItemCode, '${keyword}') or contains(ItemName, '${keyword}')`;
    const endpoint = `/Items?$select=ItemCode,ItemName,QuantityOnStock,ItemsGroupCode&$filter=${encodeURIComponent(filter)}&$top=5`;
    
    const sapRes = await sapService.get(endpoint);
    const items = sapRes.data && sapRes.data.value ? sapRes.data.value : [];

    if (items.length === 0) {
      return {
        topic: `Stock de "${keyword}"`,
        answer: `No encontré ningún artículo en el catálogo de SAP que coincida con **"${keyword}"**. Verifica si el código o el nombre está escrito correctamente.`,
      };
    }

    const totalStock = items.reduce((acc, curr) => acc + (curr.QuantityOnStock || 0), 0);

    return {
      topic: `Stock de "${keyword}"`,
      answer: `Encontré **${items.length} artículo(s)** en el inventario SAP que coinciden con tu búsqueda. Hay un stock global de **${totalStock} piezas** en total.`,
      kpis: [
        { label: 'Artículos Encontrados', value: items.length },
        { label: 'Stock Global (Pzas)', value: totalStock, color: totalStock > 0 ? '#16A34A' : '#DC2626' },
      ],
      table: {
        headers: ['Código', 'Descripción', 'Stock (SAP)'],
        rows: items.map(p => [
          p.ItemCode,
          p.ItemName,
          p.QuantityOnStock,
        ]),
      },
    };
  } catch (err) {
    return {
      topic: 'Stock SAP',
      answer: 'Error al consultar el inventario en SAP: ' + err.message,
    };
  }
}

module.exports = queryStockInsumo;
