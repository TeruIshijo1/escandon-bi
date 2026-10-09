'use strict';

const { connectRemoteDB, sql } = require('../config/remote-db');

// Las expresiones SQL pertenecen a este catálogo cerrado. Los valores del usuario
// sólo entran como parámetros. Se consulta Vertical sin modificar sus tablas.
const definitions = Object.create(null);
const catalog = Object.create(null);
const field = (key, label, type = 'string', expression = `v.[${key}]`) => ({
  key, label, type, expression,
  width: type === 'string' ? 190 : type === 'datetime' ? 180 : 140,
  ...(['money', 'number', 'percent'].includes(type) ? { align: 'right' } : {})
});
const f = field;

function define(id, config, fields) {
  const { from, date, order, where, status, medicalDischargeDate, ...metadata } = config;
  definitions[id] = { from, date, order, where, status, medicalDischargeDate, fields };
  catalog[id] = {
    id, source: 'Vertical', requiresDateFilter: Boolean(date), filters: [], summary: {},
    ...metadata,
    defaultFields: metadata.defaultFields || fields.slice(0, 8).map(item => item.key),
    fields: fields.map(({ expression: _expression, ...column }) => column)
  };
}

define('vertical_accounts', {
  title: 'Cuentas y atenciones hospitalarias', icon: '🏥', category: 'Hospitalización y Cuentas',
  description: 'Cuentas clínicas con ingreso, alta, médico, total, anticipos y saldo registrados en Vertical.',
  grain: 'Una fila por cuenta o atención médica (PCNum).',
  dateFieldLabel: 'Fecha de atención', date: 'v.[Date]', from: 'PC v', order: 'v.[Date] DESC, v.PCNum DESC',
  summary: { amountField: 'Total', amountLabel: 'Total de cuentas' }
}, [
  f('PCNum', 'Folio de atención', 'number'), f('Fecha', 'Fecha de atención', 'datetime', 'v.[Date]'),
  f('PTNum', 'Número de paciente', 'number'), f('PCType', 'Tipo de atención'), f('PC_ST', 'Estado Vertical'),
  f('BPCode', 'Código de pagador'), f('PRNum', 'Número de médico', 'number'), f('Total', 'Total registrado', 'money'),
  f('Balance', 'Saldo registrado', 'money'), f('Downpayments', 'Anticipos', 'money'),
  f('SubtotalCost', 'Costo registrado', 'money'), f('Profit', 'Utilidad registrada', 'money'),
  f('MedicalDischargeDate', 'Fecha de alta médica', 'datetime'), f('ClosedOn', 'Fecha de cierre', 'datetime'),
  f('CreatedOn', 'Fecha de creación', 'datetime')
]);

define('vertical_account_charges', {
  title: 'Detalle de cargos de cuentas', icon: '🧾', category: 'Hospitalización y Cuentas',
  description: 'Artículos y servicios cargados a cada atención: cantidad y precio unitario originales.',
  grain: 'Una fila por cargo de cuenta (PCITNum).',
  dateFieldLabel: 'Fecha de cargo', date: 'v.ChargeDate', from: 'PCIT v', order: 'v.ChargeDate DESC, v.PCITNum DESC',
  summary: { quantityField: 'Quantity', quantityLabel: 'Unidades registradas' }
}, [
  f('PCITNum', 'Número de cargo', 'number'), f('PCNum', 'Folio de atención', 'number'),
  f('ChargeDate', 'Fecha de cargo', 'datetime'), f('SUCode', 'Unidad de servicio'), f('ItemCode', 'Código de artículo'),
  f('ItemDescription', 'Artículo o servicio'), f('Quantity', 'Cantidad', 'number'), f('UnitPrice', 'Precio unitario', 'money')
]);

const serviceFields = [
  f('FOLIO_DE_ATENCION', 'Folio de atención'), f('NUMERO_DE_CARGO', 'Número de cargo', 'number'),
  f('FECHA_DE_CARGO', 'Fecha de cargo', 'datetime'), f('UNIDAD_DE_SERVICIO', 'Unidad de servicio'),
  f('NOMBRE_DEL_PACIENTE', 'Paciente'), f('CODIGO', 'Código de artículo'), f('DESCRIPCION_DEL_ARTICULO', 'Artículo o servicio'),
  f('CANTIDAD', 'Cantidad', 'number'), f('DEVUELTO', 'Cantidad devuelta', 'number'),
  f('TOTAL_COBRADO', 'Total cobrado en la vista', 'money'), f('PRECIO_UNITARIO', 'Precio unitario', 'money'),
  f('DESCUENTO', 'Descuento', 'money'), f('TOTAL_SIN_DESC', 'Importe sin descuento', 'money'),
  f('TOTAL_A_PAGAR_AL_SUBROGADO', 'Importe de referencia del subrogado', 'money'),
  f('NUMERO_DE_ORDEN', 'Número de orden', 'number'), f('ESTATUS_CH', 'Estado de cuenta Vertical'),
  f('FECHA_CERRADO_CH', 'Fecha de cierre', 'datetime'), f('GRUPO_DE_ARTICULOS', 'Grupo de artículos')
];
define('vertical_service_charges', {
  title: 'Cargos por unidad de servicio', icon: '💳', category: 'Servicios Clínicos',
  description: 'Cargos, devoluciones, descuentos y médicos de urgencias, quirófano, consulta y otros servicios.',
  grain: 'Una fila de detalle de la vista de cuentas de servicios; conserva sus cargos y devoluciones.',
  defaultFields: ['FOLIO_DE_ATENCION', 'FECHA_DE_CARGO', 'UNIDAD_DE_SERVICIO', 'NOMBRE_DEL_PACIENTE', 'DESCRIPCION_DEL_ARTICULO', 'CANTIDAD', 'DEVUELTO', 'TOTAL_COBRADO', 'Medico_Tratante'],
  dateFieldLabel: 'Fecha de cargo', date: 'v.FECHA_DE_CARGO', from: 'UDR_CUENTAS_SERVICIOS v',
  order: 'v.FECHA_DE_CARGO DESC, v.NUMERO_DE_CARGO DESC, v.CODIGO',
  summary: { amountField: 'TOTAL_COBRADO', amountLabel: 'Total cobrado en vista', quantityField: 'CANTIDAD', quantityLabel: 'Unidades registradas' }
}, [
  ...serviceFields, f('Medico_Solicitante', 'Médico solicitante'), f('Medico_Tratante', 'Médico tratante'),
  f('Anestesiologo', 'Anestesiólogo'), f('ESTATUS_DEVOLUCION', 'Estado de devolución'),
  f('FECHA_DE_DEVOLUCION', 'Fecha de devolución', 'datetime')
]);

