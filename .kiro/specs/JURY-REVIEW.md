# Jury review, 2026-11-15 (owner + Claude acting as a Kiroween judge)

Scored on the five criteria at 20 % each. Each item is a defect a judge would notice, with the fix. This is the input for the `jury-polish` spec; it is not itself a spec.

## Must fix (a judge would mark us down)

1. **The demo is not reachable.** No deploy, no git remote, no demo link in the README. A judge opens the Devpost page in January and has nothing to click. Fix: Vercel deploy of the demo shop, README link at the top, public GitHub repo with `.kiro/` at the root.
2. **The owner's machine does not exist yet.** The demo promise ("call books, the machine blinks") is half missing. Fix: spec owner-machine (running now).
3. **Kiro features unused: hooks, MCP, powers.** Steering, specs, custom agent and PBT are strong; three judged features have zero use. Fix with real use, not decoration:
   - Hooks: in `.kiro/agents/builder.json` (CLI hooks: `postToolUse` lint/typecheck on written files, `stop` hook that runs the booking property tests), and IDE hooks in `.kiro/hooks/` (on save of `lib/booking/**` run its properties; on save of a steering or spec file, check NOTAS-KIRO.md has a row for today; a secret/personal-data scan before commit).
   - MCP: one server Kiro really used while building (for example a docs server for Next.js/Gemini, or a Postgres server pointed at PGlite/a local branch, never production). Record in NOTAS-KIRO.md what it changed.
   - Powers: only if a real one fits; do not fake it.
4. **The demo breaks when the free tier runs out, and judges test weeks later, many of them on the same day.** TTS has ~10 requests per model per day; the text model has bursts of 503 and hangs. Fix: pre-generate every fixed line into the voice cache (natural-voice 9.11) for ES and EN; a visible, honest "high demand, the neural voice is resting, this is the browser voice" state instead of silently sounding robotic; a quota dashboard line in the server log; consider a second free text model provider only if the docs allow it on a free tier with no card.
5. **Safari and Firefox.** Many judges use a Mac with Safari. Speech recognition is Chrome-only. Fix: detect it on the call page and say clearly "Voice works in Chrome; here you can type", with typed mode first, never a broken button. Test the whole call in Safari typed mode.
6. **English is second-class.** Most judges speak English and the browser picks English for them. The English voice has not been auditioned and the English spoken forms got less testing than Spanish. Fix: English voice audition (natural-voice task 2), English regression calls of the same five real cases, and the language switch visible before the call starts.
7. **The home page is a placeholder.** `/` has a title and a tagline. It is the first thing a judge sees. Fix: a real landing page in the Marfil & Oro haunted style: the problem in one line, a big "Call Peluquería Lola" button, a second "Open the owner's machine" button (with the demo PIN shown), a 20-second looping preview, how it works in three steps, and "Built with Kiro" with links to the specs.

## Should fix (design and presentation points)

8. **The Halloween theme is only in CSS.** No tape reels, red light or hiss on screen yet, default Next.js SVGs in `public/`, no favicon or social image. Fix: animated reels while the receptionist speaks, the red light, a faint optional tape hiss (off by default, respects reduced motion), a ghost fade on transcript lines, a custom favicon and Open Graph image so the Devpost/LinkedIn link looks finished.
9. **README for judges.** Add a GIF of a call and the machine, an architecture diagram (channels → `handleTurn` → booking rules → Postgres; model proposes, code decides), the "How we used Kiro" table generated from NOTAS-KIRO.md with numbers (properties, mutation proofs, bugs caught), and a "Try it in 30 seconds" block.
10. **No CI.** A GitHub Actions workflow running lint, typecheck and the test suite on PGlite, with a badge. Cheap credibility for "Technological implementation".
11. **Impact needs evidence.** One real salon (or two) in Madrid trying it, even for an afternoon, with a quote and numbers (calls answered, bookings taken). Plus the cost line: runs on free tiers, what it would cost per month at real volume.
12. **Claims must match the product.** Product copy promises WhatsApp, web chat and four sector packs. Either build them (WhatsApp is the strongest second channel) or present them as the roadmap. A judge who reads "WhatsApp" and cannot find it marks Presentation down.

## Nice to have

13. Accessibility pass with a screen reader on the call page and the machine; `aria-label`s checked on CallButton and TypeInsteadButton; mobile screenshots at 375 px.
14. Demo hygiene: delete the test bookings (Ana Prueba, John Test) from the demo database before recording; demo retention job live.
15. Video under 3 minutes: real call in Spanish with subtitles, then English, the machine blinking, then 40 seconds of Kiro (spec → property that caught a real bug → hook firing).
