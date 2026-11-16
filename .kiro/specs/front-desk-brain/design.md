# Design Document: Front Desk Brain

## Overview

On 2026-11-16 a real caller said "Hola Lola quería cortarme el pelo y hacerme un degradado" and heard the Fallback_Message, because Gemini answered 503 after 6.6 s and the code had nothing else to say. This spec gives the Conversation_Core a second reader, the **Code_Brain**: pure rules that turn the caller's words into the same kind of facts the model gives, so `decideTurn` and the Booking_Rules can finish the Turn without the model.

The design rests on one observation about the code as it is: `decideTurn` already decides every fact. The model contributes three things only: what it heard (intent, service words, day, time, name, phone, yes, goodbye), a free line for questions and small talk, and a one-line reason for the Owner. The Code_Brain replaces the first with rules, replaces the second with templates from the Shop_Profile, and builds the third by code. Everything after that (merging fields, the Booking_Rules, read-back, confirmation, writes, the Message) is the code that already runs and is already tested.

Four other changes ride on it:

1. **Service_Combos.** "Corte y degradado" becomes one booking with the Combo_Id `corte-hombre+degradado`. The Booking_Rules resolve a Combo_Id to one service of the summed duration, so every existing rule and property applies to it unchanged, and one booking row keeps the "one Booking per Call" index and the no-overlap constraint as they are. No migration.
2. **The First_Offer.** Once the services are known, the code offers the nearest free slot instead of asking "¿qué día y a qué hora?". That is what turns the regression call into one "sí".
3. **A Rich_Profile.** Nineteen services with aliases, prices and durations, five Categories, and fourteen FAQ_Entries, all validated by the profile schema.
4. **A short Model_Wait.** The model gets at most 2.6 s, a third default model, and attempt deadlines chosen from a new measurement. The Code_Brain's answer is computed before the model is called, so a late model costs the caller the wait and nothing else.

### Working beside the other specs

- **core-call-loop**: requirements 4.6, 4.7 and the "ask day and time" step of the booking flow are amended (requirements.md, "Amendments"). Its properties P1–P9 and S1–S8 stay as they are; P1–P9's shop generator gains Combo_Ids, and S2's generator gains brain facts. Neither change touches an assertion.
- **natural-voice**: the Cache_Plan gets a sixth tier appended after tier 5 (Requirement 14). Tiers 1–5 stay byte-identical for the same profile, which Property B14 checks.
- **owner-machine**: the spec files are never edited. Two owner-side helpers learn to name a Combo_Id (`serviceName` in `lib/owner/machineShop.ts`, the label in `lib/owner/agenda.ts`), through the same catalog helper the Receptionist uses. The `fallback` outcome stays reachable through the per-visitor rate limit, so owner-machine's end-of-Call urgency tests keep a real fallback path to run on.
- **jury-polish**: its tasks 4.3 (N15 tolerance) and the suggested-reply language defect are not duplicated here. Its task 8 also edits `cachePlan.ts`; whichever lands second re-reads the file first.

## Where current documentation changed my first choice

The design session could not run a shell (every `execute_bash` call failed at its permission step), so nothing below has been checked yet. Each point a finding could change is marked *(check in 1.x)*; task 1 fills in this table before any code.

| Area | What to check | Source | Finding | What it changed |
|---|---|---|---|---|
| Gemini models | `gemini-3.5-flash`: exact id, GA or preview, free-tier RPM and RPD, whether it accepts `thinking_level: "low"` and ignores sampling parameters like the 3.6+ models *(check in 1.1)* | Gemini API models and rate-limits pages, `@google/genai` 2.32 types | | |
| SDK abort | The top-level `signal` still aborts within ~50 ms at the shorter Model_Wait (measured 2026-11-11 at 50 ms) *(check in 1.2)* | a throwaway script against the real API, one call per model | | |
| Chrome speech | How Chrome's `es-ES` recognition writes times, numbers and phones ("a las 5", "17:00", "612 34 56 78") *(check in 1.3)* | no official doc; the owner's real transcripts in jury-polish's Real_Call_Cases ("las 4:00 de la tarde", "a las 17") and the Web Speech API spec | | |
| fast-check | `fc.mixedCase`, `fc.shuffledSubarray`, `fc.uniqueArray` in the installed version *(check in 1.4)* | `node_modules/fast-check` README and types | | |
| Demo facts | Nearest metro stations to Calle Mayor 12 (Sol, Ópera) and the public car park at Plaza Mayor, before they go into FAQ answers *(check in 1.5)* | Metro de Madrid and Madrid city council pages | | If they cannot be checked, the FAQ answers use neutral wording ("hay parkings públicos cerca") and no station names |
| Next.js | Nothing in the route changes shape; confirm `after()` and the route's default runtime are unchanged in the installed version *(check in 1.6)* | `node_modules/next/dist/docs/` | | |

