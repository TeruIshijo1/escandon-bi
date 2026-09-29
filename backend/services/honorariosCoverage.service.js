'use strict';

const numberOrNull = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// Sólo lecturas. La cita aporta identidad, fecha, realización y concepto;
// el tabulador aporta la base. Nunca se usa el precio de venta como honorario.
const APPOINTMENT_RECOVERY_SQL = `
  WITH Tariff AS (
    SELECT ITEMCODE, COUNT(*) TariffCount, MIN(IMPORTE) Fee, MIN(ITEMDESCRIPTION) Description
    FROM UT_Honorarios GROUP BY ITEMCODE
  ), RecordedTax AS (
    SELECT Medico, ItemCode, MIN(IvaRateLinea) MinVatRate, MAX(IvaRateLinea) MaxVatRate,
      MIN(ItemGroupName) ItemGroupName
    FROM UDR_HON_PAGO
    WHERE PCDate >= @startDate AND PCDate < DATEADD(day,1,CAST(@endDate AS date)) AND BaseImporte > 0
    GROUP BY Medico,ItemCode
  )
  SELECT a.PCAPNum, a.PCNum, a.SONum, a.FromDate FechaAtencion, a.PCAP_ST,
    a.UDF_Ejecutada, a.ItemCode, a.PRNum, p.FullName Medico, p.UDF_TIPO_MEDICO,
    p.UDF_ISR, p.UDF_IVA, ms.MSDescription_ES Especialidad,
    pt.FullName Paciente, so.SO_ST, t.TariffCount, t.Fee, t.Description,
    rt.MinVatRate, rt.MaxVatRate, rt.ItemGroupName,
    CASE WHEN a.PTID IS NULL AND a.PTNum IS NULL THEN 1 ELSE 0 END MissingPatient,
    (SELECT COUNT(*) FROM PCAP x
      WHERE x.PCAPNum<>a.PCAPNum AND x.PRNum=a.PRNum
        AND (x.PTID=a.PTID OR x.PTNum=a.PTNum)
        AND CONVERT(date,x.FromDate)=CONVERT(date,a.FromDate) AND x.PCAP_ST='SH') OtherAppointments,
    (SELECT COUNT(*) FROM SO x JOIN SOLN l ON l.SONum=x.SONum
      WHERE x.PR_RQ=a.PRNum AND (x.PTID=a.PTID OR x.PTNum=a.PTNum)
        AND CONVERT(date,x.CreatedOn)=CONVERT(date,a.FromDate)
        AND l.ItemCode=a.ItemCode AND x.SO_ST<>'CA') OtherOrders,
    (SELECT COUNT(*) FROM PCBL b
      WHERE (b.PR_TX=a.PRNum OR b.PR_PC=a.PRNum)
        AND (b.PTID=a.PTID OR b.PTNum=a.PTNum)
        AND CONVERT(date,b.ChargeDate)=CONVERT(date,a.FromDate)
        AND b.ItemCode=a.ItemCode AND b.LineType='CH') OtherCharges
  FROM PCAP a
  LEFT JOIN PR p ON p.PRNum=a.PRNum
  LEFT JOIN MS ms ON ms.MSCode=p.MSCode
  LEFT JOIN PT pt ON pt.PTNum=a.PTNum
  LEFT JOIN SO so ON so.SONum=a.SONum
  LEFT JOIN Tariff t ON t.ITEMCODE=a.ItemCode
  LEFT JOIN RecordedTax rt ON rt.Medico=p.FullName AND rt.ItemCode=a.ItemCode
  WHERE a.FromDate >= @startDate AND a.FromDate < DATEADD(day,1,CAST(@endDate AS date))
    AND NULLIF(LTRIM(RTRIM(a.ItemCode)),'') IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM SOLN l WHERE l.SONum=a.SONum)
    AND NOT EXISTS (SELECT 1 FROM UDR_HON_PAGO v WHERE v.UDRKey=CONCAT('CITA-',a.PCAPNum))
  ORDER BY a.FromDate,a.PCAPNum`;

