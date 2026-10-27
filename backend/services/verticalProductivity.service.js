'use strict';

const { dateOnly, addDays, hospitalToday } = require('./statisticsCommon');
const { DAILY_PRODUCTIVITY_SQL } = require('./verticalProductivitySql');

function readDailyProductivity(remotePool, startDate, endDate = hospitalToday()) {
  dateOnly(startDate);
  dateOnly(endDate);
  if (startDate > endDate) throw new Error('Periodo de productividad inválido.');
  return remotePool.request().input('startDate', startDate).input('endExclusive', addDays(endDate, 1)).query(DAILY_PRODUCTIVITY_SQL);
}

module.exports = { DAILY_PRODUCTIVITY_SQL, readDailyProductivity };
