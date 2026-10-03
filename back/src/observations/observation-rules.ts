// Pure rules about observations: what protects one from being replaced, and how an edit is described.
// Kept free of database code so they can be unit-tested (see back/test/observations.test.ts).

export type ProtectionReason = 'SENT_EMAIL' | 'REMINDER' | 'EVIDENCE' | 'HISTORY' | 'EDITED' | 'REVIEWED' | 'ASSIGNED';

export type ProtectionInput = {
  status: string;
  editedAt?: Date | null;
  reviewStatus?: string | null;
  generatedEmails: { status: string; sentAt?: Date | null; reminderCount?: number | null }[];
  evidenceCount: number;   // includes responses and files sent by the company
  historyCount: number;    // one entry is written at creation
  assignmentCount: number;
  draftEdited?: boolean;   // a person rewrote and saved the email draft
};

// An observation is protected as soon as a person or a company has acted on it. A protected observation is
// never deleted or overwritten by a new analysis of its report.
export function protectionReasons(o: ProtectionInput): ProtectionReason[] {
  const reasons: ProtectionReason[] = [];
  if (o.generatedEmails.some(e => e.sentAt && e.status !== 'ERROR')) reasons.push('SENT_EMAIL');
  if (o.generatedEmails.some(e => (e.reminderCount || 0) > 0)) reasons.push('REMINDER');
  if (o.evidenceCount > 0) reasons.push('EVIDENCE');
  // More than the creation entry, or a status beyond the initial ones, means the workflow has started.
  if (o.historyCount > 1 || !['OPEN', 'TO_SEND'].includes(o.status)) reasons.push('HISTORY');
  if (o.editedAt || o.draftEdited) reasons.push('EDITED');
  if (o.reviewStatus === 'VALIDATED' || o.reviewStatus === 'REJECTED') reasons.push('REVIEWED');
  if (o.assignmentCount > 0) reasons.push('ASSIGNED');
  return reasons;
}

export const PROTECTION_LABEL: Record<ProtectionReason, string> = {
  SENT_EMAIL: 'mail envoyé',
  REMINDER: 'relance envoyée',
  EVIDENCE: 'justificatif ou réponse de l’entreprise',
  HISTORY: 'historique de suivi',
  EDITED: 'observation ou brouillon modifié manuellement',
  REVIEWED: 'validée ou rejetée',
  ASSIGNED: 'responsable affecté',
};

// Two observations are "the same finding" when their titles match once case, accents and punctuation are ignored.
export function findingKey(title: string | null | undefined): string {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export const EDITABLE_FIELDS = ['title', 'description', 'reference', 'requiredAction', 'severity', 'dueDate', 'lotId', 'companyId'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export const FIELD_LABEL: Record<EditableField, string> = { title: 'Titre', description: 'Description', reference: 'Référence', requiredAction: 'Action attendue', severity: 'Sévérité', dueDate: 'Échéance', lotId: 'Lot', companyId: 'Entreprise' };
const SEVERITY_FR: Record<string, string> = { INFO: 'Information', LOW: 'Faible', MEDIUM: 'Moyenne', HIGH: 'Élevée', CRITICAL: 'Critique' };

export type FieldChange = { field: EditableField; label: string; from: string | null; to: string | null };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const text = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s || null; };

// Compares the stored observation with the requested values. Only fields present in `next` are considered;
// `names` gives display names for the lot and company ids involved.
export function diffObservation(
  current: { title: string; description: string; reference: string | null; requiredAction: string | null; severity: string; dueDate: Date | null; lotId: string | null; companyId: string | null },
  next: Partial<{ title: string; description: string; reference: string | null; requiredAction: string | null; severity: string; dueDate: Date | null; lotId: string | null; companyId: string | null }>,
  names: Record<string, string> = {},
): FieldChange[] {
  const changes: FieldChange[] = [];
  const name = (id: string | null) => (id ? names[id] || id : null);
  for (const field of EDITABLE_FIELDS) {
    if (!(field in next)) continue;
    let from: string | null, to: string | null;
    if (field === 'dueDate') { from = day(current.dueDate); to = day(next.dueDate ?? null); }
    else if (field === 'lotId' || field === 'companyId') { from = text(current[field]); to = text(next[field]); if (from !== to) { changes.push({ field, label: FIELD_LABEL[field], from: name(from), to: name(to) }); } continue; }
    else if (field === 'severity') { from = text(current.severity); to = text(next.severity); if (from !== to) changes.push({ field, label: FIELD_LABEL[field], from: from ? SEVERITY_FR[from] || from : null, to: to ? SEVERITY_FR[to] || to : null }); continue; }
    else { from = text(current[field]); to = text(next[field]); }
    if (from !== to) changes.push({ field, label: FIELD_LABEL[field], from, to });
  }
  return changes;
}

const short = (v: string | null) => (v === null ? '—' : v.length > 70 ? `${v.slice(0, 67)}…` : v);

// One line for the observation history: "Modification : Titre « a » → « b » ; Échéance — → 2026-10-15".
export function describeChanges(changes: FieldChange[]): string {
  return `Modification : ${changes.map(c => `${c.label} « ${short(c.from)} » → « ${short(c.to)} »`).join(' ; ')}`;
}