function mergeRecoveredAppointments(originalRows, candidates) {
  const rows = originalRows.map(row => ({ ...row, FuenteHonorario: 'Liquidación clínica' }));
  const coverage = { candidates: candidates.length, recoveredAppointments: 0, recoveredBase: 0, pendingAppointments: 0, duplicateCandidates: 0 };
  const seen = new Set();
  for (const candidate of candidates) {
    const key = `CITA-${candidate.PCAPNum}`;
    const existing = rows.filter(row => String(row.UDRKey) === key);
    // Un renglón con concepto ya está representado: no agregar otro ni cambiarlo.
    if (seen.has(key) || existing.some(row => row.CodigoServicio) || existing.length > 1) {
      coverage.duplicateCandidates += 1;
      continue;
    }
    seen.add(key);
    const original = existing[0];
    const fee = numberOrNull(candidate.Fee);
    const valid = candidate.PCAP_ST === 'SH' && candidate.UDF_Ejecutada === true
      && candidate.SO_ST !== 'CA' && candidate.TariffCount === 1 && fee > 0
      && !!String(candidate.Medico || '').trim() && !!candidate.PRNum && !!candidate.ItemCode
      && candidate.MissingPatient === 0 && candidate.OtherAppointments === 0
      && candidate.OtherOrders === 0 && candidate.OtherCharges === 0;
    const registeredVat = numberOrNull(candidate.UDF_IVA);
    const minVat = numberOrNull(candidate.MinVatRate);
    const maxVat = numberOrNull(candidate.MaxVatRate);
    const vatRate = [0,8,16].includes(registeredVat) ? registeredVat / 100
      : minVat !== null && minVat === maxVat && [0,0.08,0.16].includes(minVat) ? minVat : null;
    const sourceIsr = numberOrNull(candidate.UDF_ISR);
    const isr = [0,0.1,0.0125].includes(sourceIsr) ? sourceIsr : [10,1.25].includes(sourceIsr) ? sourceIsr / 100 : null;
    const issues = [
      candidate.PCAP_ST !== 'SH' && 'La cita no está marcada como llegada',
      candidate.UDF_Ejecutada !== true && 'La cita no está marcada como realizada',
      candidate.OtherAppointments > 0 && 'Existe otra cita del mismo paciente y médico ese día',
      candidate.OtherOrders > 0 && 'Existe una orden del mismo servicio, paciente y médico ese día',
      candidate.OtherCharges > 0 && 'Existe un cargo del mismo servicio, paciente y médico ese día; revisar la atención vinculada',
      candidate.TariffCount !== 1 && 'Tabulador inexistente o ambiguo',
      !(fee > 0) && 'Falta una base positiva en el tabulador',
      candidate.MissingPatient !== 0 && 'Falta identificación del paciente',
      candidate.SO_ST === 'CA' && 'Orden cancelada'
    ].filter(Boolean);
    const reason = valid
      ? 'Cita marcada como llegada y realizada; concepto tomado de la cita y base del tabulador único. No tiene líneas de orden de venta. Una unidad por cita; preliquidación sujeta a revisión.'
      : `${issues.join('. ') || 'Revisar identidad y realización de la cita'}. Requiere decisión del revisor.`;
    const row = {
      ...original, UDRKey: key, RenglonAuditoria: original?.RenglonAuditoria ?? 1,
      FolioAtencion: candidate.PCAPNum, FolioCita: candidate.PCAPNum,
      FechaAtencion: candidate.FechaAtencion, FolioOrdenVenta: candidate.SONum,
      OrigenRenglon: 'CITA_REALIZADA_SIN_ORDEN', FuenteHonorario: 'Cita sin orden de venta',
      EstadoVertical: null,
      Medico: candidate.Medico, MedicoId: candidate.PRNum, Paciente: candidate.Paciente || original?.Paciente,
      Cliente: original?.Cliente || 'Sin pagador vinculado', Especialidad: candidate.Especialidad || original?.Especialidad,
      TipoMedico: candidate.UDF_TIPO_MEDICO, CodigoServicio: candidate.ItemCode,
      Servicio: candidate.Description || 'Concepto de cita pendiente de tabulador',
      GrupoServicio: candidate.ItemGroupName || 'Servicios de cita', Cantidad: 1,
      PrecioCobradoPaciente: null, BaseImporte: candidate.TariffCount === 1 && fee > 0 ? roundMoney(fee) : null,
      IvaLinea: candidate.TariffCount === 1 && fee > 0 && vatRate !== null ? roundMoney(fee * vatRate) : null,
      TasaIVAPropuesta: vatRate, RequiereRevision: true,
      TasaISR: isr, ElegiblePago: 0, IntegridadBaseValida: valid ? 1 : 0,
      SinTabulador: candidate.TariffCount !== 1 || !(fee > 0) ? 1 : 0,
      TieneSO: candidate.SONum ? 1 : 0, TieneCita: 1, MatchMedico: 1,
      PasaCatalogoHonorarios: candidate.TariffCount === 1, PasaIncluidoHonorarios: valid,
      MensajeAuditoria: reason, MotivoExclusionOriginal: original?.MotivoExclusionOriginal || '',
      ObservacionCobertura: `${reason} IVA: ${vatRate === null ? 'pendiente; no se supone exención' : registeredVat !== null ? 'tasa registrada del prestador' : 'tasa coincidente de la liquidación del mismo médico y servicio en este periodo'}.`
    };
    if (original) rows[rows.indexOf(original)] = row;
    else rows.push(row);
    if (valid) { coverage.recoveredAppointments += 1; coverage.recoveredBase = roundMoney(coverage.recoveredBase + fee); }
    else coverage.pendingAppointments += 1;
  }
  return { rows, coverage };
}

async function recoverHonorariosCoverage(pool, rows, startDate, endDate) {
  const result = await pool.request().input('startDate', startDate).input('endDate', endDate).query(APPOINTMENT_RECOVERY_SQL);
  return mergeRecoveredAppointments(rows, result.recordset);
}

async function getClinicalProviderDirectory(pool) {
  const result = await pool.request().query(`SELECT PRNum,FullName FROM PR WHERE Role='P' AND NULLIF(LTRIM(RTRIM(FullName)),'') IS NOT NULL`);
  return result.recordset;
}

module.exports = { recoverHonorariosCoverage, mergeRecoveredAppointments, getClinicalProviderDirectory, APPOINTMENT_RECOVERY_SQL };
