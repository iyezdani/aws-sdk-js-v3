// Informational measurements (rubric I-rows): recorded, not asserted.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const info: Record<string, unknown> = {};

export const record = (key: string, value: unknown) => {
  info[key] = value;
};

/** Call from afterAll. Writes <HARNESS_INFO_DIR>/<spec>.json when set; always echoes to stdout. */
export const flushInfo = (specFile: string) => {
  const dir = process.env.HARNESS_INFO_DIR;
  const json = JSON.stringify(info, null, 2);
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${basename(specFile).replace(/\.spec\.ts$/, "")}.json`), json + "\n");
  }
  console.log(`HARNESS_INFO ${basename(specFile)} ${JSON.stringify(info)}`);
};