define('vertical_consultation_schedule', {
  title: 'Agenda de consulta externa', icon: '📅', category: 'Consulta Externa',
  description: 'Citas programadas con paciente, médico, especialidad y estados originales de cita y orden.',
  grain: 'Una fila de la agenda de citas de Vertical (UDR_CPP).',
  dateFieldLabel: 'Fecha programada', date: 'v.Fecha', from: 'UDR_CPP v', order: 'v.Fecha DESC, v.Hora, v.Numero_Cita'
}, [
  f('Numero_Cita', 'Número de cita', 'number'), f('Fecha', 'Fecha programada', 'date'),
  f('Hora', 'Hora programada', 'string', 'CONVERT(varchar(8), v.Hora, 108)'), f('Medico', 'Médico'),
  f('Especialidad', 'Especialidad'), f('Numero_Paciente', 'Número de paciente', 'number'), f('Paciente', 'Paciente'),
  f('PCAP_ST_Descripcion', 'Estado de cita'), f('Articulo', 'Servicio'), f('Ejecutada', 'Realización registrada'),
  f('GrupoEjecucion', 'Grupo de ejecución'), f('SO_ST', 'Estado de orden Vertical'),
  f('PCAP_SONum', 'Orden vinculada en cita', 'number'), f('SO_SONum', 'Orden vinculada en venta', 'number'),
  f('EstadoPagoAuditoria', 'Estado de pago según vista'), f('UDF_InvoicePaid', 'Factura pagada registrada'),
  f('DXDescription_ES', 'Diagnóstico'), f('Comentarios', 'Comentarios'), f('Folio_Medico', 'Número de médico', 'number')
]);

define('vertical_consultations_day', {
  title: 'Consulta del día y órdenes vinculadas', icon: '🩺', category: 'Consulta Externa',
  description: 'Consultas del periodo, servicios y estados de orden reportados por la vista clínica del día.',
  grain: 'Una fila de la vista de consulta del día (V_UDR_CONSULTA_DIA).',
  dateFieldLabel: 'Fecha de consulta', date: 'v.Fecha', from: 'V_UDR_CONSULTA_DIA v',
  order: 'v.Fecha DESC, v.Hora, v.Numero_Cita'
}, [
  f('Numero_Cita', 'Número de cita', 'number'), f('Fecha', 'Fecha de consulta', 'date'),
  f('Hora', 'Hora de consulta', 'string', 'CONVERT(varchar(8), v.Hora, 108)'), f('Medico', 'Médico'),
  f('MSDescription_ES', 'Especialidad'), f('Numero_Paciente', 'Número de paciente', 'number'),
  f('Paciente', 'Paciente'), f('Estatus_Orden_Venta', 'Estado de orden'), f('Articulo', 'Servicio'),
  f('Edad_Anios', 'Edad en años'), f('Folio_Medico', 'Número de médico', 'number')
]);

define('vertical_study_requests', {
  title: 'Solicitudes de estudios y auxiliares', icon: '🔬', category: 'Estudios y Auxiliares',
  description: 'Estudios solicitados por área, médico y tipo de atención, con cantidades registradas.',
  grain: 'Una fila por solicitud de estudio (PCPRITNum).',
  dateFieldLabel: 'Fecha de solicitud', date: 'v.Fecha', from: 'UDR_BI_SOLICITUDES_ESTUDIOS v',
  order: 'v.Fecha DESC, v.PCPRITNum DESC', summary: { quantityField: 'Cantidad', quantityLabel: 'Estudios solicitados' }
}, [
  f('PCPRITNum', 'Número de solicitud', 'number'), f('Fecha', 'Fecha de solicitud', 'date'), f('Estudio', 'Estudio'),
  f('SUCode', 'Código de área'), f('AreaNombre', 'Área'), f('Medico', 'Médico'), f('TipoAtencion', 'Tipo de atención'),
  f('Cantidad', 'Cantidad', 'number')
]);

define('vertical_auxiliary_charges', {
  title: 'Cobros de imagenología y auxiliares', icon: '🧪', category: 'Estudios y Auxiliares',
  description: 'Detalle de cobros de auxiliares con fecha del cargo original y total de línea de la vista.',
  grain: 'Una fila de UDR_PAY_IMA, vinculada a su cargo PCIT por PCITNum.',
  dateFieldLabel: 'Fecha de cargo', date: 'p.ChargeDate', from: 'UDR_PAY_IMA v INNER JOIN PCIT p ON p.PCITNum = v.PCITNum',
  order: 'p.ChargeDate DESC, v.PCITNum DESC, v.ItemCode',
  summary: { amountField: 'LineTotal', amountLabel: 'Total de líneas', quantityField: 'Quantity', quantityLabel: 'Unidades registradas' }
}, [
  f('PCITNum', 'Número de cargo', 'number'), f('ChargeDate', 'Fecha de cargo', 'datetime', 'p.ChargeDate'),
  f('SUCode', 'Unidad de servicio'), f('LineType', 'Tipo de línea'), f('FullName', 'Paciente'),
  f('ItemCode', 'Código de artículo'), f('ItemDescription', 'Artículo o servicio'), f('Quantity', 'Cantidad', 'number'),
  f('LineTotal', 'Total de línea', 'money')
]);

