import{u as y,j as e}from"./index-Bsr2uJcy.js";import{b as j,u as k,r as n}from"./router-LvRPBkFM.js";function N(){var h,x;const{login:f,user:a,loading:l,error:C}=y(),d=j(),c=((x=(h=k().state)==null?void 0:h.from)==null?void 0:x.pathname)||"/",[r,b]=n.useState({username:"",password:""}),[i,g]=n.useState(!1),[p,v]=n.useState(!1),[m,s]=n.useState("");n.useEffect(()=>{!l&&a&&d(c,{replace:!0})},[a,l]);const u=t=>{s(""),b(o=>({...o,[t.target.name]:t.target.value}))},w=async t=>{if(t.preventDefault(),!r.username.trim()||!r.password.trim()){s("Ingrese usuario y contraseña.");return}g(!0),s("");const o=await f(r.username.trim().toLowerCase(),r.password);g(!1),o.ok?d(c,{replace:!0}):s(o.message||"Credenciales incorrectas. Intente de nuevo.")};return e.jsxs("div",{style:{minHeight:"100vh",background:"radial-gradient(circle at 80% 20%, #083b66 0%, #002347 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem",position:"relative",overflow:"hidden"},children:[e.jsx("div",{style:{position:"absolute",inset:0,opacity:.03,backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Cpath d='M27 10h6v17h17v6H33v17h-6V33H10v-6h17V10z' fill='%23ffffff' fill-rule='evenodd'/%3E%3C/svg%3E")`,backgroundSize:"60px 60px",pointerEvents:"none"}}),[{w:500,h:500,top:"-150px",left:"-100px",bg:"radial-gradient(circle, rgba(0,184,163,0.1) 0%, rgba(0,0,0,0) 70%)"},{w:400,h:400,bottom:"-100px",right:"-50px",bg:"radial-gradient(circle, rgba(0,70,135,0.2) 0%, rgba(0,0,0,0) 70%)"}].map((t,o)=>e.jsx("div",{style:{position:"absolute",width:t.w,height:t.h,top:t.top,bottom:t.bottom,left:t.left,right:t.right,background:t.bg,borderRadius:"50%",pointerEvents:"none"}},o)),e.jsx("div",{className:"login-card-wrapper",style:{position:"relative",padding:"3px",borderRadius:"24px",background:"linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.03))",boxShadow:"0 32px 80px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.15)",width:"100%",maxWidth:"430px",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",animation:"cardEntrance 0.7s cubic-bezier(0.16, 1, 0.3, 1) both"},children:e.jsxs("div",{style:{background:"#ffffff",borderRadius:"21px",padding:"2.75rem 2.25rem 2.25rem"},children:[e.jsx("style",{children:`
            @keyframes cardEntrance {
              from { opacity: 0; transform: scale(0.96) translateY(15px); }
              to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .login-field-group {
              margin-bottom: 1.25rem;
            }
            .login-label {
              display: block;
              font-family: var(--font-display);
              font-size: 0.75rem;
              font-weight: 700;
              color: var(--color-azul-oscuro);
              margin-bottom: 0.45rem;
              letter-spacing: 0.06em;
              text-transform: uppercase;
            }
            .login-input-container {
              position: relative;
              display: flex;
              align-items: center;
            }
            .login-icon-left {
              position: absolute;
              left: 0.875rem;
              color: #A0AEC0;
              display: flex;
              align-items: center;
              pointer-events: none;
              transition: color 0.2s;
            }
            .login-input-field {
              width: 100%;
              padding: 0.75rem 1rem 0.75rem 2.5rem;
              border: 1.5px solid #E2E8F0;
              border-radius: 12px;
              font-family: var(--font-body);
              font-size: 0.92rem;
              outline: none;
              transition: all 250ms ease;
              background: #F8FAFC;
              color: var(--color-navy);
            }
            .login-input-field:focus {
              border-color: var(--color-verde-e);
              background: #FFFFFF;
              box-shadow: 0 0 0 4px rgba(0, 184, 163, 0.12);
            }
            .login-input-field:focus + .login-icon-left {
              color: var(--color-verde-e);
            }
            .login-btn-submit {
              position: relative;
              width: 100%;
              padding: 0.8rem;
              background: linear-gradient(135deg, var(--color-azul-claro) 0%, var(--color-azul-fuerte) 100%);
              border: none;
              border-radius: 12px;
              color: white;
              font-family: var(--font-display);
              font-size: 0.95rem;
              font-weight: 700;
              letter-spacing: 0.02em;
              cursor: pointer;
              transition: all 250ms cubic-bezier(0.16, 1, 0.3, 1);
              margin-top: 1.5rem;
              overflow: hidden;
            }
            .login-btn-submit:hover:not(:disabled) {
              transform: translateY(-2px);
              box-shadow: 0 8px 24px rgba(0, 70, 135, 0.35);
            }
            .login-btn-submit:active:not(:disabled) {
              transform: translateY(0);
            }
            .login-btn-submit::after {
              content: '';
              position: absolute;
              top: 0; left: -50%; width: 30%; height: 100%;
              background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%);
              transform: skewX(-25deg);
              transition: 0.75s;
            }
            .login-btn-submit:hover::after {
              left: 120%;
            }
            .login-btn-submit:disabled {
              opacity: 0.7;
              cursor: not-allowed;
              transform: none !important;
              box-shadow: none !important;
            }
            .pass-toggle-btn {
              position: absolute;
              right: 0.875rem;
              background: none;
              border: none;
              cursor: pointer;
              color: #A0AEC0;
              padding: 4px;
              display: flex;
              align-items: center;
              transition: color 0.2s;
            }
            .pass-toggle-btn:hover {
              color: var(--color-azul-medio);
            }
          `}),e.jsxs("div",{style:{textAlign:"center",marginBottom:"2rem",display:"flex",flexDirection:"column",alignItems:"center"},children:[e.jsx("div",{className:"brand-logo-badge",style:{marginBottom:"1rem",cursor:"default"},children:e.jsx("img",{src:"/logo-escandon.png",alt:"Hospital Escandón",className:"brand-logo-img",style:{height:50}})}),e.jsx("p",{style:{fontFamily:"var(--font-display)",fontSize:"0.8rem",fontWeight:600,color:"#8A97A8",margin:0,letterSpacing:"0.02em"},children:"Inteligencia de Negocios · Hospital Escandón"})]}),e.jsxs("form",{onSubmit:w,noValidate:!0,children:[e.jsxs("div",{className:"login-field-group",children:[e.jsx("label",{className:"login-label",children:"Usuario"}),e.jsxs("div",{className:"login-input-container",children:[e.jsx("input",{className:"login-input-field",type:"text",name:"username",value:r.username,onChange:u,placeholder:"Ingrese su usuario",autoComplete:"off",autoFocus:!0,disabled:i}),e.jsx("span",{className:"login-icon-left",children:e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("path",{d:"M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"}),e.jsx("circle",{cx:"12",cy:"7",r:"4"})]})})]})]}),e.jsxs("div",{className:"login-field-group",style:{marginBottom:"0.75rem"},children:[e.jsx("label",{className:"login-label",children:"Contraseña"}),e.jsxs("div",{className:"login-input-container",children:[e.jsx("input",{className:"login-input-field",style:{paddingRight:"2.75rem"},type:p?"text":"password",name:"password",value:r.password,onChange:u,placeholder:"Ingrese su contraseña",autoComplete:"off",disabled:i}),e.jsx("span",{className:"login-icon-left",children:e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("rect",{x:"3",y:"11",width:"18",height:"11",rx:"2",ry:"2"}),e.jsx("path",{d:"M7 11V7a5 5 0 0 1 10 0v4"})]})}),e.jsx("button",{type:"button",onClick:()=>v(t=>!t),className:"pass-toggle-btn",tabIndex:-1,children:p?e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("path",{d:"M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"}),e.jsx("line",{x1:"1",y1:"1",x2:"23",y2:"23"})]}):e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"18",height:"18",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("path",{d:"M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"}),e.jsx("circle",{cx:"12",cy:"12",r:"3"})]})})]})]}),m&&e.jsxs("div",{style:{background:"rgba(239,68,68,0.06)",border:"1.5px solid rgba(239,68,68,0.15)",borderRadius:"10px",padding:"0.65rem 0.875rem",fontSize:"0.8rem",color:"#E53E3E",marginTop:"1rem",display:"flex",alignItems:"center",fontFamily:"var(--font-body)"},children:[e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round",style:{marginRight:"8px",flexShrink:0},children:[e.jsx("path",{d:"M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"}),e.jsx("line",{x1:"12",y1:"9",x2:"12",y2:"13"}),e.jsx("line",{x1:"12",y1:"17",x2:"12.01",y2:"17"})]}),m]}),e.jsx("button",{className:"login-btn-submit",type:"submit",disabled:i,children:i?e.jsxs("span",{style:{display:"flex",alignItems:"center",justifyContent:"center",gap:"0.6rem"},children:[e.jsx("span",{style:{width:16,height:16,border:"2px solid rgba(255,255,255,0.3)",borderTop:"2px solid white",borderRadius:"50%",animation:"spin 0.8s linear infinite",display:"block"}}),e.jsx("style",{children:"@keyframes spin{to{transform:rotate(360deg)}}"}),"Validando accesos…"]}):"Entrar"})]}),e.jsx("div",{style:{textAlign:"center",marginTop:"1.75rem",borderTop:"1px solid #EDF2F7",paddingTop:"1.25rem"},children:e.jsxs("p",{style:{fontFamily:"var(--font-mono)",fontSize:"0.68rem",color:"#A0AEC0",margin:0,display:"flex",alignItems:"center",justifyContent:"center",gap:"4px"},children:[e.jsxs("svg",{xmlns:"http://www.w3.org/2000/svg",width:"12",height:"12",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2.2",strokeLinecap:"round",strokeLinejoin:"round",style:{opacity:.7},children:[e.jsx("rect",{x:"3",y:"11",width:"18",height:"11",rx:"2",ry:"2"}),e.jsx("path",{d:"M7 11V7a5 5 0 0 1 10 0v4"})]}),"Acceso restringido · HE-BI v",e.jsx("span",{style:{fontWeight:600},children:"4.0"})," · ",new Date().getFullYear()]})})]})})]})}export{N as default};
