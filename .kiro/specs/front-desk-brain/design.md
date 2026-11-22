# Design Document: Front Desk Brain

## Overview

On 2026-11-16 a real caller said "Hola Lola quería cortarme el pelo y hacerme un degradado" and heard the Fallback_Message, because Gemini answered 503 after 6.6 s and the code had nothing else to say. This spec gives the Conversation_Core a second reader, the **Code_Brain**: pure rules that turn the caller's words into the same kind of facts the model gives, so `decideTurn` and the Booking_Rules can finish the Turn without the model.

The design rests on one observation about the code as it is: `decideTurn` already decides every fact. The model contributes three things only: what it heard (intent, service words, day, time, name, phone, yes, goodbye), a free line for questions and small talk, and a one-line reason for the Owner. The Code_Brain replaces the first with rules, replaces the second with templates from the Shop_Profile, and builds the third by code. Everything after that (merging fields, the Booking_Rules, read-back, confirmation, writes, the Message) is the code that already runs and is already tested.

Four other changes ride on it:

1. **Service_Combos.** "Corte y degradado" becomes one booking with the Combo_Id `corte-hombre+degradado`. The Booking_Rules resolve a Combo_Id to one service of the summed duration, so every existing rule and property applies to it unchanged, and one booking row keeps the "one Booking per Call" index and the no-overlap constraint as they are. No migration.
2. **The First_Offer.** Once the services are known, the code offers the nearest free slot instead of asking "¿qué día y a qué hora?". That is what turns the regression call into one "sí".
3. **A Rich_Profile.** Nineteen services with aliases, prices and durations, five Categories, and fourteen FAQ_Entries, all validated by the profile schema.
4. **The model only when needed, and briefly.** When the Code_Brain is sure (a Sure_Reading), the model is not called. Otherwise it gets at most 1.6 s, a third default model, and attempt deadlines chosen from a new measurement.
5. **Latency.** The browser ends the caller's Turn after 600 ms of silence instead of waiting for Chrome, plays a preloaded Filler when the reply is not audible by 700 ms, gets the reply's audio in the same response as its text, and starts playback with 150 ms buffered. A script and a page panel measure it on the deployed demo.

### Working beside the other specs

- **core-call-loop**: requirements 4.6, 4.7, the "ask day and time" step of the booking flow and the speech port's end of Turn are amended (requirements.md, "Amendments"). Its properties P1–P9 and S1–S8 stay as they are; P1–P9's shop generator gains Combo_Ids, and S2's generator gains brain facts. Neither change touches an assertion.
- **natural-voice**: the Cache_Plan gets tiers 6 (pinned Fillers) and 7 (profile answers) appended after tier 5 (Requirement 14). Tiers 1–5 stay byte-identical for the same profile, which Property B14 checks. The live audio path moves into `/api/turn` (Requirement 20); `/api/speech` stays for retries and keeps its tests. The start buffer becomes adaptive (Requirement 21); N12 keeps holding.
- **owner-machine**: the spec files are never edited. Two owner-side helpers learn to name a Combo_Id (`serviceName` in `lib/owner/machineShop.ts`, the label in `lib/owner/agenda.ts`), through the same catalog helper the Receptionist uses. One Urgency_Rule change, asked for by the reviewer: urgent terms inside the pack's Not_Urgent_Phrases do not count (Requirement 16.5); M1–M3's oracle learns the same rule. The `fallback` outcome stays reachable through the per-visitor rate limit, so owner-machine's end-of-Call urgency tests keep a real fallback path to run on.
- **jury-polish**: its tasks 4.3 (N15 tolerance) and 6.7 (the suggested-reply language defect) are not duplicated here. Its task 8 also edits `cachePlan.ts`, its task 4 tests `neuralVoice.ts` (the Safari shared element, which the Filler also plays through), and its Call_Page tasks edit `components/call/`; whichever lands second re-reads the file first.

## Where current documentation changed my first choice

The design session could not run a shell, so task 1 filled in this table on 2026-11-16, before any app code. The web tool and Context7 both failed at their permission step that day, so every page below was fetched with Node into `.measurements/` and read there.

| Area | What to check | Source | Finding | What it changed |
|---|---|---|---|---|
| Gemini models (1.1) | `gemini-3.5-flash`: exact id, GA or preview, free-tier RPM and RPD, `thinking_level: "low"`, sampling parameters; the same for the two current defaults | Gemini API docs as Markdown, fetched with Node into `.measurements/fdb-*.txt` on 2026-11-16 (`web_fetch` and Context7 both failed at the permission step): models, models/gemini-3.5-flash, models/gemini-3.5-flash-lite, whats-new-gemini-3.6, thinking, rate-limits, pricing. Plus the `model` field of the three spike answers (1.2) | **`gemini-3.5-flash` is deprecated**: it can no longer be picked in AI Studio, and API requests to it are routed to `gemini-3.6-flash` (stable). The spike's request to `gemini-3.5-flash` came back with `model: "gemini-3.6-flash"`. `gemini-3.5-flash-lite` is stable (last update July 2026). `gemini-flash-lite-latest` is an alias that is hot-swapped with each release, and the spike's request to it came back as `gemini-3.5-flash-lite`: **today the two current defaults are the same model**. `thinking_level`: 3.6 Flash accepts minimal, low, medium, high (default medium); 3.5 Flash-Lite the same (default minimal); so `"low"` is accepted by all three. From 3.6 Flash and 3.5 Flash-Lite on, `temperature`, `top_p` and `top_k` are deprecated and ignored, and "returns an error in future model generations". Both models are "Free of charge" on the Free tier. **Free-tier RPM and RPD are not in the docs**: the rate-limits page sends readers to AI Studio's per-project page, which needs the owner's login, so they are not guessed here | (a) Task 7.2 should add `gemini-3.6-flash`, not the deprecated `gemini-3.5-flash`: the same backend today, but a deprecated id can be shut down. Requirement 12 and task 7 are not changed here; open question 14. (b) The hedge between entries 1 and 2 goes to the same model, so a model-wide 503 hits both; open question 14. (c) The request shape stays: `thinking_level: "low"`, no sampling parameters. (d) Task 7.1's 45 requests must be checked against the owner's AI Studio limits page before they run, since the docs give no numbers |
| SDK abort (1.2) | The top-level `signal` still aborts at the shorter Model_Wait (measured 2026-11-11: 52 ms for a 50 ms abort) | `.measurements/fdb-abort-spike.mts`: **3 requests**, stated before running, one per model (`gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-3.5-flash`), 2026-11-16 13:14 UTC, top-level `signal` aborted at 1600 ms, `retries: { strategy: "none" }`, the request shape of `geminiClient.ts`. Output in `.measurements/fdb-abort-spike.json`. The SDK's Node build (`@google/genai` 2.32.0) for how the signal is passed | **The abort did not hold on 1 of 3.** `gemini-3.5-flash-lite` answered at 2355 ms, 755 ms after the abort fired, with a valid answer. The other two answered before 1600 ms: `gemini-flash-lite-latest` 1010 ms, `gemini-3.5-flash` 1222 ms. The SDK passes the caller's signal into `new Request(…)` and only adds its own timeout signal when `timeout_ms` is set. Three requests cannot say why the abort was missed; the missed one was the first, cold request of the process. No more requests were sent to find out | The timing design does not change: `callModel` resolves on its own timer (`setTimeout` and `Promise.race`, `callModel.ts` lines 194–200) and never waits for the SDK to reject, so an ignored abort costs one request of quota, not caller time. Task 9.5 (B8, "a late model changes nothing") is the guard: its fake model must be able to answer after the abort, as the real one did. Task 7.1's measurement (45 requests) will show how often a late answer happens |
| Chrome speech (1.3) | How Chrome's `es-ES` recognition writes times, numbers and phones | The owner's two real calls (Real_Call_Cases, 2026-11-13; Real_Call_2026_11_16); the Web Speech API spec | See "Transcript forms seen in real calls (task 1.3)" under "Name and phone". Seen: "a las 4:00 de la tarde", "a las 17", "a las cinco" (in the same call as "4:00"), "mañana sábado". No phone was ever kept, since no log holds a transcript. The spec says the transcript "represents the raw words that the user spoke" and nothing about how numbers are written | No reader is added or dropped. The forms of Requirements 5.2 and 6.4 that were not seen stay in the tests. One line for the manual checklist (task 14): dictate a phone and a half-past time in a real Chrome call and note the forms, with no real number |
| fast-check (1.4) | `fc.mixedCase`, `fc.shuffledSubarray`, `fc.uniqueArray`, `fc.stringMatching` in the installed version | `node_modules/fast-check` 4.10.2, `lib/fast-check.d.ts` | All four exist in 4.10.2: `mixedCase(stringArb, { toggleCase?, untoggleAll? })`, `shuffledSubarray(array, { minLength?, maxLength? })`, `uniqueArray(arb, { minLength?, maxLength?, size?, selector?, comparator? })` with `comparator` either `"SameValue"`, `"SameValueZero"`, `"IsStrictlyEqual"` or a function, and `stringMatching(regex, { size? })`. `mixedCase` toggles each character with `toUpperCase` by default, so a character whose upper case is longer ("ß" → "SS") changes the length | Nothing. A generator that draws an alias through `mixedCase` must not compare its length with the alias; none in this design does, and no Rich_Profile alias has a "ß" |
| Demo facts (1.5) | Nearest metro stations to Calle Mayor 12 and the public car park at Plaza Mayor | Madrid city council open data, "Aparcamientos públicos" (datos.madrid.es, dataset 202625, JSON, fetched 2026-11-16); Metro de Madrid station pages; the transport consortium's station pages | **Car park confirmed**: "Aparcamiento mixto. Plaza Mayor", Plaza Mayor 1, owned by the Ayuntamiento de Madrid, 415 public places (plus 279 for residents), open 24 hours. The walking time from Calle Mayor 12 is not in the data. **Metro not checked**: metromadrid.es blocked the automated request ("La solicitud ha sido bloqueada por los sistemas de seguridad"), and the consortium's station URLs answered 404 | `parking` (task 5.1): "No tenemos aparcamiento propio, pero hay un parking público en la plaza Mayor, muy cerca." / "We have no parking of our own, but there is a public car park in Plaza Mayor, very close." ("muy cerca" replaces the unchecked "a dos minutos andando".) `como-llegar` gets the neutral wording, no station names: "Estamos en la calle Mayor, en pleno centro, y se llega bien en metro y en autobús." / "We are on Calle Mayor, right in the centre, easy to reach by metro or bus." The FAQ table below is updated to match. The owner may put Sol and Ópera back after checking them |
| Next.js (1.6) | `after()` and the route's default runtime in the installed version | `node_modules/next/dist/docs/` (Next 16.4.5): `04-functions/after.md`, `02-route-segment-config/index.md`, `02-guides/streaming.md` | No change. `after()` is stable (since 15.1), works in Route Handlers, runs "after a response … is finished", even when it did not complete successfully, and on Vercel through `waitUntil`. The `runtime` segment option defaults to `'nodejs'`; `'edge'` is marked deprecated. The app's routes export no `runtime` | One consequence for task 19: with the Inline_Audio stream the response finishes when the audio ends, so anything the turn route schedules with `after()` (the log lines) runs after the audio, not after the first JSON line. Nothing in the design needs it sooner; task 19.4's handler tests must not assume an order between `after()` work and the stream |
| Web Speech (1.7) | `stop()` vs `abort()` for a pending final result and for `onend`; interim results with `continuous = false` | Web Speech API spec (W3C CG draft, webaudio.github.io/web-speech-api, fetched 2026-11-16); MDN source pages for `stop()`, `abort()` and `continuous` | `stop()`: the service stops collecting audio and "must attempt to return a recognition result (or a nomatch) based on the audio that it has already collected"; MDN: as a `result` event, or a `nomatch` event if nothing was recognized. `abort()`: stop at once and "do not return any information"; `end` fires once the service is disconnected. A second `stop()` or `abort()` on a stopping object is ignored. With `continuous = false` at most one final result comes; `continuous` "doesn't affect interim results" (MDN), so interim results keep coming in one-shot mode. Final results are never overwritten; interim ones may be | `stop()` does give a final, so the Silence_Cut design stands: `stop()` at the cut, never `abort()` (task 16.3 tests it). One addition for task 16.1: after `stop()` the outcome may be `nomatch` instead of a final, and the reducer treats it as "no late final" (the sent text stays the Transcript line). No question for the owner |
| Streaming route (1.8) | Whether a Node route handler's `ReadableStream` body is flushed per chunk on Vercel, and whether `Server-Timing` is readable by same-origin `fetch` | Bundled Next.js docs (`route.md` "Streaming", `guides/streaming.md`); Vercel "Streaming" functions doc (last updated 2026-09-01); MDN `Server-Timing` and "Forbidden response header name" | Route Handlers can return a `ReadableStream`; "Vercel supports streaming natively", and streaming is on by default for Node.js functions. Status and headers go out with the first chunk and cannot change afterwards. Neither doc promises a flush per chunk, and the Next.js guide names two buffering layers: compression ("Gzip and Brotli compression can buffer chunks internally before flushing") and Safari, which "buffers streaming responses until 1024 bytes have been received" (WebKit bug 252413; the guide says it about pages, and does not say whether a `fetch` body reader waits too). `Server-Timing` is an ordinary response header (the only forbidden response header name is `Set-Cookie`), so same-origin `fetch` reads it with `response.headers.get`. Sent as a trailer it reaches DevTools only: "The Fetch API cannot access HTTP trailers" | (a) Confirms task 17.2: the header is set before the body, so it times the work before the first JSON line (brain, db, model, total), never the TTS; the TTS time stays a browser-side measure. (b) The first-line flush is not proven by the docs. The Latency_Script (task 15) already records time to the reply and time to the audio's first byte separately; on the deployed demo that shows whether the first line arrives early. (c) The Safari 1024-byte question is open question 15, with a checklist line |
| Filler playback (1.9) | Whether a `blob:` URL on the shared, unlocked `<audio>` element plays without a new gesture on Safari iOS, and whether a fetched cached line can be reused without a blob | MDN autoplay guide and `URL.createObjectURL()`; WebKit "New `<video>` Policies for iOS" (2016); the app's `lib/voice/neuralVoice.ts` | No doc says whether a new `src`, `blob:` or not, on an element already played inside a gesture plays later without one. MDN: media with sound may autoplay once "the user has interacted with the site"; WebKit: `play()` must come "directly" from a `touchend`, `click`, `doubleclick` or `keydown` handler. The one fact on record is the owner's iPhone call of 2026-11-16, already built into `neuralVoice.ts`: the element unlocked by the call button plays every later cached line (a plain URL), and a new element per line was refused with `NotAllowedError`. MDN accepts a `blob:` URL wherever a URL is used, but nothing covers it on Safari iOS. Priming with `fetch(…, { cache: "force-cache" })` fills the HTTP cache, yet the media element makes its own request (often a Range request), and no doc promises that cache will serve it | The design's blob preload stays: it removes the network wait at 700 ms, and the plain cache URL is the path the real iPhone showed working. Open question 16 proposes that task 20 falls back to the plain cache URL when `play()` on a blob URL rejects. Checklist line for task 14: on a real iPhone, a Turn that waits more than 700 ms plays a Filler with no tap after the call button |

## Architecture

```mermaid
sequenceDiagram
    participant B as Browser (voice adapter)
    participant H as handleTurn (say)
    participant R as Code_Brain (pure)
    participant M as callReceptionist (model)
    participant D as decideTurn + Booking_Rules
    participant DB as Repository

    B->>H: say(utterance, audio: "inline")
    H->>DB: rate limits, load Call
    H->>R: readUtterance(utterance, state, shop, pack, now)
    R-->>H: Reading (sync, < 20 ms), sure or not
    alt Sure_Reading
        H->>H: factsFromReading(reading); no model call, no log line
    else not sure
        par
            H->>M: model call, Model_Wait 1.6 s
        and
            H->>DB: bookings read (when the times are already known)
        end
        alt valid model answer in time
            M-->>H: ModelTurn
            H->>H: factsFromModel(turn, reading)
        else failure, late, or global limit
            H->>H: factsFromReading(reading); log turn_fallback path "brain"
        end
    end
    H->>D: decideTurn(facts, reading, existing bookings)
    D-->>H: Decision (reply template or model line, effects)
    H->>DB: commit (as today, with the 23P01 retry loop)
    H-->>B: line 1: reply text and speech hint
    H-->>B: line 2: audio header; then PCM (live TTS) or a cache URL
```

While the request is in flight, the browser runs its own clock from End_Of_Speech: the Silence_Cut sends the Turn at 600 ms, and at 700 ms a preloaded Filler plays if the reply is not audible yet.

### Modules

| Module | Kind | What it holds |
|---|---|---|
| `lib/conversation/brain/normalize.ts` | pure | tokens, plural folding, Damerau–Levenshtein with the length rule of 4.2 |
| `lib/conversation/brain/lexicon.ts` | data | sector-neutral words per language: yes, no, goodbye, thanks, greeting, booking words, change and cancel words, negation, addition, name cues, owner-request cues, language-switch cues, question cues, part-of-day words |
| `lib/conversation/brain/services.ts` | pure | `matchServices(text, shop, opts)`: spans, longest match, ties, Goes_With, negation, add mode, Category hits |
| `lib/conversation/brain/when.ts` | pure | `readWhen(text, today, lang, sessionsOf)`: day and time, corrections, part of day, the non-cue filter |
| `lib/conversation/brain/person.ts` | pure | `readName`, `readPhone` |
| `lib/conversation/brain/topics.ts` | pure | `matchTopic(text, shop, lang)`: built-in Profile_Topics and FAQ_Entries, with the urgent-term carve-out of 9.7 |
| `lib/conversation/brain/read.ts` | pure | `readUtterance(...) → Reading`, the Intent order of 3.3 |
| `lib/conversation/facts.ts` | pure | `TurnFacts`, `factsFromModel(turn, reading, shop)`, `factsFromReading(reading)` |
| `lib/booking/services.ts` | pure rule | `resolveService(id, services)`, `comboId(ids, services)`, the Combo_Id limits |
| `lib/booking/slots.ts` | pure rule | new `firstSlotsFrom(req, ctx, opts)` |
| `lib/conversation/catalog.ts` | pure | `serviceView(id, shop)`: parts, total duration and price, `priceFrom`, names and spoken names for one service or a Service_Combo, the catalog line by Category |
| `lib/receptionist/phrases.ts` | pure | new templates (below) |
| `lib/conversation/decide.ts` | pure | takes `TurnFacts`; topic answers, Owner_Notes, First_Offer, offer acceptance, the brain's templated lines where the model's line was used |
| `lib/conversation/handleTurn.ts` | I/O through ports | the flow of the diagram; no `endWithFallback` on model failure |
| `lib/receptionist/callModel.ts`, `geminiClient.ts` | | the new constants and default list |
| `lib/conversation/shopProfile.ts` | zod | `faq`, `categories`, `category`, `goesWith`, `priceFrom`, the id pattern |
| `lib/db/seed.ts` | data | the Rich_Profile |
| `lib/receptionist/cachePlan.ts` | pure | tiers 6 (Fillers, pinned) and 7 (profile answers) |
| `lib/messages/terms.ts`, `urgency.ts` | pure | Not_Urgent_Phrases masked before the urgent-term search (16.5) |
| `lib/sectors/types.ts`, `hairSalon.ts` | data, zod | `vocabulary[lang].notUrgent` |
| `lib/voice/endOfSpeech.ts` | pure | the Silence_Cut reducer (L1) |
| `lib/voice/filler.ts` | pure | `fillerKind(utterance, lang)`, `pickFiller(kind, lang, last)`, the `fillerDecision` reducer (L2) |
| `lib/voice/turnStream.ts` | pure | encoder and decoder of the Inline_Audio stream (L4) |
| `lib/voice/voiceDecision.ts` | pure | the adaptive Start_Buffer and the underrun count (L5) |
| `lib/voice/timing.ts` | pure | Timing_Panel marks, p50 and p90 (L6) |
| `app/api/speech/stream.ts` | I/O through deps | the TTS stream of `/api/speech`, shared with `/api/turn` (L4) |
| `scripts/measure-latency.ts` | script | the Latency_Script (L6) |

