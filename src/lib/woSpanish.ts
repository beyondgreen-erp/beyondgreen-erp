// English + Spanish wording for the printed work order paperwork, so floor staff can read every
// label in either language. Labels print as the English word with the Spanish under it, e.g.
// "Operator" / "(Operador)". Words missing from the list print in English only.
import type { jsPDF } from 'jspdf'

export const ES: Record<string, string> = {
  // titles + sections
  'Work Order': 'Orden de trabajo', 'WORK ORDER': 'ORDEN DE TRABAJO', 'PRODUCT': 'PRODUCTO', 'BY ORDER': 'POR ORDEN',
  'MATERIALS (BOM)': 'MATERIALES', 'PRODUCTION LOG (filled in on the floor)': 'REGISTRO DE PRODUCCIÓN (se llena en planta)',
  'SIGN-OFF': 'FIRMAS', 'Sign-Off': 'Firmas',
  'Packing: use these counts on every case': 'Empaque: use estas cantidades en cada caja',
  'Product Specifications': 'Especificaciones del producto',
  'Materials: record the lot number and actual quantity used': 'Materiales: anote el número de lote y la cantidad real usada',
  'Production Calculator': 'Calculadora de producción', 'Orders on this work order': 'Órdenes en esta orden de trabajo',
  'Special Notes / Set-Up Instructions': 'Notas especiales / instrucciones de preparación',
  'Production Record: completed on the floor': 'Registro de producción: se llena en planta',
  // fields
  'Work Order #': 'Orden de trabajo #', 'Status': 'Estado', 'Customer': 'Cliente', 'PO #': 'Orden de compra #',
  'Sales Order #': 'Orden de venta #', 'Ship Date': 'Fecha de envío', 'Start Date': 'Fecha de inicio', 'Due Date': 'Fecha límite',
  'Operator': 'Operador', 'Machine': 'Máquina', 'Machine #': 'Máquina #', 'Item SKU': 'SKU del artículo',
  'Item Part # (SKU)': 'Número de parte (SKU)', 'Customer Part #': 'Número de parte del cliente', 'Description': 'Descripción',
  'Quantity to Make': 'Cantidad a fabricar', 'Cases': 'Cajas', 'Size': 'Tamaño', 'Thickness': 'Grosor', 'Color': 'Color',
  'Print': 'Impresión', 'Unit Weight (g)': 'Peso por unidad (g)', 'UPC / GTIN': 'Código UPC / GTIN', 'Case Size': 'Tamaño de caja',
  'Cases / Pallet': 'Cajas por tarima', 'Cases per Pallet': 'Cajas por tarima', 'Special Instructions': 'Instrucciones especiales',
  'Made so far': 'Producido hasta ahora', 'Lot #': 'Lote #', 'Date': 'Fecha', 'Straw Quantity': 'Cantidad de popotes', 'UOM': 'Unidad',
  'Customer PO': 'Orden de compra del cliente', 'Required Ship Date': 'Fecha de envío requerida', 'Supervisor': 'Supervisor',
  'Scheduled Start': 'Inicio programado', 'Pcs per Case': 'Piezas por caja', 'Cases to Pack': 'Cajas a empacar',
  'Case Labels Needed': 'Etiquetas de caja necesarias', 'Case Weight (lb)': 'Peso de caja (lb)',
  'Inner Diameter (mm)': 'Diámetro interior (mm)', 'Straw Length (in)': 'Largo del popote (pulg)', 'Wall Thickness (mm)': 'Grosor de pared (mm)',
  'Straw Weight (g)': 'Peso del popote (g)', 'Straw Color': 'Color del popote', 'Wrapper': 'Envoltura', 'Wrapper Print': 'Impresión de envoltura',
  'Print Color': 'Color de impresión', 'Print Plate': 'Placa de impresión', 'Ext. Cycle Time (M/Min)': 'Velocidad de extrusión (M/min)',
  'Straws Needed': 'Popotes necesarios', 'Extruded Length (M)': 'Largo extruido (M)', 'Production Hours': 'Horas de producción',
  'Total Resin (lb)': 'Resina total (lb)', 'Shift': 'Turno', 'Date Run': 'Fecha de producción', 'Actual Start Time': 'Hora real de inicio',
  'Actual Stop Time': 'Hora real de paro', 'Total Run Hours': 'Horas totales de producción', 'Good Cases Produced': 'Cajas buenas producidas',
  'Scrap / Reject Qty': 'Cantidad de desperdicio / rechazo', 'Scrap Reason': 'Motivo del desperdicio',
  'Operator (print & sign)': 'Operador (nombre y firma)', 'QC Check': 'Control de calidad', 'Quality Check': 'Control de calidad',
  'Checked By': 'Revisado por', 'Material': 'Material', 'Artwork / Plate #': 'Arte / placa #', 'Gusset': 'Fuelle', 'Seal Type': 'Tipo de sello', 'Perforation': 'Perforación', 'Notes': 'Notas', 'Completed By': 'Completado por',
  // table headings
  'SO #': 'Orden de venta #', 'Ordered': 'Pedido', 'Ship': 'Envío', 'Component': 'Componente', 'Basis': 'Base', 'Per': 'Por',
  'Needed': 'Necesario', 'Shift / Operator': 'Turno / Operador', 'Scrap': 'Desperdicio', 'Initials': 'Iniciales',
  'Material (role)': 'Material (función)', 'Component SKU': 'SKU del componente', 'Qty': 'Cant.', 'Req. (lb)': 'Requerido (lb)',
  'Lot / Batch #': 'Lote #', 'Used': 'Usado', 'Sales Order': 'Orden de venta', 'Pcs / Case': 'Piezas / caja', 'Pieces': 'Piezas',
  // values
  '% weight': '% peso', 'per case': 'por caja', 'per pack': 'por paquete', 'per unit': 'por unidad', '% by weight': '% por peso',
  'Raw material': 'Materia prima', 'Additive': 'Aditivo', 'Packaging': 'Empaque', 'Stock build': 'Producción para inventario',
  // close-out summary
  'Work Order Close-out Summary': 'Resumen de cierre de la orden de trabajo', 'Targets vs made': 'Objetivo vs producido',
  'Where it went: by load and PO': 'A dónde fue: por carga y orden de compra', 'Where it went: by sales order': 'A dónde fue: por orden de venta',
  'Loose ends': 'Pendientes', 'Who did the work': 'Quién hizo el trabajo', 'Materials used (net of voids)': 'Materiales usados (sin anulados)',
  'Dates': 'Fechas', 'SKU': 'SKU', 'Product': 'Producto', 'Target': 'Objetivo', 'Made': 'Producido', 'Over / under': 'Más / menos',
  'Total': 'Total', 'Load': 'Carga', 'Order': 'Orden', 'PO': 'Orden de compra', 'Released': 'Liberado', 'Claimed': 'Reclamado',
  'Built': 'Armado', 'Flag': 'Alerta', 'Type': 'Tipo', 'Item': 'Artículo', 'Detail': 'Detalle', 'Person': 'Persona', 'Logs': 'Registros',
  'Days': 'Días', 'Voided entry': 'Registro anulado', 'Logged by': 'Registrado por', 'Voided by': 'Anulado por', 'Reason': 'Motivo',
  'Week of': 'Semana del', 'Due': 'Fecha límite', 'First log': 'Primer registro', 'Last log': 'Último registro', 'Closed': 'Cerrado',
  'Weeks open': 'Semanas abierta', 'Under target': 'Debajo del objetivo', 'Made, not released': 'Producido, no liberado',
  'PO still open': 'Orden de compra abierta', 'Shipped short': 'Enviado incompleto', 'Written off': 'Dado de baja', 'None': 'Ninguno',
  'On target': 'En objetivo', 'Shipped': 'Enviado', 'Open': 'Abierta', 'No load': 'Sin carga',
  'UNITS': 'UNIDADES', 'CASE': 'Cajas', 'CASES': 'Cajas', 'CS': 'Cajas', 'PK': 'Paquetes', 'PACK': 'Paquetes', 'EA': 'Piezas', 'PCS': 'Piezas', 'BAG': 'Bolsas', 'BAGS': 'Bolsas', 'ROLL': 'Rollos', 'Units': 'Unidades', 'units': 'unidades', 'cases': 'cajas', 'SRP': 'SRP',
}