define('vertical_surgeries', {
  title: 'Cirugías y uso de quirófano', icon: '🏥', category: 'Quirófano',
  description: 'Cirugías con paciente, sala, médicos, procedimientos y estado actual de la cuenta y del alta médica.',
  grain: 'Una fila por cirugía registrada.',
  filters: ['estatusDoc'], statusField: 'EstadoCuenta', medicalDischargeField: 'AltaMedica',
  statusLabel: 'Estado de cuenta o alta médica',
  statusDescription: 'El estado es el actual. Una cuenta puede estar abierta o cerrada y tener alta médica. El período corresponde al inicio de la cirugía.',
  statusOptions: [{ value: 'ALL', label: 'Todas las cuentas' }, { value: 'OPEN', label: 'Abiertas' }, { value: 'CLOSED', label: 'Cerradas' }, { value: 'MEDICAL_DISCHARGE', label: 'Con alta médica' }, { value: 'NO_MEDICAL_DISCHARGE', label: 'Sin alta médica' }, { value: 'CANCELED', label: 'Canceladas' }],
  defaultFields: ['PCFRNum', 'FechaInicio', 'FechaFin', 'Quirofano', 'Numero_Paciente', 'Paciente', 'Medicos', 'Procedimientos', 'EstadoCuenta', 'AltaMedica'],
  dateFieldLabel: 'Inicio de cirugía', date: 'v.FechaInicio',
  from: 'UDR_USOQX v LEFT JOIN PCFR surgeryStay ON surgeryStay.PCFRNum = v.PCFRNum LEFT JOIN PC attention ON attention.PCNum = surgeryStay.PCNum',
  status: 'attention.PC_ST', medicalDischargeDate: 'attention.MedicalDischargeDate',
  order: 'v.FechaInicio DESC, v.PCFRNum DESC'
}, [
  f('PCFRNum', 'Número de estancia quirúrgica', 'number'), f('FechaInicio', 'Inicio', 'datetime'), f('FechaFin', 'Fin', 'datetime'),
  f('Quirofano', 'Quirófano'), f('Numero_Paciente', 'Número de paciente', 'number'), f('Paciente', 'Paciente'),
  f('Medicos', 'Médicos registrados'), f('Procedimientos', 'Procedimientos'), f('Numero_Atencion_Medica', 'Folio de atención'),
  f('EstadoCuenta', 'Estado de cuenta', 'string', "CASE WHEN attention.PCNum IS NULL THEN 'Sin información' WHEN attention.PC_ST = 'OP' THEN 'Abierta' WHEN attention.PC_ST = 'CL' THEN 'Cerrada' WHEN attention.PC_ST = 'CA' THEN 'Cancelada' ELSE 'Otro estado' END"),
  f('AltaMedica', 'Alta médica', 'string', "CASE WHEN attention.PCNum IS NULL THEN 'Sin información' WHEN attention.MedicalDischargeDate IS NOT NULL THEN N'Sí' ELSE 'No' END"),
  f('FechaAltaMedica', 'Fecha de alta médica', 'datetime', 'attention.MedicalDischargeDate'),
  f('FechaCierreCuenta', 'Fecha de cierre de cuenta', 'datetime', 'attention.ClosedOn')
]);

define('vertical_physician_productivity', {
  title: 'Productividad médica diaria', icon: '📊', category: 'Productividad e Indicadores',
  description: 'Primeras consultas, subsecuentes y atenciones por médico, especialidad y día.',
  grain: 'Una fila por médico, especialidad y fecha de la vista de productividad.',
  dateFieldLabel: 'Fecha de atención', date: 'v.Fecha', from: 'UDR_BI_PRODUCTIVIDAD_MEDICOS v',
  order: 'v.Fecha DESC, v.Medico, v.Especialidad',
  summary: { quantityField: 'TotalAtenciones', quantityLabel: 'Atenciones' }
}, [
  f('Fecha', 'Fecha', 'date'), f('Medico', 'Médico'), f('Especialidad', 'Especialidad'),
  f('Primeras', 'Primeras consultas', 'number'), f('Subsecuentes', 'Consultas subsecuentes', 'number'),
  f('TotalAtenciones', 'Total de atenciones', 'number')
]);

define('vertical_operational_indicators', {
  title: 'Indicadores operativos por periodo', icon: '⏱️', category: 'Productividad e Indicadores',
  description: 'Ocupación y tiempos de triaje, laboratorio, imagenología y egreso con metas de la vista.',
  grain: 'Una fila por periodo consolidado; los tiempos y ocupaciones no deben sumarse entre periodos.',
  dateFieldLabel: 'Fecha del periodo', date: 'v.FechaPeriodo', from: 'UDR_BI_INDICADORES_OPERATIVOS v',
  order: 'v.FechaPeriodo DESC, v.Anio DESC, v.Mes DESC'
}, [
  f('FechaPeriodo', 'Fecha del periodo', 'date'), f('Anio', 'Año', 'number'), f('Mes', 'Mes', 'number'),
  f('CamasOcupadas', 'Camas ocupadas', 'number'), f('QuirofanosActivos', 'Quirófanos activos', 'number'),
  f('Urgencias', 'Urgencias', 'number'), f('Hospitalizacion', 'Hospitalización', 'number'),
  ...['Triaje', 'Laboratorio', 'Imagenologia'].flatMap((key) => [
    f(`${key}Min`, `${key}: minutos`, 'number'), f(`${key}Meta`, `${key}: meta`, 'number'),
    f(`${key}Outliers`, `${key}: fuera de meta`, 'number'), f(`${key}Registros`, `${key}: registros`, 'number'),
    f(`Estado${key}`, `${key}: estado`)
  ]),
  f('EgresoHoras', 'Egreso: horas', 'number'), f('EgresoMeta', 'Egreso: meta', 'number'),
  f('EgresoRegistros', 'Egreso: registros', 'number'), f('EstadoEgreso', 'Egreso: estado')
]);

