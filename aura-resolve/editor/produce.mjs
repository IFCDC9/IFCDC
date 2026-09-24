/**
 * Creative production runner for the Production Mac agent.
 * Stages approved brand assets, builds visible transition/fade media, drives Resolve, returns draft to HQ.
 */
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { planInstruction, toResolveCall } from "./commands.mjs";
import { rememberProduction, rememberRevision, readCreativeMemory } from "./memory.mjs";
import { pickAssets, stageBrandKit } from "../brand/kit.mjs";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEDIA = join(ROOT, "media");
const RENDERS = join(ROOT, "renders");
const GENERATED = join(MEDIA, "generated");

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || "").slice(-400)}`);
  }
  return result;
}

function stillToClip(input, output, { seconds = 2.5, width = 1080, height = 1920, fadeOut = false } = {}) {
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "format=yuv420p",
  ];
  if (fadeOut) {
    const start = Math.max(0, seconds - 1.1);
    filters.push(`fade=t=out:st=${start}:d=1`);
  }
  runFfmpeg([
    "-loop", "1",
    "-i", input,
    "-t", String(seconds),
    "-vf", filters.join(","),
    "-r", "24",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-an",
    output,
  ]);
  return output;
}

function makeTransitionFlash(output, { width = 1080, height = 1920 } = {}) {
  runFfmpeg([
    "-f", "lavfi",
    "-i", `color=c=0xC9A227:s=${width}x${height}:d=0.35:r=24`,
    "-f", "lavfi",
    "-i", `color=c=black:s=${width}x${height}:d=0.15:r=24`,
    "-filter_complex", "[0][1]concat=n=2:v=1:a=0,format=yuv420p",
    "-c:v", "libx264",
    "-an",
    output,
  ]);
  return output;
}

function makeFadeBlack(output, { width = 1080, height = 1920, seconds = 1.2 } = {}) {
  runFfmpeg([
    "-f", "lavfi",
    "-i", `color=c=black:s=${width}x${height}:d=${seconds}:r=24`,
    "-vf", `fade=t=in:st=0:d=${seconds},format=yuv420p`,
    "-c:v", "libx264",
    "-an",
    output,
  ]);
  return output;
}

function trimAudio(input, output, seconds = 12) {
  runFfmpeg([
    "-i", input,
    "-t", String(seconds),
    "-af", `afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0.5, seconds - 1.2)}:d=1.1,volume=0.35`,
    "-c:a", "aac",
    "-b:a", "160k",
    output,
  ]);
  return output;
}

function probeDuration(filePath) {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { encoding: "utf8" },
  );
  const value = Number(String(probe.stdout || "").trim());
  return Number.isFinite(value) ? value : null;
}

async function waitForRender(askResolve, jobId, customName, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await askResolve("render_status", { jobId });
    const rendering = status?.result?.rendering;
    const jobStatus = status?.result?.status || {};
    const done =
      rendering === false ||
      /complete|success|ready/i.test(String(jobStatus.JobStatus || jobStatus.status || ""));
    if (done) break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const matches = existsSync(RENDERS)
    ? readdirSync(RENDERS)
        .filter((name) => name.includes(customName) || name.startsWith(customName))
        .map((name) => ({ name, path: join(RENDERS, name), mtime: statSync(join(RENDERS, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  return matches[0] || null;
}

export async function runCreativeProduction({
  instruction,
  askResolve,
  revisionNote = null,
  uploadPreview = null,
} = {}) {
  mkdirSync(GENERATED, { recursive: true });
  mkdirSync(RENDERS, { recursive: true });

  const kit = stageBrandKit({ intoMedia: true });
  const logos = pickAssets(kit, ["logo"]);
  const broll = (kit.staged || []).filter((item) => item.role === "broll" || item.role === "app-store");
  const music =
    (kit.staged || []).find((item) => item.role === "music") ||
    (kit.staged || []).find((item) => item.role === "music-fallback");
  const format = /landscape|16\s*:\s*9/.test(String(instruction || "").toLowerCase())
    ? { width: 1920, height: 1080 }
    : /square|1\s*:\s*1/.test(String(instruction || "").toLowerCase())
      ? { width: 1080, height: 1080 }
      : { width: 1080, height: 1920 };

  const stillSources = [
    logos[0]?.mediaPath,
    broll[0]?.mediaPath,
    broll[1]?.mediaPath || logos[1]?.mediaPath || logos[0]?.mediaPath,
  ].filter(Boolean);

  if (stillSources.length < 2) {
    throw new Error("Need at least two approved brand/product stills to build a creative draft");
  }

  const clipPaths = [];
  stillSources.slice(0, 3).forEach((source, index) => {
    const out = join(GENERATED, `promo-clip-${index + 1}.mp4`);
    stillToClip(source, out, {
      seconds: index === stillSources.length - 1 ? 3.2 : 2.6,
      width: format.width,
      height: format.height,
      fadeOut: false,
    });
    clipPaths.push(out);
  });

  const transitionPath = join(GENERATED, "aura-transition-flash.mp4");
  makeTransitionFlash(transitionPath, format);

  const fadePath = join(GENERATED, "aura-fade-out.mp4");
  // Bake a visible fade into ending still, then append pure black fade for smoothness.
  const endingStill = stillSources[stillSources.length - 1];
  const fadedEnding = join(GENERATED, "promo-clip-ending-fade.mp4");
  stillToClip(endingStill, fadedEnding, {
    seconds: 2.4,
    width: format.width,
    height: format.height,
    fadeOut: true,
  });
  makeFadeBlack(fadePath, { ...format, seconds: 1.1 });

  let musicPath = null;
  if (music?.mediaPath || music?.source) {
    musicPath = join(GENERATED, "promo-music-bed.m4a");
    trimAudio(music.mediaPath || music.source, musicPath, 14);
  }

  const logoPath = logos[0]?.mediaPath || null;
  const arranged = [];
  for (let i = 0; i < clipPaths.length; i += 1) {
    arranged.push(clipPaths[i]);
    if (i < clipPaths.length - 1) arranged.push(transitionPath);
  }
  arranged.push(fadedEnding);
  arranged.push(fadePath);

  const importPaths = [...new Set([...arranged, logoPath, musicPath].filter(Boolean))];
  const clipMediaNames = arranged.map((path) => basename(path));

  const plan = planInstruction(instruction, {
    assets: importPaths.map((path) => ({ mediaPath: path, path })),
    clipMediaNames,
    interleaveTransitions: false,
    transitionMediaName: basename(transitionPath),
    fadeMediaName: basename(fadePath),
    logoPath,
    musicPath,
    projectName: revisionNote
      ? `IFCDC-AURA-BARBERS-PROMO-V1`
      : undefined,
  });
  // Fresh timeline each draft so prior clips do not stack.
  const timelineName = `${plan.project}-TL-${Date.now().toString(36).slice(-5)}`;
  plan.timeline = timelineName;
  for (const step of plan.steps) {
    if (step.command === "create_timeline") step.payload = { ...(step.payload || {}), name: timelineName };
    if (step.command === "create_bin") step.payload = { ...(step.payload || {}), name: `${plan.project}-BIN` };
  }

  if (revisionNote) {
    plan.revisionNote = revisionNote;
    plan.TEXT_TITLES = [...(plan.TEXT_TITLES || []), `Revision: ${revisionNote}`].slice(0, 4);
  }

  const results = [];
  const blockers = [];

  for (const step of plan.steps) {
    if (step.command === "return_render_to_hq") continue;
    const calls = toResolveCall(step);
    if (!calls.length) {
      results.push({ step: step.command, skipped: true, reason: step.note || "no resolve call" });
      continue;
    }
    for (const call of calls) {
      try {
        const response = await askResolve(call.action, call.payload);
        results.push({ step: step.command, action: call.action, ...response });
        if (response?.ok === false) {
          blockers.push(`${call.action}: ${response.error || "failed"}`);
        } else if (response?.result?.applied === false) {
          blockers.push(`${call.action}: noted only (${response.result.reason || "API limitation"})`);
        }
        if (call.action === "render" && response?.ok) {
          const jobId = response.result?.jobId;
          const customName = call.payload?.name || plan.project;
          const file = await waitForRender(askResolve, jobId, customName);
          if (!file) {
            blockers.push("render finished without a discoverable output file");
          } else {
            const duration = probeDuration(file.path);
            let preview = null;
            if (typeof uploadPreview === "function") {
              preview = await uploadPreview({
                name: file.name,
                path: file.path,
                duration,
                project: plan.project,
                instruction,
                publish: false,
              });
            }
            results.push({
              step: "render_complete",
              ok: true,
              file: file.name,
              path: file.path,
              duration,
              preview,
            });
            plan.render = { name: file.name, path: file.path, duration, preview };
          }
        }
      } catch (error) {
        blockers.push(`${call.action}: ${error.message}`);
        results.push({ step: step.command, action: call.action, ok: false, error: error.message });
      }
    }
  }

  plan.blockers = blockers;
  const record = {
    at: new Date().toISOString(),
    instruction,
    project: plan.project,
    revisionNote,
    render: plan.render || null,
    blockers,
    publish: false,
  };
  if (revisionNote) rememberRevision({ ...record, note: revisionNote });
  else rememberProduction(record);

  writeFileSync(join(ROOT, "last-creative-plan.json"), JSON.stringify(plan, null, 2));
  writeFileSync(join(ROOT, "last-creative-results.json"), JSON.stringify(results, null, 2));

  return {
    ok: blockers.filter((item) => !/noted only|API limitation/i.test(item)).length === 0 && Boolean(plan.render),
    publish: false,
    plan,
    results,
    memory: readCreativeMemory(),
    brandKit: {
      logos: logos.map((item) => item.id),
      music: music?.id || null,
      gaps: kit.gaps,
    },
  };
}

export function copyRenderIntoMedia(name) {
  const src = join(RENDERS, name);
  if (!existsSync(src)) return null;
  const dest = join(MEDIA, name);
  copyFileSync(src, dest);
  return dest;
}

export function readRenderBytes(nameOrPath) {
  const full = existsSync(nameOrPath) ? nameOrPath : join(RENDERS, nameOrPath);
  if (!existsSync(full)) return null;
  return {
    name: basename(full),
    path: full,
    bytes: readFileSync(full),
    size: statSync(full).size,
    duration: probeDuration(full),
  };
}