## Architecture

```mermaid
sequenceDiagram
    participant B as Browser (voice adapter)
    participant H as handleTurn (say)
    participant R as Code_Brain (pure)
    participant M as callReceptionist (model)
    participant D as decideTurn + Booking_Rules
    participant DB as Repository

    B->>H: say(utterance)
    H->>DB: rate limits, load Call
    H->>R: readUtterance(utterance, state, shop, pack, now)
    R-->>H: Reading (sync, < 20 ms)
    par
        H->>M: model call, Model_Wait 2.6 s
    and
        H->>DB: bookings read (when the times are already known)
    end
    alt valid model answer in time
        M-->>H: ModelTurn
        H->>H: factsFromModel(turn, reading)
    else failure, late, or global limit
        H->>H: factsFromReading(reading); log turn_fallback path "brain"
    end
    H->>D: decideTurn(facts, reading, existing bookings)
    D-->>H: Decision (reply template or model line, effects)
    H->>DB: commit (as today, with the 23P01 retry loop)
    H-->>B: reply, complete only on a real end
```

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
| `lib/receptionist/cachePlan.ts` | pure | tier 6 |

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
5. **Candidates.** A span whose entry belongs to several services (the shared generic "corte", "cortarme el pelo", "haircut") is a tie. A tie is broken by Goes_With: if exactly one candidate lists, or is listed by, another service matched in the same utterance, it wins. Otherwise the request is a Service_Choice. A span on a Category is a Category request.
6. **Mode.** An addition word before the first span ("y también", "además", "also", "plus", "and a") makes the mode `add`; otherwise `replace`.
7. **Result.** Unique ids in said order, at most 3 (a fourth is dropped and the reply says the most is three). The Combo_Id puts them in catalog order.

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

## handleTurn

`say` keeps its shape. The changes, in order:

1. `overLimit` returns which limit was hit. The per-visitor limit keeps `endWithFallback` (outcome `fallback`, Requirement 1.4). The global hourly limit sets `skipModel`.
2. `const reading = readUtterance({ utterance, state, shop, pack, now, lang })`, synchronous.
3. If the times involved are known from the state or the Reading, the bookings read starts now (a promise awaited before `decideTurn`).
4. Unless `skipModel`, `callReceptionist(deps.model, prompt, { timeoutMs: deps.config.modelTimeoutMs, onFailure })`. `callReceptionist` already races its own deadline and aborts every attempt when it settles, so a late model answer is dropped by construction (2.4).
5. `facts = result.ok ? factsFromModel(result.turn, reading, shop) : factsFromReading(reading)`. On the brain path for any reason except `skipModel`, one `turn_fallback` line with `path: "brain"`, and `state.modelFailed = true`, `brainTurns += 1`.
6. The bookings read and the commit loop as today, with `decideTurn({ facts, reading, ... })`.

`endWithFallback` is no longer called for a model failure; the `retry` path, `maxConsecutiveInvalid` and the `fallbackRetry` line are removed from `say`. `CoreConfig.maxConsecutiveInvalid` stays in the type for one release (the harness sets it), marked deprecated, and is removed in the cleanup task.

## Model path constants

Proposed, to be confirmed by the measurement of task 7:

