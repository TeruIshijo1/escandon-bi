/**
 * AuditoriaCargos.jsx — Consumos Clínicos
 * Hospital Escandón BI Platform v3.5
 * Módulo complementario al de Inventarios y Consumos
 */
import InventarioVsCargos from '../components/audit/InventarioVsCargos';

/* Reutiliza el componente principal filtrado solo a estado DIFERENCIA / FALTANTE */
export default function AuditoriaCargos() {
  return <InventarioVsCargos defaultEstado="DIFERENCIA" />;
}
