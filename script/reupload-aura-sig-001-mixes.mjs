#!/usr/bin/env node
/**
 * Re-upload existing Signature Sound 001 WAVs to HQ persistent mix store.
 * Does NOT regenerate or alter the approved mix — delivery-layer restore only.
 */
import { readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const HQ = (process.env.IFCDC_HQ_BASE_URL || "https://ifcdc-hq-wst6.onrender.com").replace(/\/$/, "");
const SECRETS = join(homedir(), "Music/IFCDC-MUSIC/secrets/production-node.json");
const EXPORTS = join(homedir(), "Music/IFCDC-MUSIC/exports");
const REPORT = join(
  homedir(),
  "Music/IFCDC-MUSIC/library/production-reports/AURA-SIG-001-V1.report.md"
);

const UPLOADS = [
  {
    jobId: "AURA-SIG-001",
    revision: "Signature Sound 001 — Raw Idea",
    kind: "original",
    file: join(EXPORTS, "AURA-SIG-001-Raw-Idea.wav"),
  },
  {
    jobId: "AURA-SIG-001",
    revision: "Signature Sound 001 — V1",
    kind: "mix",
    file: join(EXPORTS, "AURA-SIG-001-V1.wav"),
    reportText: existsSync(REPORT) ? readFileSync(REPORT, "utf8") : undefined,
  },
];

async function upload(item) {
  if (!existsSync(item.file)) throw new Error(`Missing ${item.file}`);
  const st = statSync(item.file);
  if (st.size < 1000) throw new Error(`File too small / corrupt: ${item.file}`);
  const buf = readFileSync(item.file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`Not WAV: ${item.file}`);
  const secrets = JSON.parse(readFileSync(SECRETS, "utf8"));
  const body = {
    jobId: item.jobId,
    revision: item.revision,
    kind: item.kind,
    filename: item.file.split("/").pop(),
    base64: buf.toString("base64"),
  };
  if (item.reportText) body.reportText = item.reportText;
  console.log(`Uploading ${item.kind} ${item.revision} (${st.size} bytes)…`);
  const res = await fetch(`${HQ}/api/hq/aura/music/mixes/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secrets.token}`,
      "Content-Type": "application/json",
      "X-Aura-Music-Node-Id": secrets.nodeId || "",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const json = await res.json().catch(() => ({}));
  console.log(res.status, json.ok, json.playbackUrl || json.path, json.bytes || json.detail);
  if (!(res.status === 201 || json.ok)) throw new Error(JSON.stringify(json));
  return json;
}

async function main() {
  for (const item of UPLOADS) await upload(item);
  console.log("Done — AURA-SIG-001 audio restored to HQ persistent mix store.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
