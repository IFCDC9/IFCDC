import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Blueprint disk sizeGB matches live ~100 GB volume, not the old 5 GB spec", () => {
  const yaml = readFileSync(path.join(ROOT, "render.yaml"), "utf8");
  const disk = yaml.slice(yaml.indexOf("disk:"));
  assert.match(disk, /name:\s*ifcdc-hq-data/);
  assert.match(disk, /mountPath:\s*\/opt\/render\/project\/src\/data/);
  assert.match(disk, /sizeGB:\s*100\b/);
  assert.equal(/sizeGB:\s*5\b/.test(disk), false);
  assert.match(disk, /Do not apply this Blueprint without Founder review/);
});
