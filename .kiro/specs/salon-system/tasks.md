# Implementation Plan: Salon System

Follows `design.md` and the plan `docs/superpowers/plans/2026-11-23-salon-system.md` (it has the steps of each task). **Implemented by Claude, not Kiro** (Kiro's credits ran out on 17 Nov 2026). Pure logic comes first and each task ships with its tests. The receptionist's suites stay green after every task. Review fixes got their own commits, listed with the task they fix.

Status at the head of this branch: the full suite passes (2537 tests in 237 files, `npx vitest run`). Production is **not** migrated or deployed yet: that needs the owner's OK in chat (task 18).

- [x] 1. Schema `0009_salon` (new tables, booking and client columns), `3c59a94`. Fix: foreign-key delete behaviour and demo/trial cleanup, `984ace8`.
- [x] 2. Sector pack fields: visit-note label and client fields per pack, `b619a70`.
- [x] 3. Time blocks are busy time for the receptionist, `3cebfbf`.
- [x] 4. Manual bookings and time blocks (API), `a248abc`. Review hardening for bookings, blocks and payments, `9a4abab`.
- [x] 5. Cash desk and visit notes (API), `9bb4fbf` (hardening in `9a4abab`).
- [x] 6. Richer client cards: birthday, consent, sector fields, spend, `08e3dfc`.
- [x] 7. Month report, expenses and the accountant's export, `86ec8be`. Review fixes (clients, month report, route coverage), `ff291cb`.
- [x] 8. Automations settings and outbox, `aa7d026`. Fix: outbox respects switches, consent and stale bookings at list time, `675e725`.
- [x] 9. Four-tab owner app shell, `aacbce7`.
- [x] 10. Today: the booking book, `1310f12`.
- [x] 11. The + button, new-booking, block and pay dialogs, `1765868`.
- [x] 12. Clients tab (UI), `cb9e3dd`.
- [x] 13. My business tab (UI), `cd35b9e`.
- [x] 14. Settings and outbox tab, `6df9436`; settings shop summary, `07af79b`.
- [x] 15. Demo month and retention (sample data, cleanup), `11ef12b`.
- [x] 16. Kiro spec and submission docs (this spec, README, submission text, checklist, video script, impact), commit `docs(salon): kiro spec and submission docs`.
- [ ] 17. Whole-branch verification: full suite, `tsc`, lint, build, and a click-through at 375 px and desktop with screenshots.
- [ ] 18. Production, with the owner: apply 0009 to Neon only after his OK in chat, `demo:reset -- --allow-remote`, push, CI, deploy, check live.
