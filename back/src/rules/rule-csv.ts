// CSV import of rules: parsing, template and row validation. Pure, unit-tested (back/test/rules.test.ts).
// Nothing here writes to the database: the service decides what to do with the validated rows.

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
// The template ships one example line; it must be removed before importing.
export const EXAMPLE_PREFIX = 'EXEMPLE À SUPPRIMER';

const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const BUILDING_TYPES = ['ERP', 'IGH', 'HABITATION', 'TERTIAIRE', 'AUTRE'] as const;
export type RuleSeverity = (typeof SEVERITIES)[number];
export type RuleBuildingType = (typeof BUILDING_TYPES)[number];

// What a rule is made of, as written by a person (form or CSV line).
export type RuleInput = {
  title: string; domain: string; lotId: string | null; workType: string | null; summary: string; requirement: string;
  reference: string | null; sourceDocument: string | null; severity: RuleSeverity; controlPoint: string | null;
  actionRequest: string | null; evidenceRequired: string | null; buildingType: RuleBuildingType | null; erpType: string | null; active: boolean;
};

type Column = { key: string; header: string; label: string; required?: boolean; max?: number; aliases?: string[] };
export const CSV_COLUMNS: Column[] = [
  { key: 'title', header: 'titre', label: 'Titre', required: true, max: 200, aliases: ['title', 'intitule'] },
  { key: 'domain', header: 'categorie', label: 'Catégorie', required: true, max: 80, aliases: ['domaine', 'category', 'domain'] },
  { key: 'lot', header: 'lot', label: 'Lot', aliases: ['lots'] },
  { key: 'workType', header: 'type_travaux', label: 'Type de travaux', max: 120, aliases: ['travaux', 'work_type', 'prestation'] },
  { key: 'summary', header: 'description', label: 'Description', max: 2000, aliases: ['resume', 'summary'] },
  { key: 'requirement', header: 'exigence', label: 'Exigence', required: true, max: 4000, aliases: ['requirement', 'regle'] },
  { key: 'reference', header: 'reference', label: 'Référence', max: 200, aliases: ['ref', 'reference_reglementaire'] },
  { key: 'sourceDocument', header: 'source', label: 'Document source', max: 200, aliases: ['document', 'document_source'] },
  { key: 'severity', header: 'gravite', label: 'Sévérité', aliases: ['severite', 'severity', 'importance'] },
  { key: 'controlPoint', header: 'verification', label: 'Points à vérifier', max: 2000, aliases: ['points_a_verifier', 'controle', 'control_point'] },
  { key: 'actionRequest', header: 'action_preventive', label: 'Action préventive', max: 2000, aliases: ['action', 'action_recommandee', 'action_request'] },
  { key: 'evidenceRequired', header: 'justificatif', label: 'Justificatif attendu', max: 1000, aliases: ['preuve', 'evidence'] },
  { key: 'buildingType', header: 'type_batiment', label: 'Type de bâtiment', aliases: ['batiment', 'building_type'] },
  { key: 'erpType', header: 'type_erp', label: 'Type ERP', max: 20, aliases: ['erp'] },
  { key: 'active', header: 'actif', label: 'Active', aliases: ['active', 'statut'] },
];

export const plain = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const headerKey = (v: string) => plain(v).replace(/ /g, '_');

// Two rules are the same when they have the same title, lot and reference (case, accents and punctuation ignored).
export function ruleKey(rule: { title: string; lotId?: string | null; reference?: string | null }): string {
  return `${plain(rule.title)}|${rule.lotId || ''}|${plain(rule.reference)}`;
}

