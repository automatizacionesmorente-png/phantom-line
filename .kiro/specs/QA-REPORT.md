# QA report, 2026-11-16 (reviewer acting as a strict Kiroween judge)

Scope: the deployed demo <https://phantom-line-nine.vercel.app> at commit `21f1ad5` (branch `qa-review`), read against the steering, the five specs, `README.md` and `NOTAS-KIRO.md`. Five criteria at 20 % each: Impact, Technical implementation and Kiro use, Design, Innovation, Presentation. "Cost" is my estimate of the points a strict judge takes off, out of 100.

No app code or test was changed. Evidence files are in the git-ignored `.measurements/` folder of this worktree.

## How it was exercised

| What | Command | Raw output |
|---|---|---|
| Pages: `/`, `/call/peluqueria-lola`, `/machine/peluqueria-lola`, an unknown shop, `/robots.txt`, `/favicon.ico`, `/opengraph-image`, `/icon.svg` | `node .measurements/qa/judge-calls.mjs --pages` | `.measurements/qa/page_*.html` |
| 6 scripted calls over `/api/turn` (3 ES, 3 EN; no `/api/speech`) | `node .measurements/qa/judge-calls.mjs --calls` | `.measurements/qa/judge-*.json` |
| Latency, Spanish and English | `node --import tsx ../phantom-line/scripts/measure-latency.ts --base=https://phantom-line-nine.vercel.app --allow-remote --lang=es\|en --legacy` | `.measurements/latency/2026-11-16-before*.json` |
| The owner's machine with the PIN shown on the landing (198000), read only | `node .measurements/qa/machine-poll.mjs` | `.measurements/qa/poll.json` |

Method notes:
- `scripts/measure-latency.ts` is not in this branch. It exists only, uncommitted, in `~/Projects/phantom-line`. Its default sends `audio: "inline"`, which the deployed `/api/turn` rejects with 400 (`TurnRequestSchema` is a `strictObject`). The first Spanish run therefore failed 4 of 8 `say` Turns, and those 4 Calls stayed open; they account for 4 of the "Llamada sin terminar" messages now on the demo tape (15:17:36–15:17:57 UTC). The figures below come from the `--legacy` runs, which had no errors.
- `web_fetch` and `curl` were blocked in this session, so pages were fetched with Node's `fetch`. I had no real browser, so I could not check mobile layout at 375 px, rendered contrast or a screen reader on the live site. Those are listed as not verified, not as passing.

## Measured on the live demo

Latency (`--legacy`, Turns spaced 6 s):

| | `say` reply p50 / p90 / max | first audio byte p50 / p90 / max | Errors |
|---|---|---|---|
| Spanish (7 `say`) | 3446 / 7414 / 7414 ms | 4064 / 8041 / 8041 ms | 0 of 12 |
| English (7 `say`) | 2163 / 4212 / 4212 ms | 2818 / 4884 / 4884 ms | 0 of 12 |
| My 6 scripted calls (21 `say`) | about 3.4 s / 4.7 s / 6.5 s | not measured | 0 |

The 6 scripted calls, in brief (full text in the JSON):

| Call | What the caller did | What happened |
|---|---|---|
| es-faq | "¿hacéis manicura?", "¿tenéis aparcamiento cerca?" | Manicure: "No hacemos manicura" (true, it is not in the catalog). Parking: **"No tenemos aparcamiento propio"**, which is invented. Each answer adds "se lo dejo apuntado a Lola para que te llame", but no name or phone was asked. |
| es-two-services | "cortarme el pelo y hacerme un degradado el martes a las diez" | **Booked only a 30-minute haircut.** The fade was dropped without a word. The tape's reason says "Corte de pelo con degradado para mañana a las diez". |
| es-lola | "Quiero hablar con Lola" | "Lola verá tu mensaje y te llama". The phone is never asked, so the Message has `callerPhone: null` and its reason is "El cliente se despide." |
| en-price | haircut, then colour | Both prices are right and the dates are spoken well. Replies took 6.5 s and 6.3 s. |
| en-nonsense | "purple monkey dishwasher banana" twice | Twice, word for word: "I am Peluquería Lola's virtual assistant and Lola will see the message." The Call left an outcome `message` on the tape. |
| en-reschedule | moves the es-two-services booking | Works end to end: the name and phone match is required, the read-back is right, and the Agenda moved the booking to Wednesday 11:00. |

