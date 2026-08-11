# Gráfico BI (Inteligencia de Negocios)

Este componente representa la capa de visualización e inteligencia de negocios para el Hospital Escandón. 

## Interacciones en el Grafo
- **Origen de datos**: Los datos crudos provienen de la [[Database]].
- **Procesamiento**: El [[Backend]] extrae, formatea y aplica reglas de negocio (ETL) sobre estos datos.
- **Visualización**: El [[Frontend]] recibe la información y la renderiza a través de componentes como `EmbeddedBI.jsx` o en tarjetas de KPI (`KPICard.jsx`).

El [[Grafico_BI]] es el punto de encuentro lógico donde convergen el [[Frontend]], [[Backend]] y [[Database]] para entregar valor analítico al usuario final.
