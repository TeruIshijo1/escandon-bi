import { jsPDF } from 'jspdf';
import { formatHonorariosPdfText } from './honorariosPdfText';
import { ESCANDON_LOGO_BASE64 } from './escandonLogo';
import { multiplyHonorario } from './honorariosMoney';

const MONEY_FIELDS = ['base', 'vat', 'isr', 'vatWithholding', 'net', 'adjustments', 'paid', 'balance', 'payable'];
const LINE_FIELDS = { base: 'baseAmount', vat: 'vat', isr: 'isr', vatWithholding: 'vatWithholding',
  net: 'netAmount', adjustments: 'adjustmentAmount', paid: 'paidAmount', balance: 'balance' };
const text = value => String(value ?? '').trim();
const sameName = (a, b) => text(a).normalize('NFC') === text(b).normalize('NFC');
const invalid = detail => new Error(`No se puede generar el PDF de pago: ${detail}. Actualiza el cierre y revisa la información en Pagos y PDF.`);

function cents(value, label, signed = false) {
  if (typeof value !== 'number'
    || !Number.isFinite(Number(value))) throw invalid(`falta un importe válido de ${label}`);
  const scaled = Number(value) * 100;
  const result = Math.round(scaled);
  if (!Number.isSafeInteger(result) || Math.abs(scaled - result) > 0.00001 || (!signed && result < 0)) {
    throw invalid(`el importe de ${label} necesita revisión`);
  }
  return result;
}

function baseCents(unitAmount, quantity) {
  try { return cents(multiplyHonorario(unitAmount, quantity), 'honorario calculado'); }
  catch { throw invalid('la cantidad y la tarifa del servicio necesitan revisión'); }
}

const totalCents = (values, label) => {
  const result = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(result)) throw invalid(`el total de ${label} necesita revisión`);
  return result;
};
const validDate = value => {
  const day = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(new Date(value).getTime())) return false;
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
};

function readTotals(totals, label) {
  if (!totals || typeof totals !== 'object') throw invalid(`falta el resumen de ${label}`);
  return Object.fromEntries(MONEY_FIELDS.map(key => [key, cents(totals[key], label, key === 'adjustments')]));
}