What the owner's machine shows (from the Poll): **47 new, 47 unheard. 39 of the 47 are `abandoned`**, most with the reason "Llamada sin terminar" and no name. Of the 47, 4 were left by my failed measurement run and about 10 by my other test calls; the rest were already there.

---

## Defects, ranked by cost

### 1. The live demo invents a shop fact (cost: 5; Impact, Technical)
- Evidence: es-faq, Turn 2. `POST /api/turn {"kind":"say","utterance":"¿Y tenéis aparcamiento cerca?",…}` returned `"No tenemos aparcamiento propio. Se lo dejo apuntado a Lola para que te llame."` with `cacheable: false`, so these are the model's own words. `lib/db/seed.ts:22-75` (`lolaSeedProfile`) has no parking information at all.
- Why it costs: the first product principle is "Never invent information about the shop", and the README promises "the model proposes; plain TypeScript decides". A judge who asks one question outside the catalog sees that promise broken.
- Coverage: front-desk-brain adds a parking FAQ (11.5) and makes a covered topic use the code's answer (9.3). On the model path, a question **no** Profile_Topic covers is still answered with the model's own words. New: BACKLOG 12.
- Fix: when the model sets `outOfProfile`, or answers a question for which the Code_Brain finds no Profile_Topic, speak the Keep_Alive template ("Eso no lo sé, pero se lo apunto a Lola…"), never the model's text. Add a property: no reply on the model path states a fact that is neither in the profile nor a template.

### 2. The Kiro story has gaps a judge reads first (cost: 5; Kiro use, Presentation)
- `NOTAS-KIRO.md`: the rows for Hooks, MCP, Property-based tests and Crew / powers are empty placeholders (`| | Hooks | | |`), and rows are out of date order (2026-11-11 rows come after 2026-11-12 ones).
- Hooks: `.kiro/hooks/booking-properties.json` uses `"trigger": "PostFileSave"` and `"PreToolUse"`. I believe Kiro IDE hooks are `*.kiro.hook` files with a `when.type` such as `fileEdited`, but I could not check the docs (web access blocked), so treat this as unverified. There is no record yet that any hook fired. The `session-brief` hook did fire at the start of this session: its output, "core-call-loop: 12/13 tasks, next: 12…", is real evidence ready to quote.
- MCP: `.kiro/settings/mcp.json` lists only Context7, and nothing shows what it changed.
- `README.md`: "How it was built with Kiro" links only `core-call-loop`. It does not link the owner-machine, natural-voice, front-desk-brain or jury-polish specs, the hooks, the CI or the demo URL.
- Coverage: jury-polish tasks 1.2, 2, 3, 14 and 16. Only the date order and the placeholder rows are new: BACKLOG 18.
- Fix: do jury-polish 2 (hook evidence) and 14 (README) before anything cosmetic. Quote the session-brief output from this session.

### 3. The demo tape is 47 "new" messages, 39 of them empty (cost: 4; Design, Impact)
- Evidence: `GET /api/machine/peluqueria-lola` after login gives `counts {"new":47,"unheard":47}`. Most items read `normal abandoned | null | Llamada sin terminar | Nada acordado; colgó antes de terminar`.
- Why it costs: the promise is "owners must understand a message in under 10 seconds", but a judge opening the machine finds their own Message buried in noise. Judges arrive in groups, the demo keeps 24 hours on the tape, and every Call that starts and then closes becomes one more empty card.
- Coverage: BACKLOG 1 (a curated reset) cleans the tape once, but nothing stops new noise. New: BACKLOG 14.
- Fix: write no Message for a Call with no caller line, or with nothing actionable (no name, phone, service, time or Owner_Note). Or group such Calls into one "N llamadas sin mensaje" line.

### 4. Two services asked for, one booked, with no word about it (cost: 4; Impact, Technical)
- Evidence: es-two-services, Turn 1. The caller says "cortarme el pelo y hacerme un degradado el martes a las diez". The state has `service: "corte"`, and the Agenda holds `haircut 09:00–09:30Z`. The receptionist never says that a fade is not offered, and the owner's reason ("Corte de pelo con degradado") says it was booked.
- Coverage: front-desk-brain Requirements 4 and 7 (Service_Combo and the Rich_Profile with a fade). Until it ships, this is the most likely first sentence a Spanish judge says.
- Fix: as specified. Also add the rule that a named service the catalog does not have is said back ("degradado no lo hacemos"), never dropped.