`lib/conversation/brain/` has no import from `lib/receptionist/callModel.ts` or `lib/db`, which a lint rule (`no-restricted-imports`) enforces, so the brain can never call the model or the database by accident.

## The Reading and the TurnFacts

```ts
/** What the Code_Brain understood in one utterance. Pure data. */
interface Reading {
  intents: Intent[];                       // all found, in the order of Requirement 3.3
  services: ServiceRequest;
  day: Temporal.PlainDate | null;
  time: Temporal.PlainTime | null;
  partOfDay: "morning" | "afternoon" | null;
  name: string | null;
  phone: string | null;                    // E.164, already through normalizePhone
  phoneRejected: boolean;                  // digits were heard but normalizePhone refused them
  yes: boolean;
  no: boolean;
  topic: TopicHit | null;
  ownerRequest: boolean;
  sensitive: { term: string; lang: Lang } | null;
  wantsLanguage: Lang | null;
  question: boolean;                       // a question cue ("¿", "qué", "cuánto", "do you", "how")
  leftover: string;                        // normalized words no rule placed, for the not-understood rule only
  sure: boolean;                           // a Sure_Reading (19.2): the model is not called
}

type ServiceRequest =
  | { kind: "none" }
  | { kind: "set"; ids: string[]; mode: "replace" | "add" }      // 1–3 catalog ids, said order
  | { kind: "choice"; candidates: string[]; with: string[] }     // ask which; `with` = the other ids said
  | { kind: "category"; categoryId: string; with: string[] }     // "quiero color": a choice among the Category
  | { kind: "unknown"; said: string };                           // a service word not in the catalog

type TopicHit =
  | { kind: "hours"; day: Temporal.PlainDate | null; now: boolean }
  | { kind: "address" }
  | { kind: "services" }
  | { kind: "price" | "duration"; target: ServiceTarget }
  | { kind: "faq"; id: string };
type ServiceTarget =
  | { kind: "service"; id: string }          // a Combo_Id when two or three were named
  | { kind: "choice"; candidates: string[] }
  | { kind: "category"; categoryId: string };
```

`decideTurn` stops reading `ModelTurn` directly. It reads `TurnFacts`, which both paths build:

```ts
interface TurnFacts {
  source: "model" | "brain";
  /** The model's own line; null on the brain path, so decideTurn can never speak model text it does not have. */
  modelReply: string | null;
  intent: Intent;                 // the core-call-loop Intent ("booking" | "reschedule" | "cancel" | "question" | "order" | "other")
  wantsLanguage: Lang | null;
  services: ServiceRequest;
  date: string | null;            // YYYY-MM-DD
  time: string | null;            // HH:MM
  partOfDay: "morning" | "afternoon" | null;
  name: string | null;
  phone: string | null;           // raw on the model path (mergeFields normalizes), E.164 on the brain path
  yes: boolean;
  no: boolean;
  wantsToEnd: boolean;
  outOfProfile: boolean;
  topic: TopicHit | null;
  ownerRequest: boolean;
  sensitive: Reading["sensitive"];
  notUnderstood: boolean;
  unansweredQuestion: string | null;   // the Caller's words, truncated to 160, only for the Owner_Note
  reason: string | null;               // the model's reason; null on the brain path
  urgency: Urgency | null;             // the model's suggestion; null on the brain path
}
```

### Who decides what (Requirement 13)

