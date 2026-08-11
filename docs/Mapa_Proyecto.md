# Mapa del Proyecto: Hospital Escandón BI

Este es el nodo central del proyecto. Desde aquí puedes navegar a los diferentes módulos que componen la plataforma.

## Componentes Principales
- [[Frontend]]: Interfaz de usuario (React SPA).
- [[Backend]]: Servidor de APIs (Node.js/Express) y lógica de negocio.
- [[Database]]: Base de datos SQLite y scripts SQL.
- [[Pase_a_Produccion]]: Scripts y recursos para el despliegue a producción.

## Integración y Flujos
- La conexión principal de visualización de datos ocurre a través del [[Grafico_BI]].
- El usuario interactúa con el [[Frontend]], que solicita datos al [[Backend]].
- El [[Backend]] consulta la [[Database]] y procesa la información para enviarla de regreso.

## Referencias y Documentación Técnica
- **Estructura base:** [[ESTRUCTURA]] (Directorio raíz del proyecto).
- **Reglas del Asistente:** [[INSTRUCCIONES_IA]] contiene las directrices generales para la IA, apoyado por el [[ai_system_prompt]] específico del modelo.
- **APIs:** Las definiciones de endpoints se encuentran en [[api_spec]], consumidas directamente por el [[Backend]].
