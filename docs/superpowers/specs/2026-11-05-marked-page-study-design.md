# Marked Page Study App: Design Spec

**Date:** 2026-11-05
**Status:** Draft for review
**Working name:** Chekmark (책마크). Trademark search still to do before public use

## 1. Summary

A phone-friendly web app for people learning a language by reading paper books. The reader underlines a page with a pencil and takes a photo. The app reads the marks, explains what was marked, and turns the words and grammar into flashcards built from sentences in the reader's own books.

Pitch: *Read a real book, mark it with a pencil, and your marks become your study material.*

## 2. Goals

The founder is preparing for a backend development career and wants to try making money from this, possibly as a startup in Korea.

- **Product:** help readers of paper books learn the words and grammar they actually meet.
- **Career:** produce a real, deployed backend system with real users and measured results.
- **Business:** find out cheaply whether people will pay, before registering a company.

### Non-goals for the first version

- Ebooks or on-screen marking
- Translating whole pages or whole books
- Native iOS or Android apps
- Anki export (planned next)
- Payments (added at Stage 4, see section 12)
- Shared libraries, social features or public book content
- Languages other than Korean

## 3. Users

- **First user:** the founder, reading Korean books at about TOPIK 4.
- **First outside users:** 10 to 20 intermediate Korean learners who read paper books, with foreign students in Korea as the easiest group to reach.
- **Later:** learners of other languages, added one at a time.

## 4. The marks

The rule for readers: **underline what you don't understand, and curl the grammar you want to study.**

| Mark | What it covers | Stored type | Result | Saved for study? |
|---|---|---|---|---|
| Straight underline | A word, phrase or part of a sentence | `underline_save` | Meaning in context | Yes |
| Straight underline | One or more complete sentences | `underline_translate` | Regular translation | No |
| Curly line | Grammar | `curly` | Explanation | Yes |

Rules:

1. **Whole sentences:** an underline running from the start to the end of one or more complete printed sentences is translated and not saved. This includes a one-word sentence such as `갔어요.`
2. **Everything shorter:** any other underline is saved as one item, however many words it covers.
3. **Save switch:** the reader can change whether any underline is saved during the Mark check. With saving off, the app translates exactly the underlined text and does not extend it to the full sentence.
4. **Curly marks inside an underlined sentence:** both count. The reader gets the translation and the saved grammar item.
5. **Words inside an underlined sentence:** a second straight line cannot be told apart on paper, so the reader adds the word by hand during the Mark check.
6. **Unclear marks:** the app never guesses. It labels the mark `unclear`, and the reader chooses its type or removes it.
7. **Order:** results follow the order of the marks on the page.

## 5. User flow

1. Sign in and choose or create a book.
2. Enter the page number and take or upload one photo.
3. Wait while the app detects the marks.
4. **Mark check:** review the detected marks, correct any mistakes, and confirm.
5. Read the results for the page.
6. Words and grammar are saved to the word bank and become flashcards.
7. Review due cards at any time.

## 6. Features

### 6.1 Mark check

The app shows the photo with each detected mark highlighted and colour-coded, next to a list of the same marks. In either view the reader can:

- Tap a mark to change its type or remove it
- Use the save switch on any underline
- Add a missed mark by typing its text and choosing a type
- Confirm the page when it looks right

The app cannot continue until every `unclear` mark has been resolved.

The list is the reliable fallback. If Stage 0 shows that highlight positions are inaccurate, the first version uses the list as the main view and shows the photo without highlights.

### 6.2 Results

- **Word or phrase:** text as printed, dictionary form, meaning in this context, a short usage note, the original sentence with a translation, and one simple example with a translation.
- **Grammar:** general pattern (for example `-(으)ㄹ 뻔하다`), meaning, how it is used and attached, the original sentence with a translation, and one simple example with a translation.
- **Translation:** the underlined text and a natural translation.

Explanations are written in English at TOPIK 3–4 level in the first version.

### 6.3 Word bank

Each user has a searchable list of saved words and grammar. Every item shows each place it was met: book, page and original sentence. Users can edit or delete items.

### 6.4 Memory across pages

When a marked item is already in the word bank:

- **Same meaning:** the app shows "You saw this on page 12" with the earlier sentence, adds the new sighting, and does not explain it again or create a new flashcard.
- **Different meaning:** the app explains the new meaning and adds it to the same item as a new sense with its own flashcard.

Items are matched by dictionary form for words and by general pattern for grammar. Missed matches can create duplicates. The first version accepts this, and users can delete duplicates.

### 6.5 Review

- **Word card:** the front shows the original sentence with the word highlighted. The back shows the meaning in that context.
- **Grammar card:** the front shows the original sentence with the pattern highlighted. The back shows the explanation.
- **Rating:** Again, Hard or Easy.
- **Scheduling:** an SM-2-style algorithm in its own module, so it can be replaced later without changing other code.

