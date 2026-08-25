import{r as a}from"./router-LvRPBkFM.js";import{A as y,j as e}from"./index-Bsr2uJcy.js";import{E as k}from"./ExportButton-ZynO4GzN.js";let r=null,m=[];const h=()=>m.forEach(o=>o());function A(){const[o,s]=a.useState(r),[p,d]=a.useState(!r);a.useEffect(()=>{const t=()=>s({...r});return m.push(t),()=>{m=m.filter(i=>i!==t)}},[]),a.useEffect(()=>{if(r){s(r),d(!1);return}const t=sessionStorage.getItem("escandon_token");t&&fetch(`${y}/dashboard/kpi-config`,{headers:{Authorization:`Bearer ${t}`}}).then(i=>i.json()).then(i=>{i.ok&&(r=i.data,s(r),h())}).catch(i=>console.error("[useKPIConfig]",i)).finally(()=>d(!1))},[]);const f=a.useCallback(t=>{var i;if(!o){const n=(t||"").split("."),l=((i=n[n.length-1])==null?void 0:i.replace(/_/g," "))||t;return{nombre:l,icono:"📊",pbiUrl:null,nombreDefault:l,nombreCustom:null}}return o[t]||{nombre:t,icono:"📊",pbiUrl:null}},[o]),c=a.useCallback(async(t,{nombreCustom:i,icono:n,pbiUrl:l})=>{var x,b;const j=sessionStorage.getItem("escandon_token"),u=await(await fetch(`${y}/admin/kpi-config/${t}`,{method:"PUT",headers:{Authorization:`Bearer ${j}`,"Content-Type":"application/json"},body:JSON.stringify({nombreCustom:i,icono:n,pbiUrl:l})})).json();return u.ok&&r&&(r[t]={...r[t]||{},nombre:i||((x=r[t])==null?void 0:x.nombreDefault)||t,icono:n||((b=r[t])==null?void 0:b.icono),pbiUrl:l||null,nombreCustom:i||null},h()),u},[]),g=a.useCallback(()=>{r=null,h()},[]);return{config:o,loading:p,getKPI:f,updateKPI:c,invalidate:g}}function C({url:o,title:s,multiPagina:p=!1,reportId:d,hasJson:f=!1,onClose:c,isApiModal:g=!1}){if(a.useEffect(()=>{const n=l=>{l.key==="Escape"&&c()};return window.addEventListener("keydown",n),()=>window.removeEventListener("keydown",n)},[c]),!o)return null;const t=sessionStorage.getItem("escandon_token"),i=g&&t?`${o}?token=${t}`:o;return e.jsxs("div",{id:"pbi-modal-wrapper",onClick:c,style:{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(13,27,42,0.7)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2e3,animation:"pbiModalIn 220ms ease"},children:[e.jsx("style",{children:`
        @keyframes pbiModalIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes pbiPanelIn {
          from { opacity: 0; transform: scale(0.96) translateY(12px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }

        @media print {
          @page {
            size: landscape;
            margin: 10mm;
          }

          /* Ocultar el fondo oscurecido */
          #pbi-modal-wrapper {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100vh !important;
            background: white !important;
            backdrop-filter: none !important;
            display: block !important;
            padding: 0 !important;
            z-index: 9999 !important;
          }

          /* Ajustar el panel principal al tamaño de la página */
          #pbi-modal-panel {
            width: 100% !important;
            height: 100vh !important;
            max-width: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            border: 8px solid #004687 !important; /* Marco azul institucional */
            display: flex !important;
            flex-direction: column !important;
            margin: 0 !important;
            padding: 0 !important;
            box-sizing: border-box !important;
          }

          /* Ocultar el header oscuro interactivo y el footer */
          #pbi-modal-header, #pbi-modal-footer {
            display: none !important;
          }

          /* Mostrar el header exclusivo para impresión */
          #pbi-print-header {
            display: flex !important;
          }

          /* El iframe toma todo el espacio restante automáticamente */
          #pbi-iframe-container {
            flex: 1 !important;
            width: 100% !important;
            height: 100% !important;
            position: relative !important;
            background: white !important;
          }
        }
      `}),e.jsxs("div",{id:"pbi-modal-panel",onClick:n=>n.stopPropagation(),style:{width:"95vw",maxWidth:1100,height:"90vh",background:"white",borderRadius:18,overflow:"hidden",boxShadow:"0 30px 80px rgba(0,0,0,0.4)",display:"flex",flexDirection:"column",animation:"pbiPanelIn 250ms ease"},children:[e.jsxs("div",{id:"pbi-modal-header",style:{background:"linear-gradient(90deg, #004687, #0088C9)",padding:"0.9rem 1.5rem",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"0.75rem"},children:[e.jsx("div",{style:{width:34,height:34,borderRadius:8,background:"rgba(255,255,255,0.15)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.1rem"},children:"📊"}),e.jsxs("div",{children:[e.jsx("div",{style:{fontSize:"0.62rem",fontWeight:700,color:"rgba(255,255,255,0.6)",textTransform:"uppercase",letterSpacing:"0.1em"},children:"Reporte Power BI"}),e.jsx("div",{style:{fontSize:"0.95rem",fontWeight:700,color:"white"},children:s})]})]}),e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"0.8rem"},children:[d&&e.jsxs("div",{style:{display:"flex",gap:"0.5rem",borderRight:"1px solid rgba(255,255,255,0.2)",paddingRight:"0.8rem"},children:[e.jsx(k,{type:"pdf",reportId:d,compact:!0}),f&&e.jsx(k,{type:"excel",reportId:d,compact:!0})]}),e.jsx("button",{onClick:c,title:"Cerrar (Esc)",style:{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.25)",borderRadius:8,color:"white",width:36,height:36,fontSize:"1rem",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"background 150ms"},onMouseEnter:n=>n.currentTarget.style.background="rgba(255,255,255,0.25)",onMouseLeave:n=>n.currentTarget.style.background="rgba(255,255,255,0.15)",children:"✕"})]})]}),e.jsxs("div",{id:"pbi-print-header",style:{display:"none",padding:"1.5rem",alignItems:"center",justifyContent:"space-between",borderBottom:"2px solid #004687",background:"white",flexShrink:0},children:[e.jsxs("div",{style:{display:"flex",alignItems:"center",gap:"1rem"},children:[e.jsx("div",{className:"brand-logo-badge",style:{padding:"4px 12px",cursor:"default"},children:e.jsx("img",{src:"/logo-escandon.png",alt:"Hospital Escandón",className:"brand-logo-img",style:{height:"36px"}})}),e.jsxs("div",{children:[e.jsx("h2",{style:{margin:0,color:"#004687",fontSize:"1.2rem",fontFamily:"var(--font-display)"},children:"Hospital Escandón"}),e.jsx("p",{style:{margin:0,color:"#4A5568",fontSize:"0.8rem"},children:"Reporte de Inteligencia de Negocios"})]})]}),e.jsxs("div",{style:{textAlign:"right"},children:[e.jsx("h3",{style:{margin:0,color:"#0D1B2A",fontSize:"1.1rem"},children:s}),e.jsx("p",{style:{margin:0,color:"#8A97A8",fontSize:"0.75rem"},children:new Date().toLocaleDateString("es-MX",{year:"numeric",month:"long",day:"numeric"})})]})]}),e.jsxs("div",{id:"pbi-iframe-container",style:{flex:1,overflow:"hidden",position:"relative"},children:[e.jsx("div",{style:{width:"100%",height:p?"100%":"calc(100% + 36px)",position:"absolute",top:0,left:0},children:e.jsx("iframe",{title:s,src:i,width:"100%",height:"100%",frameBorder:"0",allowFullScreen:!1,style:{border:"none",background:"white"},loading:"lazy"})}),p&&e.jsxs(e.Fragment,{children:[e.jsx("div",{style:{position:"absolute",bottom:0,left:0,width:"180px",height:"36px",background:"#f3f2f1",zIndex:10,pointerEvents:"auto"}}),e.jsx("div",{style:{position:"absolute",bottom:0,right:0,width:"120px",height:"36px",background:"#f3f2f1",zIndex:10,pointerEvents:"auto"}})]})]}),e.jsx("div",{id:"pbi-modal-footer",style:{padding:"0.45rem 1.5rem",background:"#F8FAFC",borderTop:"1px solid #E2E8F0",fontSize:"0.62rem",fontWeight:600,color:"#94A3B8",textAlign:"center",letterSpacing:"0.04em",flexShrink:0},children:"🔒 CONEXIÓN ENCRIPTADA · HOSPITAL ESCANDÓN · PRESIONE ESC PARA CERRAR"})]})]})}export{C as P,A as u};
