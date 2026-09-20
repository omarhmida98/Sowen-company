import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class AiService {
  constructor(private config: ConfigService) {}

  isConfigured() {
    return Boolean(this.config.get<string>('GEMINI_API_KEY'));
  }

  model() {
    return this.config.get<string>('GEMINI_MODEL') || 'gemini-3.6-flash';
  }

  async json<T>(system: string, user: string): Promise<{ data: T; model: string }> {
    const key = this.config.get<string>('GEMINI_API_KEY');
    if (!key) throw new BadRequestException('GEMINI_API_KEY is not configured yet');
    const model = this.model();
    const client = new GoogleGenAI({ apiKey: key });
    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: user }] }],
      config: {
        systemInstruction: { role: 'system', parts: [{ text: system }] },
        responseMimeType: 'application/json',
      },
    });
    const raw = response.text?.trim() || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
      return { data: JSON.parse(cleaned) as T, model };
    } catch {
      throw new BadRequestException('AI response was not valid JSON');
    }
  }
}