import { z } from 'zod';

export const MARK_TYPES = ['underline_save', 'underline_translate', 'curly', 'unclear'] as const;
export type MarkType = (typeof MARK_TYPES)[number];

export type Box = [left: number, top: number, right: number, bottom: number];

export interface DetectedMark {
  type: MarkType;
  text: string;
  normal_form: string | null;
  sentence: string;
  /** Scaled 0–1000 from the top-left of the photo, or null if unknown. */
  box: Box | null;
}

export interface DetectionResult {
  photo_usable: boolean;
  problem: string | null;
  marks: DetectedMark[];
}

// Limits live in superRefine rather than .min()/.max() or z.tuple() so the JSON
// schema sent to the API stays simple. Zod still enforces them on the response.
const markSchema = z
  .object({
    type: z.enum(MARK_TYPES),
    text: z.string(),
    normal_form: z.string().nullable(),
    sentence: z.string(),
    box: z.array(z.number()).nullable(),
  })
  .superRefine((mark, ctx) => {
    const hasNormalForm = (mark.normal_form ?? '').trim() !== '';
    if ((mark.type === 'underline_save' || mark.type === 'curly') && !hasNormalForm) {
      ctx.addIssue({ code: 'custom', path: ['normal_form'], message: `normal_form is required on a ${mark.type} mark` });
    }
    if (mark.type === 'underline_translate' && mark.normal_form !== null) {
      ctx.addIssue({ code: 'custom', path: ['normal_form'], message: 'normal_form must be null on an underline_translate mark' });
    }
  });

function isValidBox(box: number[]): boolean {
  if (box.length !== 4 || box.some((v) => v < 0 || v > 1000)) return false;
  const [left, top, right, bottom] = box;
  return left <= right && top <= bottom;
}

export const detectionResultSchema = z
  .object({
    photo_usable: z.boolean(),
    problem: z.string().nullable(),
    marks: z.array(markSchema),
  })
  .superRefine((result, ctx) => {
    if (!result.photo_usable && (result.problem ?? '').trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['problem'], message: 'problem is required when photo_usable is false' });
    }
  }) as unknown as z.ZodType<DetectionResult>;

/**
 * A bad box only spoils the report drawing, so it becomes null instead of failing the whole page.
 * This runs after parsing because a Zod transform cannot be sent to the API as a JSON schema.
 */
export function dropInvalidBoxes(result: DetectionResult): DetectionResult {
  return {
    ...result,
    marks: result.marks.map((mark) => (mark.box === null || isValidBox(mark.box) ? mark : { ...mark, box: null })),
  };
}
