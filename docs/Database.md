# Database (SQLite)

Repositorio central de datos de la plataforma.

## Estructura
- Emplea SQLite (`better-sqlite3`) para alto rendimiento y baja configuración.
- Los esquemas iniciales, configuración de KPIs y datos ETL residen en los scripts `.sql`.

## Archivos Clave
- `01_schema.sql`: Definición de tablas.
- `02_seed_roles.sql`: Roles de usuarios.
- `03_views_etl.sql` / `03_data_hub.sql`: Vistas para auditoría y almacén de datos.
- `04_kpi_config.sql`: Configuración de KPIs que nutren el [[Grafico_BI]].

El acceso a la base de datos se realiza estrictamente desde el [[Backend]].
