import type {Metadata} from 'next';import './globals.css';import {PreferencesBoot} from '@/components/Preferences';
export const metadata:Metadata={title:'SOWEN V2',description:'Pré-contrôle et suivi des non-conformités chantier'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fr" suppressHydrationWarning><body><PreferencesBoot/>{children}</body></html>}