/** Revisa identidades y sumas del informe autorizado; no aplica tasas fiscales. */
export function validateHonorariosPaymentReport(report) {
  if (!report || report.version !== 1 || report.currency !== 'MXN' || !['READY', 'PAID'].includes(report.status)
    || !Array.isArray(report.issues) || report.issues.length) throw invalid('el cierre tiene datos pendientes de revisión');
  const closing = report.liquidation;
  if (!closing || !text(closing.id) || !validDate(closing.startDate) || !validDate(closing.endDate)
    || new Date(closing.startDate) > new Date(closing.endDate) || !validDate(closing.createdAt)
    || !validDate(report.generatedAt) || !text(closing.createdBy)
    || !Array.isArray(report.doctors) || !report.doctors.length) throw invalid('faltan datos del cierre o de sus médicos');
  const globalTotals = readTotals(report.totals, 'cierre');
  const providerIds = new Set();
  const rowIds = new Set();
  const movementIds = new Set();
  const doctors = [];
  for (const doctor of report.doctors) {
    const providerId = text(doctor.providerId);
    if (!providerId || !text(doctor.providerName) || providerIds.has(providerId)
      || !Array.isArray(doctor.lines) || !doctor.lines.length
      || !Array.isArray(doctor.payments) || !Array.isArray(doctor.adjustments)) {
      throw invalid('no se puede identificar por separado cada médico y sus servicios');
    }
    providerIds.add(providerId);
    const totals = readTotals(doctor.totals, `médico ${providerId}`);
    const lineAmounts = new Map();
    for (const line of doctor.lines) {
      const rowId = text(line.rowId);
      if (!rowId || rowIds.has(rowId) || text(line.providerId) !== providerId
        || !sameName(line.providerName, doctor.providerName) || !text(line.description) || !validDate(line.serviceDate)) {
        throw invalid('hay un servicio repetido, incompleto o asignado a otro médico');
      }
      rowIds.add(rowId);
      const values = Object.fromEntries(Object.entries(LINE_FIELDS).map(([field, key]) =>
        [field, cents(line[key], `servicio del médico ${providerId}`, field === 'adjustments')]));
      const quantity = Number(line.quantity);
      const unit = cents(line.unitAmount, 'tarifa');
      if (typeof line.quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || unit <= 0
        || baseCents(line.unitAmount, quantity) !== values.base
        || values.base + values.vat - values.isr - values.vatWithholding !== values.net
        || values.net + values.adjustments - values.paid !== values.balance) {
        throw invalid('los honorarios, impuestos o saldos de un servicio no coinciden');
      }
      lineAmounts.set(rowId, values);
    }
    for (const [kind, records] of [['paid', doctor.payments], ['adjustments', doctor.adjustments]]) {
      const amounts = new Map();
      const references = new Set();
      for (const record of records) {
        const rowId = text(record.row_id);
        const referenceKey = `${rowId}|${text(record.reference)}`;
        const amount = cents(record.amount, kind === 'paid' ? 'pago' : 'ajuste', kind === 'adjustments');
        const movementKey = text(record.id) ? `${kind}|${record.id}` : null;
        if (!lineAmounts.has(rowId) || !text(record.reference) || !text(record.reason) || !text(record.created_by)
          || !validDate(kind === 'paid' ? record.payment_date : record.created_at)
          || (record.liquidation_id != null && text(record.liquidation_id) !== text(closing.id))
          || (movementKey && movementIds.has(movementKey))
          || amount === 0 || (kind === 'paid' && references.has(referenceKey))) {
          throw invalid('falta confirmar la referencia, fecha o servicio de un pago o ajuste');
        }
        references.add(referenceKey);
        if (movementKey) movementIds.add(movementKey);
        amounts.set(rowId, totalCents([amounts.get(rowId) || 0, amount], 'movimientos'));
      }
      for (const [rowId, values] of lineAmounts) {
        if ((amounts.get(rowId) || 0) !== values[kind]) throw invalid('los pagos o ajustes no coinciden con el saldo del servicio');
      }
    }
    for (const field of Object.keys(LINE_FIELDS)) {
      if (totalCents([...lineAmounts.values()].map(values => values[field]), field) !== totals[field]) {
        throw invalid('el resumen del médico no coincide con sus servicios');
      }
    }
    if (totals.payable !== totals.balance) throw invalid('el importe a pagar no coincide con el saldo del médico');
    doctors.push(totals);
  }
  for (const field of MONEY_FIELDS) {
    if (totalCents(doctors.map(values => values[field]), field) !== globalTotals[field]) {
      throw invalid('el total del cierre no coincide con los importes de sus médicos');
    }
  }
  if ((report.status === 'PAID' && globalTotals.balance !== 0)
    || (report.status === 'READY' && globalTotals.balance <= 0)) throw invalid('el estado del cierre no coincide con su saldo');
  return report;
}

const money = value => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value));
const signedMoney = value => `${Number(value) > 0 ? '+' : ''}${money(value)}`;
const date = value => {
  if (!value) return 'Sin fecha registrada';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value).split('-').reverse().join('/');
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(value));
};

