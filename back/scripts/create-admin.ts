// Creates the first administrator of an installation (and its organisation) from the server.
//
//   npm --workspace back run admin:create -- --email admin@example.com --name "Prénom Nom" --organization "Ma société"
//
// On a real installation the public registration page is closed, so that the first visitor of an empty installation
// cannot make themselves administrator: the first account is created here, by someone who has access to the server.
// No password is typed or stored by this script. It prints a single-use link, valid for a limited time, with which
// the administrator chooses their own password in the browser.
//
// Reads back/.env. Refuses when accounts already exist, unless --additional-organization is given.
import { PrismaClient } from '@prisma/client';
import { accountLink, hashToken, linkBase, linkTtlHours, newToken } from '../src/auth/account-links';

const option = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? (process.argv[i + 1] || '').trim() : ''; };

async function main() {
  // Variables already set in the environment win over back/.env.
  try { process.loadEnvFile('.env'); } catch { /* no .env file: rely on the environment */ }
  const email = option('--email').toLowerCase(), displayName = option('--name'), organizationName = option('--organization');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName || !organizationName) {
    console.error('Usage: admin:create -- --email <email> --name "<name>" --organization "<organisation name>" [--additional-organization]');
    process.exit(1);
  }
  const base = linkBase({ publicAppUrl: (process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '') || null, webUrl: process.env.WEB_URL, nodeEnv: process.env.NODE_ENV });
  if (!base) { console.error('PUBLIC_APP_URL must be set (the https address of the application): the link is built from it.'); process.exit(1); }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.count();
    if (existing && !process.argv.includes('--additional-organization')) {
      console.error(`This installation already has ${existing} account(s). New users are invited by an administrator from the Team page. To create another, separate organisation, add --additional-organization.`);
      process.exit(1);
    }
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) { console.error('An account already uses this email address.'); process.exit(1); }

    const token = newToken();
    const hours = linkTtlHours('INVITATION', { INVITATION_TTL_HOURS: process.env.INVITATION_TTL_HOURS });
    const user = await prisma.$transaction(async tx => {
      const organization = await tx.organization.create({ data: { name: organizationName } });
      const created = await tx.user.create({ data: { email, displayName, role: 'ADMIN', organizationId: organization.id, passwordHash: null } });
      await tx.userToken.create({ data: { userId: created.id, type: 'INVITATION', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + hours * 3600000) } });
      await tx.activityLog.create({ data: { userId: created.id, action: 'Administrateur créé depuis le serveur', entityType: 'User', entityId: created.id } });
      return created;
    });
    console.log(`Administrator ${user.email} created for "${organizationName}". The account has no password yet.`);
    console.log(`Open this link to choose the password (single use, valid ${hours} hours). Treat it like a password:`);
    console.log(`\n  ${accountLink(base.base, token)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error?.message || error); process.exit(1); });
