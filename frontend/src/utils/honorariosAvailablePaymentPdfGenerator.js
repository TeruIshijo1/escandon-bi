import { jsPDF } from 'jspdf';
import { ESCANDON_LOGO_BASE64 } from './escandonLogo';
import { formatHonorariosPdfText } from './honorariosPdfText';
import { multiplyHonorario } from './honorariosMoney';

const FIELDS = { base: 'baseAmount', vat: 'vat', isr: 'isr', vatWithholding: 'vatWithholding', net: 'netAmount' };
const OPTIONAL = new Set(['isr', 'vatWithholding', 'net']);
const text = value => String(value ?? '').trim();
const invalid = () => new Error('No se puede generar el PDF con estos datos. Actualiza los servicios aprobados del médico e intenta de nuevo.');
const day = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
function cents(value, optional = false) {
  if (value === null && optional) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid();
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(rounded - scaled) > .00001) throw invalid();
  return rounded;
}
function sum(values) {
  if (values.includes(null)) return null;
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result)) throw invalid();
  return result;
}
function totalsMatch(totals, items) {
  if (!totals || typeof totals !== 'object') throw invalid();
  for (const field of Object.keys(FIELDS)) {
    if (cents(totals[field], OPTIONAL.has(field)) !== sum(items.map(item => item[field]))) throw invalid();
  }
}

/** Valida el reporte fresco de aprobaciones; conserva los impuestos desconocidos como null. */
export function validateHonorariosAvailablePaymentReport(report) {
  if (!report || report.version !== 1 || report.currency !== 'MXN'
    || !['AVAILABLE', 'FISCAL_PENDING'].includes(report.status)
    || !day(report.period?.startDate) || !day(report.period?.endDate)
    || report.period.startDate > report.period.endDate
    || !text(report.generatedAt) || !Number.isFinite(new Date(report.generatedAt).getTime())
    || !Array.isArray(report.doctors) || !report.doctors.length) throw invalid();
  const providers = new Set();
  const rows = new Set();
  const summaries = [];
  let pending = false;
  for (const doctor of report.doctors) {
    const id = text(doctor.providerId);
    if (!id || providers.has(id) || !text(doctor.providerName)
      || typeof doctor.fiscal?.ready !== 'boolean' || !Array.isArray(doctor.lines) || !doctor.lines.length) throw invalid();
    providers.add(id);
    const amounts = [];
    let doctorPending = false;
    for (const line of doctor.lines) {
      const rowId = text(line.rowId);
      const fixedMonthly = line.sourceType === 'BI_FIJO_MENSUAL';
      const inPeriod = fixedMonthly
        ? typeof line.month === 'string' && /^\d{4}-\d{2}$/.test(line.month)
          && line.serviceDate === `${line.month}-01` && line.quantity === 1
          && line.month >= report.period.startDate.slice(0, 7) && line.month <= report.period.endDate.slice(0, 7)
        : line.serviceDate >= report.period.startDate && line.serviceDate <= report.period.endDate;
      if (!rowId || rows.has(rowId) || text(line.providerId) !== id
        || text(line.providerName).normalize('NFC') !== text(doctor.providerName).normalize('NFC')
        || !text(line.description) || !day(line.serviceDate)
        || !inPeriod
        || typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0
        || ![0, .08, .16].includes(line.vatRate) || cents(line.unitAmount) <= 0) throw invalid();
      rows.add(rowId);
      const values = Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, cents(line[field], OPTIONAL.has(key))]));
      if (cents(multiplyHonorario(line.unitAmount, line.quantity)) !== values.base
        || cents(multiplyHonorario(line.baseAmount, line.vatRate)) !== values.vat) throw invalid();
      const missing = values.isr === null || values.vatWithholding === null;
      if (missing ? values.net !== null : values.net !== values.base + values.vat - values.isr - values.vatWithholding) throw invalid();
      doctorPending ||= missing;
      amounts.push(values);
    }
    if (doctor.fiscal.ready === doctorPending) throw invalid();
    totalsMatch(doctor.totals, amounts);
    summaries.push(Object.fromEntries(Object.keys(FIELDS).map(key => [key, cents(doctor.totals[key], OPTIONAL.has(key))])));
    pending ||= doctorPending;
  }
  if ((report.status === 'FISCAL_PENDING') !== pending) throw invalid();
  totalsMatch(report.totals, summaries);
  return report;
}

const money = value => value === null ? 'Pendiente' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value);
const date = value => text(value).split('-').reverse().join('/');
const addAmounts = (a, b) => a === null || b === null ? null : (Math.round(a * 100) + Math.round(b * 100)) / 100;