const feeFields = [
  f('UDRKey', 'Referencia Vertical'), f('PCNum', 'Folio de atención', 'number'), f('PCDate', 'Fecha de atención', 'datetime'),
  f('PTName', 'Paciente'), f('Medico', 'Médico'), f('Especialidad', 'Especialidad'), f('ItemCode', 'Código de servicio'),
  f('ItemDescription', 'Servicio'), f('Quantity', 'Cantidad', 'number'), f('BPName', 'Pagador'),
  f('ItemGroupName', 'Grupo de artículos'), f('UDF_TIPO_MEDICO', 'Tipo de médico'),
  f('SONum', 'Número de orden', 'number'), f('PCAP_ST', 'Estado de cita Vertical'), f('SO_ST', 'Estado de orden Vertical')
];
define('vertical_fee_reference', {
  title: 'Honorarios: cálculo de referencia Vertical', icon: '💼', category: 'Honorarios Médicos',
  description: 'Base e IVA calculados por Vertical, tabulador y alertas. Estos importes no acreditan un pago aplicado.',
  grain: 'Una fila de cálculo en UDR_HON_PAGO; no representa un movimiento de pago.',
  defaultFields: ['PCDate', 'PCNum', 'PTName', 'Medico', 'Especialidad', 'ItemDescription', 'Quantity', 'BaseImporte', 'IvaLinea', 'SinTabulador'],
  dateFieldLabel: 'Fecha de atención', date: 'v.PCDate', from: 'UDR_HON_PAGO v',
  order: 'v.PCDate DESC, v.UDRKey, v.ItemCode, v.Medico',
  summary: { amountField: 'BaseImporte', amountLabel: 'Base de referencia Vertical' }
}, [
  ...feeFields, f('ImporteUnitario', 'Importe unitario de referencia', 'money'),
  f('BaseImporte', 'Base de referencia', 'money'), f('IvaLinea', 'IVA de referencia', 'money'),
  f('SinTabulador', 'Sin tabulador', 'number'), f('AuditMsg', 'Alerta de auditoría'),
  f('SlotAmbiguo', 'Vínculo de cita ambiguo', 'number'), f('SOCount', 'Órdenes relacionadas', 'number')
]);

define('vertical_fee_audit', {
  title: 'Honorarios: universo y auditoría Vertical', icon: '🔎', category: 'Honorarios Médicos',
  description: 'Universo completo de la vista de auditoría, incluyendo exclusiones y reglas de elegibilidad de Vertical.',
  grain: 'Una fila original de auditoría en UDR_HON_PAGO_Audit; no implica aprobación o liquidación en BI.',
  defaultFields: ['PCDate', 'PCNum', 'PTName', 'Medico', 'ItemDescription', 'Quantity', 'IMPORTE', 'Elegible_V_HON_PAGO', 'MotivoExclusion', 'OrigenRenglon'],
  dateFieldLabel: 'Fecha de atención', date: 'v.PCDate', from: 'UDR_HON_PAGO_Audit v',
  order: 'v.PCDate DESC, v.UDRKey, v.ItemCode, v.Medico, v.OrigenRenglon'
}, [
  ...feeFields, f('OrigenRenglon', 'Origen del renglón'), f('UnitPrice', 'Precio registrado', 'money'),
  f('IMPORTE', 'Importe de referencia de auditoría', 'money'), f('IvaLinea', 'IVA de referencia', 'money'),
  f('Elegible_V_HON_PAGO', 'Elegibilidad según Vertical'), f('MotivoExclusion', 'Motivo de exclusión'),
  f('Pasa_PC_ST', 'Pasa regla de estado'), f('Pasa_ItemType', 'Pasa regla de artículo'),
  f('Pasa_UT_Honorarios', 'Pasa regla de tabulador'), f('Pasa_Incluido_Honorarios', 'Pasa regla de inclusión')
]);

define('vertical_sales_orders', {
  title: 'Órdenes de venta Vertical · resumen por orden', icon: '📋', category: 'Servicios Clínicos',
  description: 'Todas las órdenes de venta Vertical del periodo, con paciente, folio de atención e importes de cabecera; incluye órdenes sin líneas de servicio.',
  grain: 'Una fila por orden de venta (SONum). Los importes corresponden a la cabecera de cada orden.',
  defaultFields: ['SONum', 'CreatedOn', 'PatientName', 'PCNum', 'SO_ST', 'BPCode', 'Subtotal', 'Total'],
  dateFieldLabel: 'Fecha de creación de orden', date: 'v.CreatedOn',
  // PTNum es clave primaria única y activa, comprobada por metadata el 2026-10-06.
  from: 'SO v LEFT JOIN PT patient ON patient.PTNum = v.PTNum',
  order: 'v.CreatedOn DESC, v.SONum DESC',
  summary: { amountField: 'Total', amountLabel: 'Total de órdenes de venta' }
}, [
  f('SONum', 'Número de orden', 'number'), f('CreatedOn', 'Creación de orden', 'datetime'),
  f('SO_ST', 'Estado de orden Vertical'), f('PTNum', 'Número de paciente', 'number'),
  f('PCNum', 'Folio de atención', 'number'),
  f('PatientName', 'Paciente', 'string', "NULLIF(LTRIM(RTRIM(patient.FullName)), '')"),
  f('PR_RQ', 'Número de médico solicitante', 'number'), f('BPCode', 'Código de pagador'),
  f('SOType', 'Tipo de orden Vertical'), f('Subtotal', 'Subtotal de orden', 'money'),
  f('TaxTotal', 'Impuesto de orden', 'money'), f('Total', 'Total de orden', 'money')
]);

