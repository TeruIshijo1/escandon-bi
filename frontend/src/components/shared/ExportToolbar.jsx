import React, { useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

export default function ExportToolbar({ targetId, excelData, fileNamePrefix = 'Dashboard' }) {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Generar Excel Institucional
  const handleExportExcel = () => {
    setIsExportingExcel(true);
    try {
      const fechaReporte = new Date().toLocaleString('es-MX');
      let html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:spreadsheet" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8">
<style>
  body{font-family:Calibri,Arial,sans-serif}table{border-collapse:collapse;width:100%;margin-bottom:20px;}
  .title-bar{background:#004687;color:#fff;font-size:16pt;font-weight:bold;padding:12px 16px}
  .subtitle-bar{background:#0088C9;color:#fff;font-size:12pt;font-weight:bold;padding:8px 16px}
  .info-row td{font-size:9pt;color:#475569;padding:4px 16px}
  th{background:#004687;color:#fff;font-weight:bold;font-size:10pt;padding:10px 8px;border:1px solid #003366;text-align:center}
  td{padding:7px 8px;font-size:9pt;border:1px solid #D1D5DB;color:#1E293B}
  .even{background:#F4F6F9}.odd{background:#FFF}
</style></head><body>`;

      Object.keys(excelData).forEach(sheetName => {
        const data = excelData[sheetName];
        if (data && data.length > 0) {
          const keys = Object.keys(data[0]);
          html += `<table>
            <tr><td colspan="${keys.length}" class="title-bar">HOSPITAL ESCANDÓN - PLATAFORMA BI</td></tr>
            <tr><td colspan="${keys.length}" class="subtitle-bar">Reporte: ${fileNamePrefix} — ${sheetName}</td></tr>
            <tr class="info-row"><td colspan="${keys.length}">Fecha de exportación: ${fechaReporte} &nbsp;|&nbsp; Registros: ${data.length}</td></tr>
            <tr><td colspan="${keys.length}" style="height:6px;border:none"></td></tr>
            <tr>${keys.map(k => `<th>${k}</th>`).join('')}</tr>
            ${data.map((row, i) => `<tr class="${i % 2 === 0 ? 'even' : 'odd'}">${keys.map(k => {
              let val = row[k];
              if (val == null) val = '';
              return `<td>${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
            }).join('')}</tr>`).join('')}
          </table><br/>`;
        }
      });
      html += `</body></html>`;

      const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; 
      a.download = `${fileNamePrefix}_${new Date().toISOString().split('T')[0]}.xls`;
      document.body.appendChild(a); 
      a.click(); 
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exportando Excel:', e);
      alert('Error exportando a Excel.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Generar PDF
  const handleExportPdf = async () => {
    const target = document.getElementById(targetId);
    if (!target) {
      alert(`No se encontró el elemento a exportar (${targetId})`);
      return;
    }

    setIsExportingPdf(true);
    try {
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#f3f4f6'
      });

      const imgData = canvas.toDataURL('image/jpeg', 1.0);
      
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [canvas.width, canvas.height + 40] // +40px para el header
      });

      const pdfW = pdf.internal.pageSize.getWidth();
      
      // Header institucional
      pdf.setFillColor(0, 70, 135); // Azul Institucional
      pdf.rect(0, 0, pdfW, 40, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(18);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Hospital Escandón', 15, 25);
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'normal');
      pdf.text('Reporte de Inteligencia de Negocios (SITI) - ' + new Date().toLocaleDateString('es-MX'), pdfW - 15, 25, { align: 'right' });

      // Imagen del Dashboard desplazada hacia abajo
      pdf.addImage(imgData, 'JPEG', 0, 40, canvas.width, canvas.height);
      const today = new Date().toISOString().split('T')[0];
      pdf.save(`${fileNamePrefix}_${today}.pdf`);

    } catch (e) {
      console.error('Error exportando PDF:', e);
      alert('Error exportando a PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <button
        onClick={handleExportExcel}
        disabled={isExportingExcel || !excelData}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.45rem',
          padding: '0.6rem 1.1rem',
          background: '#09152b', // Dark institutional color
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          color: '#FFFFFF',
          fontFamily: "var(--font-display)",
          fontSize: '0.82rem',
          fontWeight: 700,
          cursor: isExportingExcel ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}
        onMouseEnter={e => !isExportingExcel && (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => !isExportingExcel && (e.currentTarget.style.opacity = '1')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M5.884 6.68a.5.5 0 1 0-.768.64L7.349 10l-2.233 2.68a.5.5 0 0 0 .768.64L8 10.781l2.116 2.54a.5.5 0 0 0 .768-.641L8.651 10l2.233-2.68a.5.5 0 0 0-.768-.64L8 9.219l-2.116-2.54z"/>
          <path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/>
        </svg>
        {isExportingExcel ? 'Procesando...' : 'Exportar CSV / Excel'}
      </button>
      
      <button
        onClick={handleExportPdf}
        disabled={isExportingPdf}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.45rem',
          padding: '0.6rem 1.1rem',
          background: '#09152b',
          border: '1.5px solid rgba(255,255,255,0.1)',
          borderRadius: 10,
          color: '#FFFFFF',
          fontFamily: "var(--font-display)",
          fontSize: '0.82rem',
          fontWeight: 700,
          cursor: isExportingPdf ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
        }}
        onMouseEnter={e => !isExportingPdf && (e.currentTarget.style.opacity = '0.85')}
        onMouseLeave={e => !isExportingPdf && (e.currentTarget.style.opacity = '1')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
          <path d="M4 0h5.293A1 1 0 0 1 10 .293L13.707 4a1 1 0 0 1 .293.707V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3zM4.5 3a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2zm0 2a.5.5 0 0 0 0 1h2a.5.5 0 0 0 0-1h-2zm0 2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5z"/>
        </svg>
        {isExportingPdf ? 'Creando PDF...' : 'Exportar Resumen (PDF)'}
      </button>
    </div>
  );
}
