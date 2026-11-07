import { classifySource, emptyManifest, parseManifest, pickHoldBack, planIntake, type IntakeManifest } from './photo-intake.js';

describe('classifySource', () => {
  it.each(['ann/a.jpg', 'ann/a.JPEG', 'ann/a.png', 'ann/a.heic', 'ann/a.HEIF', 'ann/a.webp', 'ann/zip/deep/a.jpg'])(
    'takes %s as a photo from ann',
    (file) => {
      expect(classifySource(file)).toEqual({ kind: 'photo', person: 'ann' });
    },
  );

  it('reports a photo outside a person folder, because it cannot be credited to anyone', () => {
    expect(classifySource('a.jpg')).toEqual({ kind: 'loose' });
  });

  it('reports a file it cannot read', () => {
    expect(classifySource('ann/pages.pdf')).toEqual({ kind: 'unsupported' });
  });

  it.each(['.DS_Store', 'ann/.DS_Store', 'ann/__MACOSX/a.jpg', 'ann/._a.jpg'])('ignores system file %s', (file) => {
    expect(classifySource(file)).toEqual({ kind: 'ignored' });
  });
});

describe('planIntake', () => {
  const photo = (person: string, name: string, hash: string) => ({ person, source: `${person}/${name}`, hash });

  it('numbers people and their pages', () => {
    const { manifest, toConvert } = planIntake(emptyManifest(), [
      photo('ann', 'b.jpg', 'h2'),
      photo('ann', 'a.jpg', 'h1'),
      photo('bo', 'a.jpg', 'h3'),
    ]);
    expect(toConvert.map((page) => [page.source, page.output])).toEqual([
      ['ann/a.jpg', 'person1-01.jpg'],
      ['ann/b.jpg', 'person1-02.jpg'],
      ['bo/a.jpg', 'person2-01.jpg'],
    ]);
    expect(manifest.people).toEqual({ ann: 'person1', bo: 'person2' });
  });

  it('does nothing for photos it has already taken in', () => {
    const first = planIntake(emptyManifest(), [photo('ann', 'a.jpg', 'h1')]);
    const second = planIntake(first.manifest, [photo('ann', 'a.jpg', 'h1')]);
    expect(second.toConvert).toEqual([]);
    expect(second.duplicates).toEqual([]);
    expect(second.manifest).toEqual(first.manifest);
  });

  it('keeps existing names when someone new sends photos later', () => {
    const first = planIntake(emptyManifest(), [photo('zoe', 'a.jpg', 'h1')]);
    const second = planIntake(first.manifest, [photo('ann', 'a.jpg', 'h2'), photo('zoe', 'a.jpg', 'h1'), photo('zoe', 'b.jpg', 'h3')]);
    expect(second.manifest.people).toEqual({ zoe: 'person1', ann: 'person2' });
    expect(second.toConvert.map((page) => page.output)).toEqual(['person2-01.jpg', 'person1-02.jpg']);
  });

  it('does not reuse a number after a gap', () => {
    const manifest: IntakeManifest = {
      people: { ann: 'person1' },
      pages: [{ hash: 'h3', source: 'ann/c.jpg', output: 'person1-03.jpg', person: 'person1', heldBack: false }],
    };
    expect(planIntake(manifest, [photo('ann', 'd.jpg', 'h4')]).toConvert[0].output).toBe('person1-04.jpg');
  });

  it('flags an exact duplicate instead of converting it', () => {
    const { toConvert, duplicates } = planIntake(emptyManifest(), [photo('ann', 'a.jpg', 'h1'), photo('bo', 'copy.jpg', 'h1')]);
    expect(toConvert.map((page) => page.source)).toEqual(['ann/a.jpg']);
    expect(duplicates).toEqual([{ source: 'bo/copy.jpg', sameAs: 'ann/a.jpg' }]);
  });

  it('does not change the manifest it was given', () => {
    const manifest = emptyManifest();
    planIntake(manifest, [photo('ann', 'a.jpg', 'h1')]);
    expect(manifest).toEqual(emptyManifest());
  });
});

describe('pickHoldBack', () => {
  const page = (person: string, hash: string, heldBack = false) => ({ hash, source: `${person}/${hash}.jpg`, output: `${person}-${hash}.jpg`, person, heldBack });
  const manifestOf = (...pages: ReturnType<typeof page>[]): IntakeManifest => ({ people: {}, pages });

  it('spreads held-back pages evenly across people', () => {
    const manifest = manifestOf(page('person1', 'a'), page('person1', 'b'), page('person1', 'c'), page('person2', 'd'), page('person2', 'e'), page('person2', 'f'));
    const held = pickHoldBack(manifest, 4).map((p) => p.person).sort();
    expect(held).toEqual(['person1', 'person1', 'person2', 'person2']);
  });

  it('moves on when a person has run out of pages', () => {
    const manifest = manifestOf(page('person1', 'a'), page('person2', 'b'), page('person2', 'c'), page('person2', 'd'));
    expect(pickHoldBack(manifest, 3).map((p) => p.hash).sort()).toEqual(['a', 'b', 'c']);
  });

  it('only tops up to the requested total', () => {
    const manifest = manifestOf(page('person1', 'a', true), page('person1', 'b'), page('person1', 'c'), page('person1', 'd'));
    expect(pickHoldBack(manifest, 2)).toHaveLength(1);
  });

  it('holds back nothing more when the total is already reached', () => {
    const manifest = manifestOf(page('person1', 'a', true), page('person1', 'b'));
    expect(pickHoldBack(manifest, 1)).toEqual([]);
  });

  it('counts pages already held when spreading', () => {
    const manifest = manifestOf(page('person1', 'a', true), page('person1', 'b'), page('person2', 'c'), page('person2', 'd'));
    expect(pickHoldBack(manifest, 2).map((p) => p.person)).toEqual(['person2']);
  });

  it('gives the same choice every time', () => {
    const manifest = manifestOf(page('person1', 'b'), page('person1', 'a'), page('person1', 'c'));
    expect(pickHoldBack(manifest, 1)).toEqual(pickHoldBack({ ...manifest, pages: [...manifest.pages].reverse() }, 1));
  });

  it('refuses when it would leave no pages to test', () => {
    const manifest = manifestOf(page('person1', 'a'), page('person1', 'b'));
    expect(() => pickHoldBack(manifest, 2)).toThrow(/at least 3 pages/);
  });
});

describe('parseManifest', () => {
  it('reads a saved manifest', () => {
    const manifest = planIntake(emptyManifest(), [{ person: 'ann', source: 'ann/a.jpg', hash: 'h1' }]).manifest;
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('gives a clear error for a damaged manifest', () => {
    expect(() => parseManifest('{oops')).toThrow(/intake\.json/);
    expect(() => parseManifest('{"people":{}}')).toThrow(/intake\.json/);
  });
});