define('vertical_service_orders', {
  title: 'Órdenes de venta de servicios', icon: '📋', category: 'Servicios Clínicos',
  description: 'Líneas de servicio de órdenes Vertical, con paciente registrado, precio, cantidad, total de línea y estado real.',
  grain: 'Una fila por línea de servicio (SOLNNum); el total de cabecera no se repite en las líneas.',
  defaultFields: ['SONum', 'CreatedOn', 'PatientName', 'PCNum', 'ItemDescription', 'Quantity', 'UnitPrice', 'LineTotal'],
  dateFieldLabel: 'Fecha de creación de orden', date: 's.CreatedOn',
  from: `SO s INNER JOIN SOLN v ON v.SONum = s.SONum
    OUTER APPLY (SELECT CASE WHEN COUNT(DISTINCT NULLIF(LTRIM(RTRIM(pt.FullName)), '')) = 1
      THEN MIN(NULLIF(LTRIM(RTRIM(pt.FullName)), '')) END PatientName
      FROM PT pt WHERE pt.PTNum = s.PTNum) patient
    OUTER APPLY (SELECT MIN(i.ItemDescription) ItemDescription, MIN(i.ItemGroupName) ItemGroupName
      FROM V_IT i WHERE i.ItemCode = v.ItemCode AND i.ItemType = 'S') item`,
  where: "EXISTS (SELECT 1 FROM V_IT i WHERE i.ItemCode = v.ItemCode AND i.ItemType = 'S')",
  order: 's.CreatedOn DESC, s.SONum DESC, v.LineNum, v.SOLNNum',
  summary: { amountField: 'LineTotal', amountLabel: 'Total de líneas de servicio', quantityField: 'Quantity', quantityLabel: 'Unidades ordenadas' }
}, [
  f('SONum', 'Número de orden', 'number'), f('SOLNNum', 'Número de línea', 'number'),
  f('CreatedOn', 'Creación de orden', 'datetime', 's.CreatedOn'), f('ItemCode', 'Código de servicio'),
  f('ItemDescription', 'Servicio', 'string', 'item.ItemDescription'), f('Quantity', 'Cantidad', 'number'),
  f('UnitPrice', 'Precio unitario', 'money'), f('LineTotal', 'Total de línea', 'money'),
  f('SO_ST', 'Estado de orden Vertical', 'string', 's.SO_ST'), f('SOLN_ST', 'Estado de línea Vertical'),
  f('PCNum', 'Folio de atención', 'number', 's.PCNum'), f('PTNum', 'Número de paciente', 'number', 's.PTNum'),
  f('PatientName', 'Paciente', 'string', 'patient.PatientName'),
  f('PR_RQ', 'Número de médico solicitante', 'number', 's.PR_RQ'), f('BPCode', 'Código de pagador', 'string', 's.BPCode'),
  f('ItemGroupName', 'Grupo de servicios', 'string', 'item.ItemGroupName'),
  f('UDF_FromDate', 'Inicio programado (texto de origen)', 'string', 's.UDF_FromDate'),
  f('UDF_ToDate', 'Fin programado (texto de origen)', 'string', 's.UDF_ToDate'),
  f('UDF_Realizado', 'Realización registrada', 'string', 's.UDF_Realizado')
]);

define('vertical_physicians', {
  title: 'Directorio de médicos y especialidades', icon: '👨‍⚕️', category: 'Catálogos Clínicos',
  description: 'Médicos de Vertical, especialidad, actividad y permisos de consulta y recetas.',
  grain: 'Una fila por médico con rol P (PRNum).',
  from: 'PR v LEFT JOIN MS m ON m.MSCode = v.MSCode',
  where: "v.Role = 'P' AND NULLIF(LTRIM(RTRIM(v.FullName)), '') IS NOT NULL", order: 'v.FullName, v.PRNum'
}, [
  f('PRNum', 'Número de médico', 'number'), f('FullName', 'Médico'), f('MSCode', 'Código de especialidad'),
  f('Especialidad', 'Especialidad', 'string', 'm.MSDescription_ES'), f('Active', 'Activo en Vertical'),
  f('UDF_TIPO_MEDICO', 'Tipo de médico'), f('AllowAppointments', 'Permite citas'),
  f('WritesPrescriptions', 'Emite recetas'), f('ProvidesExternalServices', 'Presta servicios externos')
]);

define('vertical_service_catalog', {
  title: 'Catálogo de servicios de Vertical', icon: '📚', category: 'Catálogos Clínicos',
  description: 'Servicios disponibles, grupo, descripción, unidad de medida y habilitación de la ficha clínica.',
  grain: 'Una fila de ficha de servicio de V_IT por origen y artículo; un código puede tener varios orígenes.',
  from: 'V_IT v', where: "v.ItemType = 'S'", order: 'v.ItemGroupName, v.ItemCode, v.DBName, v.FCCode'
}, [
  f('ItemCode', 'Código de servicio'), f('ItemName', 'Nombre'), f('ItemDescription', 'Descripción'),
  f('ItemGroupName', 'Grupo de servicios'), f('ItemGroupCode', 'Código de grupo'), f('Enabled', 'Habilitado'),
  f('UnitOfMeasure', 'Unidad de medida'), f('ItemType', 'Tipo de artículo'), f('IsSalesItem', 'Artículo de venta'),
  f('DBName', 'Origen de ficha'), f('FCCode', 'Centro de ficha')
]);

