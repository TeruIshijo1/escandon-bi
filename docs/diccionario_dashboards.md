# Diccionario de Datos y Reglas de Data Science (BI)

Este documento centraliza las definiciones técnicas, reglas de limpieza (ETL) y algoritmos predictivos utilizados en los dashboards nativos de la plataforma Hospital Escandón BI.

---

## 1. Dashboard: Macropanel Financiero Nativo

Este panel sustituye la vista antigua de Power BI y se conecta directamente a la tabla `PC` (Cuentas de Pacientes) y `PT` (Demografía de Pacientes) de la base de datos `KH_HE`.

### A. Reglas de Limpieza de Información (Data Quality Pipeline)
Para asegurar que Dirección General y Finanzas vean únicamente **actividad económica real**, los datos crudos pasan por el siguiente embudo de validación:

1. **Solo Cuentas Finalizadas:** 
   - Se excluyen las cuentas abiertas o en piso. 
   - *Criterio SQL:* `PC_ST = 'CL'` (Estado "Cerrada").
2. **Exclusión de Cancelaciones:** 
   - Se excluyen atenciones anuladas o con cargos cancelados en su totalidad.
3. **Filtro de Montos Válidos (Ceros y Negativos):** 
   - *Criterio SQL:* `Total > 0`. Esto elimina cortesías, garantías y errores de captura. Las devoluciones se calculan por separado.
4. **Exclusión de Pacientes de Prueba:** 
   - *Criterio SQL:* Se hace un `JOIN` con la tabla `PT` y se excluyen los nombres que contengan `TEST` o `PRUEBA`.
5. **Validación de Fechas:** 
   - *Criterio SQL:* `MedicalDischargeDate >= Date` y `MedicalDischargeDate <= GETDATE()`. Excluye incongruencias temporales o altas futuras.

### B. Análisis de Outliers (Detección de Anomalías IQR)
En lugar de eliminar cuentas con montos extremadamente altos (ej. cirugías mayores, pacientes internacionales), se utiliza el método estadístico **Rango Intercuartílico (IQR)** para marcarlos.
- Se calculan el Cuartil 1 (Q1) y el Cuartil 3 (Q3) de los ingresos del mes.
- `IQR = Q3 - Q1`.
- Límite Superior = `Q3 + 1.5 * IQR`.
- Todo registro mayor al Límite Superior se suma al panel, pero se contabiliza como **"Posible Outlier"** en la auditoría, indicando que requiere revisión humana.

### C. Proyecciones y Predicciones (Data Science)
Para dotar a la plataforma de inteligencia a futuro, se aplica un modelo matemático de **Regresión Lineal Simple** (Mínimos Cuadrados) sobre los últimos meses de historia financiera.
- **Variable Independiente (X):** El índice del mes histórico.
- **Variable Dependiente (Y):** Ingresos totales o Utilidades de ese mes.
- El algoritmo calcula la pendiente (crecimiento promedio mensual) y proyecta los próximos **3 meses**. En la gráfica, estos meses aparecen con una línea punteada indicando que son valores "Predictivos".

### D. Significado de las Métricas Entregadas
- **Ingresos Netos Validados:** Suma total de `Total` de las cuentas que superaron todo el pipeline de Data Quality.
- **Utilidad Operativa:** Suma de `Profit` de las cuentas válidas.
- **Cuentas por Cobrar Activas:** Monto total en `Balance` pendiente de liquidación.
- **Margen Promedio:** `(Utilidad / Ingresos) * 100`. Indica la rentabilidad de las atenciones brindadas en el periodo.
- **Tasa de Validez de Datos:** Porcentaje de registros que ingresaron al pipeline frente a los que pasaron todas las pruebas de calidad. Un porcentaje >95% indica excelente higiene de captura.
