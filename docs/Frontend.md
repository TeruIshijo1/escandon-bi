# Frontend (React SPA)

La capa de presentación del proyecto, desarrollada con React y Vite.

## Responsabilidades
- Renderizar la interfaz de usuario con diseño Glassmorphism.
- Proteger rutas mediante control de acceso basado en roles (RBAC).
- Mostrar tableros y paneles mediante [[Grafico_BI]].
- Consumir las APIs expuestas por el [[Backend]].

## Módulos Clave
- **Autenticación**: `AuthContext.jsx` y `useAuth.js`.
- **Dashboards**: `DashboardDirectivo.jsx`, `DashboardArea.jsx`.
- **IA**: `AIAssistant.jsx` (Asistente ARIA).
- **Embebido**: Componente `EmbeddedBI.jsx` para reportes (ver [[Grafico_BI]]).
