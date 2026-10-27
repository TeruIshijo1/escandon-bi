'use strict';

const RANKED_ATTENDANCES = `SELECT PR.FullName AS Medico, MS.MSDescription_ES AS Especialidad,
    CAST(PC.Date AS date) AS Fecha,
    ROW_NUMBER() OVER (PARTITION BY PR.PRNum, PC.PTNum ORDER BY PC.Date) AS Orden
  FROM PC
  INNER JOIN PR ON PC.PRNum = PR.PRNum
  INNER JOIN MS ON PR.MSCode = MS.MSCode
  WHERE PC.Date IS NOT NULL`;
const DAILY_COLUMNS = `Medico, Especialidad, Fecha,
  SUM(CASE WHEN Orden = 1 THEN 1 ELSE 0 END) AS Primeras,
  SUM(CASE WHEN Orden > 1 THEN 1 ELSE 0 END) AS Subsecuentes,
  COUNT(*) AS TotalAtenciones`;
const DAILY_GROUP = 'GROUP BY Medico, Especialidad, Fecha';

const DAILY_PRODUCTIVITY_SQL = `WITH Atenciones AS (
  ${RANKED_ATTENDANCES}
)
SELECT ${DAILY_COLUMNS}
FROM Atenciones
WHERE Fecha >= @startDate AND Fecha < @endExclusive
${DAILY_GROUP}`;

const DAILY_PRODUCTIVITY_FROM = `(SELECT ${DAILY_COLUMNS}
FROM (${RANKED_ATTENDANCES}) Atenciones
${DAILY_GROUP}) v`;

module.exports = { DAILY_PRODUCTIVITY_SQL, DAILY_PRODUCTIVITY_FROM };
