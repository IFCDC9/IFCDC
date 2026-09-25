/**
 * Creative production runner — Phase 4 IFCDC PRODUCTION intelligence.
 * Stages production kit, captions, multi-format masters, revisions; returns drafts to HQ.
 * publish stays false. Never overwrites protected proof projects.
 */
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, join } from "path";
import { planInstruction, toResolveCall } from "./commands.mjs";
import { directCreativeIdea } from "./director.mjs";
import { parseRevision, formatFromRevisionOrInstruction, VERTICAL, LANDSCAPE, SQUARE } from "./revision.mjs";
import {
  rememberProduction,
  rememberRevision,
  rememberMaster,
  rememberEditorial,
  rememberGate,
  ensureCompanyMemory,
  readCreativeMemory,
  PRODUCTION_COMPANY,
} from "./memory.mjs";
import { pickAssets, stageBrandKit } from "../brand/kit.mjs";
import { ensureProductionKit, kitAsset, PRODUCTION_COMPANY as KIT_COMPANY } from "../brand/production-kit.mjs";
import { ensureGlobalProductionIdentity, PRODUCTIONS_ROOT } from "../brand/production-identity.mjs";
import { clonePlan } from "../clone/pipeline.mjs";
import { gatePayload } from "./gates.mjs";
import { generateMissingAssets, bootGenerationEngine } from "../generation/engine.mjs";
import { buildProductionPipeline } from "../pipeline/production-pipeline.mjs";
import { ensureFounderIdentityLibrary } from "../library/founder-identity.mjs";
import { inventoryProductionKitSlots } from "../brand/production-kit-slots.mjs";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEDIA = join(ROOT, "media");
const RENDERS = join(ROOT, "renders");
const GENERATED = join(MEDIA, "generated");
const GENERATED_LIBRARY = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA");
const MASTERS = join(RENDERS, "masters");

const PROTECTED_PROJECTS = new Set([
  "IFCDC-AURA-BRIDGE-PROOF",
  "IFCDC-AURA-BRIDGE-PROOF-2",
  "IFCDC-AURA-BARBERS-PROMO-V1",
  "IFCDC-NEXT LEVEL",
]);

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

function overlayOnStill(baseStill, overlayPng, output, { seconds = 2.5, width = 1080, height = 1920 } = {}) {
  runFfmpeg([
    "-loop", "1",
    "-i", baseStill,
    "-loop", "1",
    "-i", overlayPng,
    "-t", String(seconds),
    "-filter_complex",
    `[0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black[bg];` +
      `[1]scale=${width}:${height}[ov];[bg][ov]overlay=0:0,format=yuv420p`,
    "-r", "24",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-an",
    output,
  ]);
  return output;
}

