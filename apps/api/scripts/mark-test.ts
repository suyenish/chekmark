// Stage 0 mark test. Usage:
//   pnpm --filter api mark-test --draft [--model <id>]
//   pnpm --filter api mark-test [--model <id>]
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { AiOutputInvalidError, AiTransientError } from '../src/ai/ai-client.js';
import { ClaudeAiClient } from '../src/ai/claude-ai-client.js';
import { DETECTION_SYSTEM_PROMPT, DETECTION_USER_PROMPT } from '../src/detection/detection.prompt.js';
import { detectionResultSchema, dropInvalidBoxes, type DetectedMark } from '../src/detection/detection.schema.js';
import {
  calculateCost,
  parseAnswers,
  pickPhotos,
  renderReport,
  type Prices,
  type ReportPage,
} from '../src/detection/mark-test-lib.js';
import { scoreMarks, type ExpectedPage } from '../src/detection/score-marks.js';

const DATA_DIR = path.resolve(process.cwd(), '../../private-test-data');
const MAX_LONG_EDGE_PX = 2000;
const JPEG_QUALITY = 85;

const { values: args } = parseArgs({
  options: { draft: { type: 'boolean', default: false }, model: { type: 'string' } },
  allowPositionals: true,
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readPrices(): Prices | null {
  const input = Number(process.env.AI_INPUT_COST_PER_MTOK);
  const output = Number(process.env.AI_OUTPUT_COST_PER_MTOK);
  return input > 0 && output > 0 ? { input, output } : null;
}

async function preparePhoto(file: string): Promise<Buffer> {
  return sharp(path.join(DATA_DIR, file))
    .rotate() // apply the phone's orientation before resizing
    .resize({ width: MAX_LONG_EDGE_PX, height: MAX_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

async function main(): Promise<void> {
  const model = args.model ?? process.env.AI_MODEL;
  if (!model) fail('Choose a model with --model <id> or AI_MODEL in .env.');
  if (!existsSync(DATA_DIR)) fail(`Put your marked page photos in ${DATA_DIR} first.`);

  const { photos, unsupported } = pickPhotos(readdirSync(DATA_DIR));
  if (unsupported.length > 0) {
    fail(`Convert these HEIC photos to JPEG first:\n${unsupported.join('\n')}\n\nOn a Mac, inside private-test-data, run:\nsips -s format jpeg <photo>.HEIC --out <photo>.jpg`);
  }
  if (photos.length === 0) fail(`No JPEG or PNG photos found in ${DATA_DIR}.`);

  let inputTokens = 0;
  let outputTokens = 0;
  const client = new ClaudeAiClient(new Anthropic(), model, (usage) => {
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
  });

  const detect = async (file: string): Promise<{ marks: DetectedMark[]; error?: string }> => {
    try {
      const result = await client.generate({
        purpose: 'detect',
        system: DETECTION_SYSTEM_PROMPT,
        prompt: DETECTION_USER_PROMPT,
        schema: detectionResultSchema,
        imageJpeg: await preparePhoto(file),
      });
      return result.photo_usable ? { marks: dropInvalidBoxes(result).marks } : { marks: [], error: `Photo not usable: ${result.problem}` };
    } catch (error) {
      if (error instanceof AiOutputInvalidError || error instanceof AiTransientError) {
        return { marks: [], error: error.message };
      }
      throw error; // a wrong key or model would fail on every page, so stop now
    }
  };

  if (args.draft) {
    const draft: { file: string; marks: { type: string; text: string }[] }[] = [];
    for (const file of photos) {
      console.log(`Reading ${file}...`);
      const { marks, error } = await detect(file);
      if (error) console.warn(`  ${error}`);
      draft.push({ file, marks: marks.map(({ type, text }) => ({ type, text })) });
    }
    const draftPath = path.join(DATA_DIR, 'answers.draft.json');
    writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
    console.log(`\nWrote ${draftPath}`);
    console.log('Correct every entry against the real page, replace each "unclear", then save it as answers.json.');
    return;
  }

  const answersPath = path.join(DATA_DIR, 'answers.json');
  if (!existsSync(answersPath)) fail(`${answersPath} is missing. Run with --draft first.`);
  const expected: ExpectedPage[] = parseAnswers(readFileSync(answersPath, 'utf8'));

  const missing = expected.filter((page) => !photos.includes(page.file)).map((page) => page.file);
  if (missing.length > 0) fail(`answers.json names photos that do not exist:\n${missing.join('\n')}`);
  const unanswered = photos.filter((file) => !expected.some((page) => page.file === file));
  if (unanswered.length > 0) console.warn(`Skipping photos with no answers: ${unanswered.join(', ')}`);

  const pages: ReportPage[] = [];
  for (const page of expected) {
    console.log(`Reading ${page.file}...`);
    const { marks, error } = await detect(page.file);
    if (error) console.warn(`  ${error}`);
    pages.push({ file: page.file, expected: page.marks, detected: marks, error });
  }

  const score = scoreMarks(expected, pages.map(({ file, detected }) => ({ file, marks: detected })));
  const reportPath = path.join(DATA_DIR, 'report.html');
  writeFileSync(reportPath, renderReport(score, pages, model));

  const percent = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
  const cost = calculateCost(inputTokens, outputTokens, readPrices());
  console.log(`\nModel:   ${model}`);
  console.log(`Overall: ${percent(score.overall)} (${score.correct} of ${score.expected} correct, ${score.extra} extra)`);
  console.log(`Saved underlines:    ${percent(score.byType.underline_save)}`);
  console.log(`Sentence underlines: ${percent(score.byType.underline_translate)}`);
  console.log(`Curly marks:         ${percent(score.byType.curly)}`);
  console.log(`Tokens:  ${inputTokens} input, ${outputTokens} output`);
  console.log(cost === null ? 'Cost:    set AI_INPUT_COST_PER_MTOK and AI_OUTPUT_COST_PER_MTOK to see this' : `Cost:    $${(cost / pages.length).toFixed(4)} per page`);
  console.log(`Result:  ${score.passed ? 'PASS' : 'FAIL'}`);
  console.log(`Report:  ${reportPath}`);
}

try {
  await main();
} catch (error) {
  if (error instanceof Anthropic.AuthenticationError) {
    fail('The API rejected your key. Check ANTHROPIC_API_KEY in .env.');
  }
  if (error instanceof Anthropic.NotFoundError) {
    fail(`The model was not found, or your account cannot use it: ${args.model ?? process.env.AI_MODEL}`);
  }
  fail(error instanceof Error ? error.message : String(error));
}