## 7. Architecture

One NestJS codebase with clear internal modules, a small web frontend, and background jobs. The same code starts as two processes: an API and a worker.

```text
Phone browser (React)
      |
      v
NestJS API ---------- Object storage (photos)
      |
      +-------------- PostgreSQL (permanent data)
      |
      +-------------- Redis (job queue, usage counters)
                           |
                           v
                     NestJS worker ---- Claude API
                     (also uses PostgreSQL and object storage)
```

### Stack

| Area | Choice | Reason |
|---|---|---|
| Backend | TypeScript, Node.js, NestJS | Matches the founder's study roadmap |
| Database | PostgreSQL | The data is strongly relational: books, pages, items, senses and cards |
| Database access | Prisma | Typed queries and managed migrations, which suit TypeScript |
| Job queue | BullMQ on Redis | Common in NestJS, with built-in retries and delays |
| Cache | Redis, only where measured to help | Starts with usage counters; no caching added before there is a need |
| Containers | Docker and Docker Compose | Same setup for local development and deployment |
| Photos | S3-compatible object storage | Standard and inexpensive |
| Frontend | React, TypeScript and Vite | Small, phone-first web app in the same language as the backend |
| AI | Claude API with image input | The model is chosen using the Stage 0 test set |
| Sign-in | One-time link sent by email | No passwords to store or reset |
| Hosting | Containers for the API and worker, managed PostgreSQL and Redis | Provider chosen in the implementation plan |

### How this covers the roadmap

| Roadmap topic | In this project | When |
|---|---|---|
| JavaScript, TypeScript, Node.js, NestJS | The whole backend | Stage 1 |
| Databases | PostgreSQL schema, migrations, transactions and indexes | Stage 1 |
| Queues | BullMQ jobs for detection and explanation | Stage 1 |
| Cache | Redis usage counters first; real caching only when measurements justify it | Stage 1, then as needed |
| Docker | Containers and Compose for all services | Stage 1 |
| Microservices | Not used. The API and worker processes teach the basics of separate services | Revisit only if load requires it |
| Kubernetes | Not used. It is too much to run for this size of app | Optional learning exercise after Stage 2 |

### Backend modules

Each module has one job and is reached through a small interface.

| Module | Job |
|---|---|
| `accounts` | Users, sign-in, usage limits |
| `library` | Books and pages |
| `photos` | Upload, storage, deletion |
| `detection` | Turns a photo into a list of marks |
| `explanation` | Turns confirmed marks into results |
| `wordbank` | Items, senses, sightings, matching |
| `review` | Flashcards and scheduling |
| `ai` | The only module that calls the Claude API; handles prompts, output validation and cost logging |
| `jobs` | BullMQ queues and workers, retries, failure handling |

### Why not the alternatives

- **Microservices or a message broker such as Kafka:** too much to run for one developer and a small user base. The NestJS module boundaries allow parts to be split out later.
- **A job queue in PostgreSQL:** needs less infrastructure, but BullMQ provides retries and delays ready-made, and Redis is on the founder's roadmap.
- **Calling the AI during the upload request:** the wait is long, and failed requests would be hard to recover. Background jobs handle both problems.
- **Separate OCR and line-detection stages:** more work up front. The first version sends the photo directly to the model. Stage 0 shows whether that is good enough.

## 8. Data model

| Table | Key fields |
|---|---|
| `users` | id, email, explanation_language, created_at |
| `books` | id, user_id, title, source_language |
| `pages` | id, book_id, page_number, photo_key, status, status_changed_at, failure_reason, detection_result, photo_deleted_at |
| `marks` | id, page_id, type, text, position, source (`detected`, `corrected` or `added`), order |
| `items` | id, user_id, kind (`word` or `grammar`), language, normal_form |
| `senses` | id, item_id, meaning, notes, example, example_translation |
| `sightings` | id, sense_id, page_id, mark_id, sentence, sentence_translation |
| `translations` | id, page_id, mark_id, translated_text |
| `cards` | id, sense_id, sighting_id, due_at, interval_days, ease, last_rating |
| `ai_calls` | id, user_id, page_id, purpose, model, input_tokens, output_tokens, cost, duration_ms |

`explanation_language` and `source_language` are stored from the start, so other languages can be added without changing the data model.

**Mark corrections are kept.** Comparing `detected` marks with what the reader confirmed gives an ongoing measure of detection accuracy.

**PostgreSQL is the source of truth.** Page status lives in PostgreSQL, and Redis only holds the work waiting to be done. If queue data is lost, a scheduled check re-queues pages stuck in `UPLOADED`, `DETECTING` or `EXPLAINING`, so no user data depends on Redis.

## 9. Processing a page

Page status moves through:

`UPLOADED → DETECTING → AWAITING_CHECK → EXPLAINING → DONE`