### 5. Replies are slow: p90 4.6–7.4 s, first audio up to 8 s (cost: 4; Impact, Design)
- Evidence: the latency table above. Spanish `say` Turns had p90 7414 ms and first audio p90 8041 ms. My English price question took 6517 ms.
- Coverage: front-desk-brain Requirements 2 and 12 (a 2.6 s Model_Wait with the Code_Brain answering).
- Fix: as specified. Then re-run `measure-latency.ts` against the deploy and put p50/p90 in the README.

### 6. The suggested reply confirms a booking the caller has moved (cost: 3; Technical, Impact)
- Evidence: the `booked` Message `4c3a7e53…` shows `agreed.byLang.es = "Cita de corte anulada: era el martes 17 a las 10:00"`, but `currentReply = "Hola Marta Prueba, te confirmo tu cita de corte el martes 17 a las 10:00. ¡Hasta pronto! Lola"`. One tap on COPY REPLY sends the customer the wrong time.
- Cause: `lib/messages/currentReply.ts:31-33` builds a new reply only when the booking was cancelled by the owner or moved by the owner. When the caller cancels it, or moves it (which cancels the old booking), the stored reply is returned.
- Coverage: none (owner-machine 4.6 covers only owner changes). New: BACKLOG 8.
- Fix: when the booking is cancelled for any reason, the reply says it was cancelled or points to the newer Message. Pin it with a property over every caller and owner action sequence: the Current_Reply never names a time that is not the booking's current time.