/** Documento de pago basado exclusivamente en el cierre y su historial guardado. */
export function generateHonorariosPaymentPdf(report) {
  validateHonorariosPaymentReport(report);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const margin = 14;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - 17;
  const blue = [0, 70, 135];
  const muted = [82, 104, 129];
  let y = 0;
  let currentDoctor = null;
  const print = (value, x, atY, options = {}) => doc.text(formatHonorariosPdfText(value), x, atY, options);
  const font = (size = 9, bold = false, color = [30, 41, 59]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const header = () => {
    doc.addImage(ESCANDON_LOGO_BASE64, 'PNG', margin, 8, 70, 13);
    font(8, true, blue);
    print(report.status === 'PAID' ? 'CIERRE SIN SALDO PENDIENTE' : 'PREPARACIÓN DE PAGO DE HONORARIOS', margin + width, 12, { align: 'right' });
    font(8, false, muted);
    print(`Cierre #${report.liquidation.id} · MXN`, margin + width, 17, { align: 'right' });
    print(`Emisión: ${date(report.generatedAt)}`, margin + width, 21, { align: 'right' });
    doc.setDrawColor(...blue); doc.setLineWidth(0.7); doc.line(margin, 25, margin + width, 25);
    y = 33;
    if (currentDoctor) {
      font(12, true, blue);
      const nameLines = doc.splitTextToSize(formatHonorariosPdfText(currentDoctor.providerName), width);
      doc.text(nameLines, margin, y); y += nameLines.length * 5;
      font(8, false, muted); print(`Médico #${currentDoctor.providerId} · Servicios del ${date(report.liquidation.startDate)} al ${date(report.liquidation.endDate)}`, margin, y); y += 7;
    }
  };
  const nextPage = () => { doc.addPage(); header(); };
  const ensure = height => { if (y + height > bottom) nextPage(); };
  const paragraph = (value, { size = 8.5, bold = false, color = muted, indent = 0, gap = 3 } = {}) => {
    font(size, bold, color);
    const lines = doc.splitTextToSize(formatHonorariosPdfText(value), width - indent * 2);
    const height = size * 0.44;
    for (const line of lines) {
      ensure(height + 1); font(size, bold, color); print(line, margin + indent, y); y += height;
    }
    y += gap;
  };
  const section = label => {
    ensure(13); doc.setFillColor(234, 243, 252); doc.roundedRect(margin, y - 4, width, 8, 1.5, 1.5, 'F');
    font(10, true, blue); print(label, margin + 3, y + 1); y += 10;
  };
  const totals = value => {
    ensure(54);
    const labels = [['Honorarios', 'base'], ['IVA', 'vat'], ['Retención de ISR', 'isr'], ['Retención de IVA', 'vatWithholding']];
    const cell = width / 4;
    labels.forEach(([label, key], index) => {
      const x = margin + index * cell;
      font(8, false, muted); print(label, x + 3, y + 1);
      font(11, true, blue); print(`${key === 'isr' || key === 'vatWithholding' ? '-' : ''}${money(value[key])}`, x + 3, y + 7);
    });
    y += 14;
    const rows = [['Neto del cierre', money(value.net)], ['Ajustes registrados', signedMoney(value.adjustments)], ['Pagos ya registrados', `-${money(value.paid)}`]];
    rows.forEach(([label, amount]) => {
      font(9, false, muted); print(label, margin + 3, y); font(9, true, blue); print(amount, margin + width - 3, y, { align: 'right' }); y += 5;
    });
    doc.setFillColor(...blue); doc.roundedRect(margin, y - 1, width, 14, 2, 2, 'F');
    font(10, true, [255, 255, 255]); print(Number(value.balance) === 0 ? 'SALDO PENDIENTE: SIN SALDO' : 'SALDO PENDIENTE', margin + 4, y + 7);
    font(16, true, [255, 255, 255]); print(money(value.payable), margin + width - 4, y + 8, { align: 'right' }); y += 20;
  };
  header();
  paragraph('Honorarios médicos', { size: 18, bold: true, color: blue });
  paragraph(`Servicios del ${date(report.liquidation.startDate)} al ${date(report.liquidation.endDate)} · ${report.doctors.length} médico(s)`, { size: 10 });
  totals(report.totals);
  paragraph(`Cierre realizado: ${date(report.liquidation.createdAt)}. Responsable: ${report.liquidation.createdBy}.`);
  if (text(report.liquidation.reason)) paragraph(`Motivo del cierre: ${report.liquidation.reason}`);
  if (text(report.liquidation.fiscalNote)) paragraph(report.liquidation.fiscalNote);
  if (validDate(report.liquidation.sapAsOf)) paragraph(`Información fiscal consultada al cierre: ${date(report.liquidation.sapAsOf)}.`);
  paragraph(report.status === 'PAID' ? 'Este cierre ya no tiene saldo pendiente. Importe a pagar: $0.00.'
    : 'El saldo pendiente considera el neto del cierre, los ajustes y todos los pagos registrados hasta la emisión de este documento.', { bold: true, color: blue });
  section('Saldo por médico');
  report.doctors.forEach(doctor => {
    font(10, true, blue);
    const nameLines = doc.splitTextToSize(formatHonorariosPdfText(`${doctor.providerName} #${doctor.providerId}`), width - 43);
    ensure(nameLines.length * 4.5 + 12);
    font(10, true, blue); doc.text(nameLines, margin + 2, y);
    print(money(doctor.totals.payable), margin + width - 2, y, { align: 'right' });
    y += nameLines.length * 4.5;
    paragraph(`Neto: ${money(doctor.totals.net)} · Ajustes: ${signedMoney(doctor.totals.adjustments)} · Pagos: ${money(doctor.totals.paid)}`, { size: 8, indent: 2, gap: 4 });
  });
  report.doctors.forEach(doctor => {
    currentDoctor = doctor; nextPage();
    totals(doctor.totals);
    section('Servicios incluidos en el cierre');
    const numbers = new Map(doctor.lines.map((line, index) => [text(line.rowId), index + 1]));
    doctor.lines.forEach((line, index) => {
      font(10, true, blue);
      const titleLines = doc.splitTextToSize(formatHonorariosPdfText(`${index + 1}. ${line.description}`), width - 6);
      ensure(Math.min(90, 47 + titleLines.length * 4.4));
      paragraph(`${index + 1}. ${line.description}`, { size: 10, bold: true, color: blue, gap: 2 });
      paragraph(`${date(line.serviceDate)} · ${line.sourceType === 'BI_FIJO_MENSUAL' ? 'Jefe de área' : text(line.role) || 'Función registrada en el cierre'}${line.patient ? ` · Paciente: ${line.patient}` : ''}`, { size: 8, gap: 1.5 });
      const references = [['Atención', line.attention], ['Cita', line.appointment], ['Orden de venta', line.salesOrder]]
        .filter(([, value]) => value !== null && value !== undefined && text(value) !== '').map(([label, value]) => `${label} #${value}`);
      if (references.length) paragraph(references.join(' · '), { size: 8, gap: 1.5 });
      paragraph(line.sourceType === 'BI_FIJO_MENSUAL'
        ? `Pago fijo mensual completo de ${line.month}: ${money(line.baseAmount)} antes de impuestos, adicional a servicios.`
        : `Cantidad: ${line.quantity} × tarifa: ${money(line.unitAmount)} = honorarios: ${money(line.baseAmount)}`, { size: 8, gap: 3 });
      const values = [['Honorarios', line.baseAmount], ['IVA', line.vat], ['ISR retenido', line.isr], ['IVA retenido', line.vatWithholding], ['Neto', line.netAmount]];
      ensure(20); doc.setFillColor(242, 247, 252); doc.roundedRect(margin, y - 2, width, 14, 1.5, 1.5, 'F');
      values.forEach(([label, value], column) => {
        const x = margin + column * width / 5 + 2;
        font(7.5, false, muted); print(label, x, y + 1); font(9, true, blue);
        print(`${column === 2 || column === 3 ? '-' : ''}${money(value)}`, x, y + 7);
      });
      y += 17;
      paragraph(`Ajustes: ${signedMoney(line.adjustmentAmount)} · Pagos: ${money(line.paidAmount)} · Saldo: ${money(line.balance)}`, { size: 9, bold: true, color: blue, gap: 2 });
      const trace = [line.tariff?.id ? `Tarifa #${line.tariff.id}${line.tariff.revision ? `, versión ${line.tariff.revision}` : ''}` : '',
        line.fixed?.assignmentId ? `Jefatura #${line.fixed.assignmentId}, versión ${line.fixed.revision}` : '',
        line.reviewer ? `Revisó: ${line.reviewer}` : ''].filter(Boolean).join(' · ');
      if (trace) paragraph(trace, { size: 7.5, gap: 2 });
      doc.setDrawColor(219, 229, 239); doc.line(margin, y, margin + width, y); y += 7;
    });
    const ledger = (label, records, adjustment) => {
      section(label);
      if (!records.length) { paragraph(adjustment ? 'Sin ajustes registrados.' : 'Sin pagos registrados.'); return; }
      records.forEach(record => {
        ensure(25);
        paragraph(`${date(adjustment ? record.created_at : record.payment_date)} · ${adjustment ? signedMoney(record.amount) : money(record.amount)} · Servicio ${numbers.get(text(record.row_id))}`, { size: 9, bold: true, color: blue, gap: 2 });
        paragraph(`Referencia: ${record.reference}`, { size: 8, gap: 1 });
        paragraph(`Motivo: ${record.reason}`, { size: 8, gap: 1 });
        paragraph(`Registró: ${record.created_by}${validDate(record.created_at) ? ` · Registro: ${date(record.created_at)}` : ''}`, { size: 7.5, gap: 5 });
      });
    };
    ledger('Pagos ya registrados', doctor.payments, false);
    ledger('Ajustes registrados', doctor.adjustments, true);
    paragraph('Saldo pendiente = neto del cierre + ajustes registrados - pagos registrados. Los honorarios e impuestos corresponden a los importes guardados al cerrar.', { size: 8, color: blue });
  });
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page); doc.setDrawColor(219, 229, 239); doc.line(margin, bottom + 5, margin + width, bottom + 5);
    font(7, false, muted); print(`Cierre #${report.liquidation.id} · Saldos al ${date(report.generatedAt)}`, margin, bottom + 10);
    print(`Página ${page} de ${pageCount}`, margin + width, bottom + 10, { align: 'right' });
  }
  const cleanId = text(report.liquidation.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Honorarios_Pago_Cierre_${cleanId}_${report.status === 'PAID' ? 'Sin_saldo' : 'Saldo_pendiente'}.pdf`);
  return true;
}