`DETECTING` and `EXPLAINING` can move to `FAILED`, and the reader can retry from there.

1. The browser resizes the photo, converts it to JPEG and uploads it.
2. A detection job asks the model for structured output:

   ```json
   {
     "photo_usable": true,
     "problem": null,
     "marks": [
       {
         "type": "underline_save | underline_translate | curly | unclear",
         "text": "text as printed",
         "normal_form": "dictionary form or pattern",
         "sentence": "the full sentence containing the mark",
         "box": [0, 0, 0, 0]
       }
     ]
   }
   ```

   `normal_form` is null for `underline_translate` marks.

3. The reader checks and confirms the marks.
4. The app looks up each word or grammar mark in the reader's word bank by `normal_form`.
5. An explanation job sends the confirmed marks and any existing senses to the model. For each mark it returns either the matching sense or a new explanation.
6. Results are saved in one transaction, and cards are created for new senses.

## 10. Error handling

| Situation | What happens |
|---|---|
| Blurry, dark or cut-off photo | Reader is asked to retake it, and it does not count towards the limit |
| No marks found | Reader can retake the photo or add marks by hand |
| Invalid model output | Retried once with the validation error, then treated as a failed attempt |
| AI timeout or rate limit | Up to 3 attempts with increasing delays, then `FAILED` with a retry button |
| Worker crash | BullMQ retries the stalled job. Jobs are safe to run twice, and items are not duplicated |
| Redis unavailable or queue data lost | Uploads are saved and pages wait in `UPLOADED`. The scheduled check re-queues them when Redis returns |
| Usage limit reached | Clear message showing when the limit resets, and the photo is not processed |
| Monthly AI budget reached | New pages are paused and the owner is alerted. Review and the word bank keep working |

## 11. Limits, privacy and copyright

- **Per-user limit:** 5 pages a day during the private test. This is a setting and may change.
- **Monthly budget:** an app-wide spending cap on AI usage.
- **Cost tracking:** every AI call is logged, so the real cost per page is known before setting a price.
- **Photos:** private to the user and deleted automatically 30 days after processing, or sooner on request.
- **Stored text:** only marked text and the sentences containing it. Full page text is not kept.
- **Sharing:** no user content is ever shown to other users.
- **Account deletion:** removes all of the user's data and photos.
- **Before public launch:** get advice on copyright, privacy law and the founder's visa status.

## 12. Stages

Each stage must pass before the next one starts. The targets are starting points chosen for this project, not industry benchmarks.

| Stage | Work | Pass condition |
|---|---|---|
| **0. Mark test** | Test about 20 real marked pages, including messy ones | At least 90% of marks have correct text and type, and no type (`underline_save`, `underline_translate`, `curly`) is below 80% |
| **1. Personal version** | Build the first version and use it with the founder's own books | Founder uses it for 3 weeks without going back to the Claude project |
| **2. Private test** | Invite 10 to 20 learners | At least 5 are still using it after 30 days |
| **3. Willingness to pay** | Ask active users to pay, using a simple payment link or manual transfer | At least 3 pay, at a price above the measured cost per user |
| **4. Paid product** | Add payments, public sign-up and Anki export | Decide on company registration and support programmes using the results |

If Stage 0 fails, change the marks or the detection method before writing product code.

The first implementation plan covers **Stage 1 only**.

## 13. Testing

- **Detection test set:** real marked pages with correct answers, re-run whenever the prompt or model changes. Because they are photos of copyrighted books, they are kept in private storage and never committed to a public repository.
- **Unit tests:** scheduling, word bank matching, page status changes and output validation.
- **Integration tests:** API, database and job queue against real PostgreSQL and Redis using Testcontainers, with a fake AI client.
- **End-to-end test:** one full journey with the fake AI client: upload, check, results, review.
- **Device test:** take and upload photos on real iPhone and Android browsers.

## 14. Risks

| Risk | Response |
|---|---|
| Straight and curly lines are confused on short words | Stage 0 measures this, and the Mark check catches what remains |
| Short sentences and phrases are sorted wrongly, so an underline is saved or not saved by mistake | Stage 0 measures this, and the save switch fixes what remains |
| Highlight positions are inaccurate | List-first Mark check (section 6.1) |
| Too few people mark paper books | Stage 2 tests this before payments are built |
| Users stop coming back | Stage 2 measures 30-day use |
| AI cost per page is too high | Cost logging, usage limits and model comparison on the test set |
| Competitors copy the idea | Compete on accuracy and the study experience, and stay small until demand is proven |
| iPhone camera problems | Use a standard photo button rather than a live camera view, and test on real devices |

## 15. Assumptions to confirm

1. The first version covers Korean books with English explanations only.
2. Underlined whole sentences do not become flashcards.
3. The first version handles one photo at a time.
4. Microservices and Kubernetes stay out of the product until real load requires them.
