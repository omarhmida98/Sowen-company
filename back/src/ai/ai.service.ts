import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_OUTPUT_TOKENS = 32000;

@Injectable()
export class AiService {
  constructor(private config: ConfigService) {}

  provider() {
    return 'Claude';
  }

  isConfigured() {
    return Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim());
  }

  model() {
    return this.config.get<string>('ANTHROPIC_MODEL')?.trim() || DEFAULT_MODEL;
  }

  // When a JSON schema is given, Claude's structured outputs guarantee the reply matches it.
  async json<T>(system: string, user: string, schema?: Record<string, unknown>): Promise<{ data: T; model: string }> {
    const key = this.config.get<string>('ANTHROPIC_API_KEY')?.trim();
    if (!key) throw new BadRequestException('ANTHROPIC_API_KEY is not configured yet');
    const client = new Anthropic({ apiKey: key });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await client.beta.messages
        .stream({
          model: this.model(),
          max_tokens: MAX_OUTPUT_TOKENS,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system,
          messages: [{ role: 'user', content: user }],
          output_config: {
            effort: 'medium',
            ...(schema ? { format: { type: 'json_schema' as const, schema } } : {}),
          },
        })
        .finalMessage();
    } catch (error) {
      throw this.toHttpError(error);
    }

    if (message.stop_reason === 'refusal') throw new BadGatewayException("Claude a refusé d'analyser ce contenu.");
    if (message.stop_reason === 'max_tokens') throw new BadGatewayException("La réponse de Claude a été tronquée (document trop volumineux pour une seule analyse).");

    const raw = message.content.map(block => (block.type === 'text' ? block.text : '')).join('').trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { data: JSON.parse(cleaned) as T, model: message.model };
    } catch {
      throw new BadGatewayException('AI response was not valid JSON');
    }
  }

  // Never forwards the SDK error body or headers: only a safe, key-free message.
  private toHttpError(error: unknown) {
    if (error instanceof Anthropic.AuthenticationError) return new BadRequestException('Clé API Anthropic invalide ou révoquée. Vérifiez ANTHROPIC_API_KEY.');
    if (error instanceof Anthropic.PermissionDeniedError) return new BadRequestException("La clé API Anthropic n'a pas accès à ce modèle ou à cette fonctionnalité.");
    if (error instanceof Anthropic.NotFoundError) return new BadRequestException(`Modèle Anthropic introuvable : ${this.model()}. Vérifiez ANTHROPIC_MODEL.`);
    if (error instanceof Anthropic.RateLimitError) return new ServiceUnavailableException("Limite de débit Anthropic atteinte. Relancez l'analyse dans quelques instants.");
    if (error instanceof Anthropic.BadRequestError) return new BadGatewayException(`Requête refusée par l'API Anthropic : ${error.message}`);
    if (error instanceof Anthropic.APIConnectionError) return new ServiceUnavailableException("Impossible de joindre l'API Anthropic. Vérifiez la connexion réseau du serveur.");
    if (error instanceof Anthropic.APIError) return new ServiceUnavailableException(`L'API Anthropic est momentanément indisponible (${error.status ?? 'erreur'}).`);
    return error instanceof Error ? error : new Error('AI analysis failed');
  }
}