export const es = (en: string) => ES[en] || ''
/** "Name (Nombre)" on one line */
export const bi = (en: string) => { const s = es(en); return s && s !== en ? `${en} (${s})` : en }
/** "Name" + newline + "Nombre" (autoTable headings) */
export const bi2 = (en: string) => { const s = es(en); return s && s !== en ? `${en}\n${s}` : en }
/** "SECTION  /  SECCIÓN" for the green bars */
export const biBar = (en: string) => { const s = es(en); return s && s !== en ? `${en}  /  ${s}` : en }
/** unit-based headings like "Cases made" -> "Cajas producidas" */
export const unitEs = (u: string) => ES[u] || ES[u.toUpperCase()]?.toLowerCase() || u

function fit(doc: jsPDF, t: string, w: number, size: number, min: number) {
  let fs = size; doc.setFontSize(fs)
  while (fs > min && doc.getTextWidth(t) > w) { fs -= 0.2; doc.setFontSize(fs) }
}

/** English label (bold) with the Spanish under it (italic), shrunk to fit the width. Inches. */
export function drawBiLabel(doc: jsPDF, en: string, x: number, y: number, w: number, esOverride?: string) {
  const s = esOverride ?? es(en)
  doc.setTextColor(70, 75, 90); doc.setFont('helvetica', 'bold'); fit(doc, en, w, 7, 5.2)
  doc.text(en, x, s ? y + 0.105 : y + 0.15)
  if (s && s !== en) { doc.setFont('helvetica', 'italic'); doc.setTextColor(100, 106, 122); fit(doc, `(${s})`, w, 6.4, 4.6); doc.text(`(${s})`, x, y + 0.215) }
  doc.setTextColor(0, 0, 0)
}

/** Two-line table heading cell (English bold, Spanish italic). align: 'left' | 'center'. */
export function drawBiHead(doc: jsPDF, en: string, x: number, y: number, w: number, align: 'left' | 'center' = 'left', color: [number, number, number] = [0, 0, 0], esOverride?: string) {
  const s = esOverride ?? es(en)
  const tx = align === 'center' ? x + w / 2 : x + 0.03
  doc.setTextColor(...color); doc.setFont('helvetica', 'bold'); fit(doc, en, w - 0.06, 7.2, 5)
  doc.text(en, tx, s ? y + 0.13 : y + 0.19, { align })
  if (s && s !== en) { doc.setFont('helvetica', 'italic'); fit(doc, s, w - 0.06, 6.3, 4.4); doc.text(s, tx, y + 0.255, { align }) }
  doc.setTextColor(0, 0, 0)
}
