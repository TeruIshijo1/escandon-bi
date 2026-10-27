'use strict';

function splitDateRange(startDate, endDate) {
   
  const today = new Date();

  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const startStr = startDate ? startDate.substring(0, 10) : null;
  const endStr = endDate ? endDate.substring(0, 10) : null;

  let hasToday = false;
  let pgStart = startStr;
  let pgEnd = endStr;
  let remoteStart = null;
  let remoteEnd = endDate;  

  if (!endStr || endStr >= todayStr) {
    hasToday = true;

    const yesterday = new Date(today.getTime());
    yesterday.setDate(yesterday.getDate() - 1);
    const yyyyy = yesterday.getFullYear();
    const ymm = String(yesterday.getMonth() + 1).padStart(2, '0');
    const ydd = String(yesterday.getDate()).padStart(2, '0');
    const yesterdayStr = `${yyyyy}-${ymm}-${ydd}`;

    if (startStr && startStr >= todayStr) {
       
      pgStart = null;
      pgEnd = null;
      remoteStart = startDate;  
    } else {
      pgEnd = yesterdayStr;
      remoteStart = todayStr;  
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
