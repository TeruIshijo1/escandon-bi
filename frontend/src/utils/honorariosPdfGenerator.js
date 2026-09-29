import { jsPDF } from 'jspdf';
import { ESCANDON_LOGO_BASE64 } from './escandonLogo';
import { formatConfiguredWithholdings, formatHonorariosRates } from './honorariosSapDisplay';
import { summarizeHonorarios } from './honorariosCalculation';

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

function formatSapCurrency(currency) {
  return currency === 'LCY' ? 'Moneda de SAP' : currency || 'Moneda no informada';
}

function formatSapAmount(val, currency) {
  if (val === null || val === undefined || val === '' || !Number.isFinite(Number(val))) return 'No disponible';
  const amount = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val) || 0);
  return `${formatSapCurrency(currency)} ${amount}`;
}

function readQuantity(value) {
  if (value === null || value === undefined || value === '') return 1;
  const quantity = Number(value);
  return Number.isFinite(quantity) ? quantity : 1;
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
function aggregateDoctorServices(filas, includeZeroAmounts = true) {
  const groups = {};

  filas.forEach(row => {
    if (row.TipoCalculo === 'SAP_DOCUMENTO') return;
    // Si existe estado efectivo, respeta el ajuste manual aunque el origen fuera elegible.
    const isEligible = row._effectiveElegible !== undefined
      ? row._effectiveElegible
      : Number(row.ElegiblePago) === 1;
    if (!isEligible) return;

    const monto = Number(row._effectiveBase !== undefined ? row._effectiveBase : row.BaseImporte) || 0;
    
    // Ocultar conceptos en ceros si no se pide formato detallado
    if (!includeZeroAmounts && monto === 0) return;

    const grupo = (row.GrupoServicio || 'SERVICIOS MÉDICOS GENERALES').trim().toUpperCase();
    const concepto = (row.Servicio || row.ItemDescription || 'HONORARIO MÉDICO').trim();
    const codigo = String(row.CodigoServicio || row.ItemCode || '').trim();
    const cant = readQuantity(row.Cantidad);

    if (!groups[grupo]) {
      groups[grupo] = {};
    }

    const key = `${codigo}|${concepto}`;
    if (!groups[grupo][key]) {
      groups[grupo][key] = {
        concepto,
        cantidad: 0,
        monto: 0
      };
    }

    groups[grupo][key].cantidad += cant;
    groups[grupo][key].monto += monto;
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
  doc.text(continuation ? 'RESUMEN DE HONORARIOS - CONTINUACIÓN' : 'RESUMEN DE HONORARIOS', pageWidth - margin, 14, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 70, 135);
  doc.text(`FECHA DE EMISIÓN: ${new Date().toLocaleDateString('es-MX')}`, pageWidth - margin, 18, { align: 'right' });
  doc.setDrawColor(0, 136, 201);
  doc.setLineWidth(0.6);
  doc.line(margin, 22, pageWidth - margin, 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  doc.setTextColor(15, 23, 42);
  doc.text('HONORARIOS - ATENCIONES Y REVISIONES', margin, 27, { maxWidth: contentWidth });

  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, 31, contentWidth, 14.5, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(0, 70, 135);
  doc.text(doctorData.medico || 'MÉDICO TRATANTE', margin + 4, 36.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.setTextColor(71, 85, 105);
  const tasaIsrLabel = formatHonorariosRates(doctorData);
  doc.text(`ESPECIALIDAD: ${doctorData.especialidad || 'MEDICINA'}  |  RETENCIÓN DE ISR ESTIMADA: ${tasaIsrLabel}`, margin + 4, 42.5);
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
  doc.text('MONTO HONORARIOS', pageWidth - margin - 4, currentY + 4.1, { align: 'right' });
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
 * Renderiza la página completa de liquidación para un médico en el documento jsPDF
 */
function renderDoctorReceipt(doc, doctorData, periodInfo, includeZeroAmounts = true, generatedBy = '') {
  // El detalle puede venir filtrado por estado. El resumen siempre se calcula
  // con el universo de revisión, que incluye aprobados, rechazados y pendientes.
  const reviewRows = doctorData.filasRevision || doctorData.filas || [];
  doctorData = { ...doctorData, filas: reviewRows, ...summarizeHonorarios(reviewRows) };
  const pageWidth = doc.internal.pageSize.getWidth(); // 215.9 mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 279.4 mm
  const margin = PDF_MARGIN;
  const contentWidth = pageWidth - margin * 2;
  let currentY = drawDoctorPageHeader(doc, doctorData, periodInfo);

  // 4. Renglones Agrupados
  const aggregated = aggregateDoctorServices(doctorData.filas || [], includeZeroAmounts);
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
    doc.text(`  ${grupo}${continuation ? ' - CONTINUACIÓN' : ''}`, margin + 1, currentY + 3.4);
    currentY += 4.8;
  };

  for (const grupo of groupNames) {
    const conceptos = Object.values(aggregated[grupo]).map(concepto => {
      const label = concepto.concepto;
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
      doc.text(`  ${grupo}`, margin + 1, currentY + 3.4);
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
      doc.text(Number(concepto.cantidad).toFixed(1), pageWidth - margin - 50, currentY + Math.min(concepto.rowHeight - 1, 4.2), { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.text(formatCurrency(concepto.monto), pageWidth - margin - 4, currentY + Math.min(concepto.rowHeight - 1, 4.2), { align: 'right' });
      zebra = !zebra;
      currentY += concepto.rowHeight;
    }
  }

  // Las líneas contables SAP son visibles en la liquidación aunque la factura
  // siga pendiente o la pestaña actual sólo muestre aprobados. Se etiquetan
  // como referencia para no confundir su importe registrado con base médica.
  const sapInvoices = doctorData.sap?.invoices || [];
  const sapLineRows = sapInvoices.flatMap(invoice => (invoice.lines || []).map((line, index) => ({
    invoice, line, coverage: invoice.verticalLineCoverage?.[index]
  })));
  if (sapLineRows.length) {
    const sectionTitle = 'FACTURAS PARA REVISAR CONTRA LAS ATENCIONES';
    const drawSectionTitle = (continued = false) => {
      doc.setFillColor(224, 242, 254);
      doc.rect(margin, currentY, contentWidth, 4.8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(3, 105, 161);
      doc.text(`${sectionTitle}${continued ? ' - CONTINUACIÓN' : ''}`, margin + 2, currentY + 3.4);
      currentY += 5;
    };
    const drawSapColumnHeader = () => {
      doc.setFillColor(239, 246, 255);
      doc.rect(margin, currentY, contentWidth, 4.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(71, 85, 105);
      doc.text('FACTURA Y CONCEPTO', margin + 2, currentY + 3.3);
      doc.text('CANTIDAD', pageWidth - margin - 50, currentY + 3.3, { align: 'center' });
      doc.text('IMPORTE', pageWidth - margin - 3, currentY + 3.3, { align: 'right' });
      currentY += 4.5;
    };
    if (currentY + 20 > contentBottom) {
      doc.addPage('letter', 'portrait');
      currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
    }
    drawSectionTitle();
    drawSapColumnHeader();

    for (const { invoice, line, coverage } of sapLineRows) {
      const concept = `Factura ${invoice.docNum || invoice.docEntry}${invoice.cancelled ? ' - CANCELADA' : ''} - ${line.description || 'Concepto sin descripción'}`;
      const conceptLines = doc.splitTextToSize(concept, contentWidth - 77);
      const coverageLabel = coverage?.label || 'Aún no se comparó con las atenciones';
      const coverageLines = doc.splitTextToSize(coverageLabel, contentWidth - 77);
      const rowHeight = Math.max(6, (conceptLines.length + coverageLines.length) * 2.6 + 1.8);
      if (currentY + rowHeight + 6 > contentBottom) {
        doc.addPage('letter', 'portrait');
        currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
        drawSectionTitle(true);
        drawSapColumnHeader();
      }

      doc.setFillColor(248, 250, 252);
      doc.rect(margin, currentY, contentWidth, rowHeight, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text(conceptLines, margin + 2, currentY + 2.8);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      doc.setTextColor(coverage?.status === 'NO_LOCALIZADO' ? 180 : 100,
        coverage?.status === 'NO_LOCALIZADO' ? 83 : 116, coverage?.status === 'NO_LOCALIZADO' ? 9 : 139);
      doc.text(coverageLines, margin + 2, currentY + 2.8 + conceptLines.length * 2.6);
      const quantity = Number(line.quantity);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text(Number.isFinite(quantity) && quantity > 0 ? quantity.toFixed(1) : 'No informada', pageWidth - margin - 50, currentY + 3.3, { align: 'center' });
      const amount = invoice.currency === 'MXN' ? formatCurrency(line.recordedAmount) : formatSapAmount(line.recordedAmount, invoice.currency);
      doc.text(amount, pageWidth - margin - 3, currentY + 3.3, { align: 'right' });
      currentY += rowHeight;
    }

    const referenceNote = doc.splitTextToSize(
      'Las atenciones y su estado vienen de Vertical, el sistema donde se registran los servicios. Las facturas se consultan en SAP, el sistema de contabilidad, para encontrar servicios que pudieran faltar. La comparación por descripción es solo una pista: confirma que no sea la misma atención antes de aprobarla. Los importes y cantidades de la factura son una referencia; no reemplazan las atenciones ni su cálculo.',
      contentWidth - 4
    );
    const noteHeight = referenceNote.length * 2.8 + 2;
    if (currentY + noteHeight > contentBottom) {
      doc.addPage('letter', 'portrait');
      currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
      drawSectionTitle(true);
      drawSapColumnHeader();
    }
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    referenceNote.forEach((line, index) => doc.text(line, margin + 2, currentY + 3 + index * 2.8));
    currentY += noteHeight + 1;
  }

  // Línea inferior de la tabla
  doc.setDrawColor(203, 213, 225);
  doc.line(margin, currentY, pageWidth - margin, currentY);
  currentY += 2.5;

  // 5. Cuadro Financiero / Resumen Fiscal (Alineado a la derecha)
  const summaryWidth = 85;
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
    { label: 'ATENCIONES APROBADAS', val: formatCurrency(subtotal), bold: false, color: [51, 65, 85] }
  ];

  if (ivaCalculado !== 0) {
    summaryRows.push({ label: 'IVA', val: formatCurrency(ivaCalculado), bold: false, color: [51, 65, 85] });
    summaryRows.push({ label: 'HONORARIOS + IVA', val: formatCurrency(totalGross), bold: true, color: [15, 23, 42] });
  }

  summaryRows.push({ label: `RETENCIÓN DE ISR ESTIMADA (${tasaIsrLabel})`, val: `-${formatCurrency(totalISR)}`, bold: false, color: [220, 38, 38] });
  if (totalIVA !== 0) {
    summaryRows.push({ label: 'RETENCIÓN DE IVA ESTIMADA', val: totalRetIVA === null ? 'PENDIENTE' : `-${formatCurrency(totalRetIVA)}`, bold: false, color: [220, 38, 38] });
  }
  if (doctorData.approvedDocuments > 0) {
    summaryRows.push({ label: 'IMPORTE FINAL DE ATENCIONES', val: formatCurrency(doctorData.clinicalNet), bold: true, color: [15,23,42] });
    summaryRows.push({ label: 'IMPORTE FINAL DE FACTURAS', val: formatCurrency(doctorData.sapDocumentNet), bold: true, color: [15,23,42] });
  }

  // Se coloca el resumen justo después del detalle; aclaraciones y firmas sólo pasan de hoja si ya no caben.
  const sap = doctorData.sap;
  const sapStatus = sap?.linkStatus === 'solo_sap'
    ? 'Hay facturas en SAP que no están relacionadas con las atenciones de este periodo.'
    : sap?.linkStatus === 'candidato_unico'
    ? `Posible proveedor encontrado en SAP: ${sap.candidates?.[0]?.cardName || 'nombre no disponible'}. Confirma que sea el médico correcto.`
    : sap?.linkStatus === 'ambiguo'
      ? 'Se encontraron varios proveedores con nombres parecidos; no se asignaron facturas para evitar errores.'
      : sap?.linkStatus === 'sin_coincidencia'
        ? 'No se encontró al proveedor en SAP.'
        : 'No se pudieron consultar las facturas de SAP para este resumen.';
  const sapTotalsText = ['candidato_unico', 'solo_sap'].includes(sap?.linkStatus) && sap.totalsByCurrency?.length
    ? sap.totalsByCurrency.map(total => {
      const retentions = (total.withholdings || [])
        .map(item => `${item.description} ${formatSapAmount(item.amount, total.currency)}`).join(', ');
      return `${formatSapCurrency(total.currency)}: ${total.invoiceCount} factura(s); importe total ${formatSapAmount(total.documentTotal, total.currency)}; IVA registrado ${formatSapAmount(total.vatRecorded, total.currency)}; pagado a la fecha ${formatSapAmount(total.paidToDate, total.currency)}; saldo pendiente ${formatSapAmount(total.openBalance, total.currency)}; pagos durante el periodo ${formatSapAmount(total.periodAppliedPayments, total.currency)}${retentions ? `; impuestos retenidos: ${retentions}` : ''}.`;
    }).join(' ')
    : '';
  const candidate = sap?.linkStatus === 'candidato_unico' ? sap.candidates?.[0] : null;
  const fiscalText = candidate ? ` RFC registrado en SAP: ${candidate.federalTaxId || 'no disponible'}. Régimen fiscal registrado: ${candidate.fiscalRegime || 'no disponible'}; confirma que los datos estén actualizados.\n\n${formatConfiguredWithholdings(candidate)} Estos datos son una referencia; se usan los importes que aparecen en cada factura.\n\n` : '';
  const calculationText = doctorData.fiscalNotes.join(' ');
  const counts = { APROBADO: 0, RECHAZADO: 0, PENDIENTE: 0 };
  reviewRows.forEach(row => { counts[row._reviewStatus || 'PENDIENTE'] += 1; });
  const sapPeriod = doctorData.sapPeriod || periodInfo;
  const legalText = `Revisión: ${counts.APROBADO} aprobados, ${counts.RECHAZADO} rechazados y ${counts.PENDIENTE} pendientes. Solo lo aprobado suma al total. Fechas de registro de las facturas en SAP: ${sapPeriod.startDate} al ${sapPeriod.endDate}.\n\n${sapStatus}${fiscalText} ${sapTotalsText}\n\n${calculationText}\n\nEl importe final de cada atención se calcula así: honorario + IVA (impuesto al valor agregado) - ISR (impuesto sobre la renta) - retención de IVA. Los impuestos son estimados y pueden variar por redondeo. Las facturas aprobadas suman el importe final que aparece en SAP; incluye pagos ya realizados, por lo que no indica cuánto falta por pagar. No sumes una factura y una atención si son el mismo servicio. Si un cálculo aparece como pendiente, falta revisar o completar información; no significa $0. Este resumen es de uso interno y no es una factura ni un comprobante de pago.`;
  const paddingX = 4;
  const paddingY = 2.5;
  const usableWidth = contentWidth - paddingX * 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const splitLegal = doc.splitTextToSize(legalText.replace(/\n{2,}/g, '\n'), usableWidth);
  const lineHeight = 3;
  const legalBoxHeight = splitLegal.length * lineHeight + paddingY * 2;
  const conformityText = 'Manifiesto mi conformidad con esta liquidación de honorarios por los servicios profesionales que le presté, sin sujeción a un horario, a la FUNDACIÓN MARÍA ANA MIER DE ESCANDÓN, I.A.P. en el libre ejercicio de mi profesión de médico; en el mes arriba mencionado y para que estos me sean pagados, contra la firma de este documento, entrego Comprobante Fiscal Digital Por Internet, expedido por el suscrito, por lo que no me adeuda cantidad alguna por concepto de honorarios y reitero además que la relación que me une con dicha Fundación es de naturaleza civil por virtud del contrato de prestación de servicios profesionales que tenemos celebrado, reiterando que la única relación existente es la antes mencionada y por ende, no existe ninguna otra ni de naturaleza laboral ni de ninguna otra. Así mismo, con el pago que se me haga de estos honorarios se encuentra pagada cualquier cantidad adeudada por la Fundación, por lo que no me reservo derecho ni acción algunos que ejercitar en contra de esa Fundación, ni en el presente ni en el futuro, por ninguna vía, otorgándoles por este medio el finiquito más amplio que en derecho proceda.';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  const conformityLines = doc.splitTextToSize(conformityText, contentWidth - 12);
  const conformityLineHeight = 3.4;
  const conformityCardHeight = 6 + conformityLines.length * conformityLineHeight;
  const closingBlockHeight = conformityCardHeight + 10;
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

  // El neto de preliquidación y los importes de SAP se presentan por separado.
  doc.setFillColor(0, 70, 135);
  doc.rect(summaryX, currentY, summaryWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text('IMPORTE APROBADO (MXN)', summaryX + 3, currentY + 4.8);
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
  if (currentY + closingBlockHeight > contentBottom) {
    doc.addPage('letter', 'portrait');
    currentY = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
  }

  // 7. Manifiesto de conformidad y firmas de cierre.
  currentY += 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(0, 70, 135);
  doc.text('CONFORMIDAD DEL MÉDICO', margin, currentY + 3);
  currentY += 5;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, currentY, contentWidth, conformityCardHeight, 2, 2, 'FD');
  doc.setFillColor(0, 112, 180);
  doc.rect(margin, currentY + 1, 1.4, conformityCardHeight - 2, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(51, 65, 85);
  conformityLines.forEach((line, index) => {
    doc.text(line, margin + 6, currentY + 4.5 + index * conformityLineHeight);
  });
  currentY += conformityCardHeight + 4;

  return currentY;
}

// Anexo del mismo documento: conserva estados y cifras originales de SAP.
function renderReviewAppendix(doc, doctorData, periodInfo, detailed, startAtY) {
  const reviewRows = doctorData.filasRevision || doctorData.filas || [];
  const documents = reviewRows.filter(row => row.TipoCalculo === 'SAP_DOCUMENTO');
  const clinical = detailed ? reviewRows.filter(row => row.TipoCalculo !== 'SAP_DOCUMENTO') : [];
  if (!documents.length && !clinical.length) return startAtY;
  let y = Number.isFinite(startAtY) ? startAtY + 3 : undefined;
  const nextPage = () => {
    doc.addPage('letter', 'portrait');
    y = drawDoctorPageHeader(doc, doctorData, periodInfo, { includeTableHeader: false, continuation: true });
  };
  const line = (value, bold = false) => {
    const normalized = String(value || '').replace(/[\u2013\u2014]/g, '-');
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
      const text = String(entry.value || '').replace(/[\u2013\u2014]/g, '-');
      const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - PDF_MARGIN * 2);
      blockHeight += lines.length * 2.5 + 0.1;
    }
    if (y + blockHeight > pageHeight - PDF_CONTENT_BOTTOM_GAP && blockHeight <= pageHeight - PDF_CONTENT_BOTTOM_GAP - 49) nextPage();
    entries.forEach(entry => line(entry.value, entry.bold));
  };
  const pageHeight = doc.internal.pageSize.getHeight();
  if (!Number.isFinite(y) || y > pageHeight - PDF_CONTENT_BOTTOM_GAP - 3.2) nextPage();
  const sapPeriod = doctorData.sapPeriod || periodInfo;
  const sapInvoiceEntries = row => {
    const invoice = row.SapDocumento;
    const summary = [
      { value: `Factura ${invoice.docNum} | ${String(invoice.postingDate || '').slice(0,10)} | ${row._reviewStatus}${invoice.cancelled ? ' | CANCELADA' : ''}`, bold: true },
      { value: `Total de la factura: ${formatSapAmount(invoice.documentTotal, invoice.currency)}. Pagado a la fecha: ${formatSapAmount(invoice.paidToDate, invoice.currency)}. Saldo pendiente: ${formatSapAmount(invoice.openBalance, invoice.currency)}.` },
      { value: `Impuestos retenidos: ${(invoice.retentions || []).map(t => `${t.description}: ${formatSapAmount(t.amount,invoice.currency)}`).join('; ') || 'No se recibió el detalle'}.` }
    ];
    const details = [];
    if (detailed) for (const item of invoice.lines || []) {
      const quantity = Number(item.quantity);
      details.push({ value: `${item.description} | Cantidad: ${Number.isFinite(quantity) && quantity > 0 ? quantity : 'No disponible'} | Importe registrado en la factura: ${formatSapAmount(item.recordedAmount, invoice.currency)}` });
    }
    if (invoice.comments) details.push({ value: invoice.comments });
    details.push({ value: `Motivo de la revisión: ${row._overrideMotivo || 'Sin motivo registrado'}. Revisó: ${row._reviewer || 'Aún no revisado'}. ${row._overrideTimestamp || ''}` });
    details.push({ value: `Importe que suma al total aprobado: ${formatCurrency(row._effectiveNeto)}. ${row._fiscalNote}` });
    return { summary, details };
  };
  if (documents.length) {
    documents.forEach((row, index) => {
      const invoice = sapInvoiceEntries(row);
      appendBlock(index === 0
        ? [{ value: `FACTURAS REGISTRADAS EN SAP - ${sapPeriod.startDate} AL ${sapPeriod.endDate}`, bold: true }, ...invoice.summary]
        : invoice.summary);
      invoice.details.forEach(entry => line(entry.value, entry.bold));
    });
  }
  const clinicalEntries = row => {
    const approved = row._effectiveElegible === true;
    const reviewedBase = row._effectiveBase ?? row.BaseImporte ?? row.BasePropuesta;
    return [
      { value: `${String(row.FechaAtencion || '').slice(0,10)} | Folio ${row.FolioAtencion} | ${row._reviewStatus} | ${row.FuenteHonorario || 'Atención clínica'}`, bold: true },
      { value: `${row.Servicio || 'Servicio por confirmar'}. Paciente: ${row.Paciente || 'Sin identificar'}. Honorario ${approved ? 'aprobado' : 'propuesto'}: ${formatCurrency(reviewedBase)}; ${approved ? `importe final aprobado: ${formatCurrency(row._effectiveNeto)}` : 'importe que suma al total aprobado: $0.00'}.` },
      { value: `${row._effectiveMotivo || ''} ${row._reviewer ? `Revisor: ${row._reviewer}. Fecha: ${row._overrideTimestamp}.` : ''}` }
    ];
  };
  if (clinical.length) {
    const firstRow = clinicalEntries(clinical[0]);
    appendBlock([{ value: 'DETALLE DE REVISIÓN DE ATENCIONES', bold: true }, ...firstRow]);
    clinical.slice(1).forEach(row => appendBlock(clinicalEntries(row)));
  }
  return y;
}

function renderFinalSignatures(doc, doctorData, periodInfo, generatedBy, startAtY) {
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
  doc.text('FIRMAS', margin, currentY + 3);
  currentY += 13;

  const signatureGap = 14;
  const signatureWidth = (contentWidth - signatureGap) / 2;
  const physicianName = String(doctorData.medico || '').trim() || 'Médico no identificado';
  const reviewerName = String(generatedBy || '').trim() || 'Usuario no identificado';
  const signatureColumns = [
    { x: margin, name: physicianName, title: 'MÉDICO / PRESTADOR' },
    { x: margin + signatureWidth + signatureGap, name: reviewerName, title: 'RESPONSABLE DE REVISIÓN' }
  ];

  doc.setDrawColor(100, 116, 139);
  doc.setLineWidth(0.35);
  signatureColumns.forEach(({ x, name, title }) => {
    const center = x + signatureWidth / 2;
    doc.line(x + 5, currentY, x + signatureWidth - 5, currentY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    const nameWidth = signatureWidth - 10;
    const nameFontSize = Math.min(8, Math.max(6.5, 8 * nameWidth / Math.max(doc.getTextWidth(name), 1)));
    doc.setFontSize(nameFontSize);
    doc.text(name, center, currentY + 5.8, { align: 'center', maxWidth: nameWidth });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(title, center, currentY + 10.5, { align: 'center' });
  });
}

/**
 * Genera y descarga el PDF de preliquidación individual para un médico
 */
export function generateDoctorHonorariosPdf(doctorData, startDate, endDate, includeZeroAmounts = true, generatedBy = '') {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter'
  });

  const periodLabel = getPeriodLabel(startDate, endDate);
  const receiptEndY = renderDoctorReceipt(doc, doctorData, { startDate, endDate, periodLabel }, includeZeroAmounts, generatedBy);
  const appendixEndY = renderReviewAppendix(doc, doctorData, { startDate, endDate, periodLabel }, includeZeroAmounts, receiptEndY);
  renderFinalSignatures(doc, doctorData, { startDate, endDate, periodLabel }, generatedBy, appendixEndY ?? receiptEndY);
  addPdfFooters(doc);

  const cleanName = (doctorData.medico || 'Medico').replace(/[^a-zA-Z0-9]/g, '_');
  const typeStr = includeZeroAmounts ? 'Detallado' : 'Resumido';
  doc.save(`Resumen_Honorarios_${typeStr}_${cleanName}_${startDate}_a_${endDate}.pdf`);
}

/**
 * Genera y descarga un PDF combinado con todas las liquidaciones de todos los médicos activos
 */
export function generateAllDoctorsHonorariosPdf(doctorsList, startDate, endDate, includeZeroAmounts = true, generatedBy = '') {
  if (!doctorsList || doctorsList.length === 0) return;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter'
  });

  const periodLabel = getPeriodLabel(startDate, endDate);
  const eligibleDoctors = doctorsList.filter(d => {
    return d.filas?.length > 0;
  });

  if (eligibleDoctors.length === 0) return;

  eligibleDoctors.forEach((doctor, idx) => {
    if (idx > 0) {
      doc.addPage('letter', 'portrait');
    }
    const receiptEndY = renderDoctorReceipt(doc, doctor, { startDate, endDate, periodLabel }, includeZeroAmounts, generatedBy);
    const appendixEndY = renderReviewAppendix(doc, doctor, { startDate, endDate, periodLabel }, includeZeroAmounts, receiptEndY);
    renderFinalSignatures(doc, doctor, { startDate, endDate, periodLabel }, generatedBy, appendixEndY ?? receiptEndY);
  });

  addPdfFooters(doc);
  const typeStr = includeZeroAmounts ? 'Detallados' : 'Resumidos';
  doc.save(`Resumen_Honorarios_${typeStr}_Completos_${startDate}_a_${endDate}.pdf`);
}