/** PDF de servicios aprobados con la información fiscal que ya está disponible. */
export function generateHonorariosAvailablePaymentPdf(report, detailed = true) {
  validateHonorariosAvailablePaymentReport(report);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const margin = 14;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - 18;
  const blue = [0, 70, 135];
  const muted = [82, 104, 129];
  const amber = [153, 90, 15];
  let y;
  let currentDoctor;
  const print = (value, x, atY, options = {}) => doc.text(formatHonorariosPdfText(value), x, atY, options);
  const font = (size = 9, bold = false, color = [30, 41, 59]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
  };
  const header = () => {
    doc.addImage(ESCANDON_LOGO_BASE64, 'PNG', margin, 8, 70, 13);
    font(8, true, blue); print('SERVICIOS APROBADOS', margin + width, 12, { align: 'right' });
    font(8, false, muted); print(detailed ? 'PDF detallado · MXN' : 'PDF resumido · MXN', margin + width, 17, { align: 'right' });
    print(`Emisión: ${new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(report.generatedAt))}`, margin + width, 21, { align: 'right' });
    doc.setDrawColor(...blue); doc.setLineWidth(.7); doc.line(margin, 25, margin + width, 25); y = 33;
    if (currentDoctor) {
      font(12, true, blue);
      const names = doc.splitTextToSize(formatHonorariosPdfText(currentDoctor.providerName), width);
      doc.text(names, margin, y); y += names.length * 5;
      font(8, false, muted); print(`Médico #${currentDoctor.providerId} · ${date(report.period.startDate)} al ${date(report.period.endDate)}`, margin, y); y += 8;
    }
  };
  const nextPage = () => { doc.addPage(); header(); };
  const ensure = height => { if (y + height > bottom) nextPage(); };
  const paragraph = (value, size = 9, bold = false, color = muted) => {
    font(size, bold, color);
    const lines = doc.splitTextToSize(formatHonorariosPdfText(value), width);
    for (const line of lines) { ensure(size * .45 + 1); font(size, bold, color); print(line, margin, y); y += size * .45; }
    y += 3;
  };
  const totals = value => {
    ensure(42);
    const labels = [['Honorarios aprobados', 'base'], ['IVA confirmado', 'vat'], ['Retención de ISR', 'isr'], ['Retención de IVA', 'vatWithholding'], ['Neto', 'net']];
    for (const [label, key] of labels) {
      font(9, key === 'net', muted); print(label, margin + 3, y);
      font(10, true, value[key] === null ? amber : blue);
      print(`${value[key] !== null && ['isr', 'vatWithholding'].includes(key) ? '-' : ''}${money(value[key])}`, margin + width - 3, y, { align: 'right' }); y += 6;
    }
    y += 5;
  };
  header();
  paragraph('Honorarios médicos', 18, true, blue);
  paragraph(`Servicios del ${date(report.period.startDate)} al ${date(report.period.endDate)}`, 10);
  if (report.status === 'FISCAL_PENDING') {
    paragraph('Información fiscal pendiente', 11, true, amber);
    paragraph('Los servicios y el IVA confirmado están incluidos. Las retenciones y el neto pendientes se completarán al configurar la información fiscal del médico.');
  }
  if (report.doctors.length > 1) totals(report.totals);
  for (let index = 0; index < report.doctors.length; index += 1) {
    const doctor = report.doctors[index];
    currentDoctor = doctor;
    if (index > 0) nextPage();
    else {
      paragraph(doctor.providerName, 13, true, blue);
      paragraph(`Médico #${doctor.providerId}`, 8);
    }
    paragraph(`RFC: ${text(doctor.fiscal.federalTaxId) || 'Pendiente'} · Régimen fiscal: ${text(doctor.fiscal.fiscalRegime) || 'Pendiente'}`, 8);
    totals(doctor.totals);
    paragraph(detailed ? 'Detalle de los servicios aprobados' : 'Resumen de los servicios aprobados', 11, true, blue);
    let lines = doctor.lines;
    if (!detailed) {
      const groups = new Map();
      for (const line of lines) {
        const key = `${line.sourceType}|${line.description}|${line.vatRate}`;
        const group = groups.get(key);
        if (!group) groups.set(key, { ...line });
        else {
          group.quantity += line.quantity;
          for (const field of Object.values(FIELDS)) group[field] = addAmounts(group[field], line[field]);
        }
      }
      lines = [...groups.values()];
    }
    lines.forEach((line, lineIndex) => {
      ensure(42);
      paragraph(`${lineIndex + 1}. ${line.description}`, 10, true, blue);
      if (detailed) {
        paragraph(`${date(line.serviceDate)}${line.patient ? ` · Paciente: ${line.patient}` : ''}`, 8);
        const references = [['Atención', line.attention], ['Cita', line.appointment], ['Orden de venta', line.salesOrder]]
          .filter(([, value]) => value != null && text(value)).map(([label, value]) => `${label} #${value}`);
        if (references.length) paragraph(references.join(' · '), 8);
        paragraph(line.sourceType === 'BI_FIJO_MENSUAL'
          ? `Pago fijo mensual completo de ${line.month}: ${money(line.baseAmount)} antes de impuestos.`
          : `Cantidad: ${line.quantity} × tarifa: ${money(line.unitAmount)} = honorarios: ${money(line.baseAmount)}`, 8);
      } else paragraph(`Cantidad: ${line.quantity} · Honorarios: ${money(line.baseAmount)}`, 8);
      paragraph(`IVA: ${money(line.vat)} · ISR: ${money(line.isr)} · Retención IVA: ${money(line.vatWithholding)} · Neto: ${money(line.netAmount)}`, 8);
      doc.setDrawColor(219, 229, 239); doc.line(margin, y, margin + width, y); y += 7;
    });
  }
  for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
    doc.setPage(page); doc.setDrawColor(219, 229, 239); doc.line(margin, bottom + 5, margin + width, bottom + 5);
    font(7, false, muted); print('Hospital Escandón · Servicios aprobados', margin, bottom + 10);
    print(`Página ${page} de ${doc.getNumberOfPages()}`, margin + width, bottom + 10, { align: 'right' });
  }
  const ids = report.doctors.map(doctor => text(doctor.providerId).replace(/[^a-zA-Z0-9_-]/g, '_')).join('_');
  doc.save(`Honorarios_${detailed ? 'Detallado' : 'Resumido'}_${ids}_${report.period.startDate}_${report.period.endDate}${report.status === 'FISCAL_PENDING' ? '_Fiscal_pendiente' : ''}.pdf`);
  return true;
}
