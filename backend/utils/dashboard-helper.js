'use strict';

/**
 * Splits a date range into historical (stored in PostgreSQL) and live (stored in remote DB/SAP) parts.
 * Assuming that data is synced up to yesterday, so "today" is always queried live.
 * 
 * @param {string} startDate - Start date of the range (YYYY-MM-DD)
 * @param {string} endDate - End date of the range (YYYY-MM-DD or YYYY-MM-DD HH:MM:SS)
 * @returns {object} { hasToday, pgStart, pgEnd, remoteStart, remoteEnd }
 */
function splitDateRange(startDate, endDate) {
  // Get today's date in local server timezone (format: YYYY-MM-DD)
  const today = new Date();
  
  // Format as YYYY-MM-DD using local time parts
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // Parse inputs
  const startStr = startDate ? startDate.substring(0, 10) : null;
  const endStr = endDate ? endDate.substring(0, 10) : null;

  let hasToday = false;
  let pgStart = startStr;
  let pgEnd = endStr;
  let remoteStart = null;
  let remoteEnd = endDate; // keep full end date for remote query if it has time

  // If no end date is provided, it defaults to now (which is today)
  if (!endStr || endStr >= todayStr) {
    hasToday = true;

    // pgEnd should be yesterday
    const yesterday = new Date(today.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyyy = yesterday.getFullYear();
    const ymm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const ydd = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${yyyyy}-${ymm}-${ydd}`;

    if (startStr && startStr >= todayStr) {
      // Entire requested range is today/future
      pgStart = null;
      pgEnd = null;
      remoteStart = startDate; // e.g. YYYY-MM-DD or complete timestamp
    } else {
      pgEnd = yesterdayStr;
      remoteStart = todayStr; // today starting from 00:00:00
    }
  }

  return {
    hasToday,
    pgStart,
    pgEnd,
    remoteStart,
    remoteEnd
  };
}

module.exports = {
  splitDateRange
};
