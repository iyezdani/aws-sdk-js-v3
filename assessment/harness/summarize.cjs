// Collapse Vitest's JSON report into the rubric row table.
// Usage: node assessment/harness/summarize.cjs <results-dir>   (reads harness.json + info/*.json)
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
const report = JSON.parse(fs.readFileSync(path.join(dir, "harness.json"), "utf8"));

const rows = new Map();
for (const file of report.testResults) {
  for (const a of file.assertionResults) {
    const id = /^(R\d+|I\d+)/.exec(a.title)?.[1];
    if (!id) continue;
    if (!rows.has(id)) rows.set(id, { passed: 0, failed: 0, failures: [] });
    const r = rows.get(id);
    if (a.status === "passed") r.passed++;
    else {
      r.failed++;
      r.failures.push(`${a.title}: ${(a.failureMessages || []).join(" ").split("\n")[0].slice(0, 220)}`);
    }
  }
}

const order = (id) => (id[0] === "R" ? 0 : 1000) + Number(id.slice(1));
const ids = [...rows.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));

let md = "| Row | Result | Tests passed | First failure |\n|---|---|---|---|\n";
for (const id of ids) {
  const r = rows.get(id);
  const total = r.passed + r.failed;
  const result = id.startsWith("I") ? "recorded" : r.failed === 0 ? "PASS" : "FAIL";
  md += `| ${id} | ${result} | ${r.passed}/${total} | ${(r.failures[0] || "").replace(/\|/g, "\\|")} |\n`;
}

const infoDir = path.join(dir, "info");
let info = {};
if (fs.existsSync(infoDir)) {
  for (const f of fs.readdirSync(infoDir)) Object.assign(info, JSON.parse(fs.readFileSync(path.join(infoDir, f), "utf8")));
}
md += "\n**Informational measurements**\n\n```json\n" + JSON.stringify(info, null, 2) + "\n```\n";
md += `\nVitest: ${report.numPassedTests} passed, ${report.numFailedTests} failed, ${report.numTotalTests} total.\n`;

fs.writeFileSync(path.join(dir, "summary.md"), md);
process.stdout.write(md);
