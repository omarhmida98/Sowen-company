// SOWEN email layout. Pure functions: text in, { html, text } out.
// Email-client constraints drive the markup: tables for layout, inline styles, bgcolor attributes,
// system fonts, no images, no scripts. The plain-text body the user edited stays the single source
// of content; the HTML is a presentation of that text, and `text` is sent as the fallback part.

export type RenderedEmail = { html: string; text: string };
export type EmailCta = { label: string; url: string };
type Banner = { label: string; tone: 'info' | 'warning' | 'danger' };

const FONT = "Arial, Helvetica, sans-serif";
const C = { text: '#1c293c', muted: '#5b6e8c', line: '#e1e8f0', soft: '#f5f8fc', brand: '#2f6bff', brandDark: '#1f4fc4' };
const SEVERITY: Record<string, { bg: string; fg: string }> = {
  information: { bg: '#eef2f7', fg: '#4c5a70' },
  faible: { bg: '#e8f6ee', fg: '#1f7a4d' },
  moyenne: { bg: '#fff4d6', fg: '#8a5a00' },
  elevee: { bg: '#ffe9d9', fg: '#b4470f' },
  critique: { bg: '#ffe1df', fg: '#b3261e' },
};
const BANNER = { info: { bg: '#edf3ff', fg: '#1f4fc4' }, warning: { bg: '#fff4d6', fg: '#8a5a00' }, danger: { bg: '#ffe1df', fg: '#b3261e' } };

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only absolute http(s) links are ever put in an email.
function safeUrl(url: string): string | null {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null; } catch { return null; }
}

const plainKey = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const lines = (text: string) => escapeHtml(text).replace(/\n/g, '<br>');

type Block = { kind: 'details'; rows: [string, string][] } | { kind: 'section'; heading: string; text: string } | { kind: 'paragraph'; text: string };
const KEY_VALUE = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{1,30}) : (\S.*)$/;
const HEADING = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{1,40}) :$/;

// Reads the plain-text body: runs of "Libellé : valeur" lines become a details card,
// a "Titre :" line followed by text becomes a section, everything else stays a paragraph.
export function parseBody(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r/g, '').split(/\n{2,}/)) {
    const rows = chunk.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
    if (!rows.length) continue;
    const pairs = rows.map(r => r.match(KEY_VALUE));
    const label = (r: string) => (r.match(KEY_VALUE)?.[1] || '').trim().split(/\s+/).length;
    if (pairs.every(Boolean) && rows.every(r => label(r) <= 3)) {
      blocks.push({ kind: 'details', rows: pairs.map(m => [m![1].trim(), m![2].trim()] as [string, string]) });
    } else if (rows.length > 1 && HEADING.test(rows[0])) {
      blocks.push({ kind: 'section', heading: rows[0].match(HEADING)![1].trim(), text: rows.slice(1).join('\n') });
    } else {
      blocks.push({ kind: 'paragraph', text: rows.join('\n') });
    }
  }
  return blocks;
}

function severityBadge(value: string) {
  const tone = SEVERITY[plainKey(value)];
  if (!tone) return escapeHtml(value);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${tone.bg}" style="background:${tone.bg};border-radius:999px;padding:3px 11px;font:bold 12px ${FONT};color:${tone.fg};">${escapeHtml(value)}</td></tr></table>`;
}

