// Search and filters of the rule library. Pure, so it can be unit-tested (front/test).

// Shown wherever rules are entered, imported or applied: the library is the organisation's own.
export const RULES_DISCLAIMER = 'Ces règles sont celles que votre organisation a saisies ou importées. SOWEN ne vérifie pas leur exactitude réglementaire : elles restent sous votre responsabilité.';

export type RuleStatusFilter = '' | 'active' | 'inactive';
export type RuleFilters = { q?: string; lotId?: string; category?: string; status?: RuleStatusFilter };
export type FilterableRule = {
  title: string; domain: string; summary?: string | null; requirement: string; reference?: string | null; sourceDocument?: string | null;
  workType?: string | null; controlPoint?: string | null; actionRequest?: string | null; active: boolean; lot?: { id: string; name: string } | null;
};

// Value of the lot filter that selects rules applying to every lot.
export const ALL_LOTS = 'none';
const normalize = (v?: string | null) => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function filterRules<T extends FilterableRule>(rows: T[], f: RuleFilters): T[] {
  const words = normalize(f.q).split(/\s+/).filter(Boolean);
  return rows.filter(r => {
    if (f.status === 'active' && !r.active) return false;
    if (f.status === 'inactive' && r.active) return false;
    if (f.category && normalize(r.domain) !== normalize(f.category)) return false;
    if (f.lotId && (f.lotId === ALL_LOTS ? Boolean(r.lot) : r.lot?.id !== f.lotId)) return false;
    if (!words.length) return true;
    const haystack = normalize([r.title, r.domain, r.summary, r.requirement, r.reference, r.sourceDocument, r.workType, r.controlPoint, r.actionRequest, r.lot?.name].filter(Boolean).join(' '));
    return words.every(w => haystack.includes(w));
  });
}

// Categories present in the library, each once (case and accents ignored), sorted.
export function categories(rows: { domain: string }[]): string[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.domain && !seen.has(normalize(r.domain))) seen.set(normalize(r.domain), r.domain);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

export const hasActiveRuleFilters = (f: RuleFilters) => Boolean(f.q?.trim() || f.lotId || f.category || f.status);

// What the screens say about the library: nothing to match against, or ready.
export type LibraryState = 'EMPTY' | 'ALL_INACTIVE' | 'READY';
export function libraryState(summary: { total: number; active: number }): LibraryState {
  if (!summary.total) return 'EMPTY';
  return summary.active ? 'READY' : 'ALL_INACTIVE';
}