define('vertical_receivables', {
  title: 'Cartera y saldos de cuentas hospitalarias', icon: '💰', category: 'Hospitalización y Cuentas',
  description: 'Cuentas por cobrar, abonos, saldo pendiente, antigüedad y convenio de la vista de cartera.',
  grain: 'Una fila de cuenta en UDR_BI_CARTERA; los saldos son valores actuales al consultar.',
  defaultFields: ['PCNum', 'FechaIngreso', 'NombrePaciente', 'TipoAtencion', 'Convenio', 'TotalFacturado', 'TotalAbonado', 'SaldoPendiente', 'AntiguedadSaldo', 'EsCarteraVencida'],
  dateFieldLabel: 'Fecha de ingreso', date: 'v.FechaIngreso', from: 'UDR_BI_CARTERA v',
  order: 'v.FechaIngreso DESC, v.PCNum DESC', summary: { amountField: 'SaldoPendiente', amountLabel: 'Saldo pendiente actual' }
}, [
  f('PCNum', 'Folio de atención', 'number'), f('FechaIngreso', 'Fecha de ingreso', 'datetime'),
  f('NombrePaciente', 'Paciente'), f('TipoAtencion', 'Tipo de atención'), f('Medico', 'Médico'),
  f('Convenio', 'Convenio'), f('TotalFacturado', 'Total facturado', 'money'), f('TotalAbonado', 'Total abonado', 'money'),
  f('SaldoPendiente', 'Saldo pendiente actual', 'money'), f('TotalDevuelto', 'Total devuelto', 'money'),
  f('PorcentajeCobrado', 'Porcentaje cobrado', 'percent'), f('EstadoAtencion', 'Estado de atención'),
  f('AntiguedadSaldo', 'Antigüedad del saldo'), f('DiasDesdeTermino', 'Días desde término', 'number'),
  f('EsCarteraVencida', 'Cartera vencida'), f('FechaAlta', 'Fecha de alta', 'datetime'), f('FechaCierre', 'Fecha de cierre', 'datetime'),
  f('PTNum', 'Número de paciente', 'number'), f('PRNum', 'Número de médico', 'number')
]);

define('vertical_discharges', {
  title: 'Altas y egresos hospitalarios', icon: '🚪', category: 'Hospitalización y Cuentas',
  description: 'Altas registradas por atención, paciente, tipo de atención y motivo o tipo de alta.',
  grain: 'Una fila de alta médica reportada por UDR_ATM_EGRESO.',
  dateFieldLabel: 'Fecha de alta', date: 'v.FechaAlta', from: 'UDR_ATM_EGRESO v',
  order: 'v.FechaAlta DESC, v.AtencionMedica DESC, v.NoPaciente'
}, [
  f('AtencionMedica', 'Folio de atención', 'number'), f('FechaAlta', 'Fecha de alta', 'datetime'),
  f('NoPaciente', 'Número de paciente', 'number'), f('Paciente', 'Paciente'), f('TipoAtencion', 'Tipo de atención'),
  f('CodigoTipoAtencion', 'Código de tipo de atención'), f('TipoAlta', 'Tipo de alta'), f('CodigoAlta', 'Código de alta')
]);

define('vertical_room_stays', {
  title: 'Habitaciones y estancias', icon: '🛏️', category: 'Hospitalización y Cuentas',
  description: 'Estancias por habitación con paciente, médico, fecha de entrada, cierre y estados nativos.',
  grain: 'Una fila de estancia/habitación de UDR_RPT_HABITACION; una atención puede tener varias estancias.',
  dateFieldLabel: 'Fecha de entrada a estancia', date: 'v.EntryDate', from: 'UDR_RPT_HABITACION v',
  order: 'v.EntryDate DESC, v.PCNum DESC, v.FRName'
}, [
  f('PCNum', 'Folio de atención', 'number'), f('EntryDate', 'Entrada a estancia', 'datetime'),
  f('Paciente', 'Paciente'), f('FRName', 'Habitación o recurso'), f('Medico', 'Médico'),
  f('ClosedOn', 'Fecha de cierre', 'datetime'), f('PCFR_ST', 'Estado de estancia Vertical'), f('FR_ST', 'Estado de recurso Vertical'),
  f('PTNum', 'Número de paciente', 'number'), f('ModifiedBy', 'Modificado por')
]);

const monthDate = 'DATEFROMPARTS(v.Anio, v.Mes, 1)';
define('vertical_returns_monthly', {
  title: 'Devoluciones clínicas por mes', icon: '↩️', category: 'Servicios Clínicos',
  description: 'Resumen mensual de artículos devueltos por unidad, usuario y artículo.',
  grain: 'Una fila agregada de devoluciones por mes y dimensiones de UDR_BI_DEVOLUCIONES.',
  defaultFields: ['FechaPeriodo', 'ItemCode', 'ItemDescription', 'SUCode', 'VecesDevuelto', 'CantidadDevuelta', 'MontoTotalDevuelto'],
  dateFieldLabel: 'Mes de devolución (primer día del mes)', date: monthDate, from: 'UDR_BI_DEVOLUCIONES v',
  order: 'v.Anio DESC, v.Mes DESC, v.ItemCode, v.SUCode, v.CreatedBy, v.ModifiedBy',
  summary: { amountField: 'MontoTotalDevuelto', amountLabel: 'Monto devuelto', quantityField: 'CantidadDevuelta', quantityLabel: 'Unidades devueltas' }
}, [
  f('FechaPeriodo', 'Periodo (primer día del mes)', 'date', monthDate), f('Anio', 'Año', 'number'), f('Mes', 'Mes', 'number'),
  f('MesNombre', 'Nombre del mes'), f('ItemCode', 'Código de artículo'), f('ItemDescription', 'Artículo'),
  f('SUCode', 'Unidad de servicio'), f('VecesDevuelto', 'Eventos de devolución', 'number'),
  f('CantidadDevuelta', 'Cantidad devuelta', 'number'), f('MontoTotalDevuelto', 'Monto devuelto', 'money'),
  f('CreatedBy', 'Creado por'), f('ModifiedBy', 'Modificado por')
]);

