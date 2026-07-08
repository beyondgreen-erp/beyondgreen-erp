// /shipments now serves the full-featured Shipments page (detail on click: activity,
// history, attachments; month + Cancelled Orders tabs; analytics/map). The canonical
// implementation lives at /sales/shipments and is re-exported here so both URLs match.
export const dynamic = 'force-dynamic'
export { default } from '@/app/sales/shipments/page'