function pngToClip(png, output, { seconds = 2.4, width = 1080, height = 1920, fadeOut = false } = {}) {
  return stillToClip(png, output, { seconds, width, height, fadeOut });
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

function trimAudio(input, output, seconds = 14, volume = 0.28) {
  const fadeStart = Math.max(0.5, seconds - 1.4);
  runFfmpeg([
    "-i", input,
    "-t", String(seconds),
    "-af", `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeStart}:d=1.2,volume=${volume}`,
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

function remasterFormat(sourcePath, format, outPath) {
  const { width, height } = format;
  runFfmpeg([
    "-i", sourcePath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    outPath,
  ]);
  return outPath;
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

function findExistingMaster(projectHint = "IFCDC-AURA-BARBERS-PROMO-V1") {
  const candidates = [];
  if (existsSync(RENDERS)) {
    for (const name of readdirSync(RENDERS)) {
      if (!name.endsWith(".mp4")) continue;
      if (name.includes(projectHint) || name.includes("BARBERS-PROMO")) {
        candidates.push({ name, path: join(RENDERS, name), mtime: statSync(join(RENDERS, name)).mtimeMs });
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

/**
 * Multi-format mastering from an existing accepted master (no Phase 3 rebuild).
 */
export async function runMultiFormatMastering({
  sourceProject = "IFCDC-AURA-BARBERS-PROMO-V1",
  sourcePath = null,
  formats = [VERTICAL, LANDSCAPE, SQUARE],
  uploadPreview = null,
  projectName = "IFCDC-AURA-BARBERS-PROMO-P4",
} = {}) {
  mkdirSync(MASTERS, { recursive: true });
  ensureCompanyMemory();
  const source = sourcePath && existsSync(sourcePath)
    ? { name: basename(sourcePath), path: sourcePath }
    : findExistingMaster(sourceProject);
  if (!source) throw new Error(`No existing master found for ${sourceProject}`);

  const masters = [];
  for (const format of formats) {
    const label = format.label.replace(":", "x");
    const outName = `${projectName}-${label}.mp4`;
    const outPath = join(MASTERS, outName);
    remasterFormat(source.path, format, outPath);
    // Also place a copy at renders root for Discoverability
    const renderCopy = join(RENDERS, outName);
    copyFileSync(outPath, renderCopy);
    const duration = probeDuration(outPath);
    let preview = null;
    if (typeof uploadPreview === "function") {
      preview = await uploadPreview({
        name: outName,
        path: outPath,
        duration,
        project: projectName,
        instruction: `Multi-format master ${format.label} from ${source.name}`,
        publish: false,
        format: format.label,
      });
    }
    masters.push({
      format: format.label,
      name: outName,
      path: outPath,
      duration,
      preview,
      source: source.name,
    });
  }

  const record = {
    at: new Date().toISOString(),
    company: PRODUCTION_COMPANY,
    project: projectName,
    source: source.name,
    masters,
    publish: false,
  };
  rememberMaster(record);
  rememberGate({ gate: "MASTER", at: record.at, project: projectName });
  rememberEditorial({
    at: record.at,
    kind: "multiformat_mastering",
    decisions: masters.map((m) => `${m.format} · ${m.duration?.toFixed?.(1) || "?"}s`),
    preferences: { formats: masters.map((m) => m.format) },
  });

  return {
    ok: masters.every((m) => existsSync(m.path)),
    publish: false,
    company: PRODUCTION_COMPANY,
    gate: gatePayload("MASTER"),
    source,
    masters,
    memory: readCreativeMemory(),
  };
}

export async function runCreativeProduction({
  instruction,
  askResolve,
  revisionNote = null,
  uploadPreview = null,
  projectName = null,
  masterFormatsAfter = false,
} = {}) {
  mkdirSync(GENERATED, { recursive: true });
  mkdirSync(RENDERS, { recursive: true });
  ensureCompanyMemory();
  ensureGlobalProductionIdentity({ forceCards: false });
  ensureProductionKit({ force: true });
  clonePlan(instruction);

  const director = directCreativeIdea(instruction, {
    revisionNote,
    projectName: projectName || undefined,
  });
  const revision = revisionNote
    ? parseRevision(revisionNote, {
        instruction,
        projectName: director.project,
        preferences: readCreativeMemory().preferences,
      })
    : director.revision;

  // Format-only remasters reuse the existing V1/P4 master without a full rebuild.
  if (revision?.remasterFromExisting && revision.format) {
    const mastered = await runMultiFormatMastering({
      sourceProject: "IFCDC-AURA-BARBERS-PROMO-V1",
      formats: [revision.format],
      uploadPreview,
      projectName: projectName || "IFCDC-AURA-BARBERS-PROMO-P4",
    });
    rememberRevision({
      at: new Date().toISOString(),
      instruction,
      revisionNote,
      intents: revision.intents,
      project: mastered.project || projectName || "IFCDC-AURA-BARBERS-PROMO-P4",
      render: mastered.masters?.[0] || null,
      masters: mastered.masters,
      preferences: revision.preferences,
      publish: false,
      note: revisionNote,
    });
    return {
      ok: mastered.ok,
      publish: false,
      mode: "format_remaster",
      director,
      revision,
      ...mastered,
    };
  }

  // Phase 5 generative path for non-Barbers projects: search → generate only if configured → plan-only otherwise.
  const lowerInstruction = String(instruction || "").toLowerCase();
  const isBarbersCommercial = /barber/.test(lowerInstruction);
  if (!isBarbersCommercial) {
    const generative = await runGenerativeProduction({
      instruction,
      director,
      revision,
      revisionNote,
      uploadPreview,
      askResolve,
      projectName: projectName || director.project,
    });
    if (generative) return generative;
  }

  const kit = stageBrandKit({ intoMedia: true });
  const logos = pickAssets(kit, ["logo"]);
  const broll = (kit.staged || []).filter((item) => item.role === "broll" || item.role === "app-store");
  const music =
    (kit.staged || []).find((item) => item.role === "music") ||
    (kit.staged || []).find((item) => item.role === "music-fallback");

  const format = revision?.format || director.format || VERTICAL;
  const musicVolume = revision?.musicVolume ?? director.MUSIC_DIRECTION?.level ?? 0.28;
  const openSeconds = revision?.openSeconds ?? 2.2;
  const fadeSeconds = revision?.fadeSeconds ?? 1.4;

  let project = projectName || director.project || "IFCDC-AURA-BARBERS-PROMO-P4";
  // Never overwrite protected accepted projects when doing new Phase 4 creative work.
  if (!revisionNote && PROTECTED_PROJECTS.has(project)) {
    project = "IFCDC-AURA-BARBERS-PROMO-P4";
  }
  // Revisions against "current production" may target P4 (or explicitly named project).
  if (revisionNote && PROTECTED_PROJECTS.has(project) && project === "IFCDC-AURA-BARBERS-PROMO-V1") {
    project = "IFCDC-AURA-BARBERS-PROMO-P4";
  }

  const titleCard = kitAsset("title-card", format.label);
  const endCard = kitAsset("end-card", format.label);
  const ctaCard = kitAsset("social-cta", format.label);
  const captionPlate = kitAsset("caption-plate", format.label);
  const lowerThird = kitAsset("lower-third", format.label);

  const stillSources = [
    logos[0]?.mediaPath,
    broll[0]?.mediaPath,
    broll[1]?.mediaPath || logos[1]?.mediaPath || logos[0]?.mediaPath,
  ].filter(Boolean);

  if (stillSources.length < 2) {
    throw new Error("Need at least two approved brand/product stills to build a creative draft");
  }

  const clipPaths = [];

  // Open: title card from production kit
  if (titleCard?.path || titleCard?.mediaPath) {
    const openPath = join(GENERATED, "promo-open-title.mp4");
    pngToClip(titleCard.mediaPath || titleCard.path, openPath, {
      seconds: openSeconds,
      width: format.width,
      height: format.height,
    });
    clipPaths.push(openPath);
  } else {
    const openPath = join(GENERATED, "promo-clip-1.mp4");
    stillToClip(stillSources[0], openPath, { seconds: openSeconds, width: format.width, height: format.height });
    clipPaths.push(openPath);
  }

  // Proof A
  {
    const out = join(GENERATED, "promo-proof-a.mp4");
    if (captionPlate?.path || captionPlate?.mediaPath) {
      overlayOnStill(stillSources[1] || stillSources[0], captionPlate.mediaPath || captionPlate.path, out, {
        seconds: 2.6,
        width: format.width,
        height: format.height,
      });
    } else {
      stillToClip(stillSources[1] || stillSources[0], out, { seconds: 2.6, width: format.width, height: format.height });
    }
    clipPaths.push(out);
  }

  const transitionPath = join(GENERATED, "aura-transition-flash.mp4");
  makeTransitionFlash(transitionPath, format);

  // Proof B with lower-third overlay when available
  {
    const out = join(GENERATED, "promo-proof-b.mp4");
    const base = stillSources[2] || stillSources[0];
    if (lowerThird?.path || lowerThird?.mediaPath) {
      overlayOnStill(base, lowerThird.mediaPath || lowerThird.path, out, {
        seconds: 2.6,
        width: format.width,
        height: format.height,
      });
    } else {
      stillToClip(base, out, { seconds: 2.6, width: format.width, height: format.height });
    }
    clipPaths.push(out);
  }

  // CTA card
  if (ctaCard?.path || ctaCard?.mediaPath) {
    const out = join(GENERATED, "promo-cta.mp4");
    pngToClip(ctaCard.mediaPath || ctaCard.path, out, {
      seconds: 2.2,
      width: format.width,
      height: format.height,
    });
    clipPaths.push(out);
  }

  // End card + smooth fade
  const fadePath = join(GENERATED, "aura-fade-out.mp4");
  if (endCard?.path || endCard?.mediaPath) {
    const endClip = join(GENERATED, "promo-end-card.mp4");
    pngToClip(endCard.mediaPath || endCard.path, endClip, {
      seconds: Math.max(2.0, fadeSeconds),
      width: format.width,
      height: format.height,
      fadeOut: true,
    });
    clipPaths.push(endClip);
  } else {
    const fadedEnding = join(GENERATED, "promo-clip-ending-fade.mp4");
    stillToClip(stillSources[stillSources.length - 1], fadedEnding, {
      seconds: Math.max(2.2, fadeSeconds),
      width: format.width,
      height: format.height,
      fadeOut: true,
    });
    clipPaths.push(fadedEnding);
  }
  makeFadeBlack(fadePath, { ...format, seconds: Math.max(1.1, fadeSeconds * 0.7) });

  let musicPath = null;
  if (music?.mediaPath || music?.source) {
    musicPath = join(GENERATED, "promo-music-bed.m4a");
    trimAudio(music.mediaPath || music.source, musicPath, 16, musicVolume);
  }

  const logoPath = logos[0]?.mediaPath || null;
  const arranged = [];
  for (let i = 0; i < clipPaths.length; i += 1) {
    arranged.push(clipPaths[i]);
    if (i < clipPaths.length - 1) arranged.push(transitionPath);
  }
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
    projectName: project,
  });
  plan.format = format;
  plan.FORMAT = format.label;
  plan.company = KIT_COMPANY;
  plan.PRODUCTION_CREDITS = director.PRODUCTION_CREDITS;
  plan.director = {
    CONCEPT: director.CONCEPT,
    SCRIPT: director.SCRIPT,
    SCENE_PLAN: director.SCENE_PLAN,
    SHOT_LIST: director.SHOT_LIST,
    ASSET_REQUIREMENTS: director.ASSET_REQUIREMENTS,
    EDITORIAL: director.EDITORIAL,
  };

  const timelineName = `${plan.project}-TL-${Date.now().toString(36).slice(-5)}`;
  plan.timeline = timelineName;
  for (const step of plan.steps) {
    if (step.command === "create_project") {
      step.payload = { ...(step.payload || {}), name: project, width: format.width, height: format.height };
    }
    if (step.command === "create_timeline") step.payload = { ...(step.payload || {}), name: timelineName };
    if (step.command === "create_bin") step.payload = { ...(step.payload || {}), name: `${project}-BIN` };
    if (step.command?.startsWith("render_")) {
      step.command =
        format.label === "16:9" ? "render_landscape" : format.label === "1:1" ? "render_square" : "render_vertical";
      step.payload = { name: `${project}-DRAFT`, ...format };
    }
  }

  if (revisionNote) {
    plan.revisionNote = revisionNote;
    plan.revision = revision;
    plan.TEXT_TITLES = [...(plan.TEXT_TITLES || []), `Revision: ${revisionNote}`, PRODUCTION_COMPANY].slice(0, 5);
  } else {
    plan.TEXT_TITLES = [...(plan.TEXT_TITLES || []), PRODUCTION_COMPANY].slice(0, 4);
  }

  rememberGate({ gate: revisionNote ? "FOUNDER_REVISION" : "BUILD", at: new Date().toISOString(), project });

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
                format: format.label,
              });
            }
            results.push({
              step: "render_complete",
              ok: true,
              file: file.name,
              path: file.path,
              duration,
              preview,
              format: format.label,
            });
            plan.render = { name: file.name, path: file.path, duration, preview, format: format.label };
          }
        }
      } catch (error) {
        blockers.push(`${call.action}: ${error.message}`);
        results.push({ step: step.command, action: call.action, ok: false, error: error.message });
      }
    }
  }

  plan.blockers = blockers;

  let masters = null;
  if (masterFormatsAfter && plan.render?.path) {
    try {
      masters = await runMultiFormatMastering({
        sourcePath: plan.render.path,
        formats: [VERTICAL, LANDSCAPE, SQUARE],
        uploadPreview,
        projectName: plan.project,
      });
    } catch (error) {
      blockers.push(`multiformat: ${error.message}`);
    }
  }

  const record = {
    at: new Date().toISOString(),
    company: PRODUCTION_COMPANY,
    instruction,
    project: plan.project,
    revisionNote,
    revisionIntents: revision?.intents || [],
    render: plan.render || null,
    masters: masters?.masters || null,
    blockers,
    publish: false,
    gate: revisionNote ? "FOUNDER_REVISION" : "HQ_PREVIEW",
  };
  if (revisionNote) {
    rememberRevision({ ...record, note: revisionNote, preferences: revision?.preferences });
  } else {
    rememberProduction(record);
  }
  rememberEditorial({
    at: record.at,
    project: plan.project,
    decisions: director.EDITORIAL,
    preferences: {
      musicVolume,
      fadeSeconds,
      openSeconds,
      endings: revision?.endingStyle || director.ENDING,
      formats: [format.label],
    },
  });
  rememberGate({ gate: record.gate, at: record.at, project: plan.project });

  writeFileSync(join(ROOT, "last-creative-plan.json"), JSON.stringify({ ...plan, director }, null, 2));
  writeFileSync(join(ROOT, "last-creative-results.json"), JSON.stringify(results, null, 2));

  return {
    ok: blockers.filter((item) => !/noted only|API limitation/i.test(item)).length === 0 && Boolean(plan.render),
    publish: false,
    company: PRODUCTION_COMPANY,
    gate: gatePayload(record.gate),
    plan,
    director,
    revision,
    results,
    masters: masters?.masters || null,
    memory: readCreativeMemory(),
    brandKit: {
      logos: logos.map((item) => item.id),
      music: music?.id || null,
      gaps: kit.gaps,
      productionKit: true,
    },
    assetIntelligence: director.ASSET_REQUIREMENTS,
    clone: clonePlan(instruction),
  };
}