function detailsCard(rows: [string, string][]) {
  const body = rows.map(([label, value], i) => `<tr>
<td class="sw-label" valign="top" width="150" style="width:150px;padding:9px 14px;font:bold 12px ${FONT};color:${C.muted};${i ? `border-top:1px solid ${C.line};` : ''}">${escapeHtml(label)}</td>
<td class="sw-value" valign="top" style="padding:9px 14px;font:14px/1.45 ${FONT};color:${C.text};${i ? `border-top:1px solid ${C.line};` : ''}">${plainKey(label) === 'gravite' ? severityBadge(value) : lines(value)}</td>
</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.soft}" style="background:${C.soft};border:1px solid ${C.line};border-radius:8px;">${body}</table>`;
}

function section(heading: string, text: string) {
  const action = plainKey(heading).startsWith('action');
  const inner = `<div style="font:bold 12px ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.06em;padding-bottom:6px;">${escapeHtml(heading)}</div><div style="font:14px/1.55 ${FONT};color:${C.text};">${lines(text)}</div>`;
  if (!action) return inner;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#edf3ff" style="background:#edf3ff;border-left:4px solid ${C.brand};border-radius:6px;padding:12px 14px;">${inner}</td></tr></table>`;
}

function row(content: string, padding = '0 28px 18px') {
  return `<tr><td class="sw-pad" style="padding:${padding};">${content}</td></tr>`;
}

type Layout = { subject: string; preheader: string; eyebrow?: string | null; title?: string | null; subtitle?: string | null; banner?: Banner | null; content: string; cta?: EmailCta | null; footerNote: string };

function layout(l: Layout) {
  const cta = l.cta && safeUrl(l.cta.url) ? { label: l.cta.label, url: safeUrl(l.cta.url)! } : null;
  const banner = l.banner ? `<tr><td class="sw-pad" bgcolor="${BANNER[l.banner.tone].bg}" style="background:${BANNER[l.banner.tone].bg};padding:10px 28px;font:bold 13px ${FONT};color:${BANNER[l.banner.tone].fg};">${escapeHtml(l.banner.label)}</td></tr>` : '';
  const heading = l.title ? row(`${l.eyebrow ? `<div style="font:bold 11px ${FONT};color:${C.muted};text-transform:uppercase;letter-spacing:.08em;padding-bottom:6px;">${escapeHtml(l.eyebrow)}</div>` : ''}<div style="font:bold 20px/1.3 ${FONT};color:${C.text};">${escapeHtml(l.title)}</div>${l.subtitle ? `<div style="font:13px/1.4 ${FONT};color:${C.muted};padding-top:4px;">${escapeHtml(l.subtitle)}</div>` : ''}`, '22px 28px 18px') : '<tr><td style="font-size:0;line-height:0;height:22px;">&nbsp;</td></tr>';
  const button = cta ? row(`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.brand}" style="background:${C.brand};border-radius:8px;"><a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;padding:12px 22px;font:bold 14px ${FONT};color:#ffffff;text-decoration:none;">${escapeHtml(cta.label)}</a></td></tr></table><div style="font:12px/1.4 ${FONT};color:${C.muted};padding-top:8px;word-break:break-all;">${escapeHtml(cta.url)}</div>`, '4px 28px 22px') : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(l.subject)}</title>
<style>@media only screen and (max-width:620px){.sw-pad{padding-left:16px!important;padding-right:16px!important}.sw-label{display:block!important;width:auto!important;padding-bottom:0!important;border-top-width:0!important}.sw-value{display:block!important;padding-top:2px!important;border-top-width:0!important}}</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(l.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${C.line};border-radius:10px;">
<tr><td class="sw-pad" style="padding:18px 28px;border-bottom:1px solid ${C.line};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="36" height="36" align="center" valign="middle" bgcolor="${C.brand}" style="width:36px;height:36px;background:${C.brand};border-radius:9px;font:bold 18px ${FONT};color:#ffffff;">S</td>
<td style="padding-left:12px;"><div style="font:bold 16px ${FONT};color:${C.text};letter-spacing:.02em;">SOWEN</div><div style="font:12px ${FONT};color:${C.muted};">Suivi de conformité chantier</div></td>
</tr></table>
</td></tr>
${banner}
${heading}
${l.content}
${button}
<tr><td class="sw-pad" bgcolor="${C.soft}" style="background:${C.soft};padding:16px 28px;border-top:1px solid ${C.line};border-radius:0 0 10px 10px;font:12px/1.5 ${FONT};color:${C.muted};">${escapeHtml(l.footerNote)}<br>SOWEN · Suivi de conformité chantier</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function bodyRows(body: string, hide: Record<string, string | null | undefined>) {
  const hidden = Object.entries(hide).filter(([, v]) => v).map(([k, v]) => `${plainKey(k)}=${String(v).trim()}`);
  return parseBody(body).map(block => {
    if (block.kind === 'details') {
      // Values already shown in the heading are not repeated in the card.
      const rows = block.rows.filter(([label, value]) => !hidden.includes(`${plainKey(label)}=${value}`));
      return rows.length ? row(detailsCard(rows)) : '';
    }
    if (block.kind === 'section') return row(section(block.heading, block.text));
    return row(`<div style="font:14px/1.6 ${FONT};color:${C.text};">${lines(block.text)}</div>`);
  }).join('\n');
}

function textFallback(parts: (string | null | undefined)[], cta: EmailCta | null | undefined, footerNote: string) {
  const link = cta && safeUrl(cta.url) ? `${cta.label} : ${safeUrl(cta.url)}` : null;
  return [...parts, link, `-- \n${footerNote}\nSOWEN · Suivi de conformité chantier`].filter(Boolean).join('\n\n');
}

export type ObservationEmailInput = {
  subject: string;
  body: string; // plain text, as edited by the user
  projectName?: string | null;
  observationTitle?: string | null;
  reference?: string | null;
  organizationName?: string | null;
  cta?: EmailCta | null;
  reminder?: { level: number } | null; // set for reminders; level is the escalation level (0 = simple reminder)
};

export function renderObservationEmail(input: ObservationEmailInput): RenderedEmail {
  const footerNote = `Message envoyé par ${input.organizationName || 'votre interlocuteur'} via SOWEN. Vous pouvez répondre directement à cet email.`;
  const reminder = input.reminder;
  const banner: Banner | null = !reminder ? null
    : reminder.level >= 2 ? { label: `Relance urgente — niveau d’escalade ${reminder.level}`, tone: 'danger' }
    : reminder.level === 1 ? { label: 'Relance — une action est toujours attendue', tone: 'warning' }
    : { label: 'Relance', tone: 'warning' };
  const intro = reminder ? 'Nous vous relançons concernant le point ci-dessous, pour lequel une action est toujours attendue.' : null;
  const content = [
    intro ? row(`<div style="font:14px/1.6 ${FONT};color:${C.text};">${escapeHtml(intro)}</div>`) : '',
    bodyRows(input.body, { projet: input.projectName, observation: input.observationTitle, reference: input.reference }),
  ].join('\n');
  return {
    html: layout({
      subject: input.subject,
      preheader: `${reminder ? 'Relance — ' : ''}${input.observationTitle || input.subject}`,
      eyebrow: input.projectName,
      title: input.observationTitle || input.subject,
      subtitle: input.reference ? `Référence : ${input.reference}` : null,
      banner,
      content,
      cta: input.cta,
      footerNote,
    }),
    text: textFallback([banner ? banner.label.toUpperCase() : null, intro, input.body.trim()], input.cta, footerNote),
  };
}

export type DigestEmailInput = { subject: string; recipientName?: string | null; items: { title: string; message: string }[]; cta?: EmailCta | null };

export function renderDigestEmail(input: DigestEmailInput): RenderedEmail {
  const footerNote = 'Vous recevez cette synthèse car vous suivez des projets dans SOWEN.';
  const greeting = `Bonjour${input.recipientName ? ` ${input.recipientName}` : ''},`;
  const intro = `Voici votre synthèse SOWEN : ${input.items.length} point(s) à traiter.`;
  const outro = 'Connectez-vous à SOWEN pour traiter ces points.';
  const list = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.soft}" style="background:${C.soft};border:1px solid ${C.line};border-radius:8px;">${input.items.map((item, i) => `<tr><td style="padding:11px 14px;${i ? `border-top:1px solid ${C.line};` : ''}"><div style="font:bold 14px/1.4 ${FONT};color:${C.text};">${escapeHtml(item.title)}</div><div style="font:13px/1.5 ${FONT};color:${C.muted};padding-top:2px;">${lines(item.message)}</div></td></tr>`).join('')}</table>`;
  const paragraph = (t: string) => row(`<div style="font:14px/1.6 ${FONT};color:${C.text};">${escapeHtml(t)}</div>`);
  return {
    html: layout({ subject: input.subject, preheader: intro, eyebrow: 'Synthèse quotidienne', title: `${input.items.length} point(s) à traiter`, content: [paragraph(greeting), paragraph(intro), row(list), paragraph(outro)].join('\n'), cta: input.cta, footerNote }),
    text: textFallback([greeting, intro, input.items.map(item => `- ${item.title}\n  ${item.message}`).join('\n'), outro], input.cta, footerNote),
  };
}
