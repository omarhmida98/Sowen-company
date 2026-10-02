import {Shell} from '@/components/Shell';import {HydrationBoundary} from '@/components/Preferences';
const loading=<div className="grid"><div className="card"><div className="muted">Chargement…</div></div><div className="card"><div className="muted">Chargement…</div></div><div className="card"><div className="muted">Chargement…</div></div><div className="card"><div className="muted">Chargement…</div></div></div>;
// HydrationBoundary replaces loading.tsx: same fallback, and it tells the translation layer when the page has hydrated.
export default function AppLayout({children}:{children:React.ReactNode}){return <Shell><HydrationBoundary fallback={loading}>{children}</HydrationBoundary></Shell>}
