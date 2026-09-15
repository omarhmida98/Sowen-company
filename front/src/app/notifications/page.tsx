'use client';
import {Shell} from '@/components/Shell';
import {NotificationCenter} from '@/components/NotificationCenter';
export default function NotificationsPage(){return <Shell><div className="topbar"><div className="title"><div className="eyebrow">Suivi opérationnel</div><h1>Notifications</h1><p>Les points qui nécessitent votre attention.</p></div></div><NotificationCenter/></Shell>}