define('vertical_prescriptions', {
  title: 'Recetas y tratamientos indicados', icon: '💊', category: 'Farmacia Clínica',
  description: 'Renglones de receta, medicamento, vía, frecuencia e instrucciones del tratamiento.',
  grain: 'Una fila por renglón de receta según UDR_RECETA_MEDICA (PCRXNum y NLINEA).',
  dateFieldLabel: 'Inicio del tratamiento', date: 'v.F_INICIO', from: 'UDR_RECETA_MEDICA v',
  order: 'v.F_INICIO DESC, v.PCRXNum DESC, v.NLINEA'
}, [
  f('PCRXNum', 'Número de receta', 'number'), f('NLINEA', 'Renglón de receta', 'number'),
  f('F_INICIO', 'Inicio del tratamiento', 'datetime'), f('FullName', 'Paciente'), f('MEDICO', 'Médico'),
  f('MEDICAMENTO', 'Medicamento'), f('FRECUENCIA', 'Frecuencia'), f('VIA', 'Vía de administración'),
  f('INSTRUCCIONES', 'Instrucciones'), f('ToDate', 'Fin del tratamiento', 'datetime'),
  f('Dispense', 'Dispensación registrada', 'number'), f('TotalDosage', 'Dosis total registrada', 'number'),
  f('Hours', 'Horario registrado'), f('CEDULA', 'Cédula médica'), f('ItemDescription', 'Descripción de artículo')
]);

define('vertical_physician_revenue_monthly', {
  title: 'Consultas e ingresos médicos por mes', icon: '📈', category: 'Productividad e Indicadores',
  description: 'Consultas e ingresos mensuales por médico registrados en la vista de ingresos de Vertical.',
  grain: 'Una fila por médico y mes de UDR_BI_INGRESOS_MEDICOS; ingresos clínicos de referencia de la vista.',
  dateFieldLabel: 'Mes de ingresos (primer día del mes)', date: monthDate, from: 'UDR_BI_INGRESOS_MEDICOS v',
  order: 'v.Anio DESC, v.Mes DESC, v.PRNum',
  summary: { amountField: 'IngresosTotales', amountLabel: 'Ingresos de la vista', quantityField: 'TotalConsultas', quantityLabel: 'Consultas' }
}, [
  f('FechaPeriodo', 'Periodo (primer día del mes)', 'date', monthDate), f('PRNum', 'Número de médico', 'number'),
  f('Medico', 'Médico'), f('Anio', 'Año', 'number'), f('Mes', 'Mes', 'number'), f('MesNombre', 'Nombre del mes'),
  f('TotalConsultas', 'Consultas del mes', 'number'), f('IngresosTotales', 'Ingresos registrados en vista', 'money')
]);

define('vertical_subcontracted_services', {
  title: 'Servicios subrogados: importes de referencia', icon: '🤝', category: 'Servicios Clínicos',
  description: 'Detalle clínico de cargos subrogados e importe a pagar calculado por la vista de Vertical.',
  grain: 'Una fila de cargo subrogado en UDR_PAGO_SUBROGADOS; no acredita una transferencia efectuada.',
  defaultFields: ['FOLIO_DE_ATENCION', 'FECHA_DE_CARGO', 'UNIDAD_DE_SERVICIO', 'NOMBRE_DEL_PACIENTE', 'DESCRIPCION_DEL_ARTICULO', 'CANTIDAD', 'TOTAL_COBRADO', 'TOTAL_A_PAGAR_AL_SUBROGADO'],
  dateFieldLabel: 'Fecha de cargo', date: 'v.FECHA_DE_CARGO', from: 'UDR_PAGO_SUBROGADOS v',
  order: 'v.FECHA_DE_CARGO DESC, v.NUMERO_DE_CARGO DESC, v.CODIGO',
  summary: { amountField: 'TOTAL_A_PAGAR_AL_SUBROGADO', amountLabel: 'Referencia de subrogados' }
}, serviceFields);

const ticketFields = [
  f('PCPRNum', 'Número de solicitud', 'number'), f('PCNum', 'Folio de atención', 'number'),
  f('CreatedOn', 'Fecha de registro', 'datetime'), f('FullName', 'Paciente'), f('SUCode', 'Unidad de servicio'),
  f('FRName', 'Habitación o recurso'), f('ItemCode', 'Código de artículo'), f('ItemName', 'Artículo'),
  f('BatchCode', 'Lote'), f('ExpirationDate', 'Caducidad', 'date'), f('Quantity', 'Cantidad', 'number'),
  f('UnitPrice', 'Precio unitario', 'money'), f('Amount', 'Importe de línea', 'money'),
  f('TaxAmount', 'Impuesto de línea', 'money'), f('LineTotal', 'Total de línea', 'money'),
  f('CreatedBy', 'Registrado por'), f('DateProcess', 'Fecha de proceso', 'datetime'), f('UserProcess', 'Usuario de proceso')
];
define('vertical_clinical_supply_tickets', {
  title: 'Tickets de insumos y lotes por atención', icon: '📦', category: 'Farmacia Clínica',
  description: 'Insumos clínicos por paciente y solicitud, con lote, caducidad, cantidad e importe original.',
  grain: 'Una fila de detalle de ticket clínico de UDR_TICKET_FR; conserva el lote de cada renglón.',
  defaultFields: ['PCNum', 'CreatedOn', 'FullName', 'ItemName', 'BatchCode', 'ExpirationDate', 'Quantity', 'LineTotal'],
  dateFieldLabel: 'Fecha de registro de ticket', date: 'v.CreatedOn', from: 'UDR_TICKET_FR v',
  order: 'v.CreatedOn DESC, v.PCPRNum DESC, v.ItemCode, v.BatchCode',
  summary: { amountField: 'LineTotal', amountLabel: 'Total de líneas', quantityField: 'Quantity', quantityLabel: 'Unidades registradas' }
}, ticketFields);
define('vertical_clinical_return_tickets', {
  title: 'Tickets de devolución de insumos clínicos', icon: '🔄', category: 'Farmacia Clínica',
  description: 'Detalle de devoluciones clínicas por solicitud, paciente, artículo y lote.',
  grain: 'Una fila original de ticket de devolución de UDR_ticket_fr_dev; conserva el signo del importe y cantidad.',
  defaultFields: ['PCNum', 'CreatedOn', 'FullName', 'ItemName', 'BatchCode', 'Quantity', 'LineTotal'],
  dateFieldLabel: 'Fecha de registro de devolución', date: 'v.CreatedOn', from: 'UDR_ticket_fr_dev v',
  order: 'v.CreatedOn DESC, v.PCPRNum DESC, v.ItemCode, v.BatchCode',
  summary: { amountField: 'LineTotal', amountLabel: 'Importe de devoluciones en vista', quantityField: 'Quantity', quantityLabel: 'Cantidad de devoluciones en vista' }
}, ticketFields);

