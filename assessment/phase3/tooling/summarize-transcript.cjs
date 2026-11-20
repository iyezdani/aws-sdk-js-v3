// Summarize a Claude Code stream-json transcript: tool calls, out-of-clone access, network use,
// questions to the user, and the final result metadata. Usage: node summarize-transcript.cjs <file> <clone-dir>
const fs = require("node:fs");
const [file, clone] = process.argv.slice(2);
const cloneNorm = clone.replace(/\\/g, "/").toLowerCase();
const lines = fs.readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const calls = [];
for (const ev of lines) {
  if (ev.type !== "assistant") continue;
  for (const c of ev.message?.content ?? []) {
    if (c.type === "tool_use") calls.push(c);
  }
}
const short = (s, n = 140) => String(s).replace(/\s+/g, " ").slice(0, n);
const flags = [];
calls.forEach((c, i) => {
  const inp = c.input || {};
  const desc =
    c.name === "Bash" || c.name === "PowerShell"
      ? inp.command
      : inp.file_path || inp.path || inp.pattern || inp.query || inp.prompt || JSON.stringify(inp);
  console.log(`${String(i + 1).padStart(3)}. ${c.name}: ${short(desc)}`);
  const text = JSON.stringify(inp).replace(/\\\\/g, "/").toLowerCase();
  const paths = text.match(/[a-z]:\/[^"\s']+/g) || [];
  for (const p of paths) if (!p.startsWith(cloneNorm)) flags.push(`call ${i + 1}: path outside clone: ${p}`);
  if (/\.\.\//.test(text)) flags.push(`call ${i + 1}: relative parent path`);
  if (/\bgh\b|curl|wget|https?:\/\/|git (push|fetch|pull)|npm (view|info)|webfetch/.test(text))
    flags.push(`call ${i + 1}: possible network use`);
  if (/toptal|assessment|rubric|harness/.test(text)) flags.push(`call ${i + 1}: mentions assessment terms`);
  if (c.name === "AskUserQuestion") flags.push(`call ${i + 1}: asked the user a question`);
});
const result = lines.find((l) => l.type === "result") || {};
console.log("\nflags:", flags.length ? "\n  " + flags.join("\n  ") : "none");
console.log(
  "\nresult:",
  JSON.stringify({
    subtype: result.subtype,
    is_error: result.is_error,
    num_turns: result.num_turns,
    duration_ms: result.duration_ms,
    cost_usd: result.total_cost_usd,
    usage: result.usage && {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
      cache_read: result.usage.cache_read_input_tokens,
      cache_write: result.usage.cache_creation_input_tokens,
    },
    permission_denials: result.permission_denials,
  })
);