### 7. The receptionist promises a call back but never asks for a phone (cost: 3; Impact)
- Evidence: es-lola. "Quiero hablar con Lola" → "Lola verá tu mensaje y te llama", then "Encantada, Pedro…", then goodbye. The Message has `callerName: "Pedro Prueba"` and `callerPhone: null`. es-faq does the same twice ("para que te llame") and ends with no name and no phone.
- Coverage: front-desk-brain 10.1 keeps the Call alive after an Owner_Request, but nothing requires a phone. New: BACKLOG 9.
- Fix: an Owner_Request or Owner_Note asks for name and phone before the goodbye (the pack's required-field order). If the caller declines, the line says "Lola no podrá llamarte sin un teléfono".

### 8. The owner's message text is useless or in the wrong language (cost: 3; Design, Impact)
- Evidence (from `poll.json`):
  - `reason: "El cliente se despide."` for Pedro, who asked about his appointment. The model's last note overwrites the real reason when the caller says goodbye.
  - `reason: "Caller said goodbye"`, with `agreed: "Nada acordado; Caller said goodbye"`: one string mixing Spanish and English on a Spanish owner screen (`ownerLang: "es"`).
  - `reason: "Caller asked about haircut and colour prices."` and `"Reschedule appointment to Wednesday, 18 November 2026 at 11:00"`: English reasons on the Spanish machine.
  - `reason: "Corte de pelo con degradado para mañana a las diez"`: a relative day ("mañana") that is wrong from the next day on, and a service that was not booked.
- Cause: `lib/conversation/ownerMessage.ts:35` takes `state.note.reason` (model text, in the Call's language, replaced on every Turn), and `ownerMessage.ts:49-51` embeds it inside `agreedNothing` (`lib/receptionist/phrases.ts:441`).
- Coverage: front-desk-brain 10.7 has code build the reason, but only "when the Call had brain Turns", and "in the Call's language". That conflicts with the comment at `ownerMessage.ts:16-19`, which says owner texts are in the shop's language. New: BACKLOG 10 and 11.
- Fix: always build the reason in code, in the owner's language, from server state (services asked for and booked, topics, Owner_Notes, absolute date). Keep the first meaningful reason, never a goodbye. `agreedNothing` takes only code text.

### 9. English-speaking judges get a Spanish machine with no way to switch on the PIN screen (cost: 3; Presentation, Design)
- Evidence: `/machine/peluqueria-lola` renders "PIN de 6 cifras", "Abrir el contestador". `components/machine/PinGate.tsx:21` uses `shop.languages[0]`, with no switch. `components/machine/MachineScreen.tsx:45` starts in `shop.languages[0]` and ignores the browser language, which the call page does respect (`lib/voice/publicShop.ts` `defaultLang`). The landing is English only (`app/page.tsx`).
- Coverage: jury-polish 11 makes the landing bilingual. The machine and its gate are not covered. New: BACKLOG 15.
- Fix: the gate and the machine start in the browser language when the shop speaks it, and the gate gets the same ES / EN switch as the call page.

### 10. Not understood on the model path: a robotic line, repeated, that leaves a Message (cost: 2; Impact, Design)
- Evidence: en-nonsense. The reply was the same both times: "I am Peluquería Lola's virtual assistant and Lola will see the message." It is stiff English, it offers no help, and the Call ended with `outcome: message`, one more empty card for the owner.
- Coverage: front-desk-brain 10.3 covers the brain path only. New: BACKLOG 13.
- Fix: when the model's intent is `other`, with no field and no question, use the templated reprompt ("Sorry, I didn't catch that. I can book an appointment or tell you our hours and prices."). Write no Message unless an Owner_Note was recorded.

### 11. The brand looks unfinished in a tab or a link preview (cost: 2; Design, Presentation)
- Evidence: `/favicon.ico` is the Next.js default, `/opengraph-image` and `/icon.svg` answer 404, and `public/` still has `next.svg`, `vercel.svg`, `file.svg`, `globe.svg` and `window.svg`. Every page has the same `<title>Phantom Line</title>` and `description: "An ivory and gold haunted answering machine."` (`app/layout.tsx:21-24`), which says nothing about the product.
- Coverage: jury-polish 10 (icons, OG image, description). Titles per page are not covered. New: BACKLOG 16.
- Fix: jury-polish 10, plus `generateMetadata` titles: "Llama a Peluquería Lola · Phantom Line" and "Contestador · Phantom Line".

### 12. The landing does not sell the idea (cost: 2; Presentation, Innovation)
- Evidence: `/` has a heading, one tagline, two buttons, the PIN and the Demo_Notice. It does not say what the product does, how the code decides, or that it was built with Kiro, and it is English only.
- Coverage: jury-polish 11 and BACKLOG 2.

### 13. Claims ahead of the product (cost: 2; Presentation)
- Evidence: the product steering says "Hair salon, physio clinic, restaurant and bakery ship first" and promises WhatsApp and web chat. `lib/sectors/` has only `hairSalon.ts`, and there is no WhatsApp adapter.
- Coverage: jury-polish 12 (claims labelled as roadmap).

### 14. The English voice is mostly live, not cached (cost: 1; Impact)
- Evidence: 2 of 3 English `start` Turns returned `speech.kind: "live"`, while all Spanish greetings were `cached`. Each English Call therefore spends neural quota on its first line.
- Coverage: jury-polish 8 and natural-voice 2.

### 15. The call page has no answering-machine visuals; voice in Safari and Firefox is unverified (cost: 1; Design)
- Evidence: the call page renders no reels or light (`components/call/CallScreen.tsx`). Recognition support outside Chrome was not checked here.
- Coverage: jury-polish 5 and 9.

### 16. Small correctness and hygiene items (cost: 1 together)
- `/call/unknown-shop` answers HTTP **200** with "Este número no existe". It should be 404 for crawlers and link checkers (`app/call/[shopId]/page.tsx:27`). New: BACKLOG 17.
- The public PIN lets anyone read every demo caller's phone in the Poll (`callerPhone: "+34612000111"`). This is by design and the Demo_Notice covers it, but a strict judge may still flag it. No change proposed beyond the reset of BACKLOG 1.
- `scripts/measure-latency.ts` is uncommitted in the main worktree, and its default request is rejected by the deployed API. New: BACKLOG 19.

### Not verified (no browser in this session)
Layout at 375 px, rendered contrast on the live pages, keyboard and VoiceOver passes, Lighthouse, `prefers-reduced-motion`, and the cross-tab blink delay (BACKLOG 4). They are covered by jury-polish 13 and 15 and owner-machine 12, and someone still has to run them.

## What a judge will like (keep it visible)
- The reschedule in English worked end to end, with the name and phone match before any read-back, a correct read-back, and the Agenda updated.
- Dates and phones are spoken the way the steering asks: "mañana martes a las diez", "this Wednesday at eleven", and the phone read in groups. Prices were right in both languages.
- The Demo_Notice is on all three pages, and the PIN is shown on the landing.
- 0 HTTP errors in 24 measured Turns plus 21 scripted ones.
