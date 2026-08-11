# Backend (Node.js / Express)

Servidor que maneja la lógica de negocio, seguridad y acceso a datos.

## Responsabilidades
- Exponer endpoints REST para el [[Frontend]].
- Gestionar la autenticación y validación de roles mediante JWT.
- Conectarse y extraer datos de la [[Database]].
- Proveer los datos necesarios para renderizar el [[Grafico_BI]].
- Ejecutar los procesos ETL y lógica del asistente IA (RAG).

## Módulos Clave
- **Controladores y Rutas**: `auth`, `dashboard`, `audit`, `export`, `ai`.
- **Servicios**: `etl.service.js`, `bi.service.js`, `rag.service.js`.
- **Base de Datos**: Configuración en `db.js` conectando a SQLite (ver [[Database]]).