| Fact | `source: "model"` | `source: "brain"` |
|---|---|---|
| reply for free conversation | the model's line | a template |
| intent, day, time, name, phone, yes, goodbye, language switch | the model | the Reading |
| services | the Reading when it found any; otherwise `matchServices(turn.service)` | the Reading |
| Profile_Topic answer | the Reading (the template replaces the model's line) | the Reading |
| Owner_Request, Sensitive_Hit | the Reading, or the model's `outOfProfile` when the Reading has no topic | the Reading |
| First_Offer, slots, read-back, confirmation, every booking fact | code, as today | code, as today |
| Owner reason | the model's, plus Owner_Notes | code-built (10.7) |
| suggested urgency | the model's | none (owner-machine treats it as `null`) |

The model's `service` field description changes to "every service the caller asked for, in the caller's own words, joined with ' y ' / ' and '", so the model path can carry a Service_Combo too, through the same matcher.

## Service matching

`matchServices` works on tokens of `normalizeText` (the existing helper: lower case, no accents, letters and digits).

1. **Alias index.** For each service: its id with hyphens as spaces, both names, every alias. For each Category: its names and aliases. Each entry is a token list; plurals are folded on both sides (a final `es` after a consonant, else a final `s`, on words of 4 letters or more).
2. **Spans.** Every place where an entry's tokens match consecutive said tokens, exactly or within the typo rule of 4.2 per token. A fuzzy token is refused when the said token is itself an exact token of another entry or a lexicon word, so "corto" never becomes "corte" if "corto" is listed anywhere, and "tiene" never becomes "tinte" (distance 2 on a 5-letter word is over the limit anyway).
3. **Overlaps.** Longest span first (in tokens, then in letters); a shorter span inside a longer one is dropped. "Tinte de raíz" beats "tinte".
4. **Negation.** A span right after a negation word, or after "no" plus at most one filler word ("no quiero barba"), is dropped.
5. **Candidates.** A span whose entry belongs to several services (the shared generic "corte", "cortarme el pelo", "haircut") is a tie. A tie is broken, in order: (a) a candidate that is itself matched by another span of the same utterance wins and absorbs the tie ("un corte para mi hijo" is Corte infantil once, not a choice plus Corte infantil); (b) exactly one candidate lists, or is listed by, the Goes_With of another service matched in the same utterance; (c) exactly one candidate is, or Goes_With, a service already in `CallState.fields.serviceId` from an earlier Turn. Otherwise the request is a Service_Choice. A span on a Category is a Category request.
6. **Mode.** An addition word before the first span ("y también", "además", "also", "plus", "and a") makes the mode `add`; otherwise `replace`.
7. **Add_Ons.** After the mode is applied, each Add_On in the set whose `addOnTo` services are all missing (from the set and, in `add` mode, from the Call's services) gets the first of them added: "un degradado" and "corte degradado" become `corte-hombre` + `degradado`. Removing a base ("sin el corte") removes its Add_Ons, and the reply names both.
8. **Result.** Unique ids in said order, at most 3 (a fourth is dropped and the reply says the most is three). The Combo_Id puts them in catalog order.

While a Service_Choice waits (`CallState.fields.serviceChoice`), the next utterance is matched against the candidates' own distinguishing aliases first ("de hombre", "para mi hija", "men's"); if none match it is read normally and the choice stays open.

## Day and time

`readWhen` scans the normalized utterance for cue windows and tries, for each window, these readers in order, keeping the last success of each kind (corrections win, 5.5):

- **Day words**: `parseSpokenDay` on windows that start with "hoy", "mañana", "pasado", "el", "este", "next", "this", "on", "tomorrow", "today", plus a digit form `el 20`, `el 20 de noviembre`, `20/11`, "the 20th", "November 20". A bare "el 20" is the next date with day 20 from today (this month if not passed, else next month).
- **Time words**: `parseSpokenTime` on windows that start with "a la", "a las", "at", "sobre las", "hacia las", "around", with the day's `TimeContext`.
- **Digit times**: `(a las|sobre las|at|@)? H([:.h]MM)? (de la mañana|de la tarde|de la noche|am|pm)?`, with H in 0–23 and MM in 00–59. "a las 17" is 17:00; "a las 5" is resolved by 5.3.
- **Noon and midnight**: "a mediodía", "a las doce del mediodía", "noon", "midnight".

The non-cue filter (5.7): a number is a time only inside a time window or with a `:`/`.`/`h` minute part, never inside a run of 6 or more digits (a phone), never before "euros", "minutos", "horas", "servicios", "personas", and never as "una"/"un"/"dos" before a noun that is not "las"/"la". Property B9(b) checks it over a pool of non-time sentences.

The date always comes from `todayIn(now, shop.timeZone)`; the result is a `PlainDate` and a `PlainTime`, and `toInstant` turns them into an instant in the shop's zone, never the server's.

## Name and phone

`readName` takes the words after a name cue up to the first stop (punctuation, a digit, a cue word, "y" followed by a cue), at most 5 words, and passes them through `looksLikeName`. Without a cue it applies only while the next missing field is `name` (Requirement 6.2). The shop's `ownerName` and `name` in an address position ("Hola Lola", "¿es Peluquería Lola?") are never read as a name.

`readPhone` turns the utterance into a digit stream: digit runs as they are (separators ` -.()/` removed), and number words through `parseNumber` in the longest windows that parse to 0–999 ("treinta y cuatro" → `34`, "seiscientos doce" → `612`, "cero" → `0`). A "+" or "más"/"plus" before a country code is kept. The stream goes through `normalizePhone`; a rejected stream sets `phoneRejected`, and the reply re-asks for the phone with a template (6.5).

### Transcript forms seen in real calls (task 1.3)

No production log holds a transcript (by design), so these come from the owner's two real Chrome `es-ES` calls (2026-11-13, the Real_Call_Cases in `tests/api/turn.realCall.test.ts`; 2026-11-16, Real_Call_2026_11_16). `readWhen` and `readPhone` must accept each form in the "seen" rows; the "not seen" rows stay in the tests because Requirements 5.2 and 6.4 list them, not because Chrome was seen writing them.

| Form | Example as Chrome wrote it | Seen | Reader |
|---|---|---|---|
| Hour with `:00` and a period of the day | "a las 4:00 de la tarde" | yes, 2026-11-13 | `readWhen`, digit times |
| Bare 24-hour number after "a las" | "a las 17" | yes, 2026-11-13 | `readWhen`, digit times |
| Hour as a word, in the same call | "a las cinco" | yes, 2026-11-13 | `readWhen`, time words |
| Day word plus weekday | "mañana sábado" | yes, 2026-11-13 | `readWhen`, day words |
| Service in the caller's words, no time | "cortarme el pelo y hacerme un degradado" | yes, 2026-11-16 | `matchServices` |
| A phone number | not available: neither call's Transcript was kept, and the tests' "612 34 56 78" is scripted | no | `readPhone`, every grouping of 6.4 |
| "17:30", "17.30", "5pm", "17h" | not seen | no | `readWhen` (Requirement 5.2) |

Chrome wrote the same caller's hours both ways inside one call ("4:00" and "cinco"), so neither form can be assumed. The Web Speech API spec (W3C CG draft, read 2026-11-16) says nothing about how numbers, times or phones are written: the `transcript` attribute of `SpeechRecognitionAlternative` "represents the raw words that the user spoke", and its formatting is the recognizer's. The manual checklist (task 14) gets a line: dictate a phone and a half-past time in a real Chrome call and note the forms in the Transcript, counts and forms only, no real number.

### As built in task 6 (the Code_Brain's readers)

- **Modules** (`lib/conversation/brain/`): `normalize.ts`, `lexicon.ts`, `services.ts`, `when.ts`, `person.ts`, `topics.ts`, `read.ts`, plus one module the table above did not list, `numbers.ts`: number words as tokens, built from the Receptionist's own `speakNumber` (0–999, with and without apocope) and `speakOrdinal`, so the brain reads every number the Receptionist can say. The purity rule is a `no-restricted-imports` block for `lib/conversation/brain/**/*.ts` in `eslint.config.mjs` (`@/lib/db…` and `…/callModel`). Two tests pin it in `tests/conversation/brain/lexicon.test.ts`: a scan of every import in the folder, and an in-process ESLint run (`ESLint.lintText` from the installed `eslint`) showing 2 `no-restricted-imports` errors for a probe file in the folder and none for the same probe one folder up.
- **Tokens.** `tokenize` writes words exactly as `normalizeText` does (a test pins it), with two additions. A clock time with a separator stays one token (`"17:30"` → `17h30`, `"4:00"` → `4h00`), and so does a D/M date (`"20/11"` → `20d11`). A digit run like `612.345.678` is never glued. Each token also keeps whether punctuation came before it, so a negation never crosses a comma ("No, quiero un corte de hombre" requests the cut), and its surface form, so a name keeps its capitals and accents.
- **Plural folding** compares the sets of forms of both words (the word, without a final `s`, and without a final `es` after a consonant) instead of one folded key. A single key cannot make both "fades" = "fade" and "colores" = "color" true.
- **Longest match, then as written.** After span length, a span matched as written beats one matched through a plural or a typo. Without this rule, "un corte" was read as the Category "cortes" (plural-folded, one letter longer) and never became a Service_Choice. The first run of `services.test.ts` caught it in 7 tests.
- **Readers do not call `parseSpokenDay` / `parseSpokenTime`.** Those parsers take accented, lower-case phrases and return null for anything around them. The brain scans normalized tokens for cue windows. It reuses `WEEKDAY_WORDS`, `MONTH_WORDS`, the Receptionist's period ranges and `speakNumber`, and B9 proves the round trip against `speakDay` and `speakTime` themselves. A period after a time is read first with the Receptionist's strict range, then with an everyday range, so "la una de la tarde" is 13:00 although the Receptionist says "del mediodía". A time with no day is resolved against the Call's day (`requested.date` or `day`), and otherwise against the shop's next 7 days.
- **Phones** go through a small search over segmentations: digit runs as written, number words in groups of 0–999 via `numbers.ts`, and the first digit string that `normalizePhone` accepts wins. Number words are never merged across a pause, so "seis uno dos, treinta y cuatro" is 612 34. Without a pause, "doscientos cinco" is the single number 205 in the language itself. B10 therefore puts a comma between two number-word groups, and says why in the test.
- **Names.** After a cue, up to 5 words are taken, and trailing lexicon words are dropped ("José Antonio Ruiz de la Fuente" stops at 5 words and becomes "José Antonio Ruiz"). Without a cue, 6.2 also refuses number words: "cinco" was read as a name until a unit test caught it.
- **FAQ_Entries** are matched only in the Call's language, because "red" is the Spanish wifi alias and an English colour word. An FAQ alias inside a longer service alias belongs to the service. **B3 found this case**: "how long does Kids' cut take?" was read as the FAQ "kids" (`ninos`). Each alias passed the schema's whole-phrase check, but "kids" is also a word inside "kids' cut". A regression unit test pins it.
- **"for" is not an English time cue.** **B9(b) found this case**: "a haircut for one" was read as 13:00.
- **Sensitive_Hit** reads the pack's urgent terms in both languages, outside every matched FAQ alias and every Not_Urgent_Phrase. The pack's `sensitiveTopics` are whole sentences written for the prompt, so they are not matched word by word.
- **B13 and Requirement 7.8.** B13 says "sin {b}" leaves `A` unchanged. Task 6.2 and 7.8 say "sin el corte" removes the cut and its fade. Both hold in the test: when `b` is not in the Call, the Call's services do not change; when it is, `b` and any Add_On left without a base are removed. In both cases `b` is never requested.
- **A service word not in the catalog** (4.8) is read only right after a wanting word plus an optional article, 1–2 words that no reader placed: "quería una manicura" → `{ kind: "unknown", said: "manicura" }`. "quiero que me digas…" is not.
- **Reading** keeps the design's fields and adds three: `serviceChange` (the Call's services after this utterance, the removed services, the removed Add_Ons, the cap, and whether a Service_Choice was answered), `unplaced`, and `sureBasis` (which Sure-table row applied, for tests only). `readUtterance` also exports `nextField` and `sessionsOfShop`.
- **CallFields** gains the optional `serviceChoice`, `day` and `partOfDay` of "New CallState fields" now, because `readUtterance` reads them. Nothing writes them yet (task 8). Every existing test passed unchanged.
- **Properties.** B3: `numRuns` 200. Every frame kind, typo variants, shared aliases, Add_Ons, price and duration frames, and both languages are asserted reached; price and duration frames also check `matchTopic`'s target. B13: 200 random runs plus 3 fixed examples, so `numRuns` is 203. Two branches are too rare at random: removing a base whose Add_On is in the Call (about 1 draw in 300) and adding the fade to a Call without a men's cut (about 1 in 70). One full-suite run failed on the second branch before its example was added. B9: two properties of 200 runs each. Every form, corrections, both languages and distances 0, 1 and 7 or more days are asserted reached; the non-time pool covers prices, durations, 4 phone shapes, counts, nouns and names. B10: two properties of 200 runs each, with words, digits, leading zeros, prefixes and few or many groups asserted reached.
- **Speed (2.6)** (`.measurements/brain-speed.json`, idle machine): the first call takes 44 ms because it builds the profile's indexes. After that, over the 50 longest pool utterances, p50 is 0.7 ms, p90 2.0 ms and the maximum 6.5 ms. Under a full 3-worker suite, one single timing reached 20.7 ms; five suites run at the same time reached 148 ms. The test therefore times each utterance 5 times and requires its median to be under 20 ms. The limit is unchanged. The work per read was also cut: spans are computed once per utterance and entry list, and the lexicon phrase lists are cached.
- **Quick bite checks** (the full mutation proofs are task 13). Ignoring negation failed B13 on its first, fixed example ("sin Corte de hombre" requested the cut). Keeping the shortest span first failed B3 at once ("¿Corte de mujer?" became a Service_Choice). Ordering spans by start position only passed B3: in the Rich_Profile, the longer of two overlapping aliases never starts after the shorter one, and spans with the same start still fall back to length. Task 13's mutation "keeps the first span instead of the longest" must therefore take the first span in *index* order to fail B3 as the table expects. Code restored after each check.

## Service_Combos in the Booking_Rules

```ts
// lib/booking/services.ts
export const COMBO_SEPARATOR = "+";
export const MAX_COMBO_PARTS = 3;
export const MAX_COMBO_MIN = 480;

/** A service id or a Combo_Id as one Service: summed duration. Null if it is not valid (3.3). */
export function resolveService(id: string, services: readonly Service[]): Service | null;
/** The canonical Combo_Id of 1–3 different ids: catalog order, joined with "+". Null if invalid. */
export function comboId(ids: readonly string[], services: readonly Service[]): string | null;
```

`evaluateWith` step 1 and both functions of `slots.ts` call `resolveService` instead of `services.find`. Nothing else in the rules changes: the summed duration is checked against the session's close (step 5), sector rules see one service (step 6), and the resource search uses the summed range (steps 7–8). A non-canonical Combo_Id (wrong order) is rejected, so there is exactly one id per Service_Combo and the Agenda never shows the same combo two ways.

Sector rules see the Service_Combo as one `Service` with the Combo_Id. A future pack rule that depends on a specific service (for example "colour needs the allergy test 48 h before") would need to look at the parts; it can call `resolveParts(id)`, exported beside `resolveService`. No current rule does (`hairSalon.rules` is empty).

### Names and prices

`serviceView(id, shop)` in `lib/conversation/catalog.ts` resolves the parts against the Shop_Profile:

| Field | One service | Service_Combo |
|---|---|---|
| `durationMin` | the service's | the sum |
| `priceCents` | the service's | the sum |
| `priceFrom` | the service's | true if any part's is |
| `name[lang]` (Owner screens) | "Corte de hombre" | "Corte de hombre + Degradado" |
| `spoken[lang]` (Receptionist) | "un corte de hombre" | "un corte de hombre y un degradado" (joined with `joinAnd`) |

The Receptionist's templates (`kit.service`, `kit.spokenService`, `serviceInfo`, `readBack`, `booked`), `publicStateOf`, the prompt's state line, `serviceName` and the Agenda label all call it, so no screen ever shows a raw Combo_Id.

### As built in task 2

- `lib/booking/services.ts` exports `resolveService`, `resolveParts`, `comboId` and the three limits; `lib/booking/index.ts` re-exports them. A plain catalog id is looked up first, so `resolveService` of a catalog id returns that catalog object itself. An empty part (`"a+"`, `"+a"`, `"a++b"`) is an unknown part. The 480-minute cap applies to Service_Combos only; a single catalog service keeps its own duration whatever it is.
- `evaluateWith` step 1, `daySlots` and `findNearestSlots` call `resolveService`. Every booking test that existed before passed without a change (the 16 existing files in `tests/booking/`, 66 tests, run beside the 21 new unit tests of `services.test.ts`).
- **B5** (`tests/booking/b5-service-combos.property.test.ts`, `numRuns: NUM_RUNS` = 200, as P8 requires for that folder) has two properties and one generator check. (a) The equivalence: `checkBooking` on `comboId(ids)` and on an extra service `x` of the summed duration give the same JSON, with `ids` drawn in any order. The registry's packs have no sector rule (`hairSalon.rules` is empty), so step 6 would never see a combo; the test adds a rule of its own (reject any service longer than 20–300 minutes) on about half the runs, and asserts that `sector:too_long` was reached. It also asserts that 2-part and 3-part combos, acceptances, rejections and rejections with alternatives were all reached. A list whose sum is over 480 checks that `comboId` is null and the catalog-order id is `unknown_service`. (b) Invalid Combo_Ids, one kind per rule of Requirement 7.3: an unknown part, a repeated part (still in catalog order), 4 parts (on a catalog of 1–120-minute services, so 4 parts never pass 480), a sum over 480 (481–531, with exactly 481 asserted as reached), and parts out of catalog order. Each kind is asserted as reached.
- **Task 2.4, the generators.** `arbRequest` and `arbValidRequest` take an optional `{ combos }` (default true). On about 1 draw in 3 they use a Combo_Id when the shop has one; `comboIdsOf(shop)` lists every valid one independently of `lib/booking/services` (2–3 catalog services in catalog order, sum ≤ 480). P9 builds its own requests and draws through the same `drawServiceId`. The oracles in P3, P4 (`gridOracle`) and P6 looked up `shop.services.find(id)!`, which is undefined for a Combo_Id; they now call `serviceOf(shop, id)`, which sums the parts on its own. That is oracle plumbing: no assertion and no `numRuns` changed. The owner-machine generators (`arbAgendaBookings`, `arbMoveSequence`) pass `{ combos: false }`, because naming a Combo_Id on the owner screens is task 4.4, and M7–M11 keep the catalog they were written for.
- **How often a Combo_Id was drawn** (`.measurements/combo-rate.mts`, `fc.sample` with seed 42, 2000 draws each): 26.8 % of `arbCase` requests (28.6 % on Lola, 26.2 % on random shops), 27.2 % of `arbValidRequest`, 26.3 % of `arbRequest`. It is under 1 in 3 because a random shop with one service has no combo. B5 asserts that at least 1 in 10 of a 200-case `arbCase` sample is a Combo_Id.
- **A quick check that the change bites** (the full mutation proofs are task 13): with `resolveService` summing all but the last part, B5 failed (Lola, `colour+haircut` drawn as `[1, 0]`, alternatives of 30 minutes instead of 120), and so did P3, P4 and P6 through the Combo_Ids the generators now draw, plus 9 unit tests. The code was restored and all pass.
- S1 ("any string outside the catalog is `unknown_service`") is unchanged. Its random string could now, in theory, be a valid Combo_Id of a random shop (`"s0+s1"`), which Requirement 7.2 makes bookable; a 5-character `fc.string` hitting it exactly is far too rare to show up, so S1 was left as it is and this is noted here.

## The First_Offer

```ts
// lib/booking/slots.ts
/** Accepted slots at or after `from`, earliest first, inside `within` (local minutes) when given. Pure. */
export function firstSlotsFrom(
  req: { serviceId: string; from: Temporal.Instant; ignoreBookingId?: string },
  ctx: RuleContext,
  opts?: { limit?: number; windowDays?: number; within?: { fromMin: number; toMin: number } },
): Slot[];
```

It walks the slot grid (each session's opening plus multiples of `slotStepMin`, the same grid `findNearestSlots` uses) forward from `from` for up to 14 days and returns the first `limit` (default 3) slots `evaluateWith` accepts. `within` filters by local start minute: morning is `[0, 840)`, afternoon is `[840, 1440)`.

**As built (task 3).** The window is `[from, from + windowDays × 24 real hours]`, inclusive at both ends like `findNearestSlots`. `from` is not clamped to `now`: a start before `now` is refused by the Booking_Rules' own past check, so `firstSlotsFrom` never returns one. Each local day's starts are sorted and de-duplicated before they are evaluated, as `daySlots` does, because on a spring-forward day the "compatible" disambiguation can map two sessions onto overlapping instants. The walk stops at the `limit`-th accepted slot. `within` reads the start's local minute in the shop's zone. Tests: `tests/booking/firstSlotsFrom.test.ts` (20 unit tests) and B7 in `tests/booking/b7-first-slots.property.test.ts` (`numRuns: NUM_RUNS` = 200), whose oracle walks the grid minute by minute from `oracleSessions` and reads local minutes through `Intl`, not Temporal. B7 asserts that it reached empty and non-empty results, a full `limit`, an accepted slot skipped by `within`, `from` before and after `now`, and a Combo_Id. Quick bite check (the full mutation proofs are task 13): starting the walk at `now` instead of `from` failed B7 on its first run and 15 unit tests; reading `within` in UTC instead of the shop's zone passed every unit test and failed only B7, which shrank to a shop open on Thursday 00:00–00:35 Madrid time where a "morning" 00:00 slot is 23:00 UTC and was offered as afternoon. Code restored.

In `decideTurn`'s booking flow, the old "safety net" branch (`if (!start) return say(P.askDayAndTime(heardDate()))`) becomes:

```
from = max(roundUp(now + OFFER_LEAD_MIN, step), startOfDay(fields.day) if any)
slots = firstSlotsFrom({ serviceId, from }, ctx, { limit: 1 + declined, within: partOfDay })
slot  = slots[declined]                // the next one after each "no" (8.5)
none  → P.noSlotNearby()               // 8.3, the Call goes on
some  → s.lastOffer = [slot]; s.offerKind = "first"; say(P.firstOffer(serviceId, slot))
after 2 declines → P.askDayAndTime(day)
```

`OFFER_LEAD_MIN = 30`, a constant in `decide.ts`. It is an offer preference, not a Booking_Rule: a caller who asks for a slot 10 minutes from now still gets it if the rules accept it.

Accepting an offer happens in `mergeFields`: when `facts.yes`, no new day or time, the stage is `collecting` and `state.lastOffer` is set, `requested` becomes the local date and time of `lastOffer[0]`. The flow then runs as if the caller had said that time, so the Booking_Rules check it again against the bookings read in this request, and the read-back still needs its own yes (S2, B12).

## decideTurn, step by step

The order of `decideTurn` after this spec. Steps marked *new* are added; the rest are today's steps reading `TurnFacts`.

1. Call done → goodbye (as today).
2. A pending read-back: a yes with no change confirms; anything else returns to `collecting` (as today, reading `facts.yes`).
3. Goodbye or the Turn limit → end (as today). The outcome is `message` when the Call has Owner_Notes or an unanswered model `outOfProfile`, `answered` when it only asked questions that were answered.
4. *new* Owner_Request → record the note, say `P.ownerNoted()` plus the flow's next question when a flow is open; the Call goes on.
5. *new* Sensitive_Hit → record an urgent note, say `P.sensitiveNoted()`; the Call goes on.
6. Language switch → the model's line (model path) or `P.languageSwitched()` (brain path).
7. *new* Profile_Topic → `P.topicAnswer(topic)`; when a flow is open, the flow's next line is appended (9.6) and the flow state is not changed.
8. Question with no topic: the model's line (model path). On the brain path, *new*: record an `unanswered` note and say `P.unknownKeepAlive()`.
9. The flows: booking (now with Service_Request, Service_Choice, First_Offer and offer acceptance), reschedule, cancel. Every place the flow said `sayModel(turn.reply)` says, on the brain path, the template for the same missing thing: `P.askService()` (the catalog by Category), `P.askName()`, `P.askPhone()`, `P.askServiceChoice(candidates)`.
10. Nothing placed → model's line (model path); on the brain path, *new* `P.notUnderstood()` and the miss counter (10.3).

`Decision.fromModel` is true only when the reply is `facts.modelReply`. On the brain path it is always false.

### New CallState fields

All optional, so a Call stored before this spec loads unchanged.

| Field | Type | Use |
|---|---|---|
| `fields.serviceId` | string | now holds a service id or a Combo_Id (no rename, so stored Calls keep working) |
| `fields.serviceChoice` | `{ candidates: string[]; with: string[] }` | an open Service_Choice |
| `fields.day` | `YYYY-MM-DD` | a day heard without a time |
| `fields.partOfDay` | `"morning" \| "afternoon"` | narrows the First_Offer |
| `offerKind` | `"first" \| "alternatives"` | what `lastOffer` holds |
| `declined` | number | First_Offers declined in a row |
| `notes` | `OwnerNote[]` (at most 5) | the Owner_Notes |
| `misses` | number | not-understood Turns in a row |
| `brainTurns` | number | Turns answered by the Code_Brain |
| `modelTurns` | number | Turns with a valid model answer (for the suggested urgency's `null`) |

```ts
type OwnerNote =
  | { kind: "owner_request" }
  | { kind: "sensitive"; term: string }
  | { kind: "unanswered"; question: string }   // the Caller's words, ≤ 160 characters
  | { kind: "not_understood" };
```

### As built in task 8 (TurnFacts, templates and decideTurn)

No new library API was used in this task (only the project's own modules, Temporal and fast-check as the earlier tasks used them), so no documentation changed the plan.

- **`lib/conversation/facts.ts`.** `TurnFacts` has the design's fields plus four the flow needs on both paths: `serviceChange` (the Call's services after the utterance, the removed services and Add_Ons, the cap, an answered Service_Choice), `phoneRejected`, `notUnderstood` and `smallTalk` (a thanks or greeting alone). `factsFromReading(reading, utterance?)` and `factsFromModel(turn, reading, shop, { state?, utterance? })` take the utterance only for an unanswered question's Owner_Note (`noteQuestion`, one line, ≤ 160 characters). On the model path with no Reading, the model's service words go through `matchServices` with the Call's services, so a tie becomes a Service_Choice and tie rule 5(c) still applies; a text it cannot place is `{ kind: "unknown" }`, as `matchService` made it `unknownService` before.
- **Compatibility.** `decideTurn` takes `facts`, or a model `turn` (turned into facts with `factsFromModel`), so every core-call-loop test calls it unchanged. `mergeFields` takes `TurnFacts` or a `ModelTurn` for the same reason. `matchService` stays for its own tests.
- **CallState.** `offerKind`, `declined`, `notes`, `misses` and `brainTurns` as in the table; one field the table did not list, `topics` (the Profile_Topics answered, at most 5), for the code-built reason of 10.7. `modelTurns` is not stored: only a valid model Turn writes `note.reason`, and `suggestedFrom` already returns null for an empty reason, so a brain-only Call has no Suggested_Urgency without a new counter. `brainTurns` is counted in `decideTurn`, so task 9's `handleTurn` must not count it again.
- **Choices the design left open**, each pinned by a unit test in `tests/conversation/decide.brain.test.ts`:
  - A Profile_Topic starts or continues a flow only with facts of its own. "¿Cuánto cuesta un corte de hombre?" names a service and "¿A qué hora abrís el sábado?" has the booking word "hora" and a day, so the Reading marks both as booking; on their own they are questions, answered alone, and the service and day are remembered for a later "dame cita".
  - An Owner_Request or a Sensitive_Hit never takes the utterance's facts. Before this rule, the first probe run read "me ha dado alergia el tinte" as a request for Tinte completo and replaced the Call's mechas with it.
  - Declines follow the design's sketch: the First_Offer, after a "no" the next slot, after a second "no" the day-and-time question (`MAX_DECLINES` 2). A "no" to a rejection's alternatives, or to a read-back on the brain path, also asks for a day and time; a "no" to a cancel's read-back keeps the booking.
  - A time with no day at all ("a las cinco", model path) is still asked as before (`askDayAndTime(null)`): a First_Offer at 10:00 would ignore what the caller said.
  - An offer found for one set of services is cleared when the services change. B6 checks every offered instant against the Booking_Rules, and the 4th service of a cap or an Add_On removal returned early with the old slot still offered.
  - A note or an answer in front of a flow line keeps the reply within 3 sentences: if the two together are longer, the flow's question alone follows (the offer's "¿Te viene bien…?"); a read-back is never shortened.
- **Templates** (`lib/receptionist/phrases.ts`), beyond the design's table: `offerAgain(slot)` (the offer's question alone), `confirmAgain()` (a read-back interrupted by a question), `smallTalk("thanks" | "greeting" | "no")`, `askService(brief)`, a `continuing` form of the three Keep_Alive_Lines and of `addOnRemoved`, and the Owner's reason parts (`reasonWants`, `reasonAsked`, `note`). Wording that differs from the table's examples: prices are "Por {servicio} son {precio}, y se tarda {duración}" and durations "Para {servicio} se tarda {duración}", because "unas mechas lleva" does not agree; the hours come from the prompt's own groups (`hoursGroups` and `daySessionsInWords`, factored out of `hoursInWords`, whose output is unchanged), so in English the afternoon session is "five in the afternoon to eight in the evening"; the address is the profile's text with digits as words ("Estamos en Calle Mayor doce, Madrid."). `lib/receptionist/fillers.ts` holds the Filler texts and kinds and imports nothing.
- **`handleTurn`** still calls the model on every Turn (task 9 adds the Reading); it now passes `factsFromModel(turn, null, shop)`. One gap fixed here: the bookings read covered only a requested time or a pending start, so a First_Offer would have been searched against no bookings at all. `timesInvolved` now adds `now`, the day asked for and the offered slots whenever the Call has services.
- **Tests rewritten to the new requirement (15.4)**, because core-call-loop 5.x is amended (requirements.md, "Amendments"):

| Test | Old assertion | New assertion | What it still protects |
|---|---|---|---|
| `tests/conversation/decide.whoSpeaks.property.test.ts`, "the generator reaches all three sides" | a day with no time → `askDayAndTime(2026-11-11)` | → `firstOffer("haircut", Wednesday 10:00)` | the code speaks, never the model, and the slot is the first the rules accept |
| `tests/api/turn.whoSpeaks.test.ts`, "time dropped, date kept" | `askDayAndTime(WED)`, "¿A qué hora te viene bien mañana?" | `firstOffer("haircut", Wednesday 10:00)`, "Un corte son media hora y quince euros. ¿Te viene bien mañana a las diez? …" | the model's words about opening hours are never spoken |
| `tests/api/turn.whoSpeaks.test.ts`, "Call B's shape" | `askDayAndTime(null)` | `firstOffer("haircut", Tuesday 10:00)` | the same, for a turn with neither date nor time |

  S8's property itself and every other existing `decideTurn` test passed unchanged. S2's generator gained brain facts (a third of the inputs are `factsFromReading` of a real Reading; the plain-yes branch reads "sí") and offers drawn from the shared start pool with an `offerKind`; for a brain input, `turn.callerConfirmed` is set to the facts' `yes`, so the existing assertion reads "the facts said yes". No assertion and no `numRuns` changed.
- **New tests**: `tests/conversation/facts.test.ts` (one block per row of "Who decides what"), `tests/receptionist/phrases.brain.test.ts` (each template word for word in both languages; every one within 3 sentences of 25 words, no digits, cacheable; at least 2 Fillers per kind and language, and no import in `fillers.ts`), `tests/conversation/decide.brain.test.ts`, `tests/conversation/ownerMessage.brain.test.ts`, and the properties B12 (`numRuns` 200: the happy path of a booking with 0–4 random Turns inserted, each Turn from the brain or a scripted model; it asserts offer acceptance and bookings were reached on both sources, and a yes to alternatives), B4 (`numRuns` 100: 2–3 services by aliases only they have, or the shared cut words next to a Goes_With partner; every branch asserted reached. Task 8.6 names "a memory repository", which is task 9.1's `Repository`; B4 runs through `decideTurn` with `brainCall`, which applies each `createBooking` to the bookings the next Turn sees, as a commit would, so it can move to that repository in task 9 without changing an assertion) and B6 (`numRuns` 100: random shops drawn from the Rich_Profile's services with random durations, prices, "from" flags, hours and FAQ_Entries, which the schema validates; FAQ answers carry marker words found nowhere else, so a sentence with a marker must be that shop's own answer). `tests/conversation/brainCall.ts` runs a brain-only Call for them.
- **Quick bite checks** (the full mutation proofs are task 13). Saying every price one euro higher failed B4 at once and B6 after 2 runs; B6 shrank to a one-service shop priced one euro, asked "¿cuánto tarda Corte de mujer?", that heard "dos euros". Booking on a yes to a First_Offer failed B12 on its first run, which shrank to the plain happy path of the Real_Call; S2 did not catch it in that run, because its single Turns rarely combine a booking intent, a known service, an offered slot the rules accept and a plain yes. Code restored after each.

## handleTurn

`say` keeps its shape. The changes, in order:

1. `overLimit` returns which limit was hit. The per-visitor limit keeps `endWithFallback` (outcome `fallback`, Requirement 1.4). The global hourly limit sets `skipModel`.
2. `const reading = readUtterance({ utterance, state, shop, pack, now, lang })`, synchronous.
3. If the times involved are known from the state or the Reading, the bookings read starts now (a promise awaited before `decideTurn`).
4. If `reading.sure`, no model call: `facts = factsFromReading(reading)`, no log line, `modelFailed` untouched (2.2). Otherwise, unless `skipModel`, `callReceptionist(deps.model, prompt, { timeoutMs: deps.config.modelTimeoutMs, onFailure })`. `callReceptionist` already races its own deadline and aborts every attempt when it settles, so a late model answer is dropped by construction (2.5).
5. When the model was called: `facts = result.ok ? factsFromModel(result.turn, reading, shop) : factsFromReading(reading)`. On the brain path for any reason except `skipModel`, one `turn_fallback` line with `path: "brain"`, and `state.modelFailed = true`, `brainTurns += 1`. A Sure_Reading Turn counts in `brainTurns` too (it is answered by the brain) but not in `modelFailed`.
6. The bookings read and the commit loop as today, with `decideTurn({ facts, reading, ... })`.
7. The stage times (`brain`, `db`, `model`, `total`) are returned beside the output for the adapter's `Server-Timing` header (19.4). They are numbers only.

### What makes a Reading sure

`readUtterance` sets `sure` last, from the Reading and the Call's stage (19.2):

| Waiting for | Sure when the utterance is |
|---|---|
| read-back answer | a first-word yes or no, with no new service, day or time (a change is read as a change, and is still sure if the change itself is placed) |
| First_Offer or alternative | yes, no, or a day/time/part of day |
| Service_Choice | a candidate's distinguishing alias |
| the next field (`name`, `phone`, `requestedTime`) | that field, read by its reader |
| anything | a Service_Request in a booking utterance; a Profile_Topic; an Owner_Request; a Sensitive_Hit; a language switch; a goodbye or thanks alone |

and, in every case, at most 2 unplaced words after removing greetings, the owner's and shop's names, and the lexicon's filler words. "Hola Lola quería cortarme el pelo y hacerme un degradado" is sure (booking utterance, Service_Request, unplaced: "hacerme", which is a booking verb in the lexicon, so 0). "¿Y qué tal es Lola cortando?" is not (a question with no Profile_Topic), so the model is asked.

Mistakes cost differently in each direction. A sure Reading that should have gone to the model gives a templated line where a natural one was possible; the caller can still say it again. A Reading sent to the model that the code could answer costs up to 1.6 s and quota. The 2-word rule leans to "sure" because the owner asked for speed; Property B15 checks that a sure Reading's facts are exactly what was said, so leaning to sure never books anything the caller did not say.

`endWithFallback` is no longer called for a model failure; the `retry` path, `maxConsecutiveInvalid` and the `fallbackRetry` line are removed from `say`. `CoreConfig.maxConsecutiveInvalid` stays in the type for one release (the harness sets it), marked deprecated, and is removed in the cleanup task.

### As built in task 9 (handleTurn and the brain path)

The only library API this task used beyond earlier tasks is Vitest 4.1.12's fake timers, read in the installed type declarations (`node_modules/vitest/dist/index.d.ts`: `useFakeTimers({ toFake })`, `advanceTimersToNextTimerAsync`, `getTimerCount`). B8 fakes only `setTimeout`, `clearTimeout` and `Date`, so the real `setImmediate` can drain promise callbacks between timers. Nothing in the docs changed the plan.

- **`say`, steps 1–6.** The per-visitor limit still ends the Call with the Fallback_Message (1.4); the global limit sets `skipModel` and writes no `turn_fallback` line and no `modelFailed` (1.5; design step 5 "except skipModel"). The Reading and `factsFromReading` come first. The bookings read starts before the model call whenever the state or the Reading already involve times, wrapped so it never rejects unhandled; after the model, it is used only if the chosen facts involve exactly the same instants, else a fresh read covers them (a model that heard a time the brain did not). On a model failure, one `turn_fallback` line with `path: "brain"` and `modelFailed: true`; `decideTurn` counts `brainTurns`, so `say` does not. A valid model answer goes through `factsFromModel(turn, reading, shop, …)`, so the Reading's services, Profile_Topic, Owner_Request and Sensitive_Hit now decide on the model path too (13.2). `FallbackLogEvent.path` is `"brain" | "end" | "start" | "http_503"`; `retry` is no longer written.
- **`tests/conversation/memoryRepository.ts`** (9.1): atomic commits on a copy; an overlap of a confirmed booking on the same shop and resource is `booking_overlap`; one booking and one Message per Call; a booking for an unknown Call throws, as the foreign key does. Its tests run the same scripted Calls (a model booking, a brain-only Combo_Id booking, a hang-up, the visitor limit) and the same raw commits on it and on PGlite and compare every reply, Call row, booking and Message.
- **New tests:** `tests/conversation/coreCall.ts` (`handleTurn` on the memory repository, the per-Turn `switchModel`), `arbModelBehaviour` in `brain/arbitraries.ts`, the shop and utterance generators moved unchanged from B6 to `brain/arbShops.ts`, `handleTurn.brain.test.ts` (the early read and its reuse, the global limit, what a brain Turn records, an early-read error), and the properties B1 (101 runs: 100 random plus one fixed brain-only booking, Requirement 1.7), B8 (100), B2 (200), B3 conversation part (200) and B11 (100). Each asserts its rare branches were reached. B8 defines "the model answers at t" as the service's time for every attempt running then, so a hedge or a 5xx retry does not move the end of the Turn; t = W is left out, because two timers due at the same instant have no defined winner.
- **Quick bite checks** (full mutation proofs are task 13): ending the Call on a model failure failed B1, B2, B3, B8 and B11 on their first run; doubling the Model_Wait failed B8 (W 100, a valid answer at 101 ms, used instead of dropped); dropping the brain's Profile_Topic failed B2, B3 and B11; dropping its Owner_Request, Sensitive_Hit and unanswered question failed B11. Code restored after each.
- **Found while writing the tests:** "Oye, ¿y Lola corta bien los rizos?" is not an off-profile question: "rizos" is an alias of the perm, so the brain offers a perm. The tests use "Oye, ¿y Lola es simpática?" instead. B4 (task 8) failed once on seed −27447435: its generator said the shared cut word for the men's cut next to the women's cut ("quería barba, cortarme el pelo y corte de mujer"), which names one cut, not two. The generator now uses the shared word only when no other listed service shares it; the assertions and `numRuns` did not change.
- **Tests rewritten to the new requirement (15.4).** Each kept the behaviour it protects with an utterance that is not a Sure_Reading, so it still exercises the model path after task 17:

| Test | Old assertion | New assertion | What it still protects |
|---|---|---|---|
| `tests/api/turn.failures.test.ts`, "a model timeout", "a 429 from the model" | the end Fallback_Message, `complete: true`, outcome `fallback`, Call `failed` | a hang, a 503 on every attempt, a 429 and a network error each get the brain's reply (an oracle: the Reading decided on the stored state), `complete: false`, Call open; then "Adiós, gracias" ends it with one Message, `modelFailed: true`, the caller's name, not `fallback` | a model failure is noticed and recorded for the Owner |
| same file, the timing check | under 2000 ms with a 50 ms wait | at least `MODEL_TIMEOUT_MS − 50` and under `MODEL_TIMEOUT_MS + 1500`, with the real 2400 ms wait | a hung model never holds the Turn past the Model_Wait |
| same file, "invalid output once" and "twice in a row" | once: the retry line; twice: the end Fallback_Message | two invalid outputs in a row are two brain replies, the Call stays open, and the goodbye Message has `modelFailed: true` | invalid output never reaches the Caller |
| same file, "the global limit reached mid-call" | the end Fallback_Message and a `fallback` Message | the model is not called, the brain's reply, no log line, `modelFailed` false, no Message | the global limit still protects the quota |
| `tests/api/turn.highDemand.test.ts`, "503 on every attempt" | the end Fallback_Message and a `path: "end"` line | the brain answers, the Call goes on, one `path: "brain"` line with status 503, `InternalServerError`, 2 attempts, and no name or phone | the cause of every brain Turn is logged without personal data |
| same file, "invalid output" | `["retry", …]`, then `["end", …]` | `["brain", "invalid_output"]` twice | the zod issues are logged, never the text |
| `tests/api/turn.urgency.test.ts`, the two `fallback` cases | the model fails on the Turn (`throws429`) | the per-visitor limit on that Turn (still `fallback`, still `urgent` from "es urgente"); new case: a brain-only Call with "es urgente" ended by goodbye stores `urgent`, basis `urgent_term`, no suggestion | code-decided urgency on the fallback path and on a brain-only Call |
| same file, "completed" and "gave up after booking conflicts" | "Es urgente, un corte mañana a las 19:30…" in one line, then "Sí" | "Es urgente, por favor" first, then the booking line and "Sí" (one more scripted model Turn) | urgency on a booked Call and on the give-up path. Since 13.2 the Reading's Sensitive_Hit decides on the model path, and a Sensitive_Hit never takes the utterance's booking facts (task 8), so the one-line form no longer books |
| `tests/api/turn.digits.test.ts`, all three | "¿Cuánto cuesta un tinte?", "¿Qué horario tenéis el sábado?", "¿Dónde estáis?" heard as the model's line | the same model lines after questions with no Profile_Topic | the model's own digits are spoken as words (natural-voice 11.4) |
| `tests/api/turn.speech.test.ts`, "the read-back … and the model's own answer" | "¿Cuánto cuesta un corte?" answered by the model, not cacheable | "¿Y qué tal es Lola cortando?" answered by the model, not cacheable | model text is never cached |

  **Open point for the owner (not changed here):** a caller who says "es urgente" and a booking in the same sentence now gets the Sensitive_Hit's Keep_Alive_Line and must say the booking again, on both paths. That is task 8's approved rule; it may deserve a second look, since "es urgente, ¿me dais cita para hoy?" is a natural thing to say.

### As built in task 17 (Sure_Readings skip the model, and `Server-Timing`)

No new library API. `performance.now()` (Node 20 global) is the default stage clock; `CoreDeps.timer` can replace it. The `Server-Timing` syntax (`name;dur=ms`, comma-separated) is the one task 1.8 read on MDN; nothing in the docs changed the plan.

- **`handleTurn.say`, steps 4, 5 and 7.** When `reading.sure`, `callReceptionist` is not called: the facts are `factsFromReading`, no `turn_fallback` line is written and `modelFailed` keeps its value. `decideTurn` already counts every brain-source Turn in `brainTurns`, so a Sure_Reading Turn is counted there and nowhere else. `handleTurnTimed(input, deps)` returns `{ output, timings }`, and `handleTurn` is now `handleTurnTimed(...).output`, so no caller of `handleTurn` changed. The stages: `brain` is the Reading, `factsFromReading`/`factsFromModel` and `decideTurn`; `db` is the sum of every repository and rate-limiter call (each port is wrapped in a timing `Proxy`, so the early bookings read beside the model is counted and `db` may overlap `model`); `model` is the `callReceptionist` wait, 0 when it is skipped; `total` is the whole call. They are numbers only (`StageTimes` in `types.ts`).
- **Adapter** (`app/api/turn/handler.ts`): every 200 response of `start`, `say` and `hangup` carries `Server-Timing: brain;dur=…, db;dur=…, model;dur=…, total;dur=…` (`serverTiming`, rounded to 0.1 ms, never negative or NaN). The adapter adds the shop load and the voice-cache lookup to `db`, and `total` runs from the shop load to the response. The error responses (400, 404, 503) carry no header. Tests: `tests/api/turn.serverTiming.test.ts`.
- **B15** (`tests/conversation/b15-sure-reading.property.test.ts`, 200 runs): six Call stages reached by a prefix of brain Turns; the utterance from `arbUtterance`, the reader's pool, a canonical Sure-table line for the stage, or a not-sure line; each branch, each stage, each Sure row and both not-sure kinds asserted reached. "Only what was said": a changed name, phone or day must be the Reading's; a changed requested slot must be one the Reading said (with its day, or the Call's day), one the Call offered or held, or the Call's time on a newly said day; every part of a changed `serviceId` must come from the Reading or the Call; a booking on a sure Turn needs a yes to a read-back. Not sure: exactly one model call; on a hang, the `model` stage is at least the Model_Wait. Quick bite checks (the full mutation proofs are task 13): calling the model on every Reading failed on the first run, shrunk to a fresh "quería Corte de mujer"; setting `modelFailed` on a Sure_Reading failed after 10 runs, shrunk to "¿pagar con tarjeta?". Code restored after each.
- **17.4** (`tests/conversation/turnCompute.perf.test.ts`): the `brain` stage, median of 5 runs, under 50 ms for each of the 50 longest pool utterances and for every Turn of the Real_Call. The 250 Turns of the first test ran in 250 ms in all on this machine.
- **Tests changed under 17.5.** None was deleted and no assertion was loosened. Each one scripted the model for a line that is now a Sure_Reading, so its script was never read. The new setup says the same line with `NOT_SURE_TAIL` (`tests/conversation/notSure.ts`: " porque me lo recomendó mi cuñada" / " because my sister recommended it", three words no rule places), so the model path is still what it tests:

| Test | Old setup | New setup |
|---|---|---|
| `tests/api/turn.booking.test.ts` (es, en) | the five lines as said | every line with the tail; `model.calls` 5 still asserted |
| `tests/api/turn.failures.test.ts`, the 4 failure kinds, the timing check, invalid output twice, both rate limits | "Quiero un corte, soy Ana" | "Quiero un corte porque me lo recomendó mi cuñada, soy Ana" (the tail before the name, see below) |
| same file, hang-up mid-call | "Un corte mañana a las siete y media", "Ana" | both with the tail; `model.calls` 2 still asserted |
| `tests/api/turn.highDemand.test.ts`, one 503 | the 2026-11-12 line | the same line with the tail; `model.calls` 2 still asserted |
| `tests/api/turn.whoSpeaks.test.ts`, all four | the 2026-11-12 line, "A las nueve de la noche", "Vale, a las siete y media" | each with the tail; the recovery case now also asserts 3 model calls (it passed before only because the brain gave the same answers without the model) |
| `tests/api/turn.realCall.test.ts`, the replay and its English twin | the nine caller lines | each with the tail |
| `tests/api/turn.urgency.test.ts`, seven cases | "Es urgente, por favor", the booking line, "Sí", "Es urgente, quiero un corte", "Es urgente, soy Ana", "Quería pedir cita para un corte" | each with the tail (before "soy Ana" where a name follows); the cases pin the model's `urgencySuggested` beside the code's urgency, so the model must be asked |
| `tests/api/turn.digits.test.ts`, Spanish lines 1 and 3 | "Oye, una cosa que te quería preguntar", "Vale, ¿y algo más que me puedas contar?" | "Oye, otra cosa que me ronda la cabeza", "Vale, ¿y qué más me cuentas de vosotras?" (same role: no service, day, time or topic) |
| `tests/conversation/handleTurn.brain.test.ts`, "a brain Turn after a model failure" | "quería un corte de mujer" | with the tail |
| `tests/conversation/memoryRepository.test.ts`, "a brain-only booking with a failing model" | the Real_Call's first line | with the tail, so the failing model is reached once and the Message is still `modelFailed: true` (the all-sure Call is task 10's regression) |
| `tests/conversation/b1-model-failure.property.test.ts` | each behaviour counted as reached before the Turn | counted only when the model was really called on that Turn; "every failure kind ran" is now true of the model, not of the script. The fixed booking example is now all Sure_Readings and pins 1.7 itself |

  B2, B3, B8 and B11 passed unchanged: B8 already drew only not-sure utterances, and B2, B3 and B11 assert the answer, which is the profile's whether the model was skipped or failed. B4 failed in the first full run on its "shared cut word" coverage check (0 of 100 runs), unrelated to task 17: after task 9's generator fix that branch needs four conditions at once, and it failed 2 of 4 runs of the file alone. One fixed example now reaches it (`numRuns` 101: the design's 100 random runs plus the example, as in B1); no assertion changed.
- **Code_Brain findings, not fixed here** (they belong to the readers of task 6; with task 17 a Sure_Reading now speaks them without the model, so they deserve an early look):
  1. "Oye, una cosa que te quería preguntar" is a sure `service_request` for an unknown service "preguntar" (the unknown-service rule takes any word after a wanting word). The caller would hear that the shop does not do "preguntar".
  2. "Vale, ¿y algo más que me puedas contar?" reads "contar" as a one-letter typo of "cortar", so it is a sure haircut request.
  3. "Quiero un corte, soy Ana porque me lo recomendó mi cuñada" reads the name as "Ana porque me lo recomendó".
  4. In a Call whose name is next, "…quería pedir cita para un corte de hombre y un arreglo de barba para mañana por la tarde…" (Saturday 19:30) is rejected for Sunday, and the alternatives offered are Tuesday 10:00, 10:15 and 10:30, in the morning, although the caller asked for the afternoon.

### As built in task 10 (Regression: Real_Call_2026_11_16)

No new library API (Vitest, PGlite and the project's own `makePost` / `Caller` harness, as earlier tasks used them), so no documentation changed the plan.

- **File**: `tests/api/turn.realCall1116.test.ts`, 11 tests. The Rich_Profile is `lolaSeedProfile` inserted after each reset; the clock is Saturday 2026-11-14 19:30 Madrid; the deps use the real `MODEL_TIMEOUT_MS` (2.4 s), not the harness's old 8 s. Each failing fake (`failsWith503(Infinity, …)`, `neverResolves`, `throws429`) is wrapped in a counter, because `neverResolves` and `throws429` count nothing themselves.
- **Per Turn**: the exact reply from `phrases` with the Turn's Variant_Seed (`firstOffer`, `timeAcceptedAskName`, `askPhone`, `readBack`, `booked`), `complete: false` and no outcome until Turn 5, and no reply equal to the Fallback_Message. The First_Offer is also pinned once as a literal in Spanish and in English.
- **At the end**: one booking row `corte-hombre+degradado` on `chair-1`, 09:00–09:50 UTC (10:00–10:50 Madrid), with the caller's name and `+34612345678`; one Message with outcome `booked`; the Call `completed`.
- **10.1 / 10.3** (Spanish and English, each fake): the model is called 0 times and no `turn_fallback` line is written. **10.2** (the first line plus `NOT_SURE_TAIL`, each fake): the model is called for Turn 1 only, the reply is the same First_Offer, exactly one `turn_fallback` line with `path: "brain"`, and `modelFailed: true`. **10.4** (the not-sure line, a healthy scripted model with `service` "cortarme el pelo y un degradado"): one model call, the same Combo_Id and First_Offer, the model's own line never spoken, no log line, `modelFailed: false`.
- **One deviation from the task text**: the response's `state.fields.service` shows the service by its name ("Corte de hombre + Degradado" / "Men's cut + Fade", through `serviceView`, as task 4 built it so no screen shows a raw Combo_Id). The Combo_Id itself is asserted on the booking row.
- **Bite check** (the full mutation proofs are task 13): calling the model even on a Sure_Reading (`!skipModel && !reading.sure` → `!skipModel`) failed 10 of the 11 tests: 10.1 and 10.3 on the call count (5 or 10 instead of 0), 10.2 and 10.4 on 5 log lines or 5 model calls instead of 1. The Calls still booked, because the brain answered every failed Turn. Code restored.

### As built in task 11 (Prompt)

No new library API (zod 4's `.describe()` and `z.toJSONSchema`, as task 1.5 confirmed), so no documentation changed the plan.

- **Schema** (`lib/receptionist/schema.ts`): the `service` description is now "Every service the caller asked for, in the caller's own words, joined with ' y ' (Spanish) or ' and ' (English), from the whole conversation. Null if not said." It was "The service the caller asked for, in the caller's own words, from the whole conversation. Null if not said." The model's text still goes through the same matcher (4.9, built in task 8).
- **System instruction** (`buildSystemInstruction`): a "desde" / "from" before the price of each `priceFrom` service (also in the style example, should the first service be one); after the services, an Add_On says "Solo se hace junto con: Corte de hombre." / "Only booked together with: Men's cut."; one "- Categorías: cortes (Corte de mujer, Corte de hombre, Corte infantil); barbería (…); …" line; and "- Respuestas de la tienda (puedes repetirlas tal cual):" with one line per FAQ_Entry, its first 3 aliases in the Call's language and its answer word for word. Each of these lines appears only when the profile has the field, so the V1_Profile's system instruction is byte for byte as before: its snapshot in `tests/receptionist/prompt.test.ts` passed without an update.
- **One addition beyond the task text**: `buildInput`'s "Servicio:" state line used `services.find(id)`, so a Combo_Id reached the model as "sin dato". It now uses `serviceView` (as this design's "Names and prices" section already says of "the prompt's state line"): "Corte de hombre + Degradado". A single catalog id gives the same name as before, so the `buildInput` snapshot is unchanged too.
- **Tests** (`tests/receptionist/prompt.rich.test.ts`, 8): every one of the 14 FAQ answers inside the shop facts in both languages; no digit in the facts block except the street number; the Categories line; "desde" on exactly the 6 `priceFrom` services; the Add_On line; the V1_Profile's prompt has none of the new lines; the pinned diff of the JSON schema (the property list, which properties carry a description, the new `service` text and the unchanged `date` and `time` texts); a Combo_Id in `buildInput`, and a refused one (wrong order) still "sin dato". Bite check: removing the "desde" marking failed the "desde" test on its first `priceFrom` service, `peinado-novia`. Code restored.
- **Two property failures in the full run, outside this task (not fixed here).** Neither path reaches `prompt.ts` or `schema.ts`: (1) B15 (`tests/conversation/b15-sure-reading.property.test.ts`, seed 1052892670): in the `choice` stage the generator's canonical answer "de mujer" was said in a random shop that has a men's and a kids' cut but no women's cut, so it was not a Sure_Reading; this looks like a generator that ignores the shop's services. (2) B3 matcher part (`tests/conversation/brain/services.property.test.ts`, seed 936854026): "oye, ¿barbea?", a one-letter typo of the service alias "barba", was read as the Category "barbería" (its alias "barber" is also one edit away) instead of the service. That may be a real tie-break question in the reader of task 6. Both are left for the owner.

## Model path constants

Proposed, to be confirmed by the measurement of task 7. The Model_Wait is 1.6 s by the reviewer's answer 1 (was 2.6 s in the first draft):

| Constant | Today | Proposed | Why |
|---|---|---|---|
| `MODEL_TIMEOUT_MS` (Model_Wait) | 8000 | 1600 | reviewer's answer 1; the Filler covers the wait from 700 ms on |
| `ATTEMPT_TIMEOUT_MS` | 2500 | from the rule below, 900–1300 | a hedge must start early enough to have a chance inside 1.6 s |
| `MIN_ATTEMPT_MS` | 1500 | 400 | a hedged attempt with less than 0.4 s left cannot answer |
| `MAX_MODEL_ATTEMPTS` | 4 | 3 | one per default model. With 1.6 s at most one hedge fits by deadline; the third model is reached only when earlier attempts fail fast (a 5xx starts a fresh attempt at once) |
| `DEFAULT_GEMINI_MODELS` | 2 ids | `gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.5-flash` | the owner's measurement of 2026-11-16: 1.35 s, 1.0 s, 1.5 s; `gemini-flash-latest` 503; 2.5 models 404 |

**The rule for `ATTEMPT_TIMEOUT_MS`:** run `scripts/check-turn.ts --repeat 15` once per default model (45 requests, under every model's free daily limit as checked in 1.1), at a time the owner chooses. Take the 75th percentile of the successful latencies of the first model, round it up to the next 100 ms, and clamp it to [900, 1300]. (The 90th percentile of the first draft would put the hedge past the point where it can still answer inside 1.6 s.) Record the raw numbers, the percentile, the share of successful answers that came in under 1.6 s, and the result in "As built in task 7". If more than 1 in 5 requests of the first model fail, or fewer than half answer under 1.6 s, stop and ask the owner before choosing (the order of the list may need to change instead).

### As built in task 7 (measurement only: stopped at the rule's stop condition)

**Run** (2026-11-16, 17:53–18:03 Madrid; 45 requests stated before running, the free-tier RPD is not in the docs, see task 1.1): `node --env-file=.env.local --conditions=react-server --import tsx scripts/check-turn.ts --repeat=15 --model=gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash --gap=5000 --cap=15000 "es|Hola Lola quería cortarme el pelo y hacerme un degradado"`. The line is the Real_Call_2026_11_16's first utterance. Raw single calls, no retry, round-robin over the models, 5 s between starts. Output: `.measurements/model-wait/repeat15.log`.

| Model | ok | 5xx (503) | timeout (15 s cap) | 429 | ok latencies, sorted (ms) | ok under 1.6 s |
|---|---|---|---|---|---|---|
| `gemini-3.5-flash-lite` | 10 | 4 (1135, 1440, 1580, 1743 ms) | 1 | 0 | 1228, 1328, 1589, 1709, 1834, 1863, 1954, 2000, 2211, 2990 | 3 of 10 |
| `gemini-flash-lite-latest` | 13 | 2 (1387, 4766 ms) | 0 | 0 | 1216, 1397, 1457, 1652, 1701, 1901, 1903, 1966, 1999, 2333, 2587, 2664, 6483 | 3 of 13 |
| `gemini-3.5-flash` | 1 | 0 | 13 | 1 (the 15th request, 290 ms) | 2229 | 0 of 1 |

**The rule applied to the first model:** the 75th percentile (nearest rank, 8th of 10) is 2000 ms; rounded up it stays 2000; clamped to [900, 1300] it is **1300**. **Both stop conditions are met:** 5 of 15 requests of the first model failed (more than 1 in 5), and 3 of its 10 answers (3 of 15 requests) came in under 1.6 s (fewer than half). So no `ATTEMPT_TIMEOUT_MS` is chosen, and tasks 7.2 and 7.3 are not built: the constants, the default list, the tests and `tech.md` are unchanged. Open question 17.

**What else the run showed:**
- `gemini-3.5-flash` (routed to `gemini-3.6-flash`, task 1.1) answered 1 of 15. 13 requests gave nothing within 15 s, and the 15th was a 429 after 14 requests in about 10 minutes, so its free quota is small or was already being spent by the demo. As a third entry it would add a hung hedge, not an answer.
- `gemini-flash-lite-latest` answered more often than `gemini-3.5-flash-lite` (13 against 10), though task 1.2 showed the two ids reach the same model. 15 requests per id cannot tell whether that difference is real.
- **With the proposed 1600 ms Model_Wait and a 1300 ms attempt deadline, no hedge would ever start by deadline.** `callReceptionist` treats an attempt as the last one when `timeoutMs − startAt − attemptMs < MIN_ATTEMPT_MS`; for the first attempt that is 1600 − 0 − 1300 = 300 < 400. A hedge inside 1.6 s needs `ATTEMPT_TIMEOUT_MS` ≤ 1200 with `MIN_ATTEMPT_MS` 400. The design's clamp range [900, 1300] reaches past that.
- **On this utterance, every valid model answer (24 of 24) was overruled by the code with "Uy, eso no lo hacemos…".** `decideTurn` saw a service id it does not know. The likely cause is that the prompt still describes the V1 catalog and has no Combo_Id (task 11). Neither the prompt nor the model's JSON was logged, so the cause is not proven. Tasks 9 and 10 will hit this on the model path, and B11 and the regression's fourth run (the forced model path) will show it.
- The window overlapped the time when the deployed demo saw every model fail (15:59 the same day). Load may differ at another hour.

**Owner decision (2026-11-16 18:40, question 17).** The free tier cannot answer inside 1.6 s often enough, so the 1 s goal is met by the code, not the model: Sure_Readings skip the model (task 17), fillers cover the wait (task 20). The model path is for the rest. Constants: `DEFAULT_GEMINI_MODELS` = `gemini-flash-lite-latest`, `gemini-3.5-flash-lite` (drop `gemini-3.5-flash`: it hung 13 of 15 times); `MODEL_TIMEOUT_MS` 2400; `ATTEMPT_TIMEOUT_MS` 1200 (a hedge starts at 1.2 s, so 2400 − 0 − 1200 = 1200 ≥ `MIN_ATTEMPT_MS` 400); `MIN_ATTEMPT_MS` 400; `MAX_MODEL_ATTEMPTS` 2. When the budget ends with no valid answer, the Code_Brain answers with its template for the turn (task 9), never the generic fallback line. Requirement 12's 1.6 s figure becomes 2.4 s for the model path; record that change in requirements.md with this date. The "24 of 24 overruled" finding goes to task 11 (prompt with the V2 catalog and Combo_Ids) and must be proven fixed there by logging one real model JSON. Build 7.2 and 7.3 with these numbers; 7.1 is done with the measurement above.

**As built in task 7.2 and 7.3 (2026-11-16).** `lib/receptionist/callModel.ts`: `MODEL_TIMEOUT_MS` 2400, `ATTEMPT_TIMEOUT_MS` 1200, `MIN_ATTEMPT_MS` 400, `MAX_MODEL_ATTEMPTS` 2. `lib/receptionist/geminiClient.ts`: `DEFAULT_GEMINI_MODELS` = `gemini-flash-lite-latest, gemini-3.5-flash-lite`. `callReceptionist` itself is unchanged; with these numbers a Turn makes at most two calls: the first, then either a hedge at 1.2 s (which keeps the remaining 1.2 s, as the last attempt) or one 5xx retry while at least 400 ms are left. A 5xx on the hedge starts no third attempt; a test pins it. `.kiro/steering/tech.md` has the new list and numbers, and requirements.md 12.1–12.2, the amendment table and the Model_Wait glossary entry record the change with this date. README's `GEMINI_MODEL` default follows the code.

Tests that pinned the old values, and what happened to each:

| Test | Pinned | Now |
|---|---|---|
| `geminiClient.test.ts` "uses the default model when GEMINI_MODEL is empty" | a value (`gemini-3.5-flash-lite` first) | updated to `gemini-flash-lite-latest`; a new test pins the whole list and that `gemini-3.5-flash` is absent |
| `callModel.test.ts` `OPTS` | a value (`timeoutMs: 8000`) | the setup uses `MODEL_TIMEOUT_MS` |
| "times out at exactly the Model_Wait…", "aborts the signal…", "every attempt hangs…" | a behaviour, with 8000 / 7999 written out | kept, with `MODEL_TIMEOUT_MS` in the setup |
| "the budget fits the attempts it promises" | values: `ATTEMPT < MODEL/2`, `MAX ≥ 3` | updated: `MODEL ≤ 2400`, `MODEL − ATTEMPT ≥ MIN` (a hedge always gets `MIN_ATTEMPT_MS`), `MIN ≤ ATTEMPT`, `MAX ≥ 2`. `1200 < 2400/2` is false, so the old relation cannot hold with the owner's numbers |
| "a retry stays inside the same Model_Wait" (was "…8-second deadline") | a behaviour, with 3 s 503s and 3 calls | kept: a 503 at 1 s (before the attempt deadline), a retry that would answer 3 s later, cut at 2.4 s; 2 calls |
| "a timeout is reported with … every attempt it made" | values: 3 attempts, 2 `attempt_timeout` records | updated: `MAX_MODEL_ATTEMPTS` attempts, one `attempt_timeout` of `ATTEMPT_TIMEOUT_MS` |
| "the first attempt keeps running beside the fresh one…" | a behaviour, with answers 3 s after start | kept: answers `ATTEMPT_TIMEOUT_MS + 300` after start (1.5 s), the hedge unfinished for 300 ms |
| "two attempts hang: the third … answers at 7.9 s" | a behaviour of the last attempt | kept as "the first attempt hangs: the last one keeps the rest of the budget and answers 100 ms before the end" (2.3 s, `MAX_MODEL_ATTEMPTS` calls) |
| "503 on every attempt: unavailable after MAX_MODEL_ATTEMPTS calls" | a behaviour, written with the constant | unchanged (now 2 calls, 1 earlier record) |
| `tests/api/harness.ts` `baseConfig.modelTimeoutMs: 8000` | a test-only budget for the conversation tests | unchanged: it sets the budget explicitly. The conversation tests that hang the first attempt (`turn.whoSpeaks`) now hedge at 1.2 s instead of 2.5 s and pass as before |

New: "a 503 on the hedge starts no third attempt: the cap holds" (Requirement 12.3 with `MAX_MODEL_ATTEMPTS` 2).

**Note for the owner.** Task 1.2 found that `gemini-flash-lite-latest` answered as `gemini-3.5-flash-lite`, so the two default ids may reach the same model today; the order follows the 13-of-15 against 10-of-15 of the measurement, as decided. And the deploy note of question 17 still holds with 2.4 s: until task 9 lands, today's `handleTurn` ends a Call with the Fallback_Message on a model timeout, so a 2.4 s wait (was 8 s) deployed alone would end more Calls.

## New templates

All in Spoken_Form, at most 3 sentences of at most 25 words, with Phrase_Variants where the line is frequent. Spanish shown; English has a twin of each.

| Template | Example (Rich_Profile) | Cacheable |
|---|---|---|
| `firstOffer(id, slot)` | "Un corte de hombre y un degradado son cincuenta minutos y dieciocho euros. ¿Te viene bien el martes a las diez? Si prefieres otro día, dímelo." | yes |
| `askService()` | "Claro. Hacemos cortes, barbería, peinados, color y tratamientos. ¿Qué te quieres hacer?" | yes |
| `askServiceChoice(candidates)` | "¿El corte es de mujer, de hombre o infantil?" | yes |
| `topicAnswer(hours)` | "Abrimos de martes a sábado, de diez de la mañana a dos de la tarde y de cinco a ocho de la tarde. Lunes y domingo cerramos." | yes |
| `topicAnswer(hours, day)` | "El sábado abrimos de diez a dos y de cinco a ocho." | yes |
| `topicAnswer(hours, now)` | "Ahora mismo estamos cerrados; abrimos mañana a las diez." | yes (has a day, so not in tier 7) |
| `topicAnswer(address)` | "Estamos en la calle Mayor doce, en Madrid." | yes |
| `topicAnswer(price, service)` | "Por un corte de hombre son catorce euros, y se tarda media hora." | yes |
| `topicAnswer(price, choice)` | "El corte de mujer son veinticinco euros, el de hombre catorce y el infantil diez." | yes |
| `topicAnswer(duration, category)` | "El tinte de raíz lleva una hora y cuarto, el tinte completo una hora y tres cuartos, y las mechas dos horas y media. Te cuento el resto si quieres." | yes |
| `topicAnswer(faq)` | the FAQ_Entry's answer, as written | yes |
| `ownerNoted()` | "Se lo apunto a Lola para que te llame. Mientras, ¿te doy cita o te cuento horarios y precios?" | yes |
| `sensitiveNoted()` | "De eso no te puedo aconsejar, pero se lo apunto a Lola y te llama hoy mismo. ¿Te ayudo con algo más?" | yes |
| `unknownKeepAlive()` | "Eso no lo sé, pero se lo apunto a Lola. ¿Te ayudo con una cita, horarios o precios?" | yes |
| `notUnderstood()` | "Perdona, no te he entendido. Puedo darte cita o contarte horarios, precios y servicios." | yes |
| `notUnderstoodAgain()` (third miss) | "Se lo dejo apuntado a Lola por si acaso. Si te resulta más fácil, también puedes escribirme aquí abajo." | yes |
| `languageSwitched()` | "Of course, we can carry on in English. How can I help?" (in the new language) | yes |
| `phoneAgain()` | "Perdona, no me ha quedado claro el número. ¿Me lo dices otra vez, despacio?" | yes |
| `tooManyServices()` | "Como mucho te puedo apuntar tres servicios seguidos. ¿Cuáles quieres?" | yes |
| `addOnRemoved(addOn, base)` | "Vale, sin el corte. El degradado va con el corte, así que lo quito también. ¿Qué te quieres hacer?" | yes |
| `filler(kind)`, `check` | "A ver, déjame que mire…", "Vale, te miro…" / "Let me check…", "Okay, one moment…" | yes, tier 6 |
| `filler(kind)`, `answer` | "Vale, mira…", "Pues mira…" / "Okay, so…", "Right, so…" | yes, tier 6 |
| `filler(kind)`, `wait` | "Mm, un segundito…", "Vale…" / "Just a second…", "Mm, okay…" | yes, tier 6 |

Fillers are not replies: they are never returned by the Turn_API, never stored in the Transcript, and live in `lib/receptionist/fillers.ts` so the browser can import their texts and cache keys without importing the phrase book.

The prices are said with "Por {servicio} son {precio}" and "{servicio} lleva {duración}" so no verb has to agree with a plural spoken name ("unas mechas"). A part priced "from" makes the price "desde {precio}". A template whose line would pass 25 words in one sentence splits at the clause the template marks, never mid-name (the rule `readBack` already follows).

## The Shop_Profile schema

```ts
const Id = z.string().regex(/^[a-z][a-z0-9-]{0,59}$/);
const SpokenAnswer = z.string().trim().min(1).max(300)
  .refine((s) => !/\d/.test(s), "Spoken_Form: no digits")
  .refine((s) => !/[*_#`~<>[\]{}|]/.test(s) && !EMOJI.test(s), "no markup or emoji")
  .refine((s) => sentences(s).length <= 2 && sentences(s).every((x) => words(x) <= 25), "1–2 sentences of ≤ 25 words");

ServiceSchema += { id: Id, category: Id.optional(), goesWith: z.array(Id).max(10).optional(), addOnTo: z.array(Id).min(1).max(5).optional(), priceFrom: z.boolean().optional() };
CategorySchema = z.strictObject({ id: Id, name: Localized, aliases: z.array(z.string().min(1).max(60)).max(20).optional() });
FaqEntrySchema = z.strictObject({
  id: Id.refine((id) => !BUILT_IN_TOPICS.has(id), "reserved topic id"),
  aliases: z.strictObject({ es: z.array(Alias).min(1).max(30), en: z.array(Alias).min(1).max(30) }),
  answer: z.strictObject({ es: SpokenAnswer, en: SpokenAnswer }),
});
ShopProfileSchema += { categories: z.array(CategorySchema).max(12).optional(), faq: z.array(FaqEntrySchema).max(40).optional() }
  .refine(every category, goesWith and addOnTo id exists; no addOnTo id is itself an Add_On; no service is its own Add_On)
  .refine(FAQ ids unique; FAQ aliases unique across entries and different from every Service_Alias and Category alias, after normalization);
```

The id pattern accepts every id stored today (`haircut`, `colour`, `beard`, `chair-1`), so stored profiles still parse.

### As built in task 4

- **Schema** (`lib/conversation/shopProfile.ts`): `IdSchema`, `BUILT_IN_TOPICS`, `SpokenAnswerSchema`, `CategorySchema`, `FaqEntrySchema` and the `END_OF_SPEECH_MS_*` constants are exported. The cross-references are one `superRefine` (`profileReferenceIssues`) that adds one issue per broken reference, with its path, so a refusal says which service or alias is wrong. The id pattern applies to service, Category and FAQ ids; resource ids keep their old rule (the schema of this spec does not name them). `voice.endOfSpeechMs` sits beside `voice.es` and `voice.en`, an integer in [300, 1500].
- **Two choices the design left open.** (1) The FAQ alias check compares against everything the service matcher reads (each service's id with hyphens as spaces, both names, its aliases; each Category's names and aliases), not only the `aliases` lists, because the matcher of task 6 indexes all of them. The same alias in one entry's Spanish and English lists ("parking", "bizum") is allowed: it is not a repeat across entries. (2) A service's and a Category's `aliases` may now hold **30** entries (was 20 for services). The Rich_Profile's Corte infantil has 13 own aliases plus the 9 shared generic ones of the services table, 22 in all, which the old cap would have refused in task 5. No test pinned 20.
- **Catalog** (`lib/conversation/catalog.ts`): `serviceView(id, shop, pack?)` returns `{ known: true, parts, durationMin, priceCents, priceFrom, name, spoken }` or, for an unknown id or a Combo_Id `resolveParts` refuses, `{ known: false }` with the id as its name and spoken name. The pack is optional: it is needed only for a part with no `spokenName` (the phrase book's old "una cita de …" rule moved here unchanged). `nameByParts` names a stored id from names only, for the Machine_Page, whose shop has no durations; it does not re-check catalog order, because a stored Combo_Id was already accepted by the Booking_Rules. `catalogItems` is the list ("corte, tinte y barba", or the Categories when there are more than 5 services and some Categories); `catalogLine` is the sentence ("Hacemos cortes, barbería, peinados, color y tratamientos." / "We do haircuts, barbering, styling, colour and treatments."). The list keeps at most 20 words so "Tenemos {list}, ¿te interesa algo?" stays within 25; a longer list keeps its first items and ends "y más cosas" / "and more".
- **Phrase book**: `kit.spokenService`, `kit.service`, `kit.catalog` and `serviceInfo` read `serviceView`. A single service's `serviceInfo` is the old line word for word (plus "desde" / "from" when `priceFrom`); a Service_Combo says "Claro, un corte y un degradado son cincuenta minutos y diecinueve euros." / "Sure, a haircut and a fade take … and cost …", the "son" form the new templates use so no verb has to agree with a plural. `publicStateOf` shows a Service_Combo by its parts and still shows nothing for an id outside the catalog. The prompt's state line (`prompt.ts`) still looks the id up directly; it moves to `serviceView` in task 11, whose prompt diff is pinned.
- **Owner side**: `serviceName` and `agendaWhat` call `nameByParts`, so the Agenda, the move and cancel dialogs and the Tape say "Corte de hombre + Degradado". New tests: `tests/owner/machineShop.test.ts` and a Combo_Id block in `tests/owner/agenda.test.ts`; no existing owner test changed.
- **Tests**: `tests/conversation/shopProfile.brain.test.ts` (each refusal of 4.1 and both parses), `tests/conversation/catalog.test.ts`, `tests/receptionist/phrases.combo.test.ts`. Every existing phrase test passed unchanged.
- **A quick bite check that changed a test** (full mutation proofs are task 13): comparing FAQ aliases with the service words *without* normalizing the service side passed every test at first, because each colliding alias in the test was already lower case. Two cases were added that only collide after normalization ("corte de hombre" against the name "Corte de hombre", and "Men’s Cut" with a curly apostrophe against the alias "men's cut"); with the bug, the test fails on the first of them. Code restored, all pass.

## The Rich_Profile

Peluquería Lola keeps its id, owner, address, Time_Zone, hours (Tuesday to Saturday, 10:00–14:00 and 17:00–20:00), two chairs, voice and speech rate. Prices and durations are my estimate of a typical Madrid neighbourhood salon in 2026 (reviewer's answer 7). They are not from a price survey: the owner reads this table once before the seed runs on Neon.

### Categories

| id | es | en | aliases |
|---|---|---|---|
| `cortes` | cortes | haircuts | cortes, corte de pelo en general |
| `barberia` | barbería | barbering | barbería, barbero, barber |
| `peinados` | peinados | styling | peinados, styling |
| `color` | color | colour | color, colour, color de pelo, coloración, tintes, colouring |
| `tratamientos` | tratamientos | treatments | tratamientos, treatments |

### Services

The shared generic aliases ("corte", "corte de pelo", "cortar el pelo", "cortarme el pelo", "cortarse el pelo", "cortar", "haircut", "hair cut", "cut") are on all three cuts, so they make a Service_Choice unless Goes_With decides.

| id | es / en | min | € | from | category | goes with | add-on to | own aliases (besides the shared ones) |
|---|---|---|---|---|---|---|---|---|
| `corte-mujer` | Corte de mujer / Women's cut | 45 | 25 | | cortes | | | corte de mujer, corte de señora, corte de chica, cortar las puntas, sanear las puntas, las puntas, women's cut, ladies' cut, trim |
| `corte-hombre` | Corte de hombre / Men's cut | 30 | 14 | | cortes | degradado, barba, arreglo-barba | | corte de hombre, corte de caballero, corte de chico, men's cut, gents' cut |
| `degradado` | Degradado / Fade | 20 | 4 | | barberia | corte-hombre | corte-hombre | degradado, corte degradado, degradado a cero, degradado bajo, fade, skin fade, low fade, feid, taper |
| `corte-infantil` | Corte infantil / Kids' cut | 25 | 10 | | cortes | | | corte infantil, corte de niño, corte de niña, para mi hijo, para mi hija, para mi niño, para mi niña, para el niño, para la niña, kids' cut, child's cut, for my son, for my daughter |
| `barba` | Barba / Beard shave | 25 | 10 | | barberia | corte-hombre | | barba, afeitado, afeitar, afeitarme, toalla caliente, shave, hot towel shave, beard |
| `arreglo-barba` | Arreglo de barba / Beard trim | 15 | 6 | | barberia | corte-hombre | | arreglo de barba, arreglar la barba, arreglarme la barba, perfilar la barba, recortar la barba, beard trim, trim my beard |
| `lavar-peinar` | Lavar y peinar / Wash and blow-dry | 30 | 15 | | peinados | | | lavar y peinar, lavado y peinado, peinar, peinarme, secar, brushing, blow dry, blow-dry, blowout |
| `peinado-evento` | Peinado de evento / Event styling | 60 | 35 | | peinados | | | peinado de evento, peinado de fiesta, peinado de invitada, peinado para una boda, event hair, party hair, wedding guest hair |
| `peinado-novia` | Peinado de novia / Bridal hair | 120 | 120 | yes | peinados | | | peinado de novia, novia, me caso, bridal hair, bride |
| `recogido` | Recogido / Updo | 45 | 30 | | peinados | | | recogido, moño, updo, bun |
| `tinte-raiz` | Tinte de raíz / Root colour | 75 | 28 | | color | | | tinte de raíz, retoque de raíz, raíces, raíz, tapar las canas, canas, root colour, root touch-up, roots, grey coverage |
| `tinte-completo` | Tinte completo / Full colour | 105 | 38 | yes | color | | | tinte completo, tinte, teñir, teñirme, teñirse, pintar el pelo, pintarme el pelo, full colour, full color, dye, hair dye |
| `mechas` | Mechas / Highlights | 150 | 55 | yes | color | matiz | | mechas, mechitas, reflejos, highlights, foils |
| `balayage` | Balayage / Balayage | 180 | 85 | yes | color | matiz | | balayage, babylights, ombré, mechas californianas |
| `matiz` | Matiz / Toner | 30 | 15 | | color | mechas, balayage, decoloracion | | matiz, matizar, baño de color, toner, gloss |
| `decoloracion` | Decoloración / Bleaching | 150 | 60 | yes | color | matiz | | decoloración, decolorar, aclarar el pelo, bleach, bleaching, lighten my hair |
| `keratina` | Alisado de keratina / Keratin smoothing | 150 | 95 | yes | tratamientos | | | alisado de keratina, keratina, alisado, alisar, alisado brasileño, keratin, smoothing |
| `hidratante` | Tratamiento hidratante / Hydrating treatment | 30 | 15 | | tratamientos | | | tratamiento hidratante, hidratación, mascarilla, hydrating treatment, deep conditioning |
| `permanente` | Permanente / Perm | 120 | 50 | | tratamientos | | | permanente, ondas, rizos, ondular, perm, waves, curls |

Every combination of up to three services whose sum is at most 240 minutes can fit the morning session; the longest single service (balayage, 180 min) fits either session. The Real_Call_2026_11_16 resolves to `corte-hombre+degradado`: 50 minutes, 18 €. "Un degradado" or "corte degradado" alone resolves to the same Service_Combo through `addOnTo` (reviewer's answer 3). The fade is never booked alone.

"Corte degradado" is a `degradado` alias, and it beats the shared "corte" by the longest-match rule, so it never makes a Service_Choice. "Un corte para mi hija" is Corte infantil by rule 5(a); "un corte y barba" is Corte de hombre by 5(b); "un corte" after an earlier "y también barba" is Corte de hombre by 5(c); a bare "un corte" in a fresh Call asks "¿De mujer, de hombre o infantil?" (reviewer's answer 4).

### FAQ_Entries

Answers in Spoken_Form (no digits). Spanish shown; each has an English twin of the same content. Station and car park names wait for check 1.5.

| id | Spanish aliases (sample) | English aliases (sample) | Spanish answer |
|---|---|---|---|
| `pago` | pagar con tarjeta, bizum, efectivo, formas de pago, cómo se paga | pay by card, payment, cash, bizum | "Puedes pagar con tarjeta, con Bizum o en efectivo." |
| `parking` | aparcar, parking, aparcamiento, dónde dejo el coche | parking, park the car | "No tenemos aparcamiento propio, pero hay un parking público en la plaza Mayor, muy cerca." |
| `accesibilidad` | silla de ruedas, escalones, accesible, carrito | wheelchair, step-free, accessible, stroller | "Sí, el local está a pie de calle, sin escalones, y entra bien una silla de ruedas." |
| `sin-cita` | sin cita, sin reserva, pasarme sin cita, ir directamente | walk in, without an appointment, drop in | "Si hay un sillón libre te atendemos sin cita, pero con cita te aseguras el hueco." |
| `cancelacion` | anular con antelación, política de cancelación, si no puedo ir, penalización | cancellation policy, cancel fee, if I can't make it | "Puedes cambiar o anular tu cita sin coste hasta veinticuatro horas antes, llamando a este mismo número." |
| `llegar-antes` | cuánto antes llego, llegar antes, con cuánta antelación | how early, arrive early | "Con llegar cinco minutos antes es suficiente." |
| `ninos` | niños, críos, hacéis a niños, peques | kids, children, do you cut children | "Sí, cortamos a niños y niñas de cualquier edad; el corte infantil es hasta los doce años." |
| `productos` | vendéis productos, champú, comprar productos, mascarillas para casa | sell products, shampoo, buy products | "Sí, vendemos champús, mascarillas y productos de peinado de las marcas que usamos en el salón." |
| `bono-regalo` | tarjeta regalo, bono regalo, regalar, vale regalo | gift voucher, gift card, gift certificate | "Sí, tenemos tarjetas regalo del importe que quieras; se compran en la peluquería." |
| `prueba-alergia` | prueba de alergia, test de alergia, prueba de sensibilidad, prueba del tinte | allergy test, patch test, skin test | "Para cualquier tinte necesitamos una prueba de alergia cuarenta y ocho horas antes. Es gratis y solo lleva cinco minutos." |
| `hombres` | hacéis a hombres, cortáis a hombres, para chicos, sois unisex | do you do men, men's hair, unisex | "Sí, claro, hacemos cortes de hombre, degradados y barba." |
| `ingles` | habláis inglés, atendéis en inglés | do you speak English, English-speaking | "Sí, te podemos atender en inglés, y si quieres seguimos esta llamada en inglés." |
| `wifi` | wifi, internet, red | wifi, wi-fi, internet | "Sí, hay wifi gratis para clientes; la clave te la damos en el salón." |
| `como-llegar` | cómo llego, metro, autobús, cómo se llega, transporte | how do I get there, metro, subway, bus, public transport | "Estamos en la calle Mayor, en pleno centro, y se llega bien en metro y en autobús." |

"How long does colour take" is not an FAQ_Entry: "¿cuánto tarda el color?" is a duration question on the `color` Category, answered from the catalog (Requirement 11.5).

The `ingles` entry also sets `wantsLanguage: "en"` when the question is asked in Spanish and the shop offers English; the answer is then followed by `languageSwitched()` in English. The FAQ alias `prueba de alergia` contains the urgent term "alergia"; by Requirement 9.7 the answer is given and no Sensitive_Hit is raised, and by Requirement 16.5 the Urgency_Rules no longer count it either (below).

### As built in task 5

- **The seed** (`lib/db/seed.ts`): `lolaSeedProfile` is the Rich_Profile of the tables above: 5 Categories, 19 services in table order (so `corte-hombre` comes before `degradado` and the Real_Call's Combo_Id is `corte-hombre+degradado`), 14 FAQ_Entries with an English twin of every answer and alias list. The shared generic cut aliases are one constant, `SHARED_CUT_ALIASES`, spread into the three cuts. Every field outside the catalog (id, name, owner, address, zone, languages, hours, chairs, pack, speech rate; there is no `voice` override) is unchanged. `parking` and `como-llegar` use task 1.5's wording.
- **Spoken names**, which the tables did not give: un corte de mujer / a women's cut, un corte de hombre / a men's cut, un degradado / a fade, un corte infantil / a kids' cut, un afeitado de barba / a beard shave, un arreglo de barba / a beard trim, un lavado y peinado / a wash and blow-dry, un peinado de evento / an event hairstyle, un peinado de novia / a bridal hairstyle, un recogido / an updo, un tinte de raíz / a root colour, un tinte completo / a full colour, unas mechas / highlights, un balayage / a balayage, un matiz / a toner, una decoloración / a bleach, un alisado de keratina / a keratin smoothing, un tratamiento hidratante / a hydrating treatment, una permanente / a perm. The English FAQ aliases add "do you take cards" and "car park" to the samples; the Spanish ones add "aceptáis tarjeta". The owner reads these with the price table.
- **5.2, the demo tests moved to the V1_Profile** (`tests/fixtures/lola.ts`), same assertions:
  - `tests/owner/demo.test.ts`: the import (`lolaSeedProfile` from the seed → `lolaProfile` from the fixture), `englishLola`, the default `shop` of `samples()`, the `phrases(…)` call of the booking-sample test, and both `shop:` arguments of the "only the keys asked for" test. The "is Peluquería Lola, the seeded shop" check keeps `lolaSeedProfile`.
  - `tests/owner/demo.property.test.ts` (M20): the import, `TZ` and both members of `arbShop`. `numRuns` and every assertion unchanged.
- **Two `tests/db/seed.test.ts` assertions the task did not list.** Task 5.2 says this file keeps `lolaSeedProfile`, and it does, but two of its checks pinned the old catalog, so they could not pass unchanged:
  - The services check of core-call-loop 7.3 (`[["haircut", 30, 1500], ["colour", 90, 4500], ["beard", 20, 1000]]`) now pins all 19 `[id, minutes, cents]` rows of the services table (Requirement 11.4). Same kind of assertion, more rows. core-call-loop 7.3 is not in requirements.md's "Amendments" table, although 11.4 replaces it; that is an open point for the owner (a one-row addition to the table), not changed here.
  - "is the same profile as the Lola test fixture" (`expect(lolaSeedProfile).toEqual(lolaProfile)`) became "keeps everything of the V1_Profile but its catalog" (11.7): the seed and the fixture are equal on every field except `services`, `categories` and `faq`, the fixture has no `categories` or `faq`, and the compared field list is pinned so a new field cannot slip out of the check.
- **5.3** (`tests/conversation/richProfile.test.ts`): the profile parses with its pack; 19 services, each with both spoken names, at least 4 aliases and a known Category, every Category used, only `degradado` is an Add_On, and the six "desde" prices; the 12 Goes_With pairs each make a Combo_Id the Booking_Rules accept on Tuesday 17 November at 10:00 (the longest, balayage + matiz, is 210 of the session's 240 minutes); the 14 FAQ ids and every answer through `SpokenAnswerSchema` plus a no-digit check; both catalog lines; `serviceView("corte-hombre+degradado")` is 50 minutes, 1800 cents, not "desde", "Corte de hombre + Degradado" and "un corte de hombre y un degradado".
- **5.4, the first service is now `corte-mujer`** (Corte de mujer, 45 min, 25 €; it was `haircut`, 30 min). `demoSamples` still makes a valid booking sample: on Monday 16 November at 12:00 it books Tuesday 17 at the sample's usual time, the Booking_Rules accept it on the chair it names, and the caller's line says "un corte de mujer". The Cache_Plan's tier 2 still renders `rejected`, `timeAcceptedAskName` and `booked` in both languages, with an alternative on each of the 7 days. The demo sample's agreed text and suggested reply now name the women's cut, and tier 2's lines change with it, so the Voice_Cache must be rebuilt after the seed runs (an owner step, with task 12's tiers).

## Not_Urgent_Phrases (owner-machine 5.3, amended)

The reviewer's answer 5: a question about the allergy test is not urgent; a real reaction still is. The change is data in the pack plus one masking step in `findTerm`'s caller, so a new pack can list its own phrases with no engine change.

```ts
// lib/sectors/types.ts: vocabulary[lang] gains
notUrgent?: readonly string[];        // zod: same shape as `urgent`, max 20

// lib/sectors/hairSalon.ts
es.notUrgent = ["prueba de alergia", "test de alergia", "prueba del tinte"];
en.notUrgent = ["allergy test", "patch test"];

// lib/messages/terms.ts
/** The line's words with every Not_Urgent_Phrase (any pack language) replaced by one blank word. */
export function maskPhrases(line: string, phrases: readonly string[]): string;
```

`ruleOf` step 1 searches the urgent terms in `callerLines.map((l) => maskPhrases(l, allNotUrgent))`; steps 2–4 read the lines unmasked, so "prueba de alergia para hoy" still counts "hoy". Masking replaces the phrase by a word that matches nothing ("·"), so the words on either side do not join into a new term. Examples, all pinned by unit tests in `tests/messages/urgency.test.ts`:

| Caller line | Rule urgency | Basis |
|---|---|---|
| "¿Hacéis la prueba de alergia?" | low | none |
| "Quiero la prueba de alergia, que me ha dado alergia otro tinte" | urgent | `urgent_term` "alergia" (the second one) |
| "Me pica la cabeza desde el tinte" | urgent | `urgent_term` "me pica" |
| "Allergy test before my colour, please" | low | none |
| "I had a reaction after the patch test" | urgent | `urgent_term` "reaction" |

M1–M3's independent oracle gets the same rule written its own way (it removes the phrases from its own token list, not with `maskPhrases`), and the generators draw Not_Urgent_Phrases next to urgent terms, so each property reaches both "masked" and "masked but another urgent term in the line" (asserted, like every rare branch). No assertion is loosened: for lines with no Not_Urgent_Phrase the oracle is unchanged.

### As built in task 18

- **Before the change** (2026-11-16, `npx vitest run tests/messages/urgency.test.ts`): 5 of the 22 tests failed. "¿Hacéis la prueba de alergia?" and "Allergy test before my colour, please" came out `urgent` (basis `urgent_term` "alergia" / "allergy"), "prueba de alergia para hoy" was `urgent_term` instead of `today_open` by "hoy", and so were "¿Necesito un TEST DE ALERGIA?" and "me prueba de alergia pica". After it: 22 of 22.
- **`maskPhrases(line, phrases): string[]`, not `string`.** The sketch above replaces a phrase with "·", but `findTerm` normalizes every line again and turns any non-letter into a space, so "me · pica" would read "me pica". `maskPhrases` returns the pieces of the normalized line between the phrases, and `ruleOf` passes them to `findTerm` as separate lines, so nothing joins across a phrase. A word is masked when it sits in any occurrence of any phrase (overlaps make a union, so "allergy test de alergia" masks every word). The phrases of every pack language apply, like the urgent terms. Steps 2–4 read the unmasked lines.
- **Schema**: `notUrgent` is `termList(20).optional()`. It has the same element and duplicate rules as `urgent` (`termList(40)`), so an empty list, more than 20 phrases, a phrase over 40 characters or a repeat after normalization is refused (`tests/sectors/urgencyTerms.test.ts`). Packs without the field still validate.
- **Tests changed in `tests/messages/urgency.property.test.ts`** (no `numRuns` changed, still 200):
  - The oracle: new `startsOf`, `coverOf`, `phrasesOf`, `urgentOf` and `urgentOccurrences`. The `urgentTerm` fact of `oracleRule` is now "an urgent-term occurrence none of whose tokens a phrase covers", where it used to be "any urgent-term occurrence". With no phrase in the lines nothing is covered, so the fact is the old one.
  - `maskBranch`, `reached`, `count` and `expectReached`: M1, M2 and M3(a) each assert that they reached "masked only" and "masked plus another urgent term". Measured on one run of 200 each: M1 27 and 92, M2 42 and 94, M3(a) 16 and 103.
  - `placeOutside`: M2 and M3(a) insert their terms through it instead of `insertWord`. It inserts at the same word position unless that would put the term inside a phrase or change the coverage of a word already in the line; in that case the term goes on a new line. For lines with no phrase, it gives exactly what `insertWord` gave.
  - M2 sometimes puts a phrase of the same pack right before or after the inserted term. Its assertions did not change.
  - M3(a) places 0–3 phrases on the Caller's side. It gains two assertions: the rule is `urgent_term` exactly when the oracle finds an uncovered urgent term, and the Receptionist-only Transcript is never `urgent_term`. Its old assertions did not change.
  - The first test also asserts that phrases exist and that no phrase fits inside a single urgent term, which is what makes the new-line fallback of `placeOutside` sound.
  - `tests/messages/arbitraries.ts`: `ALL_PHRASES`, and `arbWord` draws a phrase variant with weight 1 (of 10).
- **Mutation proof.** Searching urgent terms in the unmasked lines failed M1 (it shrank to a Caller who said only "prueba de alergia", answered `urgent` where the oracle says `normal`, booked today) and M3(a). Masking only the Spanish phrases failed M1 (it shrank to "allergy test") and M3(a). Gluing the pieces back into one line ("me pica" across a phrase) was caught only by the unit test "the words on either side of a masked phrase do not join": the generators very rarely put "me" and "pica" on either side of a phrase. Code restored after each.

## The Cache_Plan's tiers 6 and 7

Appended after tier 5 in `cachePlan`, built for each language with a chosen voice, deduplicated against earlier tiers like every tier:

- **Tier 6 (pinned): the Fillers**, every variant of every kind. They are pinned because the Call_Page fetches them at Call start (Requirement 18.5); an evicted Filler would be a silent Turn. `PINNED_TIERS` becomes `{1, 2, 6}`. Task 12 checks how `buildVoiceCache.ts` orders work under the budget and, if it builds tiers in number order and stops at the budget, makes it build pinned tiers first, so tier 6 can never be cut by tiers 3–5.
- **Tier 7 (not pinned)**: every new Fixed_Phrase of this spec, every variant; `topicAnswer` for `address`, `services`, each FAQ_Entry, each service's price, each Service_Choice the profile can produce, each Category's durations; `askServiceChoice` for each choice. `firstOffer` is not in tier 7: it names a day.

The build also checks every Filler's audio at the shop's speech rate: over 900 ms is a build error naming the line (Requirement 18.6). The task measures both tiers' size for the Rich_Profile and compares it with the Voice_Cache budget (`voiceCacheBudget.ts`) before building any audio (Requirement 14.3).

## Latency (Requirements 17–22)

### Where the 3–4 s went, and where it goes

| Stage, from End_Of_Speech | 2026-11-16 (measured, plus constants) | After (design budget) |
|---|---|---|
| Chrome decides the utterance is over | ~1.0–1.5 s, not measured (Chrome's own timer) | Silence_Cut: 600 ms |
| `/api/turn` server and network | 1.65 s (model on every Turn) | Sure_Reading: ~0.3 s (database only); model Turn: up to 1.6 s + ~0.3 s |
| second request, `/api/speech` first byte | 0.72 s | gone: TTS starts in the same request (Inline_Audio) |
| Start_Buffer | 0.3 s | 0.15 s while steady |
| first sound | ~3–4 s | Filler at 0.7 s when the reply is not audible yet; cached reply ~1.0 s; live reply ~1.0 + TTS first audio (~0.6–0.7 s) + 0.15 ≈ 1.8 s |

The live-reply row is the risk for the p50 ≤ 1.5 s target: TTS time to first audio is Gemini's, and a First_Offer names a day, so it is never cached. Task 20's after-numbers will say whether the target holds; if not, the numbers are recorded as they are (22.6) and open question 12 lists the next options.

### L1: the Silence_Cut (`lib/voice/endOfSpeech.ts`)

A pure reducer per recognition session:

```ts
type EosEvent =
  | { type: "RESULT"; at: number; finalText: string; interim: string }  // the port's accumulated view
  | { type: "TICK"; at: number }
  | { type: "REC_END"; at: number };
type EosEffect = { type: "send"; text: string } | { type: "stopRecognition" } | { type: "updateLine"; text: string } | { type: "carry"; words: string };
```

- every `RESULT` moves `lastResultAt`; a `TICK` with `at − lastResultAt ≥ endOfSpeechMs` and some text emits `send(final + interim)` and `stopRecognition` (`rec.stop()`, not `abort()`, so Chrome can still deliver its final);
- after `send`, a later `RESULT` or `REC_END` with a final text emits `updateLine(final)` and, when the final's words extend the sent words (compared with `normalizeText`), `carry(extra words)`; never a second `send`;
- `REC_END` before any `send` with a final text sends it (Android with no interim results, 17.4); with no text, it is today's `no-speech`.

The port's `listen` resolves at the `send`, so the call loop posts the Turn at once; `carry` is held by the port and put in front of the next utterance. The port's ticks are 50 ms timers, so the cut lands within 50 ms of `endOfSpeechMs`. End_Of_Speech is `lastResultAt`, and the port reports it with the result so the Filler clock and the Timing_Panel share it.

### L2: Fillers (`lib/voice/filler.ts`, `lib/receptionist/fillers.ts`)

- `fillerKind(utterance, lang)`: lexicon only (no profile, so it is safe in the browser bundle, which `scripts/check-client-bundle.mjs` checks): a question cue → `answer`; a booking word, a day word, a time or a digit → `check`; else `wait`.
- `pickFiller(kind, lang, last)`: the first variant of the kind, by the Call's Variant_Seed, that is not `last`.
- `fillerDecision` reducer, clock from End_Of_Speech: events `REPLY_AUDIBLE_READY` (cached element can play, or the Start_Buffer is full), `FILLER_ENDED`, `TICK`. At `fillerAfterMs` (700) with no reply ready → `playFiller` if the Filler is loaded; else nothing. A reply that becomes ready while the Filler plays waits for `FILLER_ENDED`. At most one `playFiller` per Turn.
- Preload: at Call start, after the call button's gesture, the Call_Page fetches the Filler URLs of the Call's language (from a small list the public shop data carries: text, key, url) into `blob:` URLs held for the Call; on a language switch, the other language's. A failed fetch leaves that Filler out.
- Playback goes through the same shared, unlocked `<audio>` element as cached lines (the Safari rule of natural-voice), so a Filler and the reply never play at once by construction.

### L3: Sure_Readings

See "What makes a Reading sure" above. The 50 ms bound (19.1) is checked by a unit test that times `readUtterance` + `decideTurn` with a memory repository over the 50 longest pool utterances and every scripted Turn of the regression call. Database time is not in it; the Latency_Script measures it from `Server-Timing` on the deployed demo (19.5).

### L4: the Inline_Audio stream (`lib/voice/turnStream.ts`)

```
{"kind":"turn", ...TurnResponse}\n
{"kind":"audio","audio":"pcm","sampleRate":24000}\n      | {"kind":"audio","audio":"cached","url":"/api/voice/…"}\n
<raw 16-bit mono PCM until the end of the body>          | {"kind":"audio","audio":"none","fallback":"quota"|"rate_limit"|"unavailable"|"off"}\n
```

Content type `application/x-phantom-turn`. The first line is written as soon as `handleTurn` returns, so the Call_Page shows the text at once; the TTS request starts in the same moment. The audio header is written when the first audio chunk exists (or the TTS failed), so its `fallback` is decided before any PCM, like `/api/speech`'s status. An error after the first chunk ends the body early, which the browser sees as a stall, as today. A cached hit writes the header with the URL, and the body ends.

`app/api/speech/stream.ts` holds what `/api/speech`'s `say` does after the token check (limits, model order, 429 marks, the cache write, the timers) as `speechStream(input, deps, signal) → { kind: "pcm", sampleRate, body } | { kind: "none", fallback }`. Both routes call it. `/api/speech`'s tests run unchanged against it.

The decoder takes a `ReadableStream<Uint8Array>` and yields `{ turn }`, `{ audio }`, then PCM chunks. It finds the two newlines in whatever chunks arrive, so a line split across chunks, or a chunk that holds both lines and the first PCM bytes, decode the same (B18).

The request opts in with `audio: "inline"` on `say` (`TurnRequestSchema` gains the optional key). `start` keeps JSON: the greeting is a pinned cached line already. Typed_Mode and old clients get JSON, unchanged.

### L5: the adaptive Start_Buffer

`voiceDecision` gains `startBufferMs` in its initial state and an `underruns` count: in `playingStream`, a `CHUNK` that arrives after `scheduledUntil` (the audio had run out) counts one. The runner passes 150 while the Call has had no underrun and 300 after one (`CallLoopState.voiceUnderruns`). N12's rules do not mention the buffer size, so N12 runs unchanged for both values; its generator draws both.

### L6: measuring

- **Timing_Panel** (`?timing=1` on the Call_Page; `lib/voice/timing.ts` pure): per Turn, `endOfSpeech`, `sent`, `textReceived`, `fillerAudible`, `replyAudible`, `underruns`, as milliseconds from End_Of_Speech. It shows the last Turn and p50/p90 of all, and a "copy" button that copies the numbers as JSON. No words are kept.
- **Latency_Script** (`scripts/measure-latency.ts`): `--base`, `--allow-remote`, `--turns`, `--lang=es|en|both`, `--legacy` (JSON + `/api/speech`, for the before numbers on today's deploy). It plays scripted Calls (the regression call, an FAQ, a price question, a free question for the model) and records `Server-Timing`, time to the first line, to the audio header, to the first PCM byte and to 150 ms of audio. It prints p50/p90 per stage and writes `.measurements/latency/<date>-<before|after>.json`. Before it runs it prints the request count: Turns, model calls (the free questions only) and TTS requests (live lines). It writes Calls to the database behind the base URL, so against the deployed demo it is an owner step.
- **Timing harness** (`tests/voice/latencyHarness.ts`): fake clock, fake speech port that emits interim results at given times, fake Turn_API that answers after a given delay with a given stream, fake audio element with a given start delay. Scenarios as unit tests: a sure Turn with a cached reply at 250 ms server time (reply ready at ~900 ms, so the Filler plays at 700 ms and the reply follows it: open question 10); the same with `endOfSpeechMs` 400 (reply ready at ~700 ms or before: no Filler); a model Turn at 1.9 s (Filler at 700 ms; reply after it); a late final from Chrome (no second Turn); an underrun (next reply buffers 300 ms).

## Error handling and logging

| Situation | What the Caller hears | Call | Log |
|---|---|---|---|
| model `timeout` (Model_Wait passed) | the Code_Brain's reply | goes on | `turn_fallback`, `path: "brain"`, reason `timeout`, attempts, latency |
| model 5xx with no attempt left | the Code_Brain's reply, at once | goes on | the same, with status and error class |
| model 429 | the Code_Brain's reply, at once | goes on | the same, reason `quota` |
| Sure_Reading (model not called) | the Code_Brain's reply | goes on | nothing (not a failure) |
| model invalid output | the Code_Brain's reply | goes on | the same, reason `invalid_output`, zod issues (path, code, message only) |
| global hourly limit | the Code_Brain's reply | goes on | `turn_fallback`, `path: "brain"`, reason `rate_limit`, limit `global` |
| per-visitor limit | the Fallback_Message | ends, outcome `fallback` | as today |
| database commit conflict after 3 tries | `slotJustTaken` (as today) | ends, outcome `message` | as today |
| database down | HTTP 503 from the adapter (as today) | the browser's timeout rule | as today |

`FallbackLogEvent.path` gains `"brain"`. The existing redaction test (`fallbackLog.redact.test.ts`) gets a brain case: a Reading built from an utterance with a name, a phone and an unanswered question produces a log line that contains none of them.

## Correctness Properties

Each property is one fast-check test with `numRuns: 200` unless noted. Shared generators extend `tests/booking/arbitraries.ts` (`arbShop`, `arbNow` covering both 2026 Madrid DST weekends, `arbExisting`). New generators live in `tests/conversation/brain/arbitraries.ts`:

- `arbAliasVariant(alias)`: random case per letter, accents added or removed, doubled spaces, punctuation around it, and with probability 0.3 one typo in one word of 5+ letters, filtered so the typo word is not another alias word or a lexicon word;
- `arbFrame(kind, lang)`: question, booking, price, duration and addition frames ("oye, ¿{x}?", "quería {x}", "¿cuánto cuesta {x}?", "how long does {x} take", "y también {x}");
- `arbUtterance`: a mix from pools of booking pieces, FAQ questions, names, phones, days, times, yes and no, owner requests, off-profile questions and gibberish;
- `arbModelBehaviour`: a valid scripted turn, Gemini's 503 (`geminiHighDemandError`), a 429, a hang that ignores the signal, a network error, invalid JSON, a schema-invalid object;
- `memoryRepository()`: an in-memory `Repository` for the conversation-level properties (bookings checked for overlap on commit, returning `booking_overlap` like the constraint). The database-level behaviour stays on PGlite in the regression tests.

Properties for the Code_Brain run with the model replaced by a failing fake and `modelTimeoutMs` set to 20 ms, so they test the brain, not the clock; B8 tests the clock.

**B1. A model failure never ends a Call.** *For all* shops (the Rich_Profile and `arbShop` profiles with random catalogs and FAQ), conversations of 1–12 `arbUtterance`s with no goodbye, and a model behaviour per Turn from `arbModelBehaviour`: every Turn returns `complete: false` unless its outcome is `booked`, `rescheduled` or `cancelled` or the Turn limit was reached; no reply equals the Fallback_Message in either language; no stored Call has status `failed`; no Message has outcome `fallback`. `numRuns: 100`. Validates 1.1–1.3, 1.7.

**B2. Every FAQ topic gets the profile's answer.** *For all* FAQ_Entries of the Rich_Profile and of `arbShop` profiles with generated FAQ, languages, aliases, `arbAliasVariant`s and question frames, in a fresh Call and in the middle of a booking (services known, name missing): with a failing model, the reply contains the entry's answer exactly; in the middle of a booking it is followed by the booking's next question; the reply contains neither `unknownKeepAlive`, nor `ownerNoted`, nor the Fallback_Message; no Owner_Note is recorded; the Call is open. Validates 9.1, 9.5, 9.6, 1.1.

**B3. Every service alias is found and answered.** *For all* services `s` of the Rich_Profile, aliases `a` of `s`, `arbAliasVariant(a)`, languages and frames: `matchServices` returns `[s]` when `a` belongs to `s` only, or a Service_Choice whose candidates are exactly the services that share `a`; with a failing model, a price frame's reply contains `speakPrice(s)` (or every candidate's price), a duration frame's reply contains `speakDuration(s)`, and a booking frame's reply is a First_Offer whose slot `evaluateBooking` accepts for `s`. No reply is an owner-message line. Validates 4.1–4.4, 9.1, 8.1.

**B4. Two or three services in one sentence make one Service_Combo.** *For all* lists of 2–3 different Rich_Profile services (with unshared aliases, or a shared one with a Goes_With partner), aliases, joiners ("y", ",", "con", "y también", "and", "with", "plus") and orders: `matchServices` returns exactly that set; `comboId` of any order is the same string; with a failing model, the reply is a First_Offer stating `speakDuration(sum)` and `speakPrice(sum)` (with "desde" iff a part has `priceFrom`), and accepting it, a name, a phone and a yes write one booking with that Combo_Id and `end − start = sum`. `numRuns: 100`. Validates 7.1, 7.3, 7.5, 4.7.

**B5. A Service_Combo is one service of the summed duration.** *For all* shops, packs, `now`, existing bookings, lists of 1–3 service ids and starts: `checkBooking({ serviceId: comboId(ids) })` deep-equals `checkBooking({ serviceId: "x" })` on the same shop with an extra service `x` of the summed duration (`ok`, reason, resource, start, end, alternatives); and every invalid Combo_Id (an unknown part, a repeated part, 4 parts, a sum over 480 minutes, parts out of catalog order) is rejected with `unknown_service`. Also: P1–P9 run with `arbShop` drawing Combo_Ids as service ids (a generator change, no assertion changed). Validates 7.2, 7.3.

**B6. The Code_Brain never invents.** *For all* shops from `arbShop` (random catalogs, prices with and without `priceFrom`, hours, FAQ) and brain-only conversations of 1–10 `arbUtterance`s: every price phrase in every reply parses with `parsePrice` to a profile price or a Service_Combo's sum, preceded by "desde" iff a part has `priceFrom`; every duration phrase is a profile duration or a sum; every instant in `lastOffer` and in a pending read-back is accepted by `evaluateBooking` with that Turn's context; every sentence that is not a template sentence is an FAQ_Entry answer of that shop. `numRuns: 100`. Validates 9.2, 8.2.

**B7. The first slots from a time are the first ones the rules accept.** *For all* shops, `now`, existing bookings, services and Combo_Ids, `from` instants and `within` filters: every slot of `firstSlotsFrom` is accepted by `evaluateBooking`, starts at or after `from` and inside `within`, and the slots are strictly increasing; and an exhaustive scan of the slot grid from `from` to the first returned slot finds no accepted slot inside `within` before it. Validates 8.1–8.3 (a new rule in `lib/booking/`).

**B8. The brain answers by the Model_Wait, and a late model changes nothing.** With fake timers: *for all* Model_Waits `W` in [100, 3000] ms (the default is 1600), utterances that are not Sure_Readings, and model behaviours with an event time `t` in [0, 5000] ms (a valid answer, a 503, a 429, invalid output, a hang): the Turn resolves at `min(t, W)` for a failure and at `t` for a valid answer with `t ≤ W`, else at `W` (within one timer tick); the Turn_Source is `model` iff a valid answer came at `t ≤ W`; and after a late valid answer settles, the stored Call state equals the state of the brain's Decision. `numRuns: 100`. Validates 2.3–2.5.

**B9. Days and times are read as said, and only when said.** *For all* shop session sets, todays (both DST weekends), dates within 14 days, times on the 5-minute grid inside the sessions, and forms (the Receptionist's own `speakDay` and `speakTime` words; digits "a las H", "H:MM", "H.MM", "Hh" with and without a period; English forms): `readWhen` returns that date and time; "X, no, Y" returns Y. *And for all* utterances from the non-time pool (prices, phones, durations, "una cita", "dos servicios", names): `readWhen` returns no day and no time. Validates 5.1–5.3, 5.5, 5.7.

**B10. Names and phones are read as said.** *For all* names from a pool (1–4 words, with accents and compound surnames) and cue frames: `readName` returns the name; in "Hola {ownerName}, …" frames with no cue it returns null. *For all* valid Spanish mobile numbers and groupings into 1–3-digit groups, said as digits or as number words (`speakNumber`, "cero" for a leading zero), with random separators and an optional "+34" or "más treinta y cuatro": `readPhone` returns the E.164 number. Validates 6.1–6.4.

**B11. Owner requests and unanswered questions keep the Call alive and reach the Owner.** *For all* brain-only conversations with 1–3 Owner_Requests, off-profile questions or Sensitive_Hits at random positions, ending with a goodbye: every such Turn returns `complete: false` with the matching Keep_Alive_Line; the Call records one Owner_Note per such Turn (at most 5); the final Message has outcome `message` unless a booking, reschedule or cancel was confirmed, and its reason lists the notes after the main reason. `numRuns: 100`. Validates 10.1–10.6.

**B12. An accepted offer is not a booking.** *For all* conversations on both Turn_Sources: a `createBooking` or `reschedule` effect occurs only in a Turn whose previous reply was a read-back and whose facts say yes with no change; a yes to a First_Offer or an alternative only sets the requested time. (S2 with brain facts and offers in its generator.) Validates 8.4, 13.5.

**B13. Negation, addition and replacement.** *For all* current Service sets `A` (0–3 ids), services `b` and frames: "sin {b}" / "no quiero {b}" leaves `A` unchanged and never requests `b`; "y también {b}" gives `A ∪ {b}` (capped at 3, with `tooManyServices` past it); "{b}" alone gives `{b}`. Validates 4.6, 4.7, 7.8.

**B14. Tiers 6 and 7 only append.** *For all* shops and todays and languages: the plan's lines of tiers 1–5, in order, equal the plan built with tiers 6 and 7 switched off; tier 6 holds exactly every Filler variant of each language with a voice; every tier-7 line is cacheable and equals a line `phrases(...)` really says; keys are unique. `numRuns: 30`, with the 120 s timeout N17 uses. Validates 14.2, 18.5.

**B15. A Sure_Reading never calls the model, and says only what was said.** *For all* shops, Call stages and utterances from `arbUtterance` (Sure_Readings and others): when `reading.sure`, the model fake records zero calls in that Turn, no `turn_fallback` line is written, `modelFailed` is unchanged, and every fact the Turn stores (services, day, time, name, phone, yes/no) is one the Reading found in that utterance or the Call already had; when not sure, the model is called once with the Model_Wait. Readings of the Sure table's rows are sure, and a question with no Profile_Topic or 3+ unplaced words is not (both branches asserted reached). Validates 2.2, 2.3, 19.2, 19.3.

**B16. One utterance per listen, at the Silence_Cut.** With fake timers: *for all* `endOfSpeechMs` in [300, 1500] and sequences of recognition results (interim and final texts with arrival times, gaps from 0 to 3000 ms, an optional late final after the cut, an optional `REC_END` with or without interim results): exactly one `send` per session; it happens within one tick (50 ms) after the first gap of at least `endOfSpeechMs` after some text, or at `REC_END` when no gap came; its text is the final parts plus the latest interim at that moment; a later final never causes a second `send`; and the sent text plus the `carry` words contain every word of the last final, in order. Validates 17.1, 17.3–17.5.

**B17. A Filler only when it helps, never twice.** With fake timers: *for all* reply-ready times `r` in [0, 4000] ms from End_Of_Speech, Filler loaded or not, Filler lengths in [200, 900] ms, and Calls of 1–10 Turns: a Filler plays in a Turn iff `r > 700` and the chosen Filler is loaded; it starts at 700 ms (within one tick), so it is audible by 1000 ms with the fake element's start delay up to 300 ms; the reply starts at `max(r, fillerEnd)` and never while the Filler plays; at most one Filler per Turn; no two consecutive Turns play the same variant; Typed_Mode and browser-voice Calls play none. Validates 18.1, 18.2, 18.4, 18.6, 18.8, 22.4.

**B18. The Inline_Audio stream decodes the same however it is split.** *For all* TurnResponses, audio headers (each kind) and PCM byte arrays, and *for all* ways to split the encoded bytes into 1–50 chunks (including splits inside a line, inside the newline, and a chunk holding both lines and PCM): the decoder yields the same TurnResponse, the same header and the same PCM bytes in order as the unsplit stream; a body cut before the second line yields the turn and a `none`/`unavailable` header; a first line that is not valid JSON is a decode error, never a crash. Validates 20.1, 20.5.

**B19. The Start_Buffer adapts and N12 still holds.** *For all* event sequences of N12's generator, with `startBufferMs` drawn from {150, 300}: every N12 rule holds; playback starts at the first moment the queued audio reaches `startBufferMs` or the stream ends; and `underruns` counts exactly the chunks that arrived after the scheduled audio had run out. A runner-level unit test checks that the next reply of the Call uses 300 after one underrun. Validates 21.1, 21.2.

## Testing strategy

- **Regression (PGlite, `tests/api/turn.realCall1116.test.ts`)**: the Real_Call_2026_11_16 in Spanish and English through `makePost` and the `Caller` harness, with the Rich_Profile inserted, `NOW` set to Saturday 2026-11-14 19:30 Madrid (so the First_Offer is the next Tuesday at 10:00, said "el martes a las diez"), and three model fakes: `failsWith503(Infinity, …)`, `neverResolves`, `throws429`. Every Turn of this call is a Sure_Reading, so the model fakes must record zero calls; a fourth run sends the same first utterance with three extra unplaceable words, so the model is called and fails, and the reply is the same. Asserted per Turn: the exact reply (computed with `phrases` and checked once against a literal), `complete: false` until the booking, and at the end one booking row `corte-hombre+degradado` from 10:00 to 10:50 on `chair-1`, one Message with outcome `booked`, `modelFailed: false` in the first three runs and `true` in the fourth, and a `turn_fallback` line with `path: "brain"` only for the Turn whose model call failed.
- **Unit tests** for every lexicon list, each FAQ_Entry of the Rich_Profile in both languages, each template's word limits, and the schema's refusals.
- **Performance**: `readUtterance` on the 50 longest pool utterances, each under 20 ms (Requirement 2.6); `readUtterance` plus `decideTurn` under 50 ms (Requirement 19.1).
- **Mutation proofs** (Requirement 15.5): each break is made, the failing property and its shrunk counterexample are recorded below and in `NOTAS-KIRO.md`, and the code is restored.

| Mutation | Expected to fail |
|---|---|
| `say` calls `endWithFallback` again on a 503 | B1, the regression test |
| `matchServices` keeps the first span instead of the longest | B3 ("arreglo de barba" read as barba) |
| Goes_With ignored | B4, the regression test (Service_Choice instead of the combo) |
| `resolveService` sums all but the last part | B5 |
| a negation word ignored | B13 |
| `readWhen` takes the first time instead of the last | B9 (corrections) |
| a digit inside a phone read as a time | B9(b) |
| `firstSlotsFrom` starts at `now` instead of `from` | B7 |
| a Profile_Topic answer built from the model's line | B6, B2 |
| a late model answer written to the state | B8 |
| a yes to a First_Offer emits `createBooking` | B12 |
| tier 6 inserted before tier 3 | B14 |
| the Add_On rule skipped ("un degradado" books the fade alone) | B4, a unit test |
| tie rule 5(a) dropped ("un corte para mi hijo" asks which) | a unit test, B3 |
| `maskPhrases` applied to the today search too ("prueba de alergia para hoy" loses "hoy") | owner-machine M1, a unit test |
| `maskPhrases` removes the whole line instead of the phrase | owner-machine M1, the "reacción" unit test |
| a Sure_Reading still calls the model | B15 |
| the Silence_Cut uses `abort()` | a speech-port unit test (no final arrives) |
| a late final sends a second Turn | B16 |
| the Filler plays when the reply is ready at 600 ms | B17 |
| the same Filler variant twice in a row | B17 |
| the decoder assumes the first line ends inside the first chunk | B18 |
| the Start_Buffer stays 150 after an underrun | B19's runner unit test |

## Open questions

Answered by the reviewer on 2026-11-16:

1. **Model_Wait.** Superseded by the Latency group: no model call on a Sure_Reading, at most 1.6 s otherwise (Requirements 2, 12.2, 19).
2. **Skip the model when the brain is sure.** Yes, in this spec (Requirement 19).
3. **Degradado.** Stays an add-on to a men's cut; "corte degradado" and "un degradado" alone resolve to Corte de hombre + Degradado through `addOnTo` (Requirement 4.10).
4. **"Un corte".** Inferred from the same utterance or earlier Turns (tie rules 5(a)–(c)); asked only when nothing decides it (Requirement 4.4).
5. **Allergy test.** Not urgent: Not_Urgent_Phrases in the pack, real reactions stay urgent (Requirement 16.5).
6. **Old demo bookings.** Accepted: raw ids for up to 7 days.
7. **Prices.** Typical Madrid neighbourhood salon, 2026: the services table, estimates for the owner to read before the seed.
8. **Combo durations are plain sums.** Accepted.
9. **The client's 15-second timeout.** Unchanged.

Open:

10. **A Filler can delay a fast reply.** The Silence_Cut alone takes 600 ms, so a reply is rarely audible by 700 ms after End_Of_Speech, and a Filler will play on most Turns. A sure Turn with a cached reply (~900 ms) then waits for the Filler to end, up to 900 ms of Filler audio: the reply starts at ~1.4–1.6 s instead of ~0.9 s. The requirement is built as written. Options after the first after-numbers: (a) Fillers of at most 500 ms ("Vale…", "Mm…") for the `wait` and `check` kinds; (b) measure the 700 ms from the Silence_Cut instead, which pushes the Filler past the 1.0 s target; (c) a lower `endOfSpeechMs` for the demo shop (400–500 ms), at the risk of cutting slow speakers. Recommendation: (a), decided with the Timing_Panel's numbers.
11. **Interim text accuracy.** The Silence_Cut sends Chrome's latest interim text, which is sometimes less accurate than its final (numbers above all). The merge rule keeps the final for the Transcript and carries extra words, but a corrected word inside the sent text is not re-sent. The Timing_Panel can count Turns whose final differed from the sent text (a count only, no words); if it is high for phones, the port could wait for the final when the next field is the phone.
12. **If live replies miss p50 ≤ 1.5 s.** TTS first audio is Gemini's (0.72 s measured). Next options, not in this spec: start TTS before the database commit (saves the commit time, ~50–100 ms, but a commit conflict changes the reply); cache First_Offers for today and tomorrow (they name a day, but only a few slots exist per day).
13. **The Latency_Script writes to the database.** Against the deployed demo it creates Calls and Messages on the demo shop (they leave the tape after 24 h by demo retention). It is an owner step; Kiro runs it only against `next dev` with PGlite or a local database, if the owner provides one.

Opened by task 1 (2026-11-16), for the owner:

14. **The model list.** The docs say `gemini-3.5-flash` is deprecated and routed to `gemini-3.6-flash`, and the spike's two current defaults both answered as `gemini-3.5-flash-lite` (`gemini-flash-lite-latest` is an alias of it today). Proposal for task 7.2: `gemini-3.5-flash-lite, gemini-3.6-flash`, and keep `gemini-flash-lite-latest` third only if task 7.1 shows it answering when the first one fails. Each entry would then be a different model, so one model's 503 burst does not hit every attempt. `gemini-3.6-flash` defaults to `medium` thinking and is the slower family; the request sends `low`, and task 7.1 measures it. Requirement 12 names the list; until the owner answers, task 7 is built as written with `gemini-3.5-flash`, which works today through the routing.
15. **Safari and the first JSON line.** The bundled Next.js streaming guide says Safari buffers a streamed response until 1024 bytes have arrived. If that also holds for a `fetch` body reader, the reply's text line (well under 1 KB) waits for the first audio bytes on iPhone. Options: (a) measure first, on a real iPhone, with the Timing_Panel; (b) pad the first line to 1024 bytes with spaces after the JSON (the decoder ignores them; costs 1 KB per Turn). Recommendation: (a), then (b) only if the panel shows it.
16. **Fillers from `blob:` URLs on iPhone.** No doc says that a `blob:` URL on the unlocked shared element plays without a new gesture on Safari iOS; plain cache URLs do (owner's call, 2026-11-16). Proposal: task 20 keeps the blob preload and, when `play()` on a blob URL rejects, plays the same Filler from its plain cache URL once. A checklist line in task 14 confirms which path a real iPhone took.

Opened by task 7.1 (2026-11-16), for the owner:

17. **The model path constants.** *Decided by the owner on 2026-11-16 18:40 (see "Owner decision" under "As built in task 7"): two models, 2.4 s, 1.2 s, 400 ms, 2 attempts; built in task 7.2 and 7.3.* The measurement met both stop conditions (see "As built in task 7"). Of 15 requests to `gemini-3.5-flash-lite`, 5 failed and 3 answered under 1.6 s. `gemini-3.5-flash` answered 1 of 15. The decisions the owner needs to make:
    - (a) **The third model.** Drop `gemini-3.5-flash` (1 of 15 answered, and the 429 suggests a small quota), or replace it with `gemini-3.6-flash` and measure it first (open question 14).
    - (b) **Measure again at a quieter hour** (45 requests, or 30 without the third model) before choosing `ATTEMPT_TIMEOUT_MS`. Today's run overlapped the demo's all-models failure window.
    - (c) **The clamp.** With a 1600 ms Model_Wait and `MIN_ATTEMPT_MS` 400, a hedge starts by deadline only when `ATTEMPT_TIMEOUT_MS` ≤ 1200. Lower the clamp to [900, 1200], or accept that above 1200 the first attempt keeps the whole Model_Wait and only a fast 5xx starts a second one.
    - (d) **The order of the list.** `gemini-flash-lite-latest` answered 13 of 15 and `gemini-3.5-flash-lite` 10 of 15, though both reach the same model today.

    Recommendation: (a) drop the third model for now; (c) clamp to [900, 1200]; (b) measure again tomorrow morning with the two lite ids. With today's numbers, rule (c) gives 1200 ms. If the owner accepts these numbers instead of a new run, the rule's stop condition is overruled and the owner says so.

    **Deploy note:** a 1.6 s Model_Wait before task 9 lands would make today's `handleTurn` end more Calls with the Fallback_Message. Task 7's constants should reach the deployed demo together with task 9, not before.
