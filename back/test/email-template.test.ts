// Email template tests. Run with: npm --workspace back test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, parseBody, renderDigestEmail, renderObservationEmail } from '../src/mailer/email-template';

const BODY = [
  'Bonjour,',
  '',
  'Dans le cadre du projet « Résidence Les Tilleuls », nous vous transmettons l\'observation ci-dessous, qui concerne votre entreprise ELEC.',
  '',
  'Observation : Différentiel 30 mA manquant',
  'Référence : NF C 15-100 article 411.3.3',
  'Lot : Électricité',
  'Gravité : Élevée',
  'Source : rapport-bc.pdf, page 12',
  'Échéance : 15/10/2026',
  '',
  'Description :',
  'Absence de dispositif différentiel 30 mA sur les circuits prises.',
  '',
  'Action attendue :',
  'Installer les dispositifs différentiels avant mise sous tension.',
  '',
  'Merci de nous transmettre votre réponse ainsi que les justificatifs de correction avant le 15/10/2026.',
  '',
  'Cordialement,',
  'SOWEN Construction',
].join('\n');
const base = { subject: '[SOWEN] Résidence Les Tilleuls - Différentiel 30 mA manquant', body: BODY, projectName: 'Résidence Les Tilleuls', observationTitle: 'Différentiel 30 mA manquant', reference: 'NF C 15-100 article 411.3.3', organizationName: 'SOWEN Construction' };

test('the edited plain text is read into details, sections and paragraphs', () => {
  const blocks = parseBody(BODY);
  const details = blocks.find(b => b.kind === 'details');
  assert.ok(details && details.kind === 'details');
  assert.deepEqual(details.rows.map(r => r[0]), ['Observation', 'Référence', 'Lot', 'Gravité', 'Source', 'Échéance']);
  assert.deepEqual(blocks.filter(b => b.kind === 'section').map(b => b.kind === 'section' && b.heading), ['Description', 'Action attendue']);
  assert.equal(blocks[0].kind, 'paragraph');
});

test('observation email: branding, project, title, details card, sections, request and footer', () => {
  const { html } = renderObservationEmail(base);
  for (const expected of ['SOWEN', 'Résidence Les Tilleuls', 'Différentiel 30 mA manquant', 'Référence : NF C 15-100 article 411.3.3', 'Lot', 'Électricité', 'Source', 'rapport-bc.pdf, page 12', 'Échéance', '15/10/2026', 'Description', 'Absence de dispositif différentiel', 'Action attendue', 'Installer les dispositifs', 'justificatifs de correction', 'Message envoyé par SOWEN Construction via SOWEN']) {
    assert.ok(html.includes(expected), `missing: ${expected}`);
  }
  assert.equal((html.match(/Différentiel 30 mA manquant/g) || []).length, 3, 'title appears in <title>, preheader and heading, not again in the card');
});

test('severity is shown as a coloured badge for each level', () => {
  const colours: Record<string, string> = { Faible: '#e8f6ee', Moyenne: '#fff4d6', 'Élevée': '#ffe9d9', Critique: '#ffe1df', Information: '#eef2f7' };
  for (const [label, colour] of Object.entries(colours)) {
    const { html } = renderObservationEmail({ ...base, body: BODY.replace('Gravité : Élevée', `Gravité : ${label}`) });
    assert.ok(html.includes(`bgcolor="${colour}"`) && html.includes(`>${label}</td>`), label);
  }
});

