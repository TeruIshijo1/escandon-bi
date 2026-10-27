


USE [KH_HE];
DECLARE @Desde date = '20260901';
DECLARE @HastaExclusiva date = '20260926';

SELECT DB_NAME() AS BaseConsultada, SYSDATETIME() AS FechaConsulta;
SELECT o.name, OBJECTPROPERTY(o.object_id, 'IsEncrypted') AS Cifrada,
  HAS_PERMS_BY_NAME(SCHEMA_NAME(o.schema_id)+'.'+o.name,'OBJECT','VIEW DEFINITION') AS PuedeVerDefinicion
FROM sys.objects o WHERE o.name IN ('UDR_HON_PAGO','UDR_HON_PAGO_Audit');



SELECT a.UDRKey, a.ItemCode, a.OrigenRenglon, COUNT(*) AS FilasAuditoria,
  MIN(a.IMPORTE) AS ImporteAuditoriaMin, MAX(a.IMPORTE) AS ImporteAuditoriaMax,
  MIN(p.Quantity) AS CantidadPago, MIN(p.BaseImporte) AS BasePago,
  SUM(p.BaseImporte) AS BaseRepetidaPorJoin
FROM UDR_HON_PAGO_Audit a
LEFT JOIN UDR_HON_PAGO p ON p.UDRKey=a.UDRKey AND p.ItemCode=a.ItemCode
WHERE a.PCDate>=@Desde AND a.PCDate<@HastaExclusiva
  AND (a.ItemGroupName IS NULL OR a.ItemGroupName NOT IN ('ALMACEN GENERAL','FARMACIA'))
  AND a.Elegible_V_HON_PAGO=1
  AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion='' OR a.MotivoExclusion NOT LIKE 'No entra%')
  AND a.Medico IS NOT NULL AND a.Medico<>''
GROUP BY a.UDRKey,a.ItemCode,a.OrigenRenglon HAVING COUNT(*)>1;


SELECT COUNT(*) AS ClavesConVariosServicios FROM (
  SELECT UDRKey FROM UDR_HON_PAGO_Audit
  WHERE PCDate>=@Desde AND PCDate<@HastaExclusiva
  GROUP BY UDRKey HAVING COUNT(DISTINCT ItemCode)>1
) x;


SELECT ISRRateNorm,IvaRateLinea,TaxCode,COUNT(*) AS Filas,
  SUM(BaseImporte) AS Base,SUM(IvaLinea) AS IVA
FROM UDR_HON_PAGO WHERE PCDate>=@Desde AND PCDate<@HastaExclusiva
GROUP BY ISRRateNorm,IvaRateLinea,TaxCode;

SELECT ISRRateNorm,COUNT(*) AS FilasConIVAPC,
  SUM(CASE WHEN ABS(RetISR_PC-Subtotal_PC*ISRRateNorm)<0.011 THEN 1 ELSE 0 END) AS CoincideISRBase,
  SUM(CASE WHEN ABS(RetISR_PC-Total_PC*ISRRateNorm)<0.011 THEN 1 ELSE 0 END) AS CoincideISRBruto
FROM UDR_HON_PAGO
WHERE PCDate>=@Desde AND PCDate<@HastaExclusiva AND IVA_PC>0 AND ISRRateNorm>0
GROUP BY ISRRateNorm;

SELECT UDRKey,ItemCode,Quantity,ImporteUnitario,BaseImporte,SinTabulador
FROM UDR_HON_PAGO WHERE PCDate>=@Desde AND PCDate<@HastaExclusiva
  AND ABS(BaseImporte-Quantity*ImporteUnitario)>0.011;

SELECT ITEMCODE,COUNT(*) AS Filas,MIN(IMPORTE) AS Minimo,MAX(IMPORTE) AS Maximo
FROM UT_Honorarios GROUP BY ITEMCODE HAVING COUNT(*)>1;

SELECT UDF_TIPO_MEDICO,UDF_ISR,UDF_IVA,COUNT(*) AS PrestadoresActivos
FROM PR WHERE Active=1 GROUP BY UDF_TIPO_MEDICO,UDF_ISR,UDF_IVA;


SELECT a.OrigenRenglon,COUNT(*) AS FilasSinVistaPago,SUM(a.IMPORTE) AS ImporteAuditoria
FROM UDR_HON_PAGO_Audit a
LEFT JOIN UDR_HON_PAGO p ON p.UDRKey=a.UDRKey AND p.ItemCode=a.ItemCode
WHERE a.PCDate>=@Desde AND a.PCDate<@HastaExclusiva
  AND p.UDRKey IS NULL
  AND (a.ItemGroupName IS NULL OR a.ItemGroupName NOT IN ('ALMACEN GENERAL','FARMACIA'))
  AND a.Elegible_V_HON_PAGO=1
  AND (a.MotivoExclusion IS NULL OR a.MotivoExclusion='' OR a.MotivoExclusion NOT LIKE 'No entra%')
  AND a.Medico IS NOT NULL AND a.Medico<>''
GROUP BY a.OrigenRenglon;
