# Stage 0 mark test results

The mark test checks whether an AI model can read a reader's pencil marks from a phone photo of a Korean book page. It compares what the model finds against an answer key the founder corrected by hand, and scores each mark on its text and its type.

## Test set so far

- 7 pages, all photographed on one phone
- 2 readers and 2 books: a TOPIK reading workbook, with marks by two people, and a Korean edition of a self-help book
- 65 marks in the answer key: 53 saved underlines, 1 sentence underline and 11 curly marks
- No pages held back yet. The fair check starts when volunteers' pages arrive.

The photos stay out of the repository (`private-test-data/`, gitignored).

## Results

| Run (7 November 2026) | Overall | Saved underlines | Sentence underlines | Curly marks | Cost per page |
|---|---|---|---|---|---|
| Dry run, invented page with 6 marks | 100% | 100% | 100% | 100% | $0.0014 |
| Haiku 5.5, run 1 | 70.7% | 81.1% | n/a | 90.9% | $0.0022 |
| Haiku 5.5, run 2, corrected key | 65.3% | 73.6% | 100% | 81.8% | $0.0021 |

Target: 90% overall, and no type below 80%. Overall accuracy counts extra marks against the score: correct ÷ (expected + extra).

Run 2 used a corrected answer key: one sentence split into a curly mark and a sentence underline, one underline split in two, and one word fixed. Some of its marks still differ from the key only by a final full stop.

## Most common errors

1. **Faint pencil on grey boxes is missed**, for example `최초의 동전` and `소형`.
2. **Marks are cut short**, for example `한층 앞당겨질` instead of `한층 앞당겨질 것으로 기대된다`, and a curly mark missing its first two words.
3. **Similar syllables are misread**, for example `펑펑` read as `평평` and `뽑히는` read as `뽐히는`.
4. **Separate lines are merged or split**, for example `부상을` and `당하고` merged into one mark.
5. **Partial sentences are sorted as whole sentences**, so an underline that starts partway through a sentence was marked `underline_translate`.
6. **One line between two printed lines was counted twice.**
7. **A line that stops partway through a word is copied exactly**, giving meaningless text such as `비록 신`.
8. **Results change between runs.** The same photo gives different misses each time, so 7 pages cannot pin down accuracy.

Fixed in the tool: an invalid on-photo box used to fail the whole page, which happened on 2–3 of 7 pages. A bad box is now dropped and the marks are kept.

Done correctly every time: printed red wavy lines and yellow highlights in the book were ignored.

## Decisions

- **Model:** `claude-haiku-5-5`, because it is the cheapest. Sonnet 5.5 has not been tried yet, at about $0.04 per page.
- **Mark check view:** `list`, because the model sometimes returned invalid box positions. Highlight accuracy has not been reviewed.
- **Gate:** the target was not met. On 7 November 2026 the founder chose to build Stage 1 anyway, as a portfolio project with a required Mark check and a beta label (spec section 12). The target must be met before Stage 3.

## Next

- **Prompt:** add rules for whole words, marks that run to the end of the text, one line between two printed lines, and faint pencil.
- **More test pages:** add volunteers' pages, hold back 10, and rerun.
- **Sonnet:** try Sonnet 5.5 on the same set.
- **Scoring:** decide whether it should ignore a final full stop.
