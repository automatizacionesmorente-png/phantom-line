# Impact: the problem, the running cost, and how a salon starts

Every number below is either read on the cited page (fetched and read on 22 Nov 2026), computed here with the arithmetic shown, or marked as an assumption. A figure we could not verify is left out. Prices are in US dollars as published; nothing is converted.

## 1. The problem in numbers

| Figure | Source |
|---|---|
| 42% of 1,000 US consumers leave a voicemail when a business does not answer; 78% say they have abandoned a business after an unanswered call. | CallRail consumer survey, 25 Sep 2025. https://www.callrail.com/blog/missed-calls-cost-businesses-more-than-ever |
| 69% of callers who reached voicemail hung up without leaving a message (300 UK micro businesses of 0-9 employees, plus call data from 10,000 businesses). | Moneypenny small business call report, 21 Nov 2016. https://www.moneypenny.com/uk/resources/news/small-business-call-report/ |
| 33,882 companies in "Peluquerías y barberías" (CNAE 9621) in Spain, data year 2024. | einforma sector report (a commercial database, not INE; it may count self-employed). https://www.einforma.com/informes-sectoriales/cnae-9621-empresas-peluquerias-y-barberias |

Limits of this evidence, stated plainly: the first two are surveys published by companies that sell call services, they are not about hair salons, and the second is ten years old. We found no verified salon-only missed-call rate and no verified value of a missed call, so we publish none. The honest claim is: when a small business does not pick up, many callers do not leave a message and some do not come back; a salon owner with scissors in one hand is in that situation all day.

## 2. What it costs to run

What the code uses (`.kiro/steering/tech.md`, `lib/receptionist/geminiClient.ts`, `lib/receptionist/ttsClient.ts`): Vercel (Next.js hosting), Neon (Postgres), Gemini Flash-Lite for the conversation, Gemini Flash TTS for the optional neural voice. The default voice is the browser's Web Speech API, which costs nothing.

### Published prices and free tiers

| Service | Free tier | Paid | Source |
|---|---|---|---|
| Vercel | Hobby: 1M CDN requests and 100 GB data transfer a month, 1 developer seat | Pro: $20 a month per developer seat, includes $20 of usage credit | https://vercel.com/pricing |
| Neon | Free: 100 CU-hours of compute per project a month, 1 GB storage per project | Launch: $0.106 per CU-hour, $0.35 per GB-month, no monthly minimum; the page estimates about $15 a month for a small intermittent database | https://neon.com/pricing (updated 2026-11-04) |
| Gemini text (Gemini 3.5 Flash-Lite, the first default model) | Free of charge | $0.30 input and $2.50 output per 1M tokens | https://aistudio.google.com/docs/pricing |
| Gemini TTS (Gemini 3.8 Flash TTS, the first default voice) | Free tier | Text input $0.50 per 1M tokens and audio output $9 per 1M until 31 Dec 2026, then $1.00 and $18 | https://aistudio.google.com/docs/pricing |
| Audio length in tokens | | 32 tokens per second of audio | https://aistudio.google.com/docs/audio |

Not verified: whether Vercel's Hobby terms allow a commercial service (we did not read the fair-use policy). Until that is checked, the paid plan below assumes Vercel Pro. The pricing page was read up to 100,000 of its 117,956 characters; the models above were in the part read.

### Measured and assumed inputs

- Measured: the system prompt of the demo shop (19 services) is 10,892 characters in Spanish and 10,516 in English (`buildSystemInstruction` on `lolaSeedProfile`). We estimate 3,500 tokens (about 3 characters per token for Spanish; an estimate, not a tokenizer count). Per Turn we assume 4,000 input tokens in total with the transcript.
- Measured: the output is capped at 400 tokens per Turn (`MAX_OUTPUT_TOKENS`). We price every Turn at the cap.
- Assumption: a call has 8 Turns and every Turn calls the model. This is an upper bound: the code answers some Turns without the model (`Sure_Reading`) and a voice cache serves fixed lines.
- Assumption: 40 seconds of synthesised speech per call, all live (no cache hit), with 40 text tokens per reply.

### Cost per call (upper bound)

- Text, per Turn: 4,000 x $0.30 / 1,000,000 = $0.00120 input, plus 400 x $2.50 / 1,000,000 = $0.00100 output = $0.00220. Per call: 8 x $0.00220 = $0.0176.
- Voice, per call: 40 s x 32 = 1,280 audio tokens x $18 / 1,000,000 = $0.02304, plus 8 x 40 = 320 text tokens x $1.00 / 1,000,000 = $0.00032 = $0.02336 (at the price from 1 Jan 2027; before that it is about half).
- Total: $0.0176 + $0.02336 = $0.04096 per call.

### Cost per month at 1,000 calls

- Variable: 1,000 x $0.04096 = **$40.96** (text $17.60, neural voice $23.36). With the free browser voice it is $17.60.
- Shared fixed, for any number of shops on one deployment: Vercel Pro $20 + Neon about $15 (Neon's own estimate for a small database) = $35.
- Total at 1,000 calls with neural voice and paid plans: $40.96 + $35 = **about $76 a month**. Of this, $35 is shared by all shops.
- Free-tier operation (the demo today): $0, bounded by the free quotas. The TTS route is capped at 30 neural replies a day by default (`DEFAULT_TTS_LIMITS`), after which the browser voice speaks.

At 300 calls a month (the planned Salon plan): 300 x $0.04096 = $12.29 variable per shop. This is the cost basis for the planned prices on `/startup`: a free tier of 30 calls (30 x $0.04096 = $1.23 at the upper bound, $0 inside the free quotas) and a planned 29 EUR a month per shop. The price is a planned figure, not a market-tested one, and the currencies are not converted here.

## 3. How a salon starts with the sector pack

Today, honestly: a shop is created by hand, not by a self-service screen (a `/setup` flow is item 16 of the backlog and is not built).

1. The hair-salon sector pack (`lib/sectors/hairSalon.ts`) supplies the vocabulary in Spanish and English, the kind of resource (chair) and the receptionist's defaults.
2. A `ShopProfile` is written for the salon: name, owner name, address, IANA time zone, opening hours per weekday, services with durations and prices, and the everyday answers. The demo profile in `lib/db/seed.ts` (Peluquería Lola, 19 services, two chairs) is the template. It is validated by `ShopProfileSchema`.
3. The profile is inserted with the seed pattern (`scripts/seed.ts`) and a 6-digit owner PIN is set (`seedOwnerPin`); only a hash is stored.
4. The shop gets two links: `/call/<shop-id>` for callers and `/machine/<shop-id>` for the owner, who enters the PIN to see messages and bookings.
5. The owner checks prices and hours, makes one test call, and watches the light blink on the machine.

What is not built, so not promised: a real phone number, WhatsApp, self-service setup, and billing.
