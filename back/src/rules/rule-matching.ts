// Preventive pre-control: which rules of the library apply to a description of planned works.
// Pure, unit-tested (back/test/rules.test.ts). The rule in the database is the only source of truth: this module
// only decides whether a rule matches and says why. It never produces guidance or references of its own.

export type MatchField = 'title' | 'workType' | 'domain' | 'summary' | 'requirement' | 'condition' | 'controlPoint';
// A category is often a broad word ("sécurité"): on its own it is not enough to match.
const FIELDS: [MatchField, number][] = [['title', 3], ['workType', 3], ['domain', 1], ['summary', 1], ['requirement', 1], ['condition', 1], ['controlPoint', 1]];
const STRONG = 2; // weight from which one common term is enough

export type MatchableRule = {
  id: string; active: boolean; lotId: string | null; buildingType: string | null; erpType: string | null; severity: string;
  title: string; workType?: string | null; domain: string; summary?: string | null; requirement: string; condition?: string | null; controlPoint?: string | null;
};
export type MatchQuery = { description: string; aiTerms?: string[]; lotId?: string | null; buildingType?: string | null; erpType?: string | null };
export type MatchReason = { terms: { term: string; field: MatchField; fromAi: boolean }[]; lot: boolean };
export type RuleMatch<R extends MatchableRule> = { rule: R; score: number; reasons: MatchReason };

// Words that say nothing about the kind of works.
const STOPWORDS = new Set(('alors au aux avec ce ces cette dans de des du elle en et il ils la le les leur leurs lui mais ne nos notre nous ou par pas pour que qui sa se ses son sur un une vos votre vous est sont sera seront etre ete avoir tout tous toute toutes plus moins tres afin ainsi dont entre vers chez sans sous selon lors puis donc car comme aussi '
  + 'travaux travail installation installer installe pose poser mise place remplacement remplacer creation creer realisation realiser nouveau nouvelle nouveaux nouvelles existant existante existants batiment batiments local locaux niveau niveaux zone zones lot lots projet chantier prevoir prevu prevue prevus ensemble partie parties type types').split(/\s+/));

const fold = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Light stemming: plural and feminine endings, so that "portes" and "porte" are the same word.
const stem = (t: string) => { let s = t; if (s.length > 4) s = s.replace(/(s|x)$/, ''); if (s.length > 5) s = s.replace(/e$/, ''); return s; };

// The significant words of a text: `stem` is what is compared, `word` is the word as written, for display.
export function termPairs(text: unknown): { stem: string; word: string }[] {
  const pairs = new Map<string, string>();
  for (const word of String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const t = fold(word);
    if (t.length < 3 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
    const s = stem(t);
    if (s.length >= 3 && !pairs.has(s)) pairs.set(s, word);
  }
  return [...pairs].map(([stem, word]) => ({ stem, word }));
}
export const terms = (text: unknown): string[] => termPairs(text).map(p => p.stem);
// The same words, as the user wrote them.
export const words = (text: unknown): string[] => termPairs(text).map(p => p.word);

// Same word, or two long words with the same root ("électrique" / "électricité", "ventilation" / "ventilateur").
function same(a: string, b: string) {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 6;
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };

// Rules that apply to the described works, best match first.
// A rule is returned only when it is active, compatible with the project (building type, ERP type, lot) and
//   - shares a significant term with the description in its title or type of works, or
//   - shares at least two terms with it anywhere, or
//   - is attached to the lot the user selected.
// Anything else is not returned: an empty list means the library has no rule for these works.
export function matchRules<R extends MatchableRule>(rules: R[], query: MatchQuery): RuleMatch<R>[] {
  const fromText = termPairs(query.description);
  const fromAi = termPairs((query.aiTerms || []).join(' ')).filter(t => !fromText.some(x => same(x.stem, t.stem)));
  const wanted = [...fromText.map(p => ({ ...p, fromAi: false })), ...fromAi.map(p => ({ ...p, fromAi: true }))];
  const matches: RuleMatch<R>[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.buildingType && query.buildingType && rule.buildingType !== query.buildingType) continue;
    if (rule.erpType && fold(rule.erpType) !== fold(query.erpType)) continue;
    if (query.lotId && rule.lotId && rule.lotId !== query.lotId) continue;
    const fieldTerms = FIELDS.map(([field, weight]) => ({ field, weight, terms: terms(rule[field]) }));
    const found: MatchReason['terms'] = [];
    let score = 0, strong = false;
    for (const w of wanted) {
      // the most significant field in which the term appears
      const hit = fieldTerms.find(f => f.terms.some(t => same(t, w.stem)));
      if (!hit) continue;
      found.push({ term: w.word, field: hit.field, fromAi: w.fromAi });
      score += hit.weight;
      if (hit.weight >= STRONG) strong = true;
    }
    const lot = Boolean(query.lotId && rule.lotId === query.lotId);
    if (!(strong || found.length >= 2 || lot)) continue;
    matches.push({ rule, score: score + (lot ? 2 : 0), reasons: { terms: found, lot } });
  }
  return matches.sort((a, b) => b.score - a.score || (SEVERITY_RANK[a.rule.severity] ?? 9) - (SEVERITY_RANK[b.rule.severity] ?? 9) || a.rule.title.localeCompare(b.rule.title, 'fr'));
}

const FIELD_LABEL: Record<MatchField, string> = { title: 'titre', workType: 'type de travaux', domain: 'catégorie', summary: 'description', requirement: 'exigence', condition: 'condition', controlPoint: 'points à vérifier' };
// One line stored with the check, for the record.
export function describeReasons(reasons: MatchReason, lotName?: string | null): string {
  const parts: string[] = [];
  if (reasons.terms.length) parts.push(`Termes communs : ${reasons.terms.map(t => `« ${t.term} » (${FIELD_LABEL[t.field]}${t.fromAi ? ', terme normalisé' : ''})`).join(', ')}`);
  if (reasons.lot) parts.push(`Règle du lot sélectionné${lotName ? ` (${lotName})` : ''}`);
  return parts.join(' · ');
}
