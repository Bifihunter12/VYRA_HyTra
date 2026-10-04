// npm run test:sql — every *.sql.mjs file runs in its own fresh database.
import { readdirSync } from "fs";
import { spawnSync } from "child_process";
const dir = new URL(".", import.meta.url).pathname;
let failed = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".sql.mjs")).sort()) {
  console.log(`\n▶ ${f}`);
  const r = spawnSync(process.execPath, [dir + f], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
process.exit(failed ? 1 : 0);
