---
inclusion: fileMatch
fileMatchPattern: ["app/**/*.tsx", "components/**/*.tsx", "app/globals.css", "tailwind.config.*"]
---

# Visual design: "Marfil & Oro", haunted

Phantom Line uses its author's visual identity, Marfil & Oro, and haunts it. The machine is a warm ivory 1980s answering machine with gold trim. The fear comes from details that move: the light that blinks by itself, the reels that turn with nobody there, the voices fading in. Most Halloween apps are black and purple; this one stands out by being ivory and gold.

## Tokens (define once in `app/globals.css` as CSS variables, map them in Tailwind)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#FBF6EE` | page background (never pure white, never black) |
| `--section` | `#F5EFE4` | sections, machine body |
| `--card` | `#FFFDF8` | cards, message tape label |
| `--border` | `#E8E1D3` | borders |
| `--ink` | `#14110C` | headings |
| `--text` | `#2E2921` | body |
| `--muted` | `#6B665E` | secondary text (brand `#79746C` darkened to pass 4.5:1) |
| `--gold` | `#9E711F` | the one highlighted phrase in a heading (large text only: 4.0:1) |
| `--gold-text` | `#82591A` | gold for small text and links (5.7:1) |
| `--gold-dot` | `#D0AB73` | eyebrow dots, reel hubs |
| `--espresso` | `#241D14` | tape reels, nav bar, the speaker grille |
| `--olive` | `#3A3F2F` | closing panel |
| `--light` | `#B65F45` | the message light (terracotta red) |
| `--light-text` | `#9C4E37` | urgent badge background, with `--card` text (5.8:1) |

Primary button: pill, gold gradient `#D3A65C → #B3873B → #9E731F`, **ink text** (white on gold fails contrast), with an arrow →. Secondary: ink outline pill.

## Type
- Headings: **Newsreader** 500, ink, slightly negative tracking, with exactly **one phrase in gold** ("You have *3 new messages*").
- Body: **Inter**, `--text`. Eyebrow above each section: Inter 12px uppercase, tracking .18em, gold dot.
- Handwritten notes on the tape label and the owner's suggested reply: **Caveat**.
- Load fonts with `next/font/google`.

## The machine (owner screen)
- Ivory body, radius 28px, soft brown translucent shadow, gold hairline trim.
- Two espresso tape reels with gold hubs; they rotate while a message plays.
- The message light is terracotta and **blinks slowly** when there are new messages, with an irregular flicker now and then (the haunting).
- A counter in Newsreader: "3" big, label "new messages" below.
- Each message is a tape card (`--card`) with caller, reason, urgency badge, and the suggested reply in Caveat.

## Haunted details (subtle, never in the way)
- New messages fade in like a voice from far away (opacity + slight blur, 600 ms).
- Very faint tape-hiss grain over the machine (CSS noise, opacity ≤ 0.05).
- A Caveat annotation with a hand-drawn arrow: "they called while you were busy…".
- All motion stops with `prefers-reduced-motion`.

## Never
Black or near-black screens, purple, neon, corporate blue, emojis as icons (use Lucide), hard shadows, sans-serif big headings, invented numbers in the demo.

## Accessibility
Text contrast at least 4.5:1, visible focus ring in gold, every control reachable by keyboard, the blinking light also announced as text ("3 new messages").
