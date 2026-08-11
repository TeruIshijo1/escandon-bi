# Análisis de Productividad (Excel vs SAP vs Vertical)

Al revisar tu archivo de Excel de Quirófano (que suma **94** procedimientos en Julio) y compararlo contra nuestras bases de datos en tiempo real, esto es lo que **falta o sobra**:

## 1. ¿Por qué SAP da 83 y el Excel 94?
En el Dashboard actual (alimentado por SAP) tenemos **83 folios facturados** en Quirófano (`CQX`) para Julio. 
La diferencia ocurre porque:
* **Pacientes vs Procedimientos:** SAP cuenta *pacientes ingresados* (Folios). El Excel cuenta *procedimientos*. Si a un paciente le hacen una Endoscopía + Colonoscopía al mismo tiempo (ej. *Folio 12345*), para SAP es **1** paciente en Quirófano, pero en el Excel anotaron **2** palomitas.
* **Áreas de Facturación:** En SAP vemos que rentan Endoscopios, pero algunos se facturaron probablemente desde `URG1` (Urgencias) o cuartos de piso, y no en `CQX` (Quirófano).

## 2. ¿Qué coincide perfecto entre tu Excel y la bitácora Vertical?
Sorprendentemente, el conteo manual del Excel sí coincide con la bitácora electrónica en varias cosas muy específicas:
* **Colonoscopías:** Excel reporta **6**. Vertical tiene exactamente **6**. (4 solas, 1 con endoscopia, 1 con panendoscopia).
* **Endoscopías:** Excel reporta **4**. Vertical tiene exactamente **4**.
* **Partos:** Excel reporta **2**. Vertical tiene **2**.

## 3. ¿Qué sobra o falta en Vertical vs Excel?
* **Cesáreas:** Excel reporta **6**. Vertical sólo tiene **4**. (Faltó registrar 2 cesáreas en la bitácora electrónica).
* **LUI (Legrado):** Excel reporta **2**. Vertical tiene **4**. (Aquí sobra en el sistema. Probablemente en el Excel sumaron 2 como cirugías normales por error).
* **Cirugías Generales:** El Excel suma **64**. Vertical registra alrededor de **52**. 

## Conclusión y Próximos Pasos
El Excel es un **registro manual de procedimientos**, mientras que el dashboard actual refleja la **realidad financiera (Folios cobrados)**. 

Si deseas que el Dashboard refleje esta misma vista categorizada del Excel (Maternidad, Endoscopías, Cirugías), lo ideal sería **crear una tabla nueva en el dashboard que categorice automáticamente** lo que venga escrito en el `Procedimiento` de Vertical usando reglas de palabras clave (ej. Si dice "CESAREA", ponlo en Maternidad). 

¿Te gustaría que agreguemos esa tablita de categorías en el dashboard basándonos en los textos de Vertical?

---
*P.D. Sobre la pantalla en blanco en la otra PC: cuando puedas, envíame la foto de la pestaña "Consola" tras presionar F12 en esa máquina para resolverlo en un minuto.*
