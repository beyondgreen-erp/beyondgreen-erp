/** Legacy alias so links from older sequence emails still land somewhere valid. */
import Home from '../page'
export const dynamic = 'force-dynamic'
export const revalidate = 0
export default function LegacyAlias() { return <Home /> }
