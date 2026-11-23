# Submission checklist (BACKLOG item 13)

Kiroween 2026, Devpost. **Deadline: 4 Dec 2026, 14:00 PT (23:00 Madrid).** No changes to the submission after the deadline.

Status: DONE (evidence in the repo or checked), OPEN (can be done in the repo), OWNER (only Miguel can do it: accounts, publishing, forms). Checked on 23 Nov 2026 at commit 545e2a2.

## Rules and category

| Item | Status | Evidence / what is left |
|---|---|---|
| Category Resurrection: an 80s answering machine brought back from the dead | DONE (text) | Stated in README and `docs/submission.md`. OWNER: pick the category in the Devpost form |
| Bonus categories Best Student and Best Startup | OWNER | Fill the bonus fields in the form (below) |
| Built with Kiro, `/.kiro` at the repo root and not ignored | DONE | 36 files tracked under `.kiro/` (steering, 5 specs, hooks, agents, settings); `.gitignore` has no `.kiro` rule |
| Honest Kiro / Claude split | DONE | README, `NOTAS-KIRO.md` (rows 2026-11-22 and 23), `docs/submission.md`; commits say "Written by Claude (Kiro credits exhausted)" |
| Open-source LICENSE | DONE | MIT `LICENSE` at the root. OWNER: after the repo is public, check GitHub shows the license in About |
| Public GitHub repo | OWNER | Remote `origin` is `automatizacionesmorente-png/phantom-line`. Make it public (Settings, Danger zone) and check no secret is in history |

## Working product

| Item | Status | Evidence / what is left |
|---|---|---|
| Live demo reachable | DONE | https://phantom-line-nine.vercel.app and `/startup` answered HTTP 200 on 23 Nov |
| Free access for judges until 29 Jan 2027 | OPEN | Free tiers only (Vercel, Neon, Gemini). Keep the project, database and API key alive until then; BACKLOG 8 (daily health check) and 9 (judge-proof quota) are not built |
| Testing instructions in the form: demo URL, PIN 198000, "best in Chrome" | DONE (text) | `docs/submission.md`, "Testing instructions for judges". OWNER: paste them into the form |
| Demo data in a known state before judging | OWNER | Run `npm run demo:reset -- --allow-remote` against Neon just before submitting (it touches the live database) |
| Tests green | DONE | 1923 tests in 192 files, all passing (`npx vitest run`, 23 Nov). CI in `.github/workflows/ci.yml` |
| Submission freeze: tag `kiroween-submission` and the Vercel deployment pinned to it (BACKLOG 10) | OPEN | No tag exists. After the last deploy: tag the deployed commit, and check README, video and write-up describe it. The tag and the push are the owner's call |

## Written material

| Item | Status | Evidence / what is left |
|---|---|---|
| README for judges | DONE | `README.md` |
| Devpost write-up | DONE (draft) | `docs/submission.md`. OWNER: paste into the form (repo link filled in; the repo must be public first) |
| Kiro usage log | DONE | `NOTAS-KIRO.md` |
| Impact and startup numbers cited | DONE | `docs/impact.md`, `/startup` |
| Social post text | DONE (draft) | `docs/social-post.md`, links filled in. OWNER: publish it starting with #KiroweenHackathon26 during the submission period |

## Video

| Item | Status | Evidence / what is left |
|---|---|---|
| Script under 3 minutes | DONE | `docs/video-script.md` (target 2:45) |
| Recording | OWNER | Record on a Tuesday to Saturday daytime (the shop is open Tuesday to Saturday), clear the demo agenda first |
| Upload to YouTube, public, under 3 minutes | OWNER | Public (not unlisted), link in the form |
| No copyrighted music | OWNER | Use no music or royalty-free; check the YouTube Content ID notice after upload |

## Bonus and student / startup fields

| Item | Status | Evidence / what is left |
|---|---|---|
| Blog post (bonus) published during the submission period | OWNER | Write and publish; put the link in the form. Material: `docs/submission.md` |
| Social post with #KiroweenHackathon26 published during the period | OWNER | Publish on X or LinkedIn and put the link in the form |
| Best Student fields: LinkedIn, UFV email, year, degree | OWNER | Not in the repo; fill in the form |
| Best Startup fields: founder, LinkedIn, startup page URL | OWNER | Founder: Miguel Morente. Startup page: https://phantom-line-nine.vercel.app/startup. LinkedIn is the owner's |
| Fill and submit the Devpost form | OWNER | Before 4 Dec 14:00 PT. Do not edit after the deadline |

## Owner-only items still open

1. Make the GitHub repo public and check the license shows.
2. Record the video, upload it to YouTube (public, under 3 minutes, no copyrighted music).
3. Publish the blog post.
4. Publish the #KiroweenHackathon26 social post (update `docs/social-post.md` first).
5. Run `npm run demo:reset -- --allow-remote`, tag the final commit, keep the demo alive until 29 Jan 2027.
6. Fill the Devpost form, including the student and startup fields, and submit before the deadline.