function civilDate(value) {
  if (!(value instanceof Date)) return value;
  if (!Number.isFinite(value.getTime())) return null;
  const pad = number => String(number).padStart(2, '0');
  // remote-db usa useUTC:false. Las fechas civiles se conservan en hora local,
  // incluso para cargos de las 23:xx, sin desplazarlas con toISOString().
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Exact hospital identities may be consulted without guessing an admission
// period. The scope is derived by the report engine, never from a request body.
for (const [id, keys] of Object.entries({
  vertical_accounts: ['PCNum', 'PTNum'], vertical_account_charges: ['PCNum'],
  vertical_sales_orders: ['PCNum', 'PTNum'], vertical_service_orders: ['PCNum', 'PTNum'],
  vertical_receivables: ['PCNum', 'PTNum']
})) catalog[id].pointLookupFields = keys;

async function execute(entityId, options = {}) {
  const id = typeof entityId === 'string' ? entityId : entityId?.id;
  const definition = definitions[id];
  if (!definition) throw Object.assign(new Error('El módulo Vertical no existe.'), { status: 400 });
  const { fechaDesde, fechaHasta, busqueda, estatusDoc = 'ALL', pointLookup } = options;
  if (pointLookup && (!(catalog[id].pointLookupFields || []).includes(pointLookup.field)
    || !Number.isInteger(pointLookup.value) || pointLookup.value < 1 || pointLookup.value > 2147483647)) {
    throw Object.assign(new Error('La identificación de la cuenta o paciente no es válida.'), { status: 400 });
  }
  const limit = options.limit === undefined ? 10000 : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) {
    throw Object.assign(new Error('El límite debe estar entre 1 y 10000 registros.'), { status: 400 });
  }
  const hasPeriod = Boolean(fechaDesde || fechaHasta);
  if (definition.date && (!pointLookup || hasPeriod) && (!validDate(fechaDesde) || !validDate(fechaHasta) || fechaDesde > fechaHasta
    || (Date.parse(fechaHasta) - Date.parse(fechaDesde)) / 86400000 > 366)) {
    throw Object.assign(new Error('El periodo de consulta Vertical no es válido.'), { status: 400 });
  }
  if (busqueda != null && (typeof busqueda !== 'string' || busqueda.length > 500)) {
    throw Object.assign(new Error('El texto de búsqueda no es válido.'), { status: 400 });
  }
  const states = catalog[id].statusOptions?.map(option => option.value) || ['ALL'];
  if (typeof estatusDoc !== 'string' || !states.includes(estatusDoc)) throw Object.assign(new Error('El estado elegido no está disponible para este reporte.'), { status: 400 });

  const remotePool = await connectRemoteDB();
  const request = remotePool.request().input('rowLimit', sql.Int, limit + 1);
  const conditions = definition.where ? [definition.where] : [];
  if (estatusDoc === 'MEDICAL_DISCHARGE') conditions.push(`${definition.medicalDischargeDate} IS NOT NULL`);
  else if (estatusDoc === 'NO_MEDICAL_DISCHARGE') conditions.push(`${definition.status} IS NOT NULL`, `${definition.medicalDischargeDate} IS NULL`);
  else if (estatusDoc !== 'ALL') {
    request.input('estadoCuenta', sql.NVarChar(2), { OPEN: 'OP', CLOSED: 'CL', CANCELED: 'CA' }[estatusDoc]);
    conditions.push(`${definition.status} = @estadoCuenta`);
  }
  if (pointLookup) {
    request.input('pointIdentity', sql.Int, pointLookup.value);
    conditions.push(`${definition.fields.find(field => field.key === pointLookup.field).expression} = @pointIdentity`);
  }
  if (definition.date && hasPeriod) {
    request.input('fechaDesde', sql.VarChar(10), fechaDesde).input('fechaHasta', sql.VarChar(10), fechaHasta);
    conditions.push(`${definition.date} >= CAST(@fechaDesde AS date)`,
      `${definition.date} < DATEADD(day, 1, CAST(@fechaHasta AS date))`);
  }
  const search = busqueda?.trim();
  if (search) {
    // La búsqueda se aplica antes de TOP. Los comodines escritos por el usuario
    // se tratan como texto literal, no como patrones ni fragmentos de SQL.
    request.input('busqueda', sql.NVarChar(1002), `%${search.replace(/[\\%_[]/g, '\\$&')}%`);
    conditions.push(`(${definition.fields.map(column => {
      const style = ['date', 'datetime'].includes(column.type) ? ', 126' : '';
      return `CONVERT(nvarchar(4000), ${column.expression}${style}) LIKE @busqueda ESCAPE '\\'`;
    }).join(' OR ')})`);
  }
  const result = await request.query(`SELECT TOP (@rowLimit)
    ${definition.fields.map(column => `${column.expression} AS [${column.key}]`).join(',\n    ')}
    FROM ${definition.from}
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY ${definition.order}`);
  const recordset = result.recordset || [];
  if (pointLookup && recordset.some(row => Number(row[pointLookup.field]) !== pointLookup.value)) {
    throw new Error('No se pudo verificar la identidad de todos los registros de la cuenta o paciente.');
  }
  return {
    rows: recordset.slice(0, limit).map(row => Object.fromEntries(definition.fields.map(column => [column.key, civilDate(row[column.key])]))),
    truncated: recordset.length > limit
  };
}

module.exports = { catalog, execute };