| Constant | Today | Proposed | Why |
|---|---|---|---|
| `MODEL_TIMEOUT_MS` (Model_Wait) | 8000 | 2600 | the caller hears a reply within ~3 s including the database reads (Neon HTTP adds 0.2–0.4 s per Turn) |
| `ATTEMPT_TIMEOUT_MS` | 2500 | from the rule below, 1200–2000 | a hedge must start early enough to answer inside 2.6 s |
| `MIN_ATTEMPT_MS` | 1500 | 700 | a hedged attempt with less than 0.7 s left cannot answer; measured healthy latencies are 1.0–1.5 s |
| `MAX_MODEL_ATTEMPTS` | 4 | 3 | one per default model; more cannot fit in 2.6 s |
| `DEFAULT_GEMINI_MODELS` | 2 ids | `gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.5-flash` | the owner's measurement of 2026-11-16: 1.35 s, 1.0 s, 1.5 s; `gemini-flash-latest` 503; 2.5 models 404 |

**The rule for `ATTEMPT_TIMEOUT_MS`:** run `scripts/check-turn.ts --repeat 15` once per default model (45 requests, under every model's free daily limit as checked in 1.1), at a time the owner chooses. Take the 90th percentile of the successful latencies of the first model, round it up to the next 100 ms, and clamp it to [1200, 2000]. Record the raw numbers, the percentile and the result in "As built in task 7". If more than 1 in 5 requests of the first model fail, stop and ask the owner before choosing (the order of the list may need to change instead).

## New templates

All in Spoken_Form, at most 3 sentences of at most 25 words, with Phrase_Variants where the line is frequent. Spanish shown; English has a twin of each.

| Template | Example (Rich_Profile) | Cacheable |
|---|---|---|
| `firstOffer(id, slot)` | "Un corte de hombre y un degradado son cincuenta minutos y veinticuatro euros. ¿Te viene bien el martes a las diez? Si prefieres otro día, dímelo." | yes |
| `askService()` | "Claro. Hacemos cortes, barbería, peinados, color y tratamientos. ¿Qué te quieres hacer?" | yes |
| `askServiceChoice(candidates)` | "¿El corte es de mujer, de hombre o infantil?" | yes |
| `topicAnswer(hours)` | "Abrimos de martes a sábado, de diez de la mañana a dos de la tarde y de cinco a ocho de la tarde. Lunes y domingo cerramos." | yes |
| `topicAnswer(hours, day)` | "El sábado abrimos de diez a dos y de cinco a ocho." | yes |
| `topicAnswer(hours, now)` | "Ahora mismo estamos cerrados; abrimos mañana a las diez." | yes (has a day, so not in tier 6) |
| `topicAnswer(address)` | "Estamos en la calle Mayor doce, en Madrid." | yes |
| `topicAnswer(price, service)` | "Por un corte de hombre son dieciséis euros, y se tarda media hora." | yes |
| `topicAnswer(price, choice)` | "El corte de mujer son veintiocho euros, el de hombre dieciséis y el infantil doce." | yes |
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

The prices are said with "Por {servicio} son {precio}" and "{servicio} lleva {duración}" so no verb has to agree with a plural spoken name ("unas mechas"). A part priced "from" makes the price "desde {precio}". A template whose line would pass 25 words in one sentence splits at the clause the template marks, never mid-name (the rule `readBack` already follows).

## The Shop_Profile schema

```ts
const Id = z.string().regex(/^[a-z][a-z0-9-]{0,59}$/);
const SpokenAnswer = z.string().trim().min(1).max(300)
  .refine((s) => !/\d/.test(s), "Spoken_Form: no digits")
  .refine((s) => !/[*_#`~<>[\]{}|]/.test(s) && !EMOJI.test(s), "no markup or emoji")
  .refine((s) => sentences(s).length <= 2 && sentences(s).every((x) => words(x) <= 25), "1–2 sentences of ≤ 25 words");