/**
 * Phase 5 generative production for non-person / non-Barbers ideas.
 * Generates only configured non-person assets (e.g. title graphic).
 * Never invents media. Never synthesizes a face/voice.
 */
export async function runGenerativeProduction({
  instruction,
  director,
  revision = null,
  revisionNote = null,
  uploadPreview = null,
  askResolve = null,
  projectName = null,
} = {}) {
  bootGenerationEngine();
  ensureFounderIdentityLibrary();
  mkdirSync(join(GENERATED_LIBRARY, "images"), { recursive: true });
  mkdirSync(join(GENERATED_LIBRARY, "video"), { recursive: true });
  mkdirSync(GENERATED, { recursive: true });
  mkdirSync(RENDERS, { recursive: true });

  const format = revision?.format || director.format || VERTICAL;
  const project = projectName || director.project || "IFCDC-AURA-GENERATIVE";
  if (PROTECTED_PROJECTS.has(project)) {
    return {
      ok: false,
      publish: false,
      mode: "blocked_protected_project",
      error: `Refusing to overwrite protected project ${project}`,
      director,
    };
  }

  const durationSeconds = Number(String(director.DURATION || "15").replace(/\D/g, "")) || 15;
  const needs = (director.GENERATION?.needs || []).map((need) => ({
    ...need,
    fileName:
      need.capability === "graphics_title_graphics"
        ? `${project}-title-${Date.now().toString(36)}.png`
        : need.fileName,
  }));

  const generation = await generateMissingAssets(needs, {
    outDir: join(GENERATED_LIBRARY, "images"),
    title: director.brandPromoted || "IFCDC",
    subtitle: /bumper|train/i.test(instruction) ? "Training bumper" : director.projectTitle || "",
    credit: "IFCDC PRODUCTIONS",
    width: format.width,
    height: format.height,
  });

  const pipeline = buildProductionPipeline({
    instruction,
    brandPromoted: director.brandPromoted,
    projectTitle: director.projectTitle,
    project,
    format,
    durationSeconds,
    script: director.SCRIPT,
    scenes: director.SCENE_PLAN,
    shotList: director.SHOT_LIST,
    assetInventory: director.ASSET_REQUIREMENTS,
    librarySearch: director.LIBRARY_SEARCH,
    continuity: director.CONTINUITY,
    creativeMemory: readCreativeMemory(),
    generation,
  });

  const kitSlots = inventoryProductionKitSlots({ forceCompose: false });
  rememberGate({ gate: generation.anyGenerated ? "GENERATE" : "PLAN", at: new Date().toISOString(), project });

  // Plan-only: no configured generation that produced a real file.
  if (!generation.anyGenerated) {
    const record = {
      at: new Date().toISOString(),
      company: PRODUCTION_COMPANY,
      instruction,
      project,
      mode: "phase5_plan_only",
      generation,
      pipeline,
      publish: false,
      gate: "PLAN",
    };
    rememberProduction(record);
    writeFileSync(join(ROOT, "last-creative-plan.json"), JSON.stringify({ director, pipeline, generation }, null, 2));
    return {
      ok: true,
      publish: false,
      mode: "phase5_plan_only",
      company: PRODUCTION_COMPANY,
      productionCompany: PRODUCTION_COMPANY,
      productionIdentity: "IFCDC PRODUCTION",
      brandPromoted: director.brandPromoted,
      gate: gatePayload("PLAN"),
      plan: { ...director, project, PIPELINE: pipeline, GENERATION: generation },
      director,
      pipeline,
      generation,
      assetGaps: generation.missing,
      productionKitSlots: kitSlots,
      clone: clonePlan(instruction),
      message:
        "Pipeline planned and queued. Missing generators listed exactly — no media invented. Start again when a provider is configured, or supply approved assets.",
      render: null,
      inventedMedia: false,
    };
  }

  // Real non-person graphic exists — build a short bumper draft and return to HQ.
  const graphic = generation.generated.find((g) => g.capability === "graphics_title_graphics" && g.path);
  if (!graphic?.path || !existsSync(graphic.path)) {
    return {
      ok: false,
      publish: false,
      mode: "phase5_generation_reported_without_file",
      generation,
      director,
      inventedMedia: false,
    };
  }

  const endCard = kitAsset("end-card", format.label);
  const openSeconds = Math.min(8, Math.max(4, durationSeconds * 0.55));
  const endSeconds = Math.max(2.5, durationSeconds - openSeconds);
  const openClip = join(GENERATED, `${project}-open.mp4`);
  const endClip = join(GENERATED, `${project}-end.mp4`);
  const fadePath = join(GENERATED, `${project}-fade.mp4`);
  pngToClip(graphic.path, openClip, {
    seconds: openSeconds,
    width: format.width,
    height: format.height,
  });
  if (endCard?.path || endCard?.mediaPath) {
    pngToClip(endCard.mediaPath || endCard.path, endClip, {
      seconds: endSeconds,
      width: format.width,
      height: format.height,
      fadeOut: true,
    });
  } else {
    stillToClip(graphic.path, endClip, {
      seconds: endSeconds,
      width: format.width,
      height: format.height,
      fadeOut: true,
    });
  }
  makeFadeBlack(fadePath, { ...format, seconds: 1.1 });

  const draftName = `${project}-DRAFT`;
  const draftPath = join(RENDERS, `${draftName}.mp4`);
  // Concat open + end + fade into a single draft without overwriting V1/P4.
  const listFile = join(GENERATED, `${project}-concat.txt`);
  writeFileSync(
    listFile,
    [openClip, endClip, fadePath].map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", draftPath]);

  // Also stage generated video under GENERATED_FOUNDER_MEDIA (separate from originals).
  const stagedVideo = join(GENERATED_LIBRARY, "video", `${draftName}.mp4`);
  copyFileSync(draftPath, stagedVideo);

  const duration = probeDuration(draftPath);
  let preview = null;
  if (typeof uploadPreview === "function") {
    preview = await uploadPreview({
      name: `${draftName}.mp4`,
      path: draftPath,
      duration,
      project,
      instruction,
      publish: false,
      format: format.label,
    });
  }

  // Best-effort place through Resolve when askResolve is available — never required for HQ preview.
  const resolveResults = [];
  if (typeof askResolve === "function") {
    try {
      const created = await askResolve("create_project", {
        name: project,
        frameRate: "24",
        width: format.width,
        height: format.height,
      });
      resolveResults.push({ action: "create_project", ...created });
      const imported = await askResolve("import_media", { paths: [openClip, endClip, draftPath] });
      resolveResults.push({ action: "import_media", ...imported });
    } catch (error) {
      resolveResults.push({ action: "resolve_place", ok: false, error: error.message });
    }
  }

  const record = {
    at: new Date().toISOString(),
    company: PRODUCTION_COMPANY,
    instruction,
    project,
    mode: "phase5_generative_draft",
    generation,
    render: { name: `${draftName}.mp4`, path: draftPath, duration, preview, format: format.label },
    generatedGraphic: { name: graphic.file, kind: graphic.kind },
    publish: false,
    gate: "HQ_PREVIEW",
  };
  rememberProduction(record);
  rememberGate({ gate: "HQ_PREVIEW", at: record.at, project });
  writeFileSync(join(ROOT, "last-creative-plan.json"), JSON.stringify({ director, pipeline, generation, record }, null, 2));
  writeFileSync(join(ROOT, "last-creative-results.json"), JSON.stringify({ resolveResults, preview }, null, 2));

  return {
    ok: Boolean(existsSync(draftPath)),
    publish: false,
    mode: "phase5_generative_draft",
    company: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: "IFCDC PRODUCTION",
    brandPromoted: director.brandPromoted,
    gate: gatePayload("HQ_PREVIEW"),
    plan: { ...director, project, PIPELINE: pipeline, GENERATION: generation, render: record.render },
    director,
    pipeline,
    generation,
    productionKitSlots: kitSlots,
    clone: clonePlan(instruction),
    render: record.render,
    preview,
    resolveResults,
    inventedMedia: false,
    realGeneratedFile: graphic.file,
    message: "Non-person title graphic generated, draft bumper built, preview returned to HQ. publish stays false.",
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