const escapeCell = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
// Semicolon-separated with a BOM, which is what spreadsheet software set to French opens correctly.
export function csvTemplate(): string {
  const example: Record<string, string> = {
    title: `${EXAMPLE_PREFIX} — titre court de la règle`, domain: 'Catégorie (ex. sécurité incendie)', lot: 'Nom exact d’un lot SOWEN, ou vide pour tous les lots', workType: 'Type de travaux concernés',
    summary: 'Description de la règle', requirement: 'Ce qui est exigé', reference: 'Référence du texte ou de la clause', sourceDocument: 'Document d’où vient la règle',
    severity: 'Information, Faible, Moyenne, Élevée ou Critique', controlPoint: 'Ce qu’il faut vérifier avant les travaux', actionRequest: 'Action préventive recommandée', evidenceRequired: 'Justificatif à demander',
    buildingType: 'ERP, IGH, HABITATION, TERTIAIRE, AUTRE ou vide', erpType: 'Type ERP ou vide', active: 'oui',
  };
  return `﻿${CSV_COLUMNS.map(c => c.header).join(';')}\r\n${CSV_COLUMNS.map(c => escapeCell(example[c.key] || '')).join(';')}\r\n`;
}

// Splits CSV text into rows of cells. Accepts ; , or tab as separator (the one most used in the header line),
// quoted cells, doubled quotes and line breaks inside quotes. Entirely empty lines are dropped; `line` is the
// line number in the file, for error messages.
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const source = String(text ?? '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] || '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delimiter = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = '', quoted = false, line = 1, startLine = 1;
  const endRow = () => { cells.push(cell); if (cells.some(c => c.trim() !== '')) rows.push({ line: startLine, cells: cells.map(c => c.trim()) }); cells = []; cell = ''; startLine = line + 1; };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"' && cell.trim() === '') { cell = ''; quoted = true; }
    else if (ch === delimiter) { cells.push(cell); cell = ''; }
    else if (ch === '\n') { endRow(); line++; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || cells.length) endRow();
  return rows;
}

const SEVERITY_WORDS: Record<string, RuleSeverity> = { info: 'INFO', information: 'INFO', low: 'LOW', faible: 'LOW', mineure: 'LOW', medium: 'MEDIUM', moyenne: 'MEDIUM', moyen: 'MEDIUM', high: 'HIGH', elevee: 'HIGH', haute: 'HIGH', majeure: 'HIGH', critical: 'CRITICAL', critique: 'CRITICAL' };
const YES = ['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'actif', 'active'], NO = ['non', 'n', 'no', 'false', 'faux', '0', 'inactif', 'inactive'];

export type ImportRow = { line: number; status: 'OK' | 'ERROR' | 'DUPLICATE'; errors: string[]; duplicateOf?: 'FILE' | 'LIBRARY'; rule: RuleInput & { lotName: string | null } };
export type ImportPreview = {
  fileErrors: string[]; unknownColumns: string[]; rows: ImportRow[];
  summary: { total: number; valid: number; errors: number; duplicates: number };
  // Importing is all or nothing: one invalid line blocks the whole file.
  canImport: boolean;
};

// Validates every line. `lots` are the lots a rule may be attached to, `existingKeys` the ruleKey() of the rules
// already in the organisation's library.
export function validateImport(text: string, context: { lots: { id: string; name: string; code?: string | null }[]; existingKeys: Set<string> }): ImportPreview {
  const preview: ImportPreview = { fileErrors: [], unknownColumns: [], rows: [], summary: { total: 0, valid: 0, errors: 0, duplicates: 0 }, canImport: false };
  const parsed = parseCsv(text);
  if (!parsed.length) { preview.fileErrors.push('Le fichier est vide.'); return preview; }
  const header = parsed[0].cells.map(headerKey);
  const index: Record<string, number> = {};
  header.forEach((h, i) => { const column = CSV_COLUMNS.find(c => c.header === h || c.aliases?.includes(h)); if (column) { if (!(column.key in index)) index[column.key] = i; } else if (h) preview.unknownColumns.push(parsed[0].cells[i]); });
  const missing = CSV_COLUMNS.filter(c => c.required && !(c.key in index)).map(c => c.header);
  if (missing.length) { preview.fileErrors.push(`Colonne(s) obligatoire(s) absente(s) : ${missing.join(', ')}. Utilisez le modèle CSV.`); return preview; }
  const lines = parsed.slice(1);
  if (!lines.length) { preview.fileErrors.push('Le fichier ne contient aucune règle (seulement la ligne d’en-tête).'); return preview; }
  if (lines.length > MAX_IMPORT_ROWS) { preview.fileErrors.push(`Le fichier contient ${lines.length} lignes : ${MAX_IMPORT_ROWS} au maximum par import.`); return preview; }

  const lotByName = new Map<string, { id: string; name: string }>();
  for (const lot of context.lots) { lotByName.set(plain(lot.name), lot); if (lot.code) lotByName.set(plain(lot.code), lot); }
  const seen = new Set<string>();
  for (const { line, cells } of lines) {
    const value = (key: string) => (key in index ? (cells[index[key]] ?? '').trim() : '');
    const errors: string[] = [];
    for (const column of CSV_COLUMNS) {
      const v = value(column.key);
      if (column.required && !v) errors.push(`${column.label} : valeur obligatoire.`);
      if (column.max && v.length > column.max) errors.push(`${column.label} : ${v.length} caractères, ${column.max} au maximum.`);
    }
    if (value('title').toUpperCase().startsWith(EXAMPLE_PREFIX)) errors.push('Ligne d’exemple du modèle : supprimez-la avant d’importer.');
    const lotText = value('lot');
    const lot = lotText ? lotByName.get(plain(lotText)) || null : null;
    if (lotText && !lot) errors.push(`Lot inconnu : « ${lotText} ». Utilisez le nom exact d’un lot existant, ou laissez vide.`);
    const severityText = plain(value('severity'));
    const severity = severityText ? SEVERITY_WORDS[severityText] : 'MEDIUM';
    if (!severity) errors.push(`Sévérité invalide : « ${value('severity')} » (Information, Faible, Moyenne, Élevée ou Critique).`);
    const buildingText = value('buildingType').toUpperCase();
    const buildingType = buildingText ? (BUILDING_TYPES as readonly string[]).includes(buildingText) ? buildingText as RuleBuildingType : undefined : null;
    if (buildingType === undefined) errors.push(`Type de bâtiment invalide : « ${value('buildingType')} » (${BUILDING_TYPES.join(', ')}).`);
    const activeText = plain(value('active'));
    const active = !activeText || YES.includes(activeText) ? true : NO.includes(activeText) ? false : undefined;
    if (active === undefined) errors.push(`Valeur « actif » invalide : « ${value('active')} » (oui ou non).`);

    const rule: ImportRow['rule'] = {
      title: value('title'), domain: value('domain'), lotId: lot?.id ?? null, lotName: lot?.name ?? (lotText || null), workType: value('workType') || null,
      summary: value('summary') || value('requirement'), requirement: value('requirement'), reference: value('reference') || null, sourceDocument: value('sourceDocument') || null,
      severity: severity || 'MEDIUM', controlPoint: value('controlPoint') || null, actionRequest: value('actionRequest') || null, evidenceRequired: value('evidenceRequired') || null,
      buildingType: buildingType ?? null, erpType: value('erpType') || null, active: active ?? true,
    };
    const row: ImportRow = { line, status: errors.length ? 'ERROR' : 'OK', errors, rule };
    if (row.status === 'OK') {
      const key = ruleKey(rule);
      if (context.existingKeys.has(key)) { row.status = 'DUPLICATE'; row.duplicateOf = 'LIBRARY'; }
      else if (seen.has(key)) { row.status = 'DUPLICATE'; row.duplicateOf = 'FILE'; }
      else seen.add(key);
    }
    preview.rows.push(row);
  }
  preview.summary = { total: preview.rows.length, valid: preview.rows.filter(r => r.status === 'OK').length, errors: preview.rows.filter(r => r.status === 'ERROR').length, duplicates: preview.rows.filter(r => r.status === 'DUPLICATE').length };
  preview.canImport = preview.summary.errors === 0 && preview.summary.valid > 0;
  return preview;
}
