import{j as e,P as q,A as G}from"./index-Bsr2uJcy.js";import{r}from"./router-LvRPBkFM.js";import{E as Y}from"./ExportButton-ZynO4GzN.js";import{a as _}from"./auth-4y_2pIfU.js";import"./jspdf.es.min-DHz64qE8.js";const x=({columnKey:h,data:p,colFilters:S,setColFilters:C,label:u,align:F="left",maxWidth:f})=>{const b=Array.from(new Set(p.map(s=>s[h]))).filter(Boolean).sort(),y=S[h]||"";return e.jsx("th",{style:{textAlign:F,maxWidth:f||"none"},children:e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"4px"},children:[e.jsx("span",{style:{fontSize:"0.65rem",textTransform:"uppercase",color:"#8A97A8"},children:u}),e.jsxs("select",{value:y,onChange:s=>C(j=>({...j,[h]:s.target.value})),style:{fontSize:"0.7rem",padding:"2px 4px",borderRadius:"4px",border:"1px solid #E2E8F0",background:"#F8FAFC",outline:"none",maxWidth:f||"100%",textOverflow:"ellipsis"},children:[e.jsx("option",{value:"",children:"Todos"}),b.map(s=>e.jsx("option",{value:s,children:s},s))]})]})})};function oe(){const h=r.useRef(null),p=r.useRef(null),[S,C]=r.useState(1200),[u,F]=r.useState(null),[f,b]=r.useState(!0),[y,s]=r.useState(null),j=()=>new Date().toLocaleDateString("en-CA"),[v,I]=r.useState(j()),[w,$]=r.useState(j()),[i,l]=r.useState({}),[c,A]=r.useState(1),E=100;r.useEffect(()=>{A(1)},[i]),r.useEffect(()=>{(async()=>{b(!0),s(null);try{const o=new URLSearchParams({fechaDesde:v,fechaHasta:w}),d=await fetch(`${G}/pharmacy/devoluciones?${o}`,{headers:_()});if(!d.ok)throw new Error("Error al cargar datos de devoluciones");const L=await d.json();F(L),A(1)}catch(o){s(o.message)}finally{b(!1)}})()},[v,w]),r.useEffect(()=>{const t=p.current;if(!t)return;const o=new ResizeObserver(()=>{t.scrollWidth>0&&C(t.scrollWidth)});return o.observe(t),t.firstChild&&o.observe(t.firstChild),()=>o.disconnect()},[u]);const a=(u==null?void 0:u.data)||[],P=t=>{const o=a.filter(n=>n.Orden===t.Orden&&n.FechaDevolucion===t.FechaDevolucion),d=window.open("","_blank","width=350,height=600");if(!d){alert("Por favor, deshabilite el bloqueador de ventanas emergentes (pop-ups) para imprimir el ticket.");return}const L=t.FechaNacimiento?new Date(t.FechaNacimiento).toLocaleDateString("es-MX"):"N/A",U=t.FechaDevolucion?new Date(t.FechaDevolucion).toLocaleString("es-MX"):"N/A";let k=0,z=0;const B=o.map(n=>{const R=n.TotalLinea??n.PrecioUnitario*n.CantidadDevuelta,V=n.IVA??0;return k+=R,z+=V,`
        <tr>
          <td class="text-center">${n.CantidadDevuelta}</td>
          <td>${n.Codigo} - ${n.Insumo}</td>
          <td>${n.Lote||"N/A"}<br>exp. ${n.Caducidad?new Date(n.Caducidad).toLocaleDateString("es-MX"):"N/A"}</td>
          <td class="text-right">$${(n.PrecioUnitario||0).toFixed(2)}</td>
          <td class="text-right">$${R.toFixed(2)}</td>
        </tr>
      `}).join(""),N=0,O=k-N,X=O+z,H=window.location.origin+"/logo-escandon.png",K=`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Ticket Devolución - ${t.Orden}</title>
        <style>
          /* Estilos base para impresora térmica */
          body { font-family: monospace; font-size: 10px; margin: 0; padding: 5px; color: black; width: 100%; max-width: 100%; box-sizing: border-box; }
          .header { text-align: center; margin-bottom: 8px; }
          .title { text-align: center; font-weight: bold; border-top: 1px dashed black; border-bottom: 1px dashed black; padding: 4px 0; margin-bottom: 8px; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9px; table-layout: fixed; word-wrap: break-word; }
          th, td { border: 1px solid #ccc; padding: 2px; text-align: left; vertical-align: top; overflow: hidden; }
          th { background: #f0f0f0; }
          
          /* Proporciones de las columnas para evitar que se desborde */
          th:nth-child(1), td:nth-child(1) { width: 10%; text-align: center; } /* CANT */
          th:nth-child(2), td:nth-child(2) { width: 40%; } /* PRODUCTO */
          th:nth-child(3), td:nth-child(3) { width: 22%; } /* LOTE */
          th:nth-child(4), td:nth-child(4) { width: 14%; text-align: right; } /* PRECIO */
          th:nth-child(5), td:nth-child(5) { width: 14%; text-align: right; } /* IMPORT */

          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .info-box { border: 1px dashed black; padding: 4px; margin-bottom: 4px; }
          .footer-table { width: 70%; margin-left: auto; table-layout: auto; font-size: 10px; }
          .footer-table td { border: 1px solid #ccc; padding: 2px; }
          
          @media print {
            @page { margin: 0; }
            body { 
              padding: 2mm;
              width: 100%; 
              max-width: 76mm;
              margin: 0 auto;
              box-sizing: border-box;
            }
            button { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="${H}" alt="Logo Hospital Escandón" style="width: 100%; max-width: 230px; margin-bottom: 5px; filter: grayscale(100%) brightness(0.6) contrast(100);" />
        </div>
        
        <div class="title">TICKET DEVOLUCIÓN DE FARMACIA</div>

        <div style="display: flex; justify-content: space-between;">
          <div class="info-box" style="flex: 1; margin-right: 5px;">No Req: <br><strong>${t.Orden||"N/A"}</strong></div>
          <div class="info-box" style="flex: 2;">Habitación: <br><strong>${t.Cama||"N/A"}</strong></div>
        </div>
        
        <div class="info-box">
          Folio: <strong>${t.Cuenta||"N/A"}</strong>
        </div>

        <div class="info-box">
          ${t.Paciente||"N/A"}<br>
          F. Nac.: ${L}
        </div>

        <div class="info-box text-center">
          Fecha / Hora: ${U}
        </div>

        <table>
          <thead>
            <tr>
              <th>CANT.</th>
              <th>PRODUCTO</th>
              <th>LOTE</th>
              <th>PRECIO</th>
              <th>IMPORT</th>
            </tr>
          </thead>
          <tbody>
            ${B}
          </tbody>
        </table>

        <table class="footer-table">
          <tr><td>SUMA</td><td class="text-right">$${k.toFixed(2)}</td></tr>
          <tr><td>DESCUENTO</td><td class="text-right">$${N.toFixed(2)}</td></tr>
          <tr><td>IMPORTE</td><td class="text-right">$${O.toFixed(2)}</td></tr>
          <tr><td>IVA</td><td class="text-right">$${z.toFixed(2)}</td></tr>
          <tr><td><strong>TOTAL</strong></td><td class="text-right"><strong>$${X.toFixed(2)}</strong></td></tr>
        </table>

        <div class="info-box">
          Usuario Solicita: ${t.UAbierto||"N/A"}<br>
          Usuario Procesa: ${t.UConfirma||t.UsuarioProceso||"N/A"}<br>
          Médico: ${t.Medico||"N/A"}
        </div>

        <div class="info-box text-center">
          Estado: <strong>${t.Estado||"N/A"}</strong> | Línea: <strong>${t.EstadoLinea||"N/A"}</strong>
        </div>

        <div class="info-box text-center">
          *** Gracias por su preferencia ***
        </div>
        
        <div style="text-align: center; margin-top: 15px;">
          <button onclick="window.print()" style="padding: 10px 20px; cursor: pointer;">Imprimir</button>
        </div>
      </body>
      </html>
    `;d.document.open(),d.document.write(K),d.document.close()},m=r.useMemo(()=>a.filter(t=>Object.keys(i).every(o=>i[o]?String(t[o])===String(i[o]):!0)),[a,i]),D=r.useMemo(()=>{const t=(c-1)*E;return m.slice(t,t+E)},[m,c]),g=Math.max(1,Math.ceil(m.length/E)),T={totalPartidas:m.length,totalArticulos:m.reduce((t,o)=>t+(o.CantidadDevuelta||0),0),montoRealCobrado:m.reduce((t,o)=>t+(o.MontoCobrado||0),0),pacientesImpactados:new Set(m.map(t=>t.Cuenta)).size};if(f&&!u)return e.jsx(q,{text:"Conectando con Farmacia..."});const W=t=>{p.current&&p.current.scrollLeft!==t.target.scrollLeft&&(p.current.scrollLeft=t.target.scrollLeft)},M=t=>{h.current&&h.current.scrollLeft!==t.target.scrollLeft&&(h.current.scrollLeft=t.target.scrollLeft)};return e.jsxs("div",{className:"fade-in",style:{display:"flex",flexDirection:"column",gap:"1rem",height:"100%"},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",background:"white",padding:"1rem 1.5rem",borderRadius:"12px",boxShadow:"0 1px 3px rgba(0,70,135,0.1)"},children:[e.jsxs("div",{children:[e.jsxs("h2",{style:{margin:0,color:"#004687",fontSize:"1.25rem",display:"flex",alignItems:"center",gap:"0.5rem"},children:["💊 Devoluciones de Farmacia",e.jsx("span",{style:{background:"#004687",color:"white",fontSize:"0.6rem",padding:"2px 6px",borderRadius:4,letterSpacing:"0.05em"},children:"MÓDULO FARMACIA"})]}),e.jsx("p",{style:{margin:0,fontSize:"0.8rem",color:"#64748B",marginTop:"0.2rem"},children:"Auditoría de reingresos físicos a farmacia desde las áreas clínicas."})]}),e.jsxs("div",{style:{display:"flex",gap:"1rem",alignItems:"center"},children:[e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"0.2rem"},children:[e.jsx("label",{style:{fontSize:"0.65rem",fontWeight:700,color:"#64748B",textTransform:"uppercase"},children:"Desde"}),e.jsx("input",{type:"date",value:v,onChange:t=>I(t.target.value),style:{padding:"0.4rem",borderRadius:"6px",border:"1px solid #CBD5E1",fontSize:"0.8rem",outline:"none"}})]}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"0.2rem"},children:[e.jsx("label",{style:{fontSize:"0.65rem",fontWeight:700,color:"#64748B",textTransform:"uppercase"},children:"Hasta"}),e.jsx("input",{type:"date",value:w,onChange:t=>$(t.target.value),style:{padding:"0.4rem",borderRadius:"6px",border:"1px solid #CBD5E1",fontSize:"0.8rem",outline:"none"}})]}),e.jsxs("div",{style:{display:"flex",gap:"0.5rem",marginLeft:"0.5rem"},children:[e.jsx("button",{onClick:()=>{l({}),I(""),$("")},style:{padding:"0.4rem 0.8rem",borderRadius:"6px",border:"1px solid #E2E8F0",background:"white",color:"#64748B",fontSize:"0.8rem",cursor:"pointer",fontWeight:600,display:"flex",alignItems:"center",gap:"4px"},title:"Limpiar todos los filtros de las columnas",children:"🧹 Limpiar Filtros"}),e.jsx(Y,{type:"excel",variant:"solid",reportId:"devoluciones-farmacia",queryParams:{fechaDesde:v,fechaHasta:w}})]})]})]}),y&&e.jsxs("div",{style:{background:"#FEF2F2",color:"#DC2626",padding:"1rem",borderRadius:8,border:"1px solid #FECACA"},children:[e.jsx("strong",{children:"Error:"})," ",y]}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:"1rem"},children:[e.jsxs("div",{style:{background:"white",borderRadius:8,padding:"0.8rem 1rem",border:"1px solid rgba(0,70,135,0.07)",boxShadow:"0 1px 3px rgba(0,0,0,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"},children:[e.jsxs("div",{children:[e.jsx("div",{style:{fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",color:"#8A97A8",marginBottom:"0.2rem"},children:"Total Registros"}),e.jsx("div",{style:{fontFamily:"var(--font-mono)",fontSize:"1.25rem",fontWeight:700,color:"#004687"},children:T.totalPartidas.toLocaleString("es-MX")})]}),e.jsx("span",{style:{fontSize:"1.4rem",opacity:.8},children:"📋"})]}),e.jsxs("div",{style:{background:"white",borderRadius:8,padding:"0.8rem 1rem",border:"1px solid rgba(0,70,135,0.07)",boxShadow:"0 1px 3px rgba(0,0,0,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"},children:[e.jsxs("div",{children:[e.jsx("div",{style:{fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",color:"#8A97A8",marginBottom:"0.2rem"},children:"Artículos Devueltos"}),e.jsx("div",{style:{fontFamily:"var(--font-mono)",fontSize:"1.25rem",fontWeight:700,color:"#004687"},children:T.totalArticulos.toLocaleString("es-MX")})]}),e.jsx("span",{style:{fontSize:"1.4rem",opacity:.8},children:"↩️"})]}),e.jsxs("div",{style:{background:"white",borderRadius:8,padding:"0.8rem 1rem",border:"1px solid rgba(0,70,135,0.07)",boxShadow:"0 1px 3px rgba(0,0,0,0.05)",display:"flex",justifyContent:"space-between",alignItems:"center"},children:[e.jsxs("div",{children:[e.jsx("div",{style:{fontSize:"0.65rem",fontWeight:700,textTransform:"uppercase",color:"#8A97A8",marginBottom:"0.2rem"},children:"Pacientes Impactados"}),e.jsx("div",{style:{fontFamily:"var(--font-mono)",fontSize:"1.25rem",fontWeight:700,color:"#004687"},children:T.pacientesImpactados.toLocaleString("es-MX")})]}),e.jsx("span",{style:{fontSize:"1.4rem",opacity:.8},children:"👥"})]})]}),e.jsxs("div",{style:{flex:1,background:"white",borderRadius:"12px",display:"flex",flexDirection:"column",boxShadow:"0 4px 6px rgba(0,0,0,0.02)",border:"1px solid rgba(0,70,135,0.1)",overflow:"hidden"},children:[f&&e.jsx("div",{style:{padding:"0.5rem",background:"#FEF3C7",color:"#B45309",fontSize:"0.75rem",textAlign:"center",fontWeight:600},children:"Actualizando datos..."}),e.jsx("div",{ref:h,onScroll:W,style:{overflowX:"auto",overflowY:"hidden",height:"14px",flexShrink:0},children:e.jsx("div",{style:{width:`${S}px`,height:"14px"},children:" "})}),e.jsx("div",{ref:p,onScroll:M,style:{flex:1,overflowX:"auto",overflowY:"auto"},children:e.jsxs("table",{className:"premium-table",style:{width:"100%",minWidth:"1000px"},children:[e.jsx("thead",{style:{position:"sticky",top:0,zIndex:10,background:"#F8FAFC",boxShadow:"0 2px 4px rgba(0,0,0,0.05)"},children:e.jsxs("tr",{children:[e.jsx(x,{columnKey:"Cuenta",data:a,colFilters:i,setColFilters:l,label:"FOLIO TICKET",maxWidth:"90px"}),e.jsx(x,{columnKey:"Orden",data:a,colFilters:i,setColFilters:l,label:"NO. REQ.",maxWidth:"90px"}),e.jsx("th",{style:{textAlign:"left",fontSize:"0.65rem",color:"#8A97A8",paddingBottom:"20px"},children:"FECHA"}),e.jsx(x,{columnKey:"EstadoLinea",data:a,colFilters:i,setColFilters:l,label:"ESTADO"}),e.jsx(x,{columnKey:"UAbierto",data:a,colFilters:i,setColFilters:l,label:"SOLICITA"}),e.jsx(x,{columnKey:"UConfirma",data:a,colFilters:i,setColFilters:l,label:"ACEPTA"}),e.jsx(x,{columnKey:"Paciente",data:a,colFilters:i,setColFilters:l,label:"PACIENTE",maxWidth:"150px"}),e.jsx(x,{columnKey:"Cama",data:a,colFilters:i,setColFilters:l,label:"CAMA",maxWidth:"80px"}),e.jsx(x,{columnKey:"Codigo",data:a,colFilters:i,setColFilters:l,label:"CÓDIGO"}),e.jsx(x,{columnKey:"Insumo",data:a,colFilters:i,setColFilters:l,label:"INSUMO",maxWidth:"250px"}),e.jsx("th",{style:{textAlign:"center"},children:"CANTIDAD DEVUELTA"}),e.jsx("th",{style:{textAlign:"right"},children:"MONTO ($)"}),e.jsx("th",{style:{textAlign:"center",width:"40px"}})]})}),e.jsx("tbody",{children:D.length===0?e.jsx("tr",{children:e.jsx("td",{colSpan:"12",style:{textAlign:"center",padding:"3rem",color:"#94A3B8"},children:"No se encontraron registros de devoluciones."})}):D.map((t,o)=>{var d;return e.jsxs("tr",{style:{transition:"background 0.2s"},children:[e.jsx("td",{children:e.jsx("strong",{style:{color:"#004687",fontFamily:"var(--font-mono)"},children:t.Cuenta||"N/A"})}),e.jsx("td",{children:e.jsx("span",{style:{color:"#475569",fontFamily:"var(--font-mono)",fontSize:"0.8rem"},children:t.Orden||"N/A"})}),e.jsxs("td",{style:{whiteSpace:"nowrap"},children:[new Date(t.FechaDevolucion).toLocaleDateString("es-MX")," ",new Date(t.FechaDevolucion).toLocaleTimeString("es-MX",{hour:"2-digit",minute:"2-digit"})]}),e.jsx("td",{children:e.jsx("span",{style:{background:t.EstadoLinea==="DEVUELTO"?"#D1FAE5":"#FEF3C7",color:t.EstadoLinea==="DEVUELTO"?"#065F46":"#92400E",padding:"2px 6px",borderRadius:4,fontSize:"0.7rem",fontWeight:600},children:t.EstadoLinea||"N/A"})}),e.jsx("td",{style:{fontSize:"0.8rem",color:"#475569"},children:t.UAbierto||"N/A"}),e.jsx("td",{style:{fontWeight:600,color:"#004687"},children:t.UConfirma||"N/A"}),e.jsx("td",{style:{maxWidth:"150px",fontSize:"0.8rem",whiteSpace:"normal",wordWrap:"break-word"},children:t.Paciente}),e.jsx("td",{style:{maxWidth:"80px",whiteSpace:"normal",wordWrap:"break-word"},children:e.jsx("span",{style:{background:"#F1F5F9",padding:"2px 6px",borderRadius:4,fontSize:"0.75rem",color:"#475569"},children:t.Cama||"N/A"})}),e.jsx("td",{children:e.jsx("code",{style:{fontSize:"0.75rem",color:"#475569"},children:t.Codigo})}),e.jsx("td",{style:{maxWidth:"250px",whiteSpace:"normal",wordWrap:"break-word"},children:t.Insumo}),e.jsx("td",{style:{textAlign:"center",fontWeight:700,color:"#F59E0B"},children:t.CantidadDevuelta}),e.jsxs("td",{style:{textAlign:"right",fontWeight:700,color:"#00974A"},children:["$",(d=t.Monto)==null?void 0:d.toLocaleString("es-MX",{minimumFractionDigits:2})]}),e.jsx("td",{style:{textAlign:"center"},children:e.jsx("button",{onClick:()=>P(t),style:{background:"none",border:"none",cursor:"pointer",fontSize:"1.2rem"},title:"Generar Ticket",children:"🖨️"})})]},o)})})]})}),e.jsxs("div",{style:{padding:"0.75rem 1.5rem",background:"#F8FAFC",borderTop:"1px solid #E2E8F0",display:"flex",justifyContent:"space-between",alignItems:"center"},children:[e.jsxs("div",{style:{fontSize:"0.8rem",color:"#64748B"},children:["Mostrando ",e.jsx("strong",{style:{color:"#004687"},children:D.length})," de ",e.jsx("strong",{style:{color:"#004687"},children:m.length})," registros"]}),e.jsxs("div",{style:{display:"flex",gap:"0.5rem",alignItems:"center"},children:[e.jsx("button",{onClick:()=>A(t=>Math.max(1,t-1)),disabled:c===1,style:{padding:"0.25rem 0.75rem",borderRadius:4,border:"1px solid #CBD5E1",background:c===1?"#F1F5F9":"white",cursor:c===1?"not-allowed":"pointer"},children:"Anterior"}),e.jsxs("span",{style:{fontSize:"0.8rem",color:"#475569",margin:"0 0.5rem"},children:["Página ",c," de ",g]}),e.jsx("button",{onClick:()=>A(t=>Math.min(g,t+1)),disabled:c===g||g===0,style:{padding:"0.25rem 0.75rem",borderRadius:4,border:"1px solid #CBD5E1",background:c===g||g===0?"#F1F5F9":"white",cursor:c===g||g===0?"not-allowed":"pointer"},children:"Siguiente"})]})]})]})]})}export{oe as default};
