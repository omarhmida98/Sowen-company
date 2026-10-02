import { PrismaService } from '../prisma/prisma.service';
import { MailerService } from './mailer.service';
import { EmailCta } from './email-template';

// Reply button for company emails. Returned only when a link really exists: the public address of the app
// is configured (PUBLIC_APP_URL) and the company already has an active portal access for the project.
export async function companyPortalCta(prisma: PrismaService, mailer: MailerService, projectId: string, companyId?: string | null): Promise<EmailCta | null> {
  const base = mailer.publicAppUrl();
  if (!base || !companyId) return null;
  const access = await prisma.companyPortalAccess.findFirst({
    where: { projectId, companyId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { createdAt: 'desc' },
  });
  return access ? { label: 'Répondre / transmettre les justificatifs', url: `${base}/portal/${access.token}` } : null;
}
