'use strict';

function createDashboardBatchWriter(client, batchSize = 250) {
  let pendingSql = null;
  let pendingRows = [];
  const parse = sql => String(sql).match(/^(\s*INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*)\(([^)]+)\)([\s\S]*)$/i);

  async function flush() {
    if (!pendingRows.length) return;
    const statement = pendingSql;
    const rows = pendingRows;
    pendingRows = [];
    pendingSql = null;
    const [, prefix, table, columnsText, tuple, suffix] = parse(statement);
    const columns = columnsText.split(',').map(column => column.trim());
    const conflicts = suffix.match(/ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE/i);
    const conflictIndices = conflicts?.[1].split(',').map(column => columns.indexOf(column.trim()));
    const selected = conflictIndices?.every(index => index >= 0)
      ? [...new Map(rows.map(values => [JSON.stringify(conflictIndices.map(index => values[index])), values])).values()]
      : rows;
    const params = selected.flat();
    const tuples = selected.map((values, index) => `(${tuple.replace(/\$(\d+)/g, (_, number) => `$${Number(number) + index * values.length}`)})`);
    let tail = suffix;
    if (conflicts && !/\bWHERE\b/i.test(tail)) {
      const compared = columns.filter(column => column !== 'sync_date');
      const current = compared.map(column => `${table}.${column}`).join(', ');
      const incoming = compared.map(column => column === 'fechacreacion'
        ? `COALESCE(EXCLUDED.${column}, ${table}.${column})` : `EXCLUDED.${column}`).join(', ');
      tail = tail.replace(/;?\s*$/, ` WHERE (${current}) IS DISTINCT FROM (${incoming});`);
    }
    await client.query(prefix + tuples.join(', ') + tail, params);
  }

  return {
    async query(sql, parameters = []) {
      const parsed = parse(sql);
      const indices = parsed ? [...parsed[4].matchAll(/\$(\d+)/g)].map(match => Number(match[1])) : [];
      if (!parsed || Math.max(0, ...indices) !== parameters.length || /\$\d+/.test(parsed[5])) {
        await flush();
        return client.query(sql, parameters);
      }
      if (pendingSql && pendingSql !== sql) await flush();
      pendingSql = sql;
      pendingRows.push(parameters);
      if (pendingRows.length >= batchSize) await flush();
      return { rowCount: 1, rows: [] };
    },
    flush,
  };
}

module.exports = { createDashboardBatchWriter };
