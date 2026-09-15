import Link from 'next/link';
export default function NotFound(){return <main className="standalone-state"><div className="card ui-empty"><div className="eyebrow">404</div><h1>Page introuvable</h1><p className="muted">Cette page n’existe pas ou n’est plus disponible.</p><Link className="btn" href="/">Retour au tableau de bord</Link></div></main>}
