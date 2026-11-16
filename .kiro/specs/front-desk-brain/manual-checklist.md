# Front Desk Brain: manual checklist (owner steps)

Task 14.1 writes the rest of this checklist. This first section is task 15.3, the before numbers, which must be taken **before any Latency change is deployed** (Requirement 22.3). Kiro does not run it.

## Before numbers (task 15.3)

The Latency_Script is a plain HTTP client of the app; it needs no secret and reads no `.env` file. Against the deployed demo it writes real Calls, Messages and one booking to the demo shop's database, and spends the demo's model and TTS quota, which is why it refuses a remote base unless `--allow-remote` is given.

What one language costs (the script prints the same plan before its first request):

- 4 Calls, 12 Turns (8 `say`): the regression call (5 Turns, it books with the invented caller "Ana Prueba", 612 345 678), an FAQ, a price question and a free question.
- At most 8 model calls in `--legacy` mode (today's core asks the model on every `say`).
- At most 12 TTS requests. The demo's default TTS limits are 20 an hour and 30 a day, so the two languages go in two runs at least an hour apart, and on a day when the TTS quota has not been used yet.

Steps:

1. Check that the deploy is still the one from before the Latency changes (no `Server-Timing` header on `/api/turn`; task 19 adds it).
2. Spanish, from the project folder:

   ```sh
   node --import tsx scripts/measure-latency.ts --base=<demo URL> --allow-remote --legacy --lang=es
   ```

3. At least one hour later, English:

   ```sh
   node --import tsx scripts/measure-latency.ts --base=<demo URL> --allow-remote --legacy --lang=en
   ```

4. Keep both files the script names at the end: `.measurements/latency/<date>-before.json` and `<date>-before-2.json` (`.measurements/` is not committed). They hold durations only, no words.
5. Copy the printed table of each run into the before/after row of `NOTAS-KIRO.md` (task 14.3). In legacy mode the `brain`, `db`, `model` and `total` rows read "n/a", because today's deploy sends no `Server-Timing`; that is expected, not a 0.
6. Optional clean-up: cancel Ana Prueba's booking on the machine (the demo retention removes the Calls after 7 days anyway).

Expected `audio` column: `cached` for the greeting, `live` or `none` (with the fallback, e.g. `quota`) for the replies. A run that prints `ERROR` exits with status 1; keep the file anyway and note which Turn failed.
