

'use strict';

const { getDb } = require('../config/db');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const knex = require('knex');

class DataHubService {

    async getExternalConnection(connector) {
        const config = JSON.parse(connector.Configuracion);
        
        const client = connector.Tipo === 'MSSQL' ? 'tedious' : 'pg';
        
        return knex({
            client: client,
            connection: {
                host: config.host,
                port: parseInt(config.port),
                user: config.user,
                password: config.password,
                database: config.database,
                options: {
                    encrypt: true,
                    trustServerCertificate: true
                }
            }
        });
    }

    async scanFileSource(connectorId) {
        const db = getDb();
        const connector = await db.prepare('SELECT * FROM DataConnectors WHERE ConnectorId = ?').get(connectorId);
        if (!connector) throw new Error('Conector no encontrado');

        const entities = [];

        if (connector.Tipo === 'EXCEL' || connector.Tipo === 'CSV') {
            const config = JSON.parse(connector.Configuracion);
            const filePath = path.join(__dirname, '..', 'uploads', config.filePath);

            if (!fs.existsSync(filePath)) throw new Error('Archivo no encontrado: ' + filePath);

            const workbook = new ExcelJS.Workbook();
            if (connector.Tipo === 'CSV') {
                await workbook.csv.readFile(filePath);
            } else {
                await workbook.xlsx.readFile(filePath);
            }

            workbook.eachSheet((sheet) => {
                const columns = [];
                const firstRow = sheet.getRow(1);
                firstRow.eachCell((cell, colNumber) => {
                    columns.push({ name: cell.value?.toString(), type: 'TEXT' });
                });

                entities.push({ name: sheet.name, schema: columns });
            });
        } 
        else if (connector.Tipo === 'MSSQL' || connector.Tipo === 'POSTGRES') {
            const externalDb = await this.getExternalConnection(connector);
            try {
                // Listar tablas (query genérica para INFORMATION_SCHEMA)
                const tables = await externalDb('INFORMATION_SCHEMA.TABLES')
                    .select('TABLE_NAME as name')
                    .where('TABLE_SCHEMA', 'public')  
                    .orWhere('TABLE_SCHEMA', 'dbo');

                for (const table of tables) {
                    const columnsRaw = await externalDb('INFORMATION_SCHEMA.COLUMNS')
                        .select('COLUMN_NAME as name', 'DATA_TYPE as type')
                        .where('TABLE_NAME', table.name);
                    
                    entities.push({ name: table.name, schema: columnsRaw });
                }
            } finally {
                await externalDb.destroy();
            }
        }

        // Guardar entidades en DB local
        for (const entity of entities) {
            await db.prepare(`
                INSERT INTO DataEntities (ConnectorId, NombreEntidad, Esquema)
                VALUES (?, ?, ?)
                ON CONFLICT(ConnectorId, NombreEntidad) DO UPDATE SET
                  Esquema = EXCLUDED.Esquema
            `).run(connectorId, entity.name, JSON.stringify(entity.schema));
        }

        return entities;
    }

    async getMetricValue(seccionUI) {
        const db = getDb();
        const mapping = await db.prepare(`
            SELECT m.*, e.NombreEntidad, c.Tipo, c.Configuracion, c.ConnectorId
            FROM MetricMappings m
            LEFT JOIN DataEntities e ON m.EntityId = e.EntityId
            LEFT JOIN DataConnectors c ON e.ConnectorId = c.ConnectorId
            WHERE m.SeccionUI = ?
        `).get(seccionUI);

        if (!mapping || !mapping.Tipo) return null;

        try {
            if (mapping.Tipo === 'SQLITE') return null;  

            if (mapping.Tipo === 'EXCEL' || mapping.Tipo === 'CSV') {
                return await this.calculateFromExcel(mapping);
            }

            if (mapping.Tipo === 'MSSQL' || mapping.Tipo === 'POSTGRES') {
                return await this.calculateFromSql(mapping);
            }
        } catch (err) {
            console.error(`[DataHub Error] Metrica: ${seccionUI}`, err.message);
            return 0;
        }

        return null;
    }

    async calculateFromExcel(mapping) {
        const config = JSON.parse(mapping.Configuracion);
        const filePath = path.join(__dirname, '..', 'uploads', config.filePath);
        if (!fs.existsSync(filePath)) return 0;

        const workbook = new ExcelJS.Workbook();
        if (mapping.Tipo === 'CSV') {
            await workbook.csv.readFile(filePath);
        } else {
            await workbook.xlsx.readFile(filePath);
        }
        const sheet = workbook.getWorksheet(mapping.NombreEntidad);
        if (!sheet) return 0;

        let total = 0, count = 0;
        let lastVal = 0;
        const colName = mapping.CampoValor;

        // Encontrar índice
        const firstRow = sheet.getRow(1);
        let colIndex = -1;
        firstRow.eachCell((cell, idx) => { if(cell.value?.toString() === colName) colIndex = idx; });
        if (colIndex === -1) return 0;

        sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const val = row.getCell(colIndex).value;
            const num = parseFloat(val) || 0;
            total += num;
            count++;
            lastVal = num;
        });

        if (mapping.MetodoCalculo === 'SUM') return total;
        if (mapping.MetodoCalculo === 'AVG') return count > 0 ? (total / count).toFixed(1) : 0;
        if (mapping.MetodoCalculo === 'COUNT') return count;
        if (mapping.MetodoCalculo === 'LAST') return lastVal;
        return total;
    }

    async calculateFromSql(mapping) {
        const db = getDb();
        const connector = await db.prepare('SELECT * FROM DataConnectors WHERE ConnectorId = ?').get(mapping.ConnectorId);
        const externalDb = await this.getExternalConnection(connector);

        try {
            const table = mapping.NombreEntidad;
            const column = mapping.CampoValor;
            let result;

            switch (mapping.MetodoCalculo) {
                case 'SUM':
                    result = await externalDb(table).sum(`${column} as val`).first();
                    break;
                case 'AVG':
                    result = await externalDb(table).avg(`${column} as val`).first();
                    break;
                case 'COUNT':
                    result = await externalDb(table).count(`${column} as val`).first();
                    break;
                case 'LAST':
                     
                    result = await externalDb(table).select(`${column} as val`).limit(1).first();
                    break;
                default:
                    result = { val: 0 };
            }

            return result ? (parseFloat(result.val) || 0) : 0;
        } finally {
            await externalDb.destroy();
        }
    }
}

module.exports = new DataHubService();
