import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterObservations, hasActiveFilters, NONE } from '../src/lib/observation-filters';

const lotA = { id: 'lot-a', name: 'Électricité' }, lotB = { id: 'lot-b', name: 'Plomberie' };
const acme = { id: 'c-acme', name: 'ACME Élec' }, bati = { id: 'c-bati', name: 'Bâti Sud' };
const rows = [
  { id: '1', title: 'Absence de désenfumage', description: 'Cage d’escalier B', reference: 'CO 34', requiredAction: 'Installer un exutoire', status: 'OPEN', severity: 'CRITICAL', dueDate: '2026-11-20', createdAt: '2026-09-01T10:00:00Z', reviewStatus: 'PENDING', lot: lotA, company: acme },
  { id: '2', title: 'Tableau électrique non étiqueté', description: 'TGBT du sous-sol', reference: 'NF C 15-100', requiredAction: null, status: 'SENT', severity: 'MEDIUM', dueDate: '2026-10-10', createdAt: '2026-09-03T10:00:00Z', reviewStatus: 'VALIDATED', lot: lotA, company: acme },
  { id: '3', title: 'Fuite sur colonne', description: 'Local technique', reference: null, requiredAction: 'Reprendre le raccord', status: 'OPEN', severity: 'HIGH', dueDate: null, createdAt: '2026-09-02T10:00:00Z', reviewStatus: null, lot: lotB, company: bati },
  { id: '4', title: 'Remarque sans lot', description: 'À qualifier', reference: null, requiredAction: null, status: 'RESOLVED', severity: 'LOW', dueDate: '2026-12-01', createdAt: '2026-08-30T10:00:00Z', reviewStatus: 'REJECTED', lot: null, company: null },
];
const ids = (f: Parameters<typeof filterObservations>[1]) => filterObservations(rows, f).map(o => o.id);

test('without filters every observation is listed, newest first', () => {
  assert.deepEqual(ids({}), ['2', '3', '1', '4']);
});

test('search ignores case and accents and looks in title, description, reference, action, lot and company', () => {
  assert.deepEqual(ids({ q: 'DESENFUMAGE' }), ['1']);
  assert.deepEqual(ids({ q: 'tgbt' }), ['2']);
  assert.deepEqual(ids({ q: 'co 34' }), ['1']);
  assert.deepEqual(ids({ q: 'raccord' }), ['3']);
  assert.deepEqual(ids({ q: 'plomberie' }), ['3']);
  assert.deepEqual(ids({ q: 'bati sud' }), ['3']);
});

test('every word of the search must match', () => {
  assert.deepEqual(ids({ q: 'electrique acme' }), ['2']);
  assert.deepEqual(ids({ q: 'electrique plomberie' }), []);
});

test('filters by status, severity, lot and company', () => {
  assert.deepEqual(ids({ status: 'OPEN' }), ['3', '1']);
  assert.deepEqual(ids({ severity: 'CRITICAL' }), ['1']);
  assert.deepEqual(ids({ lotId: 'lot-a' }), ['2', '1']);
  assert.deepEqual(ids({ companyId: 'c-bati' }), ['3']);
});

test('"none" selects observations without lot or company', () => {
  assert.deepEqual(ids({ lotId: NONE }), ['4']);
  assert.deepEqual(ids({ companyId: NONE }), ['4']);
});

test('filters combine', () => {
  assert.deepEqual(ids({ status: 'OPEN', lotId: 'lot-a' }), ['1']);
  assert.deepEqual(ids({ q: 'tableau', severity: 'CRITICAL' }), []);
});

test('review filter separates AI observations to validate, validated, rejected and manual ones', () => {
  assert.deepEqual(ids({ review: 'pending' }), ['1']);
  assert.deepEqual(ids({ review: 'validated' }), ['2']);
  assert.deepEqual(ids({ review: 'rejected' }), ['4']);
  assert.deepEqual(ids({ review: 'manual' }), ['3']);
});

test('sorts by oldest, due date (no due date last) and severity', () => {
  assert.deepEqual(ids({ sort: 'oldest' }), ['4', '1', '3', '2']);
  assert.deepEqual(ids({ sort: 'due' }), ['2', '1', '4', '3']);
  assert.deepEqual(ids({ sort: 'severity' }), ['1', '3', '2', '4']);
});

test('does not modify the list it receives', () => {
  const before = rows.map(o => o.id);
  filterObservations(rows, { sort: 'severity' });
  assert.deepEqual(rows.map(o => o.id), before);
});

test('hasActiveFilters ignores the sort and blank searches', () => {
  assert.equal(hasActiveFilters({ sort: 'due', q: '  ' }), false);
  assert.equal(hasActiveFilters({ lotId: NONE }), true);
});
