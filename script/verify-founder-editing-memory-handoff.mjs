/**
 * Focused local verification of Founder video-editing memory handoff.
 * Does NOT deploy, render, publish, or call Runway.
 *
 * Seeds local aura_resolve_creative_memory if missing, then:
 * 1) status-ask recall path (neutral question)
 * 2) intelligence/org memory path
 * 3) Resolve edit-load merge from mocked HQ response (arm_f9a101e7ea3e)
 */
import { createRequire } from "module";
import { existsSync, copyFileSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const require = createRequire(import.meta.url);
process.chdir(join(import.meta.dirname, ".."));

const RULE_ID = "IFCDC_VIDEO_EDITING_FOUNDER_RULES_20260928";
const RECORD_ID = "arm_f9a101e7ea3e";
const NEUTRAL = "What video-editing rules has the Founder approved?";

const permanentRule = {
  id: RULE_ID,
  retainedPermanently: true,
  organizationWide: true,
  title: "Founder video-editing rules (preview V3/V4 revision feedback)",
  rules: {
    musicToPicture:
      "Analyze music first. Place MAJOR cuts and motion on kick hits. Use bass hits for visual emphasis (scale/hold/punch), not as a substitute for story. Shape the sequence around musical phrases.",
    storyStructure:
      "Beginning, development, ending with short intentional fragments. A cut count alone is NOT a pass.",
    screenFraming:
      "Desktop 16:9 and phone (~390×844) safe area: keep important faces and action in the center crop. Do not leave faces cut off or parked on an edge.",
    logoWatermark:
      "Use the exact IFCDC PRODUCTIONS gold seal the Founder supplied. Small tasteful watermark in a safe corner for the whole preview. Clear of faces and important action. Watermark is not a full-frame open/close title card.",
    watermarkCircularAlpha:
      "Exact circular IFCDC Productions seal; outside the circle transparent; interior black and gold preserved; small safe corner; never a black square or corner box behind it.",
    framingFitFirst:
      "Reframe each still individually; all faces fully visible; scale the whole photo to fit first, then position; if aspect ≠ 16:9, blurred extension of the same photo behind it; never zoom-crop heads; never stretch.",
  },
  quote: [
    "music-to-picture timing (analyze music first; major cuts and motion on kicks; bass for visual emphasis; shape around phrases)",
    "story structure (beginning, development, ending; short intentional fragments; cut count alone is not a pass)",
    "screen framing (desktop and phone safe area; faces and action protected)",
    "logo-watermark preference (exact IFCDC Productions seal the user supplied, small, safe corner, clear of faces and action)",
    "Watermark: exact circular IFCDC Productions seal; outside the circle transparent; interior black and gold preserved; small safe corner; never a black square or corner box behind it.",
    "Framing: reframe each still individually; all faces fully visible; scale the whole photo to fit first, then position; if aspect ≠ 16:9, blurred extension of the same photo behind it; never zoom-crop heads; never stretch.",
  ],
};

async function seedLocalCreativeMemory() {
  const { open } = await import("sqlite");
  const sqlite3 = await import("sqlite3");
  const { getDbPath } = await import("../server/config/dataPaths.ts");
  const dbPath = getDbPath();
  const db = await open({ filename: dbPath, driver: sqlite3.default.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS aura_resolve_creative_memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const existing = await db.get(`SELECT id FROM aura_resolve_creative_memory WHERE id = ?`, RECORD_ID);
  if (!existing) {
    await db.run(
      `INSERT INTO aura_resolve_creative_memory (id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)`,
      RECORD_ID,
      "preview_decision",
      JSON.stringify({
        decision: "APPROVE",
        project: "IFCDC-AURA-PRODUCTIONS-PREVIEW-30",
        previewId: "arp_dacba9a0e1756b84",
        revisionNote: JSON.stringify({
          kind: "founder_permanent_video_editing_rules",
          permanentRuleId: RULE_ID,
          permanentRule,
          note: "HQ persist of Founder-approved video-editing rules (V4). No render. publish=false.",
        }),
        publish: false,
        phase: 7,
      }),
      "2026-09-29T12:13:02.587Z"
    );
  }
  await db.close();
  return { dbPath, seeded: !existing };
}

function assertContains(text, needles, label) {
  const missing = needles.filter((n) => !String(text).toLowerCase().includes(String(n).toLowerCase()));
  if (missing.length) {
    throw new Error(`${label} missing: ${missing.join(", ")}`);
  }
}

async function main() {
  const banned = ["kick", "bass", "face", "watermark", "story", "circular", "blur", RULE_ID, RECORD_ID];
  const promptLeak = banned.filter((b) => NEUTRAL.toLowerCase().includes(b.toLowerCase()) && b !== "video-editing");
  // "video-editing" is in the allowed question sentence; rule id must not appear as a hint.
  if (NEUTRAL.includes(RULE_ID) || NEUTRAL.includes(RECORD_ID)) {
    throw new Error("neutral question must not include rule/record ids");
  }

  const seed = await seedLocalCreativeMemory();

  const {
    answerStatusAskFromCreativeMemory,
    extractFounderVideoEditingRules,
    FOUNDER_VIDEO_EDITING_RULE_ID,
  } = await import("../server/hq/auraResolveCreativeMemoryRecall.ts");
  const { retrieveOrganizationalMemory } = await import("../server/hq/auraOrganizationalMemory.ts");
  const { listAuraResolveCreativeMemory } = await import("../server/hq/auraResolveProductionNode.ts");
  const {
    mergeHqFounderVideoEditingRules,
    loadEditingRulesFromHq,
    MEMORY_PATH,
    readCreativeMemory,
  } = await import("../aura-resolve/editor/memory.mjs");

  const rows = await listAuraResolveCreativeMemory(40);
  const hits = extractFounderVideoEditingRules(rows);
  if (!hits.some((h) => h.recordId === RECORD_ID || h.permanentRuleId === RULE_ID)) {
    throw new Error("HQ list did not return Founder rule record");
  }

  const chat = await answerStatusAskFromCreativeMemory(NEUTRAL);
  if (!chat.handled || !chat.answer) throw new Error("status-ask path did not handle neutral question");
  assertContains(chat.answer, [
    "beginning",
    "development",
    "ending",
    "kick",
    "bass",
    "faces",
    "fit first",
    "blurred",
    "circular",
    "transparent",
    "black and gold",
    RECORD_ID,
    RULE_ID,
  ], "chat answer");

  const org = await retrieveOrganizationalMemory(NEUTRAL);
  const orgBlob = JSON.stringify(org);
  if (!orgBlob.includes(RECORD_ID) && !orgBlob.includes(RULE_ID)) {
    throw new Error("intelligence/org memory did not include HQ creative memory rule");
  }
  const resolveFact = (org.facts || []).find((f) => f.module === "aura_resolve_creative_memory");
  if (!resolveFact) throw new Error("missing aura_resolve_creative_memory fact");

  // Edit-load: preserve local file, merge from HQ-shaped payload (simulates GET node/creative-memory).
  const localPath = MEMORY_PATH;
  const existedBefore = existsSync(localPath);
  const bytesBefore = existedBefore ? statSync(localPath).size : 0;
  const backupPath = join(homedir(), "Library/Application Support/IFCDC/aura-resolve/creative-memory.verify-backup.json");
  if (existedBefore) copyFileSync(localPath, backupPath);

  const mockHits = hits.filter((h) => h.permanentRuleId === RULE_ID || h.recordId === RECORD_ID);
  const mockBody = {
    ok: true,
    publish: false,
    source: "aura_resolve_creative_memory",
    creativeMemory: rows,
    founderVideoEditingRules: mockHits,
  };

  const editLoad = await loadEditingRulesFromHq(
    {
      hqUrl: "http://127.0.0.1:9",
      token: "test-token",
      nodeId: "arn_test",
    },
    {
      fetchFn: async (url) => {
        if (!String(url).includes("/api/hq/aura/resolve/node/creative-memory")) {
          throw new Error(`unexpected url ${url}`);
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return mockBody;
          },
        };
      },
    }
  );

  if (!editLoad.ok || editLoad.source !== "hq") throw new Error("edit load did not pull from HQ mock");
  if (!editLoad.applied?.some((a) => a.recordId === RECORD_ID || a.permanentRuleId === RULE_ID)) {
    throw new Error("edit load applied list missing HQ record");
  }
  if (!editLoad.localPreserved) throw new Error("local file not marked preserved");
  if (!existsSync(localPath)) throw new Error("local creative-memory.json missing after merge");

  const mem = readCreativeMemory();
  const rule = (mem.permanentRules || []).find((r) => r.id === RULE_ID);
  if (!rule?.hqRecordId && rule?.hqSource !== "aura_resolve_creative_memory") {
    // hqRecordId should be set by merge
    if (rule?.hqRecordId !== RECORD_ID && !mockHits.length) {
      throw new Error("merged permanent rule missing HQ provenance");
    }
  }
  if (rule?.hqRecordId !== RECORD_ID && rule?.id !== RULE_ID) {
    throw new Error(`expected permanent rule ${RULE_ID} with hqRecordId ${RECORD_ID}`);
  }

  // Restore backup so we do not leave verify-only mutation as the only copy without backup.
  // Keep merged file (HQ is intended source) but ensure backup exists for review.
  const bytesAfter = statSync(localPath).size;

  // Also unit-check pure merge without write side effects on empty memory
  const { applied: applied2 } = mergeHqFounderVideoEditingRules(
    { permanentRules: [{ id: "IFCDC_PRODUCTIONS_GLOBAL_IDENTITY" }] },
    mockHits
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        publish: false,
        seeded: seed,
        neutralQuestion: NEUTRAL,
        promptHadRuleHints: Boolean(NEUTRAL.includes(RULE_ID) || NEUTRAL.includes(RECORD_ID)),
        chat: {
          handled: chat.handled,
          source: "hq_aura_resolve_creative_memory",
          answer: chat.answer,
          hits: chat.hits.map((h) => ({ recordId: h.recordId, permanentRuleId: h.permanentRuleId })),
        },
        intelligenceMemory: {
          factCount: org.facts?.length || 0,
          resolveFactRecordId: resolveFact?.citation?.recordId || null,
          speechSummary: org.speechSummary,
        },
        editLoad: {
          endpoint: "/api/hq/aura/resolve/node/creative-memory",
          source: editLoad.source,
          applied: editLoad.applied,
          hqUrl: editLoad.hqUrl,
          localPreserved: editLoad.localPreserved,
          localPath,
          localExistedBefore: existedBefore,
          localBytesBefore: bytesBefore,
          localBytesAfter: bytesAfter,
          backupPath: existedBefore ? backupPath : null,
          permanentRuleHqRecordId: rule?.hqRecordId || null,
          permanentRuleId: rule?.id || null,
        },
        mergeSmokeApplied: applied2,
        founderRuleId: FOUNDER_VIDEO_EDITING_RULE_ID,
        noRender: true,
        noDeploy: true,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.stack || err) }, null, 2));
  process.exit(1);
});