ServiceSchema += { id: Id, category: Id.optional(), goesWith: z.array(Id).max(10).optional(), priceFrom: z.boolean().optional() };
CategorySchema = z.strictObject({ id: Id, name: Localized, aliases: z.array(z.string().min(1).max(60)).max(20).optional() });
FaqEntrySchema = z.strictObject({
  id: Id.refine((id) => !BUILT_IN_TOPICS.has(id), "reserved topic id"),
  aliases: z.strictObject({ es: z.array(Alias).min(1).max(30), en: z.array(Alias).min(1).max(30) }),
  answer: z.strictObject({ es: SpokenAnswer, en: SpokenAnswer }),
});
ShopProfileSchema += { categories: z.array(CategorySchema).max(12).optional(), faq: z.array(FaqEntrySchema).max(40).optional() }
  .refine(every category and goesWith id exists)
  .refine(FAQ ids unique; FAQ aliases unique across entries and different from every Service_Alias and Category alias, after normalization);
```

The id pattern accepts every id stored today (`haircut`, `colour`, `beard`, `chair-1`), so stored profiles still parse.

## The Rich_Profile

Peluquería Lola keeps its id, owner, address, Time_Zone, hours (Tuesday to Saturday, 10:00–14:00 and 17:00–20:00), two chairs, voice and speech rate. Prices and durations are my estimate of a mid-range Madrid salon in 2026 (open question 7).

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

| id | es / en | min | € | from | category | goes with | own aliases (besides the shared ones) |
|---|---|---|---|---|---|---|---|
| `corte-mujer` | Corte de mujer / Women's cut | 45 | 28 | | cortes | | corte de mujer, corte de señora, corte de chica, cortar las puntas, sanear las puntas, las puntas, women's cut, ladies' cut, trim |
| `corte-hombre` | Corte de hombre / Men's cut | 30 | 16 | | cortes | degradado, barba, arreglo-barba | corte de hombre, corte de caballero, corte de chico, men's cut, gents' cut |
| `degradado` | Degradado / Fade | 20 | 8 | | barberia | corte-hombre | degradado, degradado a cero, degradado bajo, fade, skin fade, low fade, feid, taper |
| `corte-infantil` | Corte infantil / Kids' cut | 25 | 12 | | cortes | | corte infantil, corte de niño, corte de niña, para mi hijo, para mi hija, para el niño, kids' cut, child's cut, for my son, for my daughter |
| `barba` | Barba / Beard shave | 25 | 12 | | barberia | corte-hombre | barba, afeitado, afeitar, afeitarme, toalla caliente, shave, hot towel shave, beard |
| `arreglo-barba` | Arreglo de barba / Beard trim | 15 | 7 | | barberia | corte-hombre | arreglo de barba, arreglar la barba, arreglarme la barba, perfilar la barba, recortar la barba, beard trim, trim my beard |
| `lavar-peinar` | Lavar y peinar / Wash and blow-dry | 30 | 18 | | peinados | | lavar y peinar, lavado y peinado, peinar, peinarme, secar, brushing, blow dry, blow-dry, blowout |
| `peinado-evento` | Peinado de evento / Event styling | 60 | 40 | | peinados | | peinado de evento, peinado de fiesta, peinado de invitada, peinado para una boda, event hair, party hair, wedding guest hair |
| `peinado-novia` | Peinado de novia / Bridal hair | 120 | 150 | yes | peinados | | peinado de novia, novia, me caso, bridal hair, bride |
| `recogido` | Recogido / Updo | 45 | 35 | | peinados | | recogido, moño, updo, bun |
| `tinte-raiz` | Tinte de raíz / Root colour | 75 | 35 | | color | | tinte de raíz, retoque de raíz, raíces, raíz, tapar las canas, canas, root colour, root touch-up, roots, grey coverage |
| `tinte-completo` | Tinte completo / Full colour | 105 | 48 | yes | color | | tinte completo, tinte, teñir, teñirme, teñirse, pintar el pelo, pintarme el pelo, full colour, full color, dye, hair dye |
| `mechas` | Mechas / Highlights | 150 | 65 | yes | color | matiz | mechas, mechitas, reflejos, highlights, foils |
| `balayage` | Balayage / Balayage | 180 | 95 | yes | color | matiz | balayage, babylights, ombré, mechas californianas |
| `matiz` | Matiz / Toner | 30 | 20 | | color | mechas, balayage, decoloracion | matiz, matizar, baño de color, toner, gloss |
| `decoloracion` | Decoloración / Bleaching | 150 | 70 | yes | color | matiz | decoloración, decolorar, aclarar el pelo, bleach, bleaching, lighten my hair |
| `keratina` | Alisado de keratina / Keratin smoothing | 150 | 110 | yes | tratamientos | | alisado de keratina, keratina, alisado, alisar, alisado brasileño, keratin, smoothing |
| `hidratante` | Tratamiento hidratante / Hydrating treatment | 30 | 22 | | tratamientos | | tratamiento hidratante, hidratación, mascarilla, hydrating treatment, deep conditioning |
| `permanente` | Permanente / Perm | 120 | 60 | | tratamientos | | permanente, ondas, rizos, ondular, perm, waves, curls |

Every combination of up to three services whose sum is at most 240 minutes can fit the morning session; the longest single service (balayage, 180 min) fits either session. The Real_Call_2026_11_16 resolves to `corte-hombre+degradado`: 50 minutes, 24 €.

### FAQ_Entries

Answers in Spoken_Form (no digits). Spanish shown; each has an English twin of the same content. Station and car park names wait for check 1.5.

| id | Spanish aliases (sample) | English aliases (sample) | Spanish answer |
|---|---|---|---|
| `pago` | pagar con tarjeta, bizum, efectivo, formas de pago, cómo se paga | pay by card, payment, cash, bizum | "Puedes pagar con tarjeta, con Bizum o en efectivo." |
| `parking` | aparcar, parking, aparcamiento, dónde dejo el coche | parking, park the car | "No tenemos aparcamiento propio, pero hay un parking público en la plaza Mayor, a dos minutos andando." |
| `accesibilidad` | silla de ruedas, escalones, accesible, carrito | wheelchair, step-free, accessible, stroller | "Sí, el local está a pie de calle, sin escalones, y entra bien una silla de ruedas." |
| `sin-cita` | sin cita, sin reserva, pasarme sin cita, ir directamente | walk in, without an appointment, drop in | "Si hay un sillón libre te atendemos sin cita, pero con cita te aseguras el hueco." |
| `cancelacion` | anular con antelación, política de cancelación, si no puedo ir, penalización | cancellation policy, cancel fee, if I can't make it | "Puedes cambiar o anular tu cita sin coste hasta veinticuatro horas antes, llamando a este mismo número." |
| `llegar-antes` | cuánto antes llego, llegar antes, con cuánta antelación | how early, arrive early | "Con llegar cinco minutos antes es suficiente." |
| `ninos` | niños, críos, hacéis a niños, peques | kids, children, do you cut children | "Sí, cortamos a niños y niñas de cualquier edad; el corte infantil es hasta los doce años." |
| `productos` | vendéis productos, champú, comprar productos, mascarillas para casa | sell products, shampoo, buy products | "Sí, vendemos champús, mascarillas y productos de peinado de las marcas que usamos en el salón." |
| `bono-regalo` | tarjeta regalo, bono regalo, regalar, vale regalo | gift voucher, gift card, gift certificate | "Sí, tenemos tarjetas regalo del importe que quieras; se compran en la peluquería." |
| `prueba-alergia` | prueba de alergia, prueba de sensibilidad, test de alergia, prueba del tinte | allergy test, patch test, skin test | "Para cualquier tinte necesitamos una prueba de alergia cuarenta y ocho horas antes. Es gratis y solo lleva cinco minutos." |
| `hombres` | hacéis a hombres, cortáis a hombres, para chicos, sois unisex | do you do men, men's hair, unisex | "Sí, claro, hacemos cortes de hombre, degradados y barba." |
| `ingles` | habláis inglés, atendéis en inglés | do you speak English, English-speaking | "Sí, te podemos atender en inglés, y si quieres seguimos esta llamada en inglés." |
| `wifi` | wifi, internet, red | wifi, wi-fi, internet | "Sí, hay wifi gratis para clientes; la clave te la damos en el salón." |
| `como-llegar` | cómo llego, metro, autobús, cómo se llega, transporte | how do I get there, metro, subway, bus, public transport | "Estamos en la calle Mayor, a cinco minutos andando de las estaciones de metro de Sol y Ópera." |

"How long does colour take" is not an FAQ_Entry: "¿cuánto tarda el color?" is a duration question on the `color` Category, answered from the catalog (Requirement 11.5).

The `ingles` entry also sets `wantsLanguage: "en"` when the question is asked in Spanish and the shop offers English; the answer is then followed by `languageSwitched()` in English. The FAQ alias `prueba de alergia` contains the urgent term "alergia"; by Requirement 9.7 the answer is given and no Sensitive_Hit is raised, but owner-machine's Urgency_Rules still read the Caller's line and mark the Message urgent (open question 5).

## The Cache_Plan's tier 6

Appended after tier 5 in `cachePlan`, built for each language with a chosen voice, deduplicated against tiers 1–5 like every tier:

- every new Fixed_Phrase of this spec, every variant;
- `topicAnswer` for `address`, `services`, each FAQ_Entry, each service's price, each Service_Choice the profile can produce, each Category's durations;
- `askServiceChoice` for each choice;
- `firstOffer` is not in tier 6: it names a day.

Not pinned (it can be evicted like tiers 3–5). The task measures its size for the Rich_Profile and compares it with the Voice_Cache budget (`voiceCacheBudget.ts`) before building any audio (Requirement 14.3).

## Error handling and logging

| Situation | What the Caller hears | Call | Log |
|---|---|---|---|
| model `timeout` (Model_Wait passed) | the Code_Brain's reply | goes on | `turn_fallback`, `path: "brain"`, reason `timeout`, attempts, latency |
| model 5xx with no attempt left | the Code_Brain's reply, at once | goes on | the same, with status and error class |
| model 429 | the Code_Brain's reply, at once | goes on | the same, reason `quota` |
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

**B8. The brain answers by the Model_Wait, and a late model changes nothing.** With fake timers: *for all* Model_Waits `W` in [100, 3000] ms and model behaviours with an event time `t` in [0, 5000] ms (a valid answer, a 503, a 429, invalid output, a hang): the Turn resolves at `min(t, W)` for a failure and at `t` for a valid answer with `t ≤ W`, else at `W` (within one timer tick); the Turn_Source is `model` iff a valid answer came at `t ≤ W`; and after a late valid answer settles, the stored Call state equals the state of the brain's Decision. `numRuns: 100`. Validates 2.2–2.4.

**B9. Days and times are read as said, and only when said.** *For all* shop session sets, todays (both DST weekends), dates within 14 days, times on the 5-minute grid inside the sessions, and forms (the Receptionist's own `speakDay` and `speakTime` words; digits "a las H", "H:MM", "H.MM", "Hh" with and without a period; English forms): `readWhen` returns that date and time; "X, no, Y" returns Y. *And for all* utterances from the non-time pool (prices, phones, durations, "una cita", "dos servicios", names): `readWhen` returns no day and no time. Validates 5.1–5.3, 5.5, 5.7.

**B10. Names and phones are read as said.** *For all* names from a pool (1–4 words, with accents and compound surnames) and cue frames: `readName` returns the name; in "Hola {ownerName}, …" frames with no cue it returns null. *For all* valid Spanish mobile numbers and groupings into 1–3-digit groups, said as digits or as number words (`speakNumber`, "cero" for a leading zero), with random separators and an optional "+34" or "más treinta y cuatro": `readPhone` returns the E.164 number. Validates 6.1–6.4.

**B11. Owner requests and unanswered questions keep the Call alive and reach the Owner.** *For all* brain-only conversations with 1–3 Owner_Requests, off-profile questions or Sensitive_Hits at random positions, ending with a goodbye: every such Turn returns `complete: false` with the matching Keep_Alive_Line; the Call records one Owner_Note per such Turn (at most 5); the final Message has outcome `message` unless a booking, reschedule or cancel was confirmed, and its reason lists the notes after the main reason. `numRuns: 100`. Validates 10.1–10.6.

**B12. An accepted offer is not a booking.** *For all* conversations on both Turn_Sources: a `createBooking` or `reschedule` effect occurs only in a Turn whose previous reply was a read-back and whose facts say yes with no change; a yes to a First_Offer or an alternative only sets the requested time. (S2 with brain facts and offers in its generator.) Validates 8.4, 13.5.

**B13. Negation, addition and replacement.** *For all* current Service sets `A` (0–3 ids), services `b` and frames: "sin {b}" / "no quiero {b}" leaves `A` unchanged and never requests `b`; "y también {b}" gives `A ∪ {b}` (capped at 3, with `tooManyServices` past it); "{b}" alone gives `{b}`. Validates 4.6, 4.7, 7.8.

**B14. Tier 6 only appends.** *For all* shops and todays and languages: the plan's lines of tiers 1–5, in order, equal the plan built with tier 6 switched off; every tier-6 line is cacheable and equals a line `phrases(...)` really says; keys are unique. `numRuns: 30`, with the 120 s timeout N17 uses. Validates 14.2.

## Testing strategy

- **Regression (PGlite, `tests/api/turn.realCall1116.test.ts`)**: the Real_Call_2026_11_16 in Spanish and English through `makePost` and the `Caller` harness, with the Rich_Profile inserted, `NOW` set to Saturday 2026-11-14 19:30 Madrid (so the First_Offer is the next Tuesday at 10:00, said "el martes a las diez"), and three model fakes: `failsWith503(Infinity, …)`, `neverResolves`, `throws429`. Asserted per Turn: the exact reply (computed with `phrases` and checked once against a literal), `complete: false` until the booking, and at the end one booking row `corte-hombre+degradado` from 10:00 to 10:50 on `chair-1`, one Message with outcome `booked`, `modelFailed: true`, and a `turn_fallback` line per Turn with `path: "brain"`.
- **Unit tests** for every lexicon list, each FAQ_Entry of the Rich_Profile in both languages, each template's word limits, and the schema's refusals.
- **Performance**: `readUtterance` on the 50 longest pool utterances, each under 20 ms (Requirement 2.5).
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

## Open questions

1. **The 2.6 s Model_Wait.** The owner asked for "about 3 s". Neon's HTTP reads add 0.2–0.4 s per Turn, so 2.6 s keeps the server's answer near 3 s. A shorter wait (2.0 s) would give more Turns to the brain on slow days. Recommendation: 2.6 s, revisited after a week of `turn_fallback` lines.
2. **Skip the model when the brain is sure.** A yes or no to a read-back, a phone or a name alone, or an FAQ hit alone gain nothing from the model: skipping it saves ~1 s and the free-tier quota. Not in this spec, because it changes how the call sounds on good days. Recommendation: a follow-up spec once B1–B14 are green.
3. **Degradado as an add-on.** The profile treats the fade as a 20-minute add-on to a men's cut, so "corte y degradado" is a real combination, as the owner asked. Many barbers sell "corte degradado" as one service. Data only; the owner chooses.
4. **"Un corte" asks which.** A plain "corte" asks "¿de mujer, de hombre o infantil?". This costs one Turn in the demo, and the demo script (`check-turn --conversation`) will need the extra answer. The alternative (assume women's cut) would misprice half the calls. Recommendation: ask.
5. **The allergy-test question marks the Message urgent.** owner-machine's Urgency_Rules match the whole word "alergia" in any Caller line. This spec cannot change owner-machine; the false positive is accepted, or owner-machine later gets an exception list.
6. **Old demo bookings.** Bookings with `haircut`, `colour` or `beard` show their raw id on the Agenda until demo retention deletes them (7 days). Keeping those ids as hidden services would avoid it at the cost of three dead catalog entries. Recommendation: accept the 7 days.
7. **Prices and durations** of the Rich_Profile are estimates, not measured. The owner should read the services table once before the seed runs on Neon.
8. **Combo durations are plain sums.** Real salons overlap work (a toner while a colour processes). The sum never double-books; a `combos` override in the profile could come later.
9. **The client's 15-second timeout** (core-call-loop 2.10) still ends a Call. With the Model_Wait at 2.6 s it can only fire on network or database trouble. Unchanged here.