test('email-safe markup: tables, inline styles, no script, no external resources', () => {
  const { html } = renderObservationEmail({ ...base, cta: { label: 'Répondre / transmettre les justificatifs', url: 'https://app.example.com/portal/abc' } });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.includes('role="presentation"') && html.includes('max-width:600px') && html.includes('name="viewport"'));
  assert.ok(!/<script/i.test(html) && !/<img/i.test(html) && !/<link/i.test(html) && !/@import|url\(/i.test(html));
  assert.ok(!/font-size:\s*[01]px/.test(html) && !/color:#ffffff;font-size/.test(html) && !/opacity:0/.test(html), 'no hidden-text tricks');
  assert.ok(!/font-family:[^;"]*(Inter|Roboto|Google)/i.test(html) && html.includes('Arial, Helvetica, sans-serif'));
});

test('user text is escaped: no HTML injection through body, title, project or reference', () => {
  const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>"\'&';
  const { html } = renderObservationEmail({ subject: evil, body: `Bonjour ${evil}\n\nLot : ${evil}\n\nDescription :\n${evil}`, projectName: evil, observationTitle: evil, reference: evil, organizationName: evil });
  assert.ok(!html.includes('<script>alert') && !html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
});

test('free-form edits still render: unknown text becomes paragraphs, line breaks are kept', () => {
  const { html, text } = renderObservationEmail({ ...base, body: 'Bonjour Monsieur Dupont,\nSuite à notre échange téléphonique.\n\nMerci de traiter ce point rapidement.' });
  assert.ok(html.includes('Bonjour Monsieur Dupont,<br>Suite à notre échange téléphonique.'));
  assert.ok(html.includes('Merci de traiter ce point rapidement.'));
  assert.ok(text.includes('Bonjour Monsieur Dupont,\nSuite à notre échange téléphonique.'));
});

test('plain-text fallback carries the same content, with no markup', () => {
  const { text } = renderObservationEmail(base);
  assert.ok(text.startsWith('Bonjour,'));
  assert.ok(text.includes('Gravité : Élevée') && text.includes('Action attendue :\nInstaller les dispositifs'));
  assert.ok(text.includes('SOWEN · Suivi de conformité chantier'));
  assert.ok(text.includes('\n-- \n'), 'standard signature separator');
  assert.ok(!/<[a-z]/i.test(text));
});

test('reply button appears only when a real link is given, and only for http(s) links', () => {
  const none = renderObservationEmail(base);
  assert.ok(!none.html.includes('<a ') && !none.html.includes('Répondre / transmettre') && !none.text.includes('http'));
  const withLink = renderObservationEmail({ ...base, cta: { label: 'Répondre / transmettre les justificatifs', url: 'https://app.example.com/portal/abc-123' } });
  assert.ok(withLink.html.includes('href="https://app.example.com/portal/abc-123"') && withLink.html.includes('Répondre / transmettre les justificatifs'));
  assert.ok(withLink.text.includes('Répondre / transmettre les justificatifs : https://app.example.com/portal/abc-123'));
  for (const url of ['javascript:alert(1)', 'not a url', '']) {
    const bad = renderObservationEmail({ ...base, cta: { label: 'Répondre', url } });
    assert.ok(!bad.html.includes('<a '), `rejected: ${url}`);
  }
});

test('reminder: banner by escalation level, intro sentence, same body', () => {
  const simple = renderObservationEmail({ ...base, reminder: { level: 0 } });
  assert.ok(simple.html.includes('>Relance<') && simple.html.includes('Nous vous relançons') && simple.html.includes('Installer les dispositifs'));
  assert.ok(simple.text.startsWith('RELANCE\n\nNous vous relançons'));
  assert.ok(renderObservationEmail({ ...base, reminder: { level: 1 } }).html.includes('Relance — une action est toujours attendue'));
  const urgent = renderObservationEmail({ ...base, reminder: { level: 3 } });
  assert.ok(urgent.html.includes('Relance urgente — niveau d’escalade 3') && urgent.html.includes('bgcolor="#ffe1df"'));
});

test('daily digest: greeting, items, escaped content, text fallback', () => {
  const { html, text } = renderDigestEmail({ subject: 'SOWEN · 2 point(s) à traiter', recipientName: 'Omar', items: [{ title: 'Observation en retard', message: 'Garde-corps <non conforme>' }, { title: 'Destinataire manquant', message: 'Lot plomberie' }] });
  assert.ok(html.includes('Bonjour Omar,') && html.includes('2 point(s) à traiter') && html.includes('Observation en retard') && html.includes('Garde-corps &lt;non conforme&gt;'));
  assert.ok(!html.includes('<a '), 'no link without a configured public address');
  assert.ok(text.includes('- Observation en retard\n  Garde-corps <non conforme>') && text.includes('Connectez-vous à SOWEN'));
});
