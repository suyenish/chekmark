import { z } from 'zod';
import type { DetectedMark } from './detection.schema.js';
import type { ExpectedPage, MarkScore, ScoredMark } from './score-marks.js';

const answersSchema = z.array(
  z.object({
    file: z.string(),
    marks: z.array(z.object({ type: z.enum(['double', 'curly', 'single']), text: z.string().min(1) })),
  }),
);

export function parseAnswers(json: string): ExpectedPage[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw new Error(`answers.json is not valid JSON: ${(error as Error).message}`);
  }
  const result = answersSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`answers.json has a problem:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function pickPhotos(fileNames: string[]): { photos: string[]; unsupported: string[] } {
  const matching = (pattern: RegExp) => fileNames.filter((name) => pattern.test(name)).sort();
  return { photos: matching(/\.(jpe?g|png)$/i), unsupported: matching(/\.(heic|heif)$/i) };
}

export interface Prices {
  /** Price per million input tokens. */
  input: number;
  /** Price per million output tokens. */
  output: number;
}

export function calculateCost(inputTokens: number, outputTokens: number, prices: Prices | null): number | null {
  if (!prices) return null;
  return (inputTokens * prices.input + outputTokens * prices.output) / 1_000_000;
}

export interface ReportPage {
  file: string;
  expected: ScoredMark[];
  detected: DetectedMark[];
  error?: string;
}

const COLOURS: Record<string, string> = { double: '#1565c0', curly: '#c62828', single: '#2e7d32', unclear: '#ef6c00' };

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace(/&#60;/g, '&lt;').replace(/&#62;/g, '&gt;').replace(/&#38;/g, '&amp;');

const percent = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);

function renderBox(mark: DetectedMark): string {
  if (!mark.box) return '';
  const [left, top, right, bottom] = mark.box;
  const style = `left:${left / 10}%;top:${top / 10}%;width:${(right - left) / 10}%;height:${(bottom - top) / 10}%;border-color:${COLOURS[mark.type]}`;
  return `<div class="box" style="${style}" title="${escapeHtml(`${mark.type}: ${mark.text}`)}"></div>`;
}

const renderList = (marks: ScoredMark[]) =>
  marks.map((m) => `<li><b style="color:${COLOURS[m.type]}">${m.type}</b> ${escapeHtml(m.text)}</li>`).join('');

function renderPage(page: ReportPage): string {
  return `<section>
<h2>${escapeHtml(page.file)}</h2>
${page.error ? `<p class="error">${escapeHtml(page.error)}</p>` : ''}
<div class="row">
<div class="photo"><img src="${encodeURI(page.file)}" alt="">${page.detected.map(renderBox).join('')}</div>
<div><h3>Expected</h3><ul>${renderList(page.expected)}</ul><h3>Detected</h3><ul>${renderList(page.detected)}</ul></div>
</div>
</section>`;
}

export function renderReport(score: MarkScore, pages: ReportPage[], model: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Mark test report</title>
<style>
body{font:15px system-ui,sans-serif;margin:24px;color:#222}
.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
.photo{position:relative;display:inline-block;max-width:640px}
.photo img{display:block;width:100%}
.box{position:absolute;border:2px solid;box-sizing:border-box}
.error{color:#c62828;font-weight:600}
section{border-top:1px solid #ddd;margin-top:24px}
</style></head><body>
<h1>Mark test: ${score.passed ? 'PASS' : 'FAIL'}</h1>
<p>Model: ${escapeHtml(model)}</p>
<p>Overall: ${percent(score.overall)} (${score.correct} correct of ${score.expected} expected, ${score.extra} extra)</p>
<p>Double: ${percent(score.byType.double)} · Curly: ${percent(score.byType.curly)} · Single: ${percent(score.byType.single)}</p>
${pages.map(renderPage).join('\n')}
</body></html>
`;
}
