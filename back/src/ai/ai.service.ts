import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  constructor(private config: ConfigService) {}

  isConfigured() {
    return Boolean(this.config.get<string>('OPENAI_API_KEY'));
  }

  model() {
    return this.config.get<string>('OPENAI_MODEL') || 'gpt-5-mini';
  }

  async json<T>(system: string, user: string): Promise<{ data: T; model: string }> {
    const key = this.config.get<string>('OPENAI_API_KEY');
    if (!key) throw new BadRequestException('OPENAI_API_KEY is not configured yet');
    const model = this.model();
    const client = new OpenAI({ apiKey: key });
    const response = await client.responses.create({
      model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    const raw = response.output_text?.trim() || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { data: JSON.parse(cleaned) as T, model };
    } catch {
      throw new BadRequestException('AI response was not valid JSON');
    }
  }
}
