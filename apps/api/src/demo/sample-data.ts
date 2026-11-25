import type { MarkType } from '../generated/prisma/client.js';
import { toNormalForm } from '../wordbank/normal-form.js';

/**
 * The demo's content. The book, its sentences and the page picture
 * (assets/demo-page.jpg) were invented for the demo: nothing is from a real book.
 */
export const DEMO_BOOK_TITLE = '골목 끝 작은 책방 (sample book)';

export interface SampleMark {
  type: MarkType;
  text: string;
  normalForm: string | null;
  sentence: string;
}

/** Pages 12 and 13 are finished; page 14 waits for the visitor's Mark check and matches the picture. */
export const DEMO_PAGES: { pageNumber: number; done: boolean; marks: SampleMark[] }[] = [
  {
    pageNumber: 12,
    done: true,
    marks: [
      { type: 'underline_save', text: '은은하게', normalForm: '은은하다', sentence: '문을 열자 오래된 종이 냄새가 은은하게 풍겼다.' },
      { type: 'curly', text: '보자마자', normalForm: '-자마자', sentence: '주인은 나를 보자마자 활짝 웃었다.' },
      { type: 'underline_save', text: '머뭇거렸다', normalForm: '머뭇거리다', sentence: '나는 대답하기 전에 잠시 머뭇거렸다.' },
      { type: 'underline_translate', text: '나는 그날 처음으로 책방의 이름을 물어보았다.', normalForm: null, sentence: '나는 그날 처음으로 책방의 이름을 물어보았다.' },
    ],
  },
  {
    pageNumber: 13,
    done: true,
    marks: [
      { type: 'underline_save', text: '구석', normalForm: '구석', sentence: '나는 구석에 앉아 책장을 넘겼다.' },
      { type: 'curly', text: '읽다 보니', normalForm: '-다 보니', sentence: '책을 읽다 보니 어느새 저녁이 되었다.' },
    ],
  },
  {
    pageNumber: 14,
    done: false,
    marks: [
      { type: 'underline_save', text: '은은하게', normalForm: '은은하다', sentence: '등불이 은은하게 골목을 비추고 있었다.' },
      { type: 'curly', text: '기다릴 수밖에 없었다', normalForm: '-(으)ㄹ 수밖에 없다', sentence: '비가 그칠 때까지 기다릴 수밖에 없었다.' },
      { type: 'unclear', text: '빗소리', normalForm: null, sentence: '조용한 책방에 빗소리만 가득했다.' },
      { type: 'underline_save', text: '문득', normalForm: '문득', sentence: '문득 어머니의 목소리가 떠올랐다.' },
      { type: 'underline_translate', text: '그래도 마음만은 따뜻했다.', normalForm: null, sentence: '그래도 마음만은 따뜻했다.' },
    ],
  },
];

export interface SavedAnswer {
  meaning: string;
  notes: string;
  example: string;
  exampleTranslation: string;
}

const ANSWERS: Record<string, SavedAnswer> = {
  은은하다: { meaning: 'soft, subtle, faint (of light, scent or sound)', notes: 'Describes something pleasantly gentle, not weak. Often used as the adverb 은은하게.', example: '방 안에 꽃향기가 은은하게 퍼졌다.', exampleTranslation: 'A faint scent of flowers spread through the room.' },
  '-자마자': { meaning: 'as soon as …', notes: 'Attaches to a verb stem. The second action follows immediately after the first.', example: '집에 오자마자 손을 씻었다.', exampleTranslation: 'I washed my hands as soon as I came home.' },
  머뭇거리다: { meaning: 'to hesitate', notes: 'Pausing in speech or movement because you are unsure.', example: '그는 문 앞에서 머뭇거렸다.', exampleTranslation: 'He hesitated in front of the door.' },
  구석: { meaning: 'corner', notes: 'An inner corner or an out-of-the-way place. For a street corner, use 모퉁이.', example: '고양이가 방 구석에서 자고 있다.', exampleTranslation: 'The cat is sleeping in the corner of the room.' },
  '-다 보니': { meaning: 'while doing … (I found that)', notes: 'Attaches to a verb stem. Continuing an action led to a result or a discovery.', example: '매일 걷다 보니 건강해졌다.', exampleTranslation: 'Walking every day, I became healthier.' },
  '-(으)ㄹ 수밖에 없다': { meaning: 'have no choice but to …', notes: 'Attaches to a verb stem. There is no other option, or the result is inevitable.', example: '버스가 끊겨서 걸을 수밖에 없었다.', exampleTranslation: 'The buses had stopped, so I had no choice but to walk.' },
  빗소리: { meaning: 'the sound of rain', notes: 'From 비 (rain) and 소리 (sound), joined with the linking ㅅ.', example: '빗소리를 들으며 잠이 들었다.', exampleTranslation: 'I fell asleep listening to the rain.' },
  문득: { meaning: 'suddenly (of a thought or feeling)', notes: 'Used when something comes to mind unexpectedly. For a sudden event, use 갑자기.', example: '문득 옛 친구가 생각났다.', exampleTranslation: 'I suddenly thought of an old friend.' },
};

const TRANSLATIONS: Record<string, string> = {
  '문을 열자 오래된 종이 냄새가 은은하게 풍겼다.': 'When I opened the door, there was a faint smell of old paper.',
  '주인은 나를 보자마자 활짝 웃었다.': 'The owner smiled broadly as soon as they saw me.',
  '나는 대답하기 전에 잠시 머뭇거렸다.': 'I hesitated for a moment before answering.',
  '나는 그날 처음으로 책방의 이름을 물어보았다.': 'That day, for the first time, I asked the name of the bookshop.',
  '나는 구석에 앉아 책장을 넘겼다.': 'I sat in the corner and turned the pages.',
  '책을 읽다 보니 어느새 저녁이 되었다.': 'I was reading, and before I knew it, it was evening.',
  '등불이 은은하게 골목을 비추고 있었다.': 'A lamp was softly lighting the alley.',
  '비가 그칠 때까지 기다릴 수밖에 없었다.': 'I had no choice but to wait until the rain stopped.',
  '조용한 책방에 빗소리만 가득했다.': 'Only the sound of rain filled the quiet bookshop.',
  빗소리: 'the sound of rain',
  '문득 어머니의 목소리가 떠올랐다.': "Suddenly, my mother's voice came to mind.",
  '그래도 마음만은 따뜻했다.': 'Still, my heart was warm.',
};

const NOT_SAVED = 'The demo has no saved explanation for this one. In the real app, Claude explains it.';

export function savedAnswer(form: string): SavedAnswer {
  const key = toNormalForm(form);
  return Object.hasOwn(ANSWERS, key) ? ANSWERS[key] : { meaning: NOT_SAVED, notes: 'Sample answers cover only the marks on the sample page.', example: form, exampleTranslation: NOT_SAVED };
}

export function savedTranslation(sentence: string): string {
  const key = toNormalForm(sentence);
  return Object.hasOwn(TRANSLATIONS, key) ? TRANSLATIONS[key] : NOT_SAVED;
}
