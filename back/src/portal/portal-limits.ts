// Limits on what a company can send through its portal link. The link is the only credential, so a leaked or
// abused link must not be able to fill the server's disk. Pure, unit-tested (back/test/security.test.ts).

export type PortalLimits = { uploadsPerHour: number; filesPerObservation: number; totalBytes: number; responsesPerHour: number };

const positive = (raw: unknown, fallback: number) => { const text = String(raw ?? '').trim(); const n = Number(text); return text !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback; };

// PORTAL_UPLOADS_PER_HOUR (20), PORTAL_MAX_FILES_PER_OBSERVATION (30), PORTAL_MAX_TOTAL_MB (500, per company and
// project) and PORTAL_RESPONSES_PER_HOUR (30).
export function portalLimits(env: Record<string, unknown>): PortalLimits {
  return {
    uploadsPerHour: positive(env.PORTAL_UPLOADS_PER_HOUR, 20),
    filesPerObservation: positive(env.PORTAL_MAX_FILES_PER_OBSERVATION, 30),
    totalBytes: positive(env.PORTAL_MAX_TOTAL_MB, 500) * 1024 * 1024,
    responsesPerHour: positive(env.PORTAL_RESPONSES_PER_HOUR, 30),
  };
}

export type PortalUsage = { uploadsLastHour: number; filesOnObservation: number; totalBytes: number };
export type UploadRefusal = { status: 429 | 413; message: string };

// Why an upload is refused, or null. `incomingBytes` is the size of the file about to be stored (or the announced
// size of the request, before it is read).
export function uploadRefusal(usage: PortalUsage, limits: PortalLimits, incomingBytes = 0): UploadRefusal | null {
  if (usage.uploadsLastHour >= limits.uploadsPerHour) return { status: 429, message: 'Trop de fichiers envoyés en peu de temps. Réessayez dans une heure.' };
  if (usage.filesOnObservation >= limits.filesPerObservation) return { status: 413, message: `Le nombre maximal de justificatifs pour cette observation est atteint (${limits.filesPerObservation}). Contactez l’équipe projet.` };
  if (usage.totalBytes + Math.max(0, incomingBytes) > limits.totalBytes) return { status: 413, message: 'L’espace réservé aux justificatifs de votre entreprise sur ce projet est plein. Contactez l’équipe projet.' };
  return null;
}
