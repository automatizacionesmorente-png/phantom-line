#!/usr/bin/env node
// PreToolUse guard: blocks any tool call that names a real env file (.env, .env.local, .env.production...).
// .env.example is allowed. Kiro sends the call as JSON on stdin; a non-zero exit blocks it and stderr goes to the agent.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let input = "";
  try {
    input = JSON.stringify(JSON.parse(raw).tool_input ?? "");
  } catch {
    input = raw;
  }
  // Node may load env files itself (`node --env-file=.env.local script`): the values never reach the agent.
  input = input.replace(/--env-file=\.env\.local/g, "");
  const hit = /(^|[\s"'/=])\.env(?!\.example)(\.[\w-]+)?(?=$|[\s"'/,;)}\]])/m.test(input);
  if (hit) {
    process.stderr.write("Blocked by .kiro/hooks guard-secrets: env files hold secrets and are never read, written or printed. Use .env.example for variable names.\n");
    process.exit(2);
  }
  process.exit(0);
});
