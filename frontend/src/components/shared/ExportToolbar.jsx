import React, { useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';

export default function ExportToolbar({ targetId, excelData, fileNamePrefix = 'Dashboard' }) {
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Generar Excel
  const handleExportExcel = () => {
    setIsExportingExcel(true);
    try {
      const wb = XLSX.utils.book_new();

      Object.keys(excelData).forEach(sheetName => {
        const data = excelData[sheetName];
        if (data && data.length > 0) {
          // Add institutional header rows to Excel
          const headerRows = [
            ['HOSPITAL ESCANDÓN - PLATAFORMA BI'],
            ['Reporte:', fileNamePrefix],
            ['Fecha de exportación:', new Date().toLocaleDateString('es-MX')],
            [] // empty row
          ];
          
          const ws = XLSX.utils.json_to_sheet(data, { origin: 'A5' });
          XLSX.utils.sheet_add_aoa(ws, headerRows, { origin: 'A1' });
          
          XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
        }
      });

      const today = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `${fileNamePrefix}_${today}.xlsx`);
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
