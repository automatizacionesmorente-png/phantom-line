# Kiro usage log

Write one line each time Kiro does something worth telling the jury. At the end this becomes the "How I used Kiro" section of the submission. English, short, with real examples.

| Date | Kiro feature | What I did | What it changed / caught |
|---|---|---|---|
| 2026-11-05 | Steering | Added product, tech, structure and receptionist-voice docs before writing any code | Every spec and chat starts from the same rules (no invented shop info, model proposes / code decides) |
| 2026-11-05 | Steering (fileMatch) | Added design.md, loaded only for UI files: Marfil & Oro tokens, fonts, contrast-checked colours | The scaffold came out ivory and gold on the first try; Kiro chose the darker gold for the small tagline on its own to keep 4.5:1 contrast |
| 2026-11-05 | Vibe | One prompt scaffolded Next.js 16 + Tailwind 4 + Vitest + fast-check into a non-empty folder without touching .kiro or .env.local | Kiro ran tests, lint and build itself, found its own failing property test (singular "1 new message") and fixed it. 4.95 credits, 21 min |
| 2026-11-05 | Specs (requirements-first) | Gave Kiro the core call loop in one paragraph; it wrote 9 EARS requirements and refined each with detailer sub-agents | Solid base, but it missed real-world rules. 23.3 credits |
| 2026-11-06 | Specs (human review) | Reviewed the requirements like a shop owner and sent 11 changes: shop time zone, no past or double bookings, a bounded nearest-slot search, explicit ES/EN switch (speech recognition cannot auto-detect), Gemini quota limits, server re-check of every booking, channel-agnostic core, reschedule/cancel, sector packs | Kiro applied all 11 in place and added Requirements 10-12. 2.6 credits |
| | Specs | | |
| | Hooks | | |
| | MCP | | |
| | Property-based tests | | |
| | Crew / powers | | |
