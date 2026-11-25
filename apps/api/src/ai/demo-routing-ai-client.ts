import { savedAnswer, savedTranslation } from '../demo/sample-data.js';
import type { ExplainPromptMark } from '../explanation/explanation.prompt.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AiClient, AiRequest } from './ai-client.js';

/** The JSON list that the resolve and explain prompts carry after their first line. */
const marksIn = <T>(prompt: string) => JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)) as T[];

/**
 * The one way to the AI. Requests for a demo account are answered from saved
 * answers and never reach the real client, so a demo visitor cannot spend money.
 */
export class DemoRoutingAiClient implements AiClient {
  constructor(
    private readonly real: AiClient,
    private readonly prisma: Pick<PrismaService, 'user'>,
  ) {}

  async generate<T>(req: AiRequest<T>): Promise<T> {
    const user = req.userId ? await this.prisma.user.findUnique({ where: { id: req.userId }, select: { demoExpiresAt: true } }) : null;
    // An account deleted while its job ran (a demo that just expired) gets no AI call either.
    if (req.userId && !user) throw new Error('The account no longer exists');
    if (!user?.demoExpiresAt) return this.real.generate(req);
    return req.schema.parse(this.answer(req));
  }

  private answer(req: AiRequest<unknown>): unknown {
    if (req.purpose === 'detect') throw new Error('A demo account cannot read photos');
    if (req.purpose === 'resolve') {
      const marks = marksIn<{ mark_id: string; text: string }>(req.prompt);
      return { marks: marks.map((mark) => ({ mark_id: mark.mark_id, normal_form: mark.text, sentence: null })) };
    }
    const blank = { translation: null, sense_id: null, meaning: null, notes: null, example: null, example_translation: null, sentence_translation: null };
    return {
      results: marksIn<ExplainPromptMark>(req.prompt).map((mark) => {
        if (mark.kind === 'translation') return { ...blank, mark_id: mark.mark_id, kind: 'translation', translation: savedTranslation(mark.text) };
        const sentence_translation = savedTranslation(mark.sentence ?? mark.text);
        const existing = mark.existing_senses[0];
        if (existing) return { ...blank, mark_id: mark.mark_id, kind: 'existing', sense_id: existing.sense_id, sentence_translation };
        const answer = savedAnswer(mark.dictionary_form ?? mark.text);
        return { ...blank, mark_id: mark.mark_id, kind: 'new', meaning: answer.meaning, notes: answer.notes, example: answer.example, example_translation: answer.exampleTranslation, sentence_translation };
      }),
    };
  }
}
