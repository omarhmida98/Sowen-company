import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_LOTS, categories, filterRules, hasActiveRuleFilters, libraryState } from '../src/lib/rule-filters';

const elec = { id: 'lot-e', name: 'Électricité' }, plomb = { id: 'lot-p', name: 'Plomberie' };
const rows = [
  { id: '1', title: 'Protection différentielle', domain: 'Sécurité électrique', summary: 'Circuits prises', requirement: 'Dispositif 30 mA', reference: 'REF-A 12', sourceDocument: 'Cahier interne', workType: 'Tableau électrique', controlPoint: 'Vérifier le calibre', actionRequest: 'Prévoir les dispositifs', active: true, lot: elec },
  { id: '2', title: 'Calorifugeage des réseaux', domain: 'Thermique', summary: null, requirement: 'Isoler les canalisations', reference: null, sourceDocument: null, workType: 'Réseaux', controlPoint: null, actionRequest: null, active: true, lot: plomb },
  { id: '3', title: 'Désenfumage des circulations', domain: 'sécurité incendie', summary: 'Cages d’escalier', requirement: 'Exutoire en partie haute', reference: 'REF-B 3', sourceDocument: null, workType: null, controlPoint: null, actionRequest: null, active: false, lot: null },
];
const ids = (f: Parameters<typeof filterRules>[1]) => filterRules(rows, f).map(r => r.id);

test('without filters every rule is listed', () => {
  assert.deepEqual(ids({}), ['1', '2', '3']);
});

test('search ignores case and accents and looks in title, category, text, reference, source and lot', () => {
  assert.deepEqual(ids({ q: 'DIFFERENTIELLE' }), ['1']);
  assert.deepEqual(ids({ q: 'ref-b' }), ['3']);
  assert.deepEqual(ids({ q: 'cahier' }), ['1']);
  assert.deepEqual(ids({ q: 'plomberie' }), ['2']);
  assert.deepEqual(ids({ q: 'escalier' }), ['3']);
  assert.deepEqual(ids({ q: 'calibre' }), ['1']);
  assert.deepEqual(ids({ q: 'tableau prises' }), ['1'], 'every word must match');
  assert.deepEqual(ids({ q: 'tableau plomberie' }), []);
});

test('filters by lot, category and status, and combines them', () => {
  assert.deepEqual(ids({ lotId: 'lot-e' }), ['1']);
  assert.deepEqual(ids({ lotId: ALL_LOTS }), ['3'], 'rules that apply to every lot');
  assert.deepEqual(ids({ category: 'Sécurité Incendie' }), ['3']);
  assert.deepEqual(ids({ status: 'active' }), ['1', '2']);
  assert.deepEqual(ids({ status: 'inactive' }), ['3']);
  assert.deepEqual(ids({ status: 'active', category: 'sécurité incendie' }), []);
  assert.deepEqual(ids({ status: 'active', q: 'reseaux', lotId: 'lot-p' }), ['2']);
});

test('categories are listed once each, sorted', () => {
  assert.deepEqual(categories([...rows, { domain: 'THERMIQUE' }, { domain: '' }]), ['Sécurité électrique', 'sécurité incendie', 'Thermique']);
  assert.equal(hasActiveRuleFilters({ q: '  ' }), false);
  assert.equal(hasActiveRuleFilters({ status: 'inactive' }), true);
});

test('library state: empty, all rules inactive, or ready', () => {
  assert.equal(libraryState({ total: 0, active: 0 }), 'EMPTY');
  assert.equal(libraryState({ total: 4, active: 0 }), 'ALL_INACTIVE');
  assert.equal(libraryState({ total: 4, active: 1 }), 'READY');
});
