import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { Resend } from 'resend';

export type MailProvider = 'gmail' | 'resend';
// `automated` marks mail sent by a scheduled job rather than by a person clicking Send.
export type OutgoingMail = { to: string; subject: string; html: string; text?: string; automated?: boolean };

// RFC 3834: tells mail servers the message was machine-generated, so they do not answer it with auto-replies.
const AUTOMATED_HEADERS = { 'Auto-Submitted': 'auto-generated' };

// A provider refusal. `message` is the raw technical reason (stored for diagnosis),
// `userMessage` is safe to show: it never contains credentials or the provider payload.
export class MailSendError extends Error {
  constructor(message: string, readonly userMessage: string | null, readonly code?: string) {
    super(message);
  }
}

@Injectable()
export class MailerService {
  private transporter: Transporter | null = null;

  constructor(private config: ConfigService) {}

  private value(key: string) {
    return (this.config.get<string>(key) || '').trim();
  }

  // EMAIL_PROVIDER selects the provider. Left empty, Resend is used, as before Gmail support existed.
  provider(): MailProvider {
    return this.value('EMAIL_PROVIDER').toLowerCase() === 'gmail' ? 'gmail' : 'resend';
  }

  isConfigured() {
    return this.provider() === 'gmail'
      ? Boolean(this.value('GMAIL_USER') && this.value('GMAIL_APP_PASSWORD'))
      : Boolean(this.value('RESEND_API_KEY') && this.value('RESEND_FROM'));
  }

  // Public address of the web app, used for links inside emails. Null unless PUBLIC_APP_URL is a valid http(s) URL.
  publicAppUrl(): string | null {
    const raw = this.value('PUBLIC_APP_URL');
    if (!raw) return null;
    try { const url = new URL(raw); return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${url.pathname.replace(/\/+$/, '')}` : null; } catch { return null; }
  }

  // Address shown to recipients, without any secret.
  sender() {
    if (!this.isConfigured()) return null;
    return this.provider() === 'gmail' ? `SOWEN <${this.value('GMAIL_USER').toLowerCase()}>` : this.value('RESEND_FROM');
  }

  async send(mail: OutgoingMail): Promise<{ id?: string }> {
    if (!this.isConfigured()) throw new MailSendError('Email provider is not configured', 'L’envoi d’emails n’est pas configuré.', 'NOT_CONFIGURED');
    return this.provider() === 'gmail' ? this.sendWithGmail(mail) : this.sendWithResend(mail);
  }

  private gmailTransport() {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true, // TLS from the first byte
        // Google shows app passwords in groups of four; the spaces are not part of the password.
        auth: { user: this.value('GMAIL_USER').toLowerCase(), pass: this.value('GMAIL_APP_PASSWORD').replace(/\s+/g, '') },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      });
    }
    return this.transporter;
  }

  private async sendWithGmail(mail: OutgoingMail) {
    try {
      const info = await this.gmailTransport().sendMail({ from: this.sender()!, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.automated ? AUTOMATED_HEADERS : undefined });
      if (!info.accepted?.length) throw Object.assign(new Error(`Recipient refused: ${String(info.response || '')}`), { code: 'EENVELOPE' });
      return { id: info.messageId };
    } catch (e: any) {
      throw new MailSendError(this.technicalReason(e), this.describeSmtpError(e), e?.code);
    }
  }

  private async sendWithResend(mail: OutgoingMail) {
    let sent;
    try {
      sent = await new Resend(this.value('RESEND_API_KEY')).emails.send({ from: this.value('RESEND_FROM'), to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.automated ? AUTOMATED_HEADERS : undefined });
    } catch (e: any) {
      throw new MailSendError(this.technicalReason(e), null);
    }
    if (sent.error) throw new MailSendError(`${sent.error.name}: ${sent.error.message}`, this.describeResendError(sent.error), sent.error.name);
    return { id: sent.data?.id };
  }

  private technicalReason(e: any) {
    const text = typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : 'Unknown email error';
    return `${e?.code ? `${e.code}: ` : ''}${text}`.slice(0, 500);
  }

  private describeSmtpError(e: any): string | null {
    const code = String(e?.code || '');
    const response = `${e?.response || ''} ${e?.message || ''}`.toLowerCase();
    if (code === 'EAUTH' || e?.responseCode === 535 || response.includes('username and password not accepted')) return 'Gmail a refusé l’identification. Vérifiez l’adresse Gmail et le mot de passe d’application.';
    if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET'].includes(code)) return 'Impossible de joindre le serveur d’envoi Gmail. Vérifiez la connexion du serveur.';
    if (response.includes('daily user sending') || response.includes('sending limit') || response.includes('quota')) return 'La limite d’envoi quotidienne de Gmail est atteinte. Réessayez plus tard.';
    if (code === 'EENVELOPE' || [550, 553].includes(e?.responseCode)) return 'L’adresse du destinataire a été refusée par le serveur d’envoi.';
    return null;
  }

  private describeResendError(error: { name?: string; message?: string }): string | null {
    const name = error.name || '';
    const message = (error.message || '').toLowerCase();
    if (['missing_api_key', 'invalid_api_key', 'restricted_api_key'].includes(name) || message.includes('api key')) return 'La clé du service d’envoi est invalide ou non autorisée.';
    if (message.includes('testing emails')) return 'Le compte d’envoi est en mode test : tant qu’aucun domaine n’est vérifié, seul le propriétaire du compte peut recevoir des emails.';
    if (message.includes('domain') && (message.includes('verif') || message.includes('not found'))) return 'Le domaine de l’adresse d’expédition n’est pas vérifié auprès du service d’envoi.';
    if (name === 'invalid_from_address' || message.includes('`from`')) return 'L’adresse d’expédition configurée est invalide.';
    if (name === 'rate_limit_exceeded' || name.includes('quota')) return 'Le quota du service d’envoi est atteint. Réessayez plus tard.';
    return null;
  }
}
