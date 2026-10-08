import { jsPDF } from 'jspdf';
import { ESCANDON_LOGO_BASE64 } from './escandonLogo';
import { formatHonorariosRates } from './honorariosSapDisplay';
import { summarizeHonorarios } from './honorariosCalculation';
import { formatHonorarioReference, formatHonorarioSalesOrder } from './honorariosIdentifiers';
import { filterDoctorReviewRows } from './honorariosEligibility';
import { formatHonorariosPdfText } from './honorariosPdfText';

const PDF_MARGIN = 13;
const PDF_CONTENT_BOTTOM_GAP = 14;

/**
 * Formatea un número como moneda mexicana MXN ($ 1,234.56)
 */
function formatCurrency(val) {
  if (val === null || val === undefined || !Number.isFinite(Number(val))) return 'PENDIENTE';
  const num = Number(val) || 0;
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
}

function readQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : null;
}

const reviewStatusLabel = row => row._reviewStatus === 'APROBADO' ? 'Aprobado'
  : row._reviewStatus === 'RECHAZADO' ? 'Excluido' : 'Por revisar';
const reviewedFee = row => row._reviewStatus === 'APROBADO' && row._effectiveElegible
  ? row._effectiveBase : row.BaseImporte ?? row.BasePropuesta;

function prepareDoctorReview(doctorData, approvedOnly = false) {
  const eligibleRows = filterDoctorReviewRows(doctorData);
  const rows = approvedOnly ? eligibleRows.filter(row => row._reviewStatus === 'APROBADO' && row._effectiveElegible) : eligibleRows;
  const rates = [...new Set(rows.map(row => row._effectiveISRRate).filter(rate => rate !== null && rate !== undefined))].sort((a, b) => a - b);
  return { ...doctorData, approvedOnly, filas: rows, filasRevision: rows, ...summarizeHonorarios(rows),
    tasaISR: rates.length === 1 ? rates[0] : null, tasasISR: rates };
}

/**
 * Obtiene el texto de periodo en formato legible
 */
function getPeriodLabel(startDate, endDate) {
  if (!startDate || !endDate) return 'PERIODO DE SERVICIOS';
  
  const [sYear, sMonth, sDay] = startDate.split('-');
  const [eYear, eMonth, eDay] = endDate.split('-');
  
  const meses = [
    'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
    'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
  ];

  const sMIdx = parseInt(sMonth, 10) - 1;
  const eMIdx = parseInt(eMonth, 10) - 1;

  // Si es un mes completo exacto (ej. 2026-08-01 a 2026-08-31)
  if (sYear === eYear && sMIdx === eMIdx && parseInt(sDay, 10) === 1) {
    const lastDayOfMonth = new Date(parseInt(sYear, 10), sMIdx + 1, 0).getDate();
    if (parseInt(eDay, 10) === lastDayOfMonth) {
      return `HONORARIOS DE ${meses[sMIdx]} ${sYear}`;
    }
  }

  return `SERVICIOS DEL ${sDay}/${sMonth}/${sYear} AL ${eDay}/${eMonth}/${eYear}`;
}

/**
 * Agrupa y suma las filas de un médico por Grupo de Servicio y Descripción de Concepto
 */
function aggregateDoctorServices(filas) {
  const groups = {};

  filas.forEach(row => {
    const value = reviewedFee(row);
    const monto = value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

    const grupo = (row.GrupoServicio || 'SERVICIOS MÉDICOS GENERALES').trim().toUpperCase();
    const concepto = (row.Servicio || row.ItemDescription || 'HONORARIO MÉDICO').trim();
    const codigo = String(row.CodigoServicio || row.ItemCode || '').trim();
    const cant = readQuantity(row.Cantidad);

    if (!groups[grupo]) {
      groups[grupo] = {};
    }

    const status = reviewStatusLabel(row);
    const key = `${codigo}|${concepto}|${status}`;
    if (!groups[grupo][key]) {
      groups[grupo][key] = {
        concepto: `${concepto} - ${status}`,
        cantidad: 0,
        monto: 0
      };
    }

    const group = groups[grupo][key];
    group.cantidad = group.cantidad === null || cant === null ? null : group.cantidad + cant;
    group.monto = group.monto === null || monto === null ? null : group.monto + monto;
  });

  return groups;
}

function drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader = true, continuation = false } = {}) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = PDF_MARGIN;
  const contentWidth = pageWidth - margin * 2;
  try {
    doc.addImage(ESCANDON_LOGO_BASE64, 'PNG', margin, 7, 82, 15);
  } catch (e) {
    console.warn('No se pudo cargar la imagen del logo:', e);
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text('FUNDACIÓN MARÍA ANA MIER DE ESCANDÓN, I.A.P.', pageWidth - margin, 10, { align: 'right' });
  doc.text(`${doctorData.approvedOnly ? 'SERVICIOS APROBADOS' : 'REVISIÓN DE HONORARIOS'}${continuation ? ' - CONTINUACIÓN' : ''}`, pageWidth - margin, 14, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 70, 135);
  doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-MX')}`, pageWidth - margin, 18, { align: 'right' });
  doc.setDrawColor(0, 136, 201);
  doc.setLineWidth(0.6);
  doc.line(margin, 22, pageWidth - margin, 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  doc.setTextColor(15, 23, 42);
  doc.text(doctorData.approvedOnly ? 'SERVICIOS APROBADOS' : 'REVISIÓN DE HONORARIOS', margin, 27, { maxWidth: contentWidth });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0, 70, 135);
  doc.text('Para preparar el pago, genera el PDF desde Pagos y PDF.', margin, 30);

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, 31, contentWidth, 14.5, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0, 70, 135);
  const doctorLabel = formatHonorariosPdfText(doctorData.medico || 'MÉDICO TRATANTE').replace(/\s+/g, ' ').trim();
  while (doc.getTextWidth(doctorLabel) > contentWidth - 8 && doc.getFontSize() > 7.5) doc.setFontSize(doc.getFontSize() - .5);
  doc.text(doctorLabel, margin + 4, 36.5, { maxWidth: contentWidth - 8 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  const tasaIsrLabel = formatHonorariosRates(doctorData);
  doc.text(formatHonorariosPdfText(`ESPECIALIDAD: ${doctorData.especialidad || 'MEDICINA'}  |  RETENCIÓN DE ISR ESTIMADA: ${tasaIsrLabel}`), margin + 4, 42.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(5, 150, 105);
  doc.text(periodInfo.periodLabel, pageWidth - margin - 4, 39.5, { align: 'right' });

  if (!includeTableHeader) return 49;
  let currentY = 49;
  doc.setFillColor(0, 70, 135);
  doc.rect(margin, currentY, contentWidth, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text('CONCEPTO DEL SERVICIO', margin + 3, currentY + 4.1);
  doc.text('CANTIDAD', pageWidth - margin - 50, currentY + 4.1, { align: 'center' });
  doc.text('HONORARIO', pageWidth - margin - 4, currentY + 4.1, { align: 'right' });
  return currentY + 6;
}

function addPdfFooters(doc) {
  const pageCount = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(226, 232, 240);
    doc.line(PDF_MARGIN, pageHeight - 8, pageWidth - PDF_MARGIN, pageHeight - 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Fundación María Ana Mier de Escandón, I.A.P. - Resumen interno de honorarios', PDF_MARGIN, pageHeight - 4);
    doc.text(`Hoja ${page} de ${pageCount}`, pageWidth - PDF_MARGIN, pageHeight - 4, { align: 'right' });
  }
}

/**
 * Renderiza los servicios configurados y su revisión para un médico.
 */
function renderDoctorReceipt(doc, doctorData, periodInfo) {
  // El detalle y el resumen comparten el mismo catálogo autorizado y médico.
  const reviewRows = doctorData.filasRevision || doctorData.filas || [];
  doctorData = { ...doctorData, filas: reviewRows, ...summarizeHonorarios(reviewRows) };
  const pageWidth = doc.internal.pageSize.getWidth(); // 215.9 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 279.4 mm
  const margin = PDF_MARGIN;
  const contentWidth = pageWidth - margin * 2;
  let currentY = drawDoctorPageHeader(doc, doctorData, periodInfo);

  // 4. Renglones Agrupados
  const aggregated = aggregateDoctorServices(doctorData.filas || []);
  const groupNames = Object.keys(aggregated);

  let zebra = false;
  const contentBottom = pageHeight - PDF_CONTENT_BOTTOM_GAP;
  const startContinuationPage = (grupo, continuation = false) => {
    doc.addPage('letter', 'portrait');
    currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { continuation: true });
    doc.setFillColor(224, 242, 254);
    doc.rect(margin, currentY, contentWidth, 4.8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(3, 105, 161);
    doc.text(formatHonorariosPdfText(`  ${grupo}${continuation ? ' - CONTINUACIÓN' : ''}`), margin + 1, currentY + 3.4);
    currentY += 4.8;
  };

  for (const grupo of groupNames) {
    const conceptos = Object.values(aggregated[grupo]).map(concepto => {
      const label = formatHonorariosPdfText(concepto.concepto);
      const lines = doc.splitTextToSize(label, contentWidth - 75);
      return { ...concepto, labelLines: lines, rowHeight: Math.max(4.8, lines.length * 3 + 1.4) };
    });
    const firstRowHeight = conceptos[0]?.rowHeight || 0;
    if (currentY + 4.8 + firstRowHeight > contentBottom) startContinuationPage(grupo);
    else {
      doc.setFillColor(224, 242, 254);
      doc.rect(margin, currentY, contentWidth, 4.8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(3, 105, 161);
      doc.text(formatHonorariosPdfText(`  ${grupo}`), margin + 1, currentY + 3.4);
      currentY += 4.8;
    }

    for (let index = 0; index < conceptos.length; index += 1) {
      const concepto = conceptos[index];
      if (currentY + concepto.rowHeight > contentBottom) startContinuationPage(grupo, true);
      doc.setFillColor(zebra ? 248 : 255, zebra ? 250 : 255, zebra ? 252 : 255);
      doc.rect(margin, currentY, contentWidth, concepto.rowHeight, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(30, 41, 59);
      doc.text(concepto.labelLines, margin + 3, currentY + 3.1);
      doc.text(concepto.cantidad === null ? 'Pendiente' : Number(concepto.cantidad).toFixed(1), pageWidth - margin - 50, currentY + Math.min(concepto.rowHeight - 1, 4.2), { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.text(formatCurrency(concepto.monto), pageWidth - margin - 4, currentY + Math.min(concepto.rowHeight - 1, 4.2), { align: 'right' });
      zebra = !zebra;
      currentY += concepto.rowHeight;
    }
  }

  // Línea inferior de la tabla
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 2.5;

  // 5. Cuadro Financiero / Resumen Fiscal (Alineado a la derecha)
  const summaryWidth = 108;
  const summaryX = pageWidth - margin - summaryWidth;

  const subtotal = doctorData.totalBase;
  const totalIVA = doctorData.totalIVA;
  const totalGross = subtotal === null || totalIVA === null ? null : subtotal + totalIVA;
  
  const tasaIsrLabel = formatHonorariosRates(doctorData);
  const totalISR = doctorData.totalISR;
  const totalRetIVA = doctorData.totalRetIVA;
  const totalNeto = doctorData.totalNeto;
  
  const ivaCalculado = totalIVA;

  const summaryRows = [
    { label: reviewRows.some(row => row.FixedMonthly) ? 'HONORARIOS APROBADOS' : 'ATENCIONES APROBADAS', val: formatCurrency(subtotal), bold: false, color: [51, 65, 85] }
  ];

  if (ivaCalculado !== 0) {
    const vatRates = [...new Set(reviewRows.filter(row => row._effectiveElegible).map(row => row._effectiveVatRate).filter(rate => rate != null))];
    summaryRows.push({ label: vatRates.length === 1 ? `IVA CONFIRMADO (${Math.round(vatRates[0] * 100)}%)` : 'IVA CONFIRMADO', val: formatCurrency(ivaCalculado), bold: false, color: [51, 65, 85] });
    summaryRows.push({ label: 'HONORARIOS + IVA', val: formatCurrency(totalGross), bold: true, color: [15, 23, 42] });
  }

  summaryRows.push({ label: `RETENCIÓN DE ISR ESTIMADA (${tasaIsrLabel})`, val: totalISR === null ? 'PENDIENTE' : `-${formatCurrency(totalISR)}`, bold: false, color: [220, 38, 38] });
  if (totalIVA !== 0) {
    summaryRows.push({ label: 'RETENCIÓN DE IVA', val: totalRetIVA === null ? 'FALTA DATO FISCAL' : `-${formatCurrency(totalRetIVA)}`, bold: false, color: [220, 38, 38] });
  }
  const calculationText = doctorData.fiscalNotes.join(' ');
  const counts = { APROBADO: 0, RECHAZADO: 0, PENDIENTE: 0 };
  reviewRows.forEach(row => { counts[row._reviewStatus] !== undefined ? counts[row._reviewStatus] += 1 : counts.PENDIENTE += 1; });
  const configurationText = reviewRows.some(row => row.FixedMonthly)
    ? 'Las atenciones utilizan su tarifa autorizada. Los pagos fijos mensuales son adicionales y requieren una decisión explícita para incluir el importe completo del mes. Configurar una jefatura no incluye automáticamente su pago.'
    : 'Los servicios de este documento pertenecen al catálogo Aprobados y tienen una tarifa aplicable al médico, su función y la fecha del servicio. La aprobación del catálogo no autoriza automáticamente el pago de cada atención.';
  const legalText = `Revisión: ${counts.APROBADO} aprobados, ${counts.RECHAZADO} excluidos y ${counts.PENDIENTE} por revisar. Solo los conceptos aprobados suman al importe aprobado. La tabla muestra el honorario de cada concepto y su estado.\n\n${configurationText}\n\n${calculationText}\n\nEl importe final se calcula así: honorario + IVA - retención de ISR - retención de IVA. Los impuestos son estimados y pueden variar por redondeo. Si un importe aparece como pendiente, falta revisar o completar información; no significa $0. Este resumen sirve para revisar servicios y no acredita un pago realizado.`;
  const paddingX = 4;
  const paddingY = 2.5;
  const usableWidth = contentWidth - paddingX * 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const splitLegal = doc.splitTextToSize(formatHonorariosPdfText(legalText).replace(/\n{2,}/g, '\n'), usableWidth);
  const lineHeight = 3;
  const legalBoxHeight = splitLegal.length * lineHeight + paddingY * 2;
  const summaryHeight = summaryRows.length * 5.2 + 9;
  if (currentY + summaryHeight > contentBottom) {
    doc.addPage('letter', 'portrait');
    currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
  }

  summaryRows.forEach(sr => {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.rect(summaryX, currentY, summaryWidth, 5.2, 'D');
    
    doc.setFont('helvetica', sr.bold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...sr.color);
    doc.text(sr.label, summaryX + 3, currentY + 3.7);
    doc.text(sr.val, summaryX + summaryWidth - 3, currentY + 3.7, { align: 'right' });
    currentY += 5.2;
  });

  // El importe final incluye únicamente decisiones aprobadas de estas atenciones.
  doc.setFillColor(0, 70, 135);
  doc.rect(summaryX, currentY, summaryWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text(totalNeto == null ? 'NETO POR CALCULAR (MXN)' : 'NETO APROBADO (MXN)', summaryX + 3, currentY + 4.8);
  doc.setFontSize(10);
  doc.text(formatCurrency(totalNeto), summaryX + summaryWidth - 3, currentY + 4.8, { align: 'right' });
  currentY += 9;

  doc.setTextColor(71, 85, 105);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  if (currentY + legalBoxHeight + 3 > contentBottom) {
    doc.addPage('letter', 'portrait');
    currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
  }
  doc.setFillColor(248, 250, 252); doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, currentY, contentWidth, legalBoxHeight, 2, 2, 'FD');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(71,85,105);
  splitLegal.forEach((line, index) => doc.text(line, margin + paddingX, currentY + paddingY + 2.5 + index * lineHeight));
  currentY += legalBoxHeight + 3;
  return currentY;
}

// El detalle conserva las decisiones de revisión de los mismos servicios autorizados.
function renderReviewAppendix(doc, doctorData, periodInfo, detailed, startAtY) {
  const clinical = detailed ? doctorData.filasRevision || doctorData.filas || [] : [];
  if (!clinical.length) return startAtY;
  let y = Number.isFinite(startAtY) ? startAtY + 3 : undefined;
  const nextPage = () => {
    doc.addPage('letter', 'portrait');
    y = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
  };
  const line = (value, bold = false) => {
    const normalized = formatHonorariosPdfText(value).replace(/[\u2013\u2014]/g, '-');
    if (!normalized.trim()) return;
    const lineHeight = 2.5;
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(7); doc.setTextColor(30,41,59);
    const pageHeight = doc.internal.pageSize.getHeight();
    const lines = doc.splitTextToSize(normalized, doc.internal.pageSize.getWidth() - PDF_MARGIN * 2);
    for (const text of lines) {
      if (y > pageHeight - PDF_CONTENT_BOTTOM_GAP - lineHeight) { nextPage(); doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(7); doc.setTextColor(30,41,59); }
      doc.text(text, PDF_MARGIN, y); y += lineHeight;
    }
    y += 0.1;
  };
  const appendBlock = entries => {
    entries = entries.filter(entry => String(entry.value || '').trim());
    if (!entries.length) return;
    let blockHeight = 0;
    for (const entry of entries) {
      doc.setFont('helvetica', entry.bold ? 'bold' : 'normal');
      doc.setFontSize(7);
      const text = formatHonorariosPdfText(entry.value).replace(/[\u2013\u2014]/g, '-');
      const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - PDF_MARGIN * 2);
      blockHeight += lines.length * 2.5 + 0.1;
    }
    if (y + blockHeight > pageHeight - PDF_CONTENT_BOTTOM_GAP && blockHeight <= pageHeight - PDF_CONTENT_BOTTOM_GAP - 49) nextPage();
    entries.forEach(entry => line(entry.value, entry.bold));
  };
  const pageHeight = doc.internal.pageSize.getHeight();
  if (!Number.isFinite(y) || y > pageHeight - PDF_CONTENT_BOTTOM_GAP - 3.2) nextPage();
  const clinicalEntries = row => {
    const approved = row._effectiveElegible === true;
    const reviewedBase = reviewedFee(row);
    return [
      { value: row.FixedMonthly ? `Mes ${row.FeeMonth} | Pago fijo mensual | ${reviewStatusLabel(row)}` : `${String(row.FechaAtencion || '').slice(0,10)} | ${formatHonorarioReference(row)} | ${formatHonorarioSalesOrder(row)} | ${reviewStatusLabel(row)} | ${row.FuenteHonorario || 'Atención clínica'}`, bold: true },
      { value: `${row.Servicio || 'Servicio por confirmar'}. ${row.FixedMonthly ? `Pago fijo mensual completo de ${row.FeeMonth}, adicional a servicios` : `Paciente: ${row.Paciente || 'Sin identificar'}`}. Honorario ${approved ? 'aprobado' : 'propuesto'}: ${formatCurrency(reviewedBase)}; ${approved ? `importe final aprobado: ${formatCurrency(row._effectiveNeto)}` : 'importe que suma al total aprobado: $0.00'}.` },
      { value: `${row._effectiveMotivo || ''} ${row._reviewer ? `Revisor: ${row._reviewer}. Fecha: ${row._overrideTimestamp}.` : ''}` }
    ];
  };
  if (clinical.length) {
    const firstRow = clinicalEntries(clinical[0]);
    appendBlock([{ value: clinical.some(row => row.FixedMonthly) ? 'DETALLE DE SERVICIOS Y PAGOS MENSUALES' : 'DETALLE DE REVISIÓN DE ATENCIONES', bold: true }, ...firstRow]);
    clinical.slice(1).forEach(row => appendBlock(clinicalEntries(row)));
  }
  return y;
}

function renderFinalSignature(doc, doctorData, periodInfo, startAtY) {
  const margin = PDF_MARGIN;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const contentBottom = pageHeight - PDF_CONTENT_BOTTOM_GAP;
  let currentY = Number.isFinite(startAtY) ? startAtY + 3 : contentBottom;

  if (currentY + 26 > contentBottom) {
    doc.addPage('letter', 'portrait');
    const headerEndY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
    currentY = Math.max(headerEndY, contentBottom - 31);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 70, 135);
  doc.text('FIRMA', margin, currentY + 3);
  currentY += 13;

  const signatureWidth = contentWidth / 2;
  const center = pageWidth / 2;
  const physicianName = formatHonorariosPdfText(doctorData.medico).trim() || 'Médico no identificado';

  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.35);
  const nameWidth = signatureWidth - 10;
  doc.line(center - nameWidth / 2, currentY, center + nameWidth / 2, currentY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 41, 59);
  const nameFontSize = Math.min(8, Math.max(6.5, 8 * nameWidth / Math.max(doc.getTextWidth(physicianName), 1)));
  doc.setFontSize(nameFontSize);
  doc.text(physicianName, center, currentY + 5.8, { align: 'center', maxWidth: nameWidth });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('MÉDICO / PRESTADOR', center, currentY + 10.5, { align: 'center' });
}

/**
 * Genera y descarga la revisión de servicios autorizados de un médico
 */
export function generateDoctorHonorariosPdf(doctorData, startDate, endDate, includeZeroAmounts = true, _generatedBy = '', approvedOnly = false) {
  doctorData = prepareDoctorReview(doctorData, approvedOnly);
  if (!doctorData.filasRevision.length) return false;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter'
  });

  const periodLabel = getPeriodLabel(startDate, endDate);
  const receiptEndY = renderDoctorReceipt(doc, doctorData, { startDate, endDate, periodLabel });
  const appendixEndY = renderReviewAppendix(doc, doctorData, { startDate, endDate, periodLabel }, includeZeroAmounts, receiptEndY);
  renderFinalSignature(doc, doctorData, { startDate, endDate, periodLabel }, appendixEndY ?? receiptEndY);
  addPdfFooters(doc);

  const cleanName = (doctorData.medico || 'Medico').replace(/[^a-zA-Z0-9]/g, '_');
  const typeStr = includeZeroAmounts ? 'Detallado' : 'Resumido';
  doc.save(`${approvedOnly ? 'Honorarios_Aprobados' : 'Resumen_Honorarios'}_${typeStr}_${cleanName}_${startDate}_a_${endDate}.pdf`);
  return true;
}

/**
 * Genera y descarga la revisión de todos los médicos con servicios autorizados
 */
export function generateAllDoctorsHonorariosPdf(doctorsList, startDate, endDate, includeZeroAmounts = true, _generatedBy = '', approvedOnly = false) {
  const eligibleDoctors = (doctorsList || []).map(doctor => prepareDoctorReview(doctor, approvedOnly)).filter(doctor => doctor.filasRevision.length);
  if (!eligibleDoctors.length) return false;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter'
  });

  const periodLabel = getPeriodLabel(startDate, endDate);
  eligibleDoctors.forEach((doctor, idx) => {
    if (idx > 0) {
      doc.addPage('letter', 'portrait');
    }
    const receiptEndY = renderDoctorReceipt(doc, doctor, { startDate, endDate, periodLabel });
    const appendixEndY = renderReviewAppendix(doc, doctor, { startDate, endDate, periodLabel }, includeZeroAmounts, receiptEndY);
    renderFinalSignature(doc, doctor, { startDate, endDate, periodLabel }, appendixEndY ?? receiptEndY);
  });

  addPdfFooters(doc);
  const typeStr = includeZeroAmounts ? 'Detallados' : 'Resumidos';
  doc.save(`${approvedOnly ? 'Honorarios_Aprobados' : 'Resumen_Honorarios'}_${typeStr}_Completos_${startDate}_a_${endDate}.pdf`);
  return true;
}
