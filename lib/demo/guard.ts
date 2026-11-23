/**
 * The safety rail of `npm run demo:reset`: the script refuses any database that is not on this
 * machine unless `--allow-remote` is on the command line. Pure; no `server-only`, because the
 * script runs outside Next.js.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export type ResetTarget =
  | { ok: true; remote: boolean }
  | { ok: false; reason: "no_url" | "bad_url" | "remote_needs_flag" };

export function checkResetTarget(databaseUrl: string | undefined, argv: readonly string[]): ResetTarget {
  if (!databaseUrl) return { ok: false, reason: "no_url" };
  let host: string;
  try {
    host = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  const remote = !(LOCAL_HOSTS.has(host) || host.endsWith(".localhost"));
  if (remote && !argv.includes("--allow-remote")) return { ok: false, reason: "remote_needs_flag" };
  return { ok: true, remote };
}
