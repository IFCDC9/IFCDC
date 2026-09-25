/**
 * Phase 7 — AURA autonomous production orchestration.
 * Founder NL → plan → search library → generate only missing → Resolve build → HQ draft.
 * Prefer reuse of approved Runway clips / Phase 6 stills / music. Minimum credits.
 * publish stays false. Non-person proof only.
 */
import { spawnSync } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { basename, extname, join } from "path";
import { parseFounderIntake, PHASE7_GATE_STATES, VERTICAL, LANDSCAPE, SQUARE } from "./intake.mjs";
import { parseRevision } from "./revision.mjs";
import {
  rememberProduction,
  rememberRevision,
  rememberGate,
  rememberEditorial,
  appendPreference,
  ensureCompanyMemory,
  readCreativeMemory,
  PRODUCTION_COMPANY,
} from "./memory.mjs";
import { gatePayload } from "./gates.mjs";
import { ensureProductionKit, kitAsset } from "../brand/production-kit.mjs";
import { ensureGlobalProductionIdentity, PRODUCTIONS_ROOT } from "../brand/production-identity.mjs";
import { stageBrandKit, pickAssets } from "../brand/kit.mjs";
import { searchAssetLibrary, buildAssetLibraryIndex } from "../library/asset-library.mjs";
import { bootGenerationEngine, generateMissingAssets } from "../generation/engine.mjs";
import { buildProductionPipeline } from "../pipeline/production-pipeline.mjs";
import { recordCostEntry, creditsUsedForProject } from "./cost-ledger.mjs";
import {
  createAutonomousJob,
  updateAutonomousJob,
  markStepComplete,
  resumeAutonomousJob,
  readAutonomousJob,
  findLatestJobForProject,
} from "./job-recovery.mjs";

const ROOT = join(homedir(), "Library/Application Support/IFCDC/aura-resolve");
const MEDIA = join(ROOT, "media");
const RENDERS = join(ROOT, "renders");
const GENERATED = join(MEDIA, "generated");
const GENERATED_LIBRARY = join(PRODUCTIONS_ROOT, "GENERATED_FOUNDER_MEDIA");

const PROTECTED = new Set([
  "IFCDC-AURA-BRIDGE-PROOF",
  "IFCDC-AURA-BRIDGE-PROOF-2",
  "IFCDC-AURA-BARBERS-PROMO-V1",
  "IFCDC-AURA-BARBERS-PROMO-P4",
  "IFCDC-NEXT LEVEL",
]);

const REUSE_VIDEO_HINTS = [
  "runway-t2v-muh4b6qu.mp4",
  "runway-i2v-muh4c5t4.mp4",
];
const REUSE_IMAGE_HINTS = [
  "phase6-openai-image-muh0wbxg.png",
];
const REUSE_MUSIC_HINTS = [
  "ifcdc-music-nite-day.mp3",
  "IFCDC-NITE-DAY",
];

function runFfmpeg(args) {
  const result = spawnSync("ffmpeg", ["-y", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || result.stdout || "").slice(-400)}`);
  }
  return result;
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

function stillToClip(input, output, { seconds = 2.5, width = 1080, height = 1920, fadeOut = false } = {}) {
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    "format=yuv420p",
  ];
  if (fadeOut) {
    const start = Math.max(0, seconds - 1.0);
    filters.push(`fade=t=out:st=${start}:d=0.9`);
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

function remasterClip(input, output, { seconds = null, width = 1080, height = 1920 } = {}) {
  const args = ["-i", input];
  if (seconds != null) args.push("-t", String(seconds));
  args.push(
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`,
    "-r", "24",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+faststart",
    output,
  );
  runFfmpeg(args);
  return output;
}

function remasterWithAudio(input, output, { width = 1920, height = 1080, musicVolume = null } = {}) {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p`;
  if (musicVolume != null) {
    runFfmpeg([
      "-i", input,
      "-vf", vf,
      "-af", `volume=${musicVolume}`,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      output,
    ]);
  } else {
    runFfmpeg([
      "-i", input,
      "-vf", vf,
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      output,
    ]);
  }
  return output;
}

function trimAudio(input, output, seconds = 12, volume = 0.28) {
  const fadeStart = Math.max(0.5, seconds - 1.2);
  runFfmpeg([
    "-i", input,
    "-t", String(seconds),
    "-af", `afade=t=in:st=0:d=0.35,afade=t=out:st=${fadeStart}:d=1.0,volume=${volume}`,
    "-c:a", "aac",
    "-b:a", "160k",
    output,
  ]);
  return output;
}

function makeFadeBlack(output, { width = 1080, height = 1920, seconds = 1.0 } = {}) {
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

function makeTransitionFlash(output, { width = 1080, height = 1920 } = {}) {
  runFfmpeg([
    "-f", "lavfi",
    "-i", `color=c=0xC9A227:s=${width}x${height}:d=0.28:r=24`,
    "-f", "lavfi",
    "-i", `color=c=black:s=${width}x${height}:d=0.12:r=24`,
    "-filter_complex", "[0][1]concat=n=2:v=1:a=0,format=yuv420p",
    "-c:v", "libx264",
    "-an",
    output,
  ]);
  return output;
}

function findByHint(hints, roots) {
  for (const hint of hints) {
    for (const root of roots) {
      if (!existsSync(root)) continue;
      const direct = join(root, hint);
      if (existsSync(direct)) return direct;
      // walk shallow
      try {
        for (const name of readdirSync(root)) {
          if (name === hint || name.includes(hint.replace(/\.\w+$/, ""))) {
            const full = join(root, name);
            if (existsSync(full) && statSync(full).isFile()) return full;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/**
 * Search IFCDC asset library BEFORE any generation. Prefer approved reuse.
 */
export function searchBeforeGenerate(intake) {
  const brand = intake.brandPromoted || intake.fields?.BRAND || "IFCDC";
  const query = [brand, "youth", "logo", "branding", "runway", "phase6", "nite"].filter(Boolean).join(" ");
  const librarySearch = searchAssetLibrary(query, { limit: 60 });
  const index = buildAssetLibraryIndex();

  const videoRoots = [
    join(GENERATED_LIBRARY, "video"),
    join(ROOT, "renders"),
    MEDIA,
  ];
  const imageRoots = [
    join(GENERATED_LIBRARY, "images"),
    MEDIA,
    join(PRODUCTIONS_ROOT, "production-kit"),
  ];
  const musicRoots = [MEDIA, join(PRODUCTIONS_ROOT, "Music"), ROOT];

  const reusedVideo = findByHint(REUSE_VIDEO_HINTS, videoRoots);
  const reusedImage = findByHint(REUSE_IMAGE_HINTS, imageRoots);
  const reusedMusic =
    findByHint(REUSE_MUSIC_HINTS, musicRoots) ||
    (librarySearch.localMatches || []).find((m) => /music|nite|mp3|m4a|wav/i.test(`${m.name} ${m.category}`))?.path ||
    null;

  const kit = stageBrandKit({ intoMedia: true });
  const logos = pickAssets(kit, ["logo"]);
  const endCard = kitAsset("end-card", intake.format?.label || "9:16");
  const titleCard = kitAsset("title-card", intake.format?.label || "9:16");

  const existingToUse = [];
  if (reusedVideo) {
    existingToUse.push({
      role: "hero_motion",
      name: basename(reusedVideo),
      path: reusedVideo,
      source: "approved_runway_library",
      capability: "text_to_video",
    });
  }
  if (reusedImage) {
    existingToUse.push({
      role: "brand_still",
      name: basename(reusedImage),
      path: reusedImage,
      source: "phase6_approved_still",
      capability: "image_generation",
    });
  }
  if (titleCard?.path || titleCard?.mediaPath) {
    existingToUse.push({
      role: "title_card",
      name: basename(titleCard.mediaPath || titleCard.path),
      path: titleCard.mediaPath || titleCard.path,
      source: "production_kit",
      capability: "graphics_title_graphics",
    });
  }
  if (endCard?.path || endCard?.mediaPath) {
    existingToUse.push({
      role: "end_card",
      name: basename(endCard.mediaPath || endCard.path),
      path: endCard.mediaPath || endCard.path,
      source: "production_kit",
      capability: "graphics_title_graphics",
    });
  }
  for (const logo of logos.slice(0, 2)) {
    if (logo.mediaPath || logo.source) {
      existingToUse.push({
        role: "logo",
        name: logo.mediaName || basename(logo.mediaPath || logo.source),
        path: logo.mediaPath || logo.source,
        source: "brand_kit",
        capability: "graphics_title_graphics",
      });
    }
  }
  if (reusedMusic) {
    existingToUse.push({
      role: "music",
      name: basename(reusedMusic),
      path: reusedMusic,
      source: "approved_music_library",
      capability: "music_sound_integration",
    });
  }

  // Also pick any youth/brand matches from library search
  for (const match of librarySearch.localMatches || []) {
    if (existingToUse.some((e) => e.name === match.name)) continue;
    if (/youth|brand|logo|title|end.?card/i.test(`${match.name} ${match.category} ${match.label || ""}`)) {
      if (match.path && existsSync(match.path)) {
        existingToUse.push({
          role: match.category || "library",
          name: match.name,
          path: match.path,
          source: "asset_library_search",
          capability: null,
        });
      }
    }
  }

  const hasMotion = existingToUse.some((e) => e.role === "hero_motion" || /\.mp4$/i.test(e.name || ""));
  const hasStill = existingToUse.some((e) => /still|title|logo|image|\.png|\.jpg/i.test(`${e.role} ${e.name}`));
  const hasMusic = existingToUse.some((e) => e.role === "music");

  const newRequired = [];
  if (!hasMotion && !hasStill) {
    newRequired.push({
      capability: "text_to_video",
      label: "Short non-person motion bumper (2s gen4_turbo)",
      durationSeconds: 2,
      required: true,
      reason: "No reusable approved video or still found",
    });
  }
  // If we have picture coverage, do NOT request Runway.
  if (!hasMusic && /music|bed|aggressive/i.test(String(intake.fields?.MUSIC || ""))) {
    newRequired.push({
      capability: "music_sound_integration",
      label: "Approved music bed",
      required: false,
      reason: "No approved music found in library",
    });
  }

  return {
    searchedBeforeGenerate: true,
    query,
    totalIndexed: index.count || librarySearch.totalIndexed,
    categories: librarySearch.categories,
    matchCount: (librarySearch.matches || []).length,
    matches: (librarySearch.matches || []).slice(0, 20),
    localMatches: librarySearch.localMatches || [],
    EXISTING_ASSETS_TO_USE: existingToUse.map(({ path, ...rest }) => ({ ...rest, pathHint: path })),
    existingToUse,
    NEW_ASSETS_REQUIRED: newRequired,
    newRequired,
    pictureCoveredByReuse: hasMotion || hasStill,
    RUNWAY_NEEDED: !(hasMotion || hasStill),
    note: "Library search completed before any provider generate call",
  };
}

function buildCreativePlan(intake, search) {
  const fields = {
    ...intake.fields,
    EXISTING_ASSETS_TO_USE: search.EXISTING_ASSETS_TO_USE,
    NEW_ASSETS_REQUIRED: search.NEW_ASSETS_REQUIRED,
  };
  const scenes = fields.SCENES || [];
  const script = [
    { beat: "HOOK", line: `${intake.brandPromoted} — short IFCDC production.` },
    { beat: "PROOF", line: "Approved branding and program media." },
    { beat: "CTA", line: fields.CTA },
    { beat: "CREDIT", line: "AN IFCDC PRODUCTION · IFCDC PRODUCTIONS" },
  ];
  const shotList = scenes.map((s, i) => ({
    shot: i + 1,
    sceneId: s.id,
    description: s.label,
    framing: intake.format.label,
  }));
  const editPlan = {
    timeline: `${intake.project}-TL`,
    place: search.existingToUse.map((a) => a.name),
    transitions: "visible brand-flash fallback (no native dissolve claim)",
    titles: [intake.brandPromoted, fields.CTA],
    branding: "production kit cards — no company-name burn on every frame",
    music: search.existingToUse.find((a) => a.role === "music")?.name || "none",
    levels: "ffmpeg music volume when bed present",
  };
  const renderPlan = {
    name: `${intake.project}-DRAFT`,
    format: intake.format,
    codec: "H264 mp4 draft",
    publish: false,
    returnToHq: true,
  };
  const generationRequirements = {
    searchedBeforeGenerate: true,
    inventMedia: false,
    willGenerateOnlyMissing: true,
    runwayCeiling: search.RUNWAY_NEEDED ? 1 : 0,
    durationSecondsIfGenerate: 2,
    preferredModel: "gen4_turbo",
    needs: search.newRequired,
  };

  return {
    brief: {
      productionCompany: PRODUCTION_COMPANY,
      productionIdentity: "IFCDC PRODUCTION",
      brandPromoted: intake.brandPromoted,
      project: intake.project,
      purpose: `IFCDC PRODUCTION promoting ${intake.brandPromoted}`,
      style: fields.STYLE,
      platform: fields.PLATFORM,
    },
    script,
    sceneBreakdown: scenes,
    shotList,
    assetList: search.EXISTING_ASSETS_TO_USE,
    generationRequirements,
    voice: fields.VOICE,
    music: fields.MUSIC,
    editPlan,
    renderPlan,
    fields,
    NATURAL_LANGUAGE_INTAKE: fields,
  };
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
    await new Promise((r) => setTimeout(r, 1500));
  }
  const matches = existsSync(RENDERS)
    ? readdirSync(RENDERS)
        .filter((name) => name.includes(customName) || name.startsWith(customName))
        .map((name) => ({ name, path: join(RENDERS, name), mtime: statSync(join(RENDERS, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
    : [];
  return matches[0] || null;
}

/**
 * Live conversational status from persisted project + Mac state.
 */
export function conversationalStatus({ project = null, jobId = null, boardHints = {} } = {}) {
  const job = jobId ? readAutonomousJob(jobId) : findLatestJobForProject(project);
  const cost = job?.project ? creditsUsedForProject(job.project) : null;
  const workingOn = job
    ? `${job.gate || job.status} · ${job.project || "unnamed"}`
    : "No active Phase 7 job";
  const progress = job?.lastCompletedStep || "not_started";
  const runwayDone =
    (job?.completedGenerations || []).some((g) => /runway|text_to_video|image_to_video/i.test(`${g.provider} ${g.capability}`)) ||
    (job?.assetState?.existingToUse || []).some((a) => /runway/i.test(`${a.source} ${a.name}`));
  const failedScene = (job?.blockers || [])[0] || null;
  const draft = job?.previews?.[0] || job?.timelineState?.draft || null;

  const answer = [
    `Working on: ${workingOn}.`,
    `Progress: last completed step = ${progress}.`,
    `Runway: ${runwayDone ? "finished or reused from library" : "not required / not started"}; credits used = ${cost?.RUNWAY_CREDITS_USED ?? job?.cost?.runwayCredits ?? 0}.`,
    failedScene ? `Issue: ${failedScene}.` : "No scene failure recorded.",
    `Resolve / Mac: ${boardHints.productionMac || boardHints.resolve || "see HQ status"}.`,
    draft ? `Latest draft: ${draft.name || draft.file || "available"} (publish=false).` : "No draft returned yet.",
    `Needs approval: ${job?.gate === "HQ_PREVIEW" || job?.gate === "FOUNDER_APPROVAL" ? "yes — Founder preview gate" : job ? `gate ${job.gate}` : "n/a"}.`,
  ].join(" ");

  return {
    ok: true,
    phase: 7,
    questionAnswered: true,
    answer,
    workingOn,
    progress,
    runwayFinished: Boolean(runwayDone),
    creditsUsed: cost?.RUNWAY_CREDITS_USED ?? job?.cost?.runwayCredits ?? 0,
    sceneFailed: failedScene,
    resolveOnline: boardHints.resolve || null,
    productionMac: boardHints.productionMac || null,
    latestDraft: draft,
    needsApproval: job?.gate === "HQ_PREVIEW" || job?.status === "DRAFT_READY",
    job: job
      ? {
          id: job.id,
          project: job.project,
          status: job.status,
          gate: job.gate,
          lastCompletedStep: job.lastCompletedStep,
        }
      : null,
    publish: false,
  };
}

/**
 * Main autonomous production runner.
 */
export async function runAutonomousProduction({
  instruction,
  askResolve = null,
  uploadPreview = null,
  projectName = null,
  revisionNote = null,
  resumeJobId = null,
  allowRunwayIfMissing = true,
} = {}) {
  mkdirSync(GENERATED, { recursive: true });
  mkdirSync(RENDERS, { recursive: true });
  mkdirSync(join(GENERATED_LIBRARY, "video"), { recursive: true });
  mkdirSync(join(GENERATED_LIBRARY, "images"), { recursive: true });
  ensureCompanyMemory();
  ensureGlobalProductionIdentity({ forceCards: false });
  ensureProductionKit({ force: false });
  bootGenerationEngine();

  // Resume path — reload state, skip completed assets
  if (resumeJobId) {
    const resumed = resumeAutonomousJob(resumeJobId);
    if (!resumed.ok) return resumed;
    if (resumed.jobId && !instruction) {
      const job = readAutonomousJob(resumed.jobId);
      instruction = job?.instruction || instruction;
      projectName = projectName || job?.project;
    }
  }

  const intake = parseFounderIntake(instruction, { projectName });
  let project = projectName || intake.project;
  if (PROTECTED.has(project)) {
    project = "IFCDC-AURA-YOUTH-PROMO-P7";
    intake.project = project;
  }

  const job = resumeJobId
    ? readAutonomousJob(resumeJobId) || createAutonomousJob({ instruction, project, brandPromoted: intake.brandPromoted, intake })
    : createAutonomousJob({ instruction, project, brandPromoted: intake.brandPromoted, intake });

  markStepComplete(job.id, "FOUNDER_IDEA", { gate: "FOUNDER_IDEA", status: "RUNNING" });

  // AURA PLAN
  const search = searchBeforeGenerate(intake);
  const creative = buildCreativePlan(intake, search);
  intake.fields = creative.fields;
  markStepComplete(job.id, "AURA_PLAN", {
    gate: "AURA_PLAN",
    plan: creative,
    intake,
  });
  rememberGate({ gate: "PLAN", at: new Date().toISOString(), project });

  // ASSET SEARCH (already done — persist)
  markStepComplete(job.id, "ASSET_SEARCH", {
    gate: "ASSET_SEARCH",
    assetState: {
      searched: true,
      libraryMatches: search.matches,
      existingToUse: search.existingToUse.map(({ path, ...rest }) => ({ ...rest, path })),
      newRequired: search.newRequired,
      completedGenerations: job.completedGenerations || [],
    },
  });

  // GENERATION — only missing, prefer zero Runway
  let generation = {
    anyGenerated: false,
    generated: [],
    missing: [],
    skipped: [],
    reused: search.existingToUse,
    runwayCredits: 0,
  };
  const alreadyDone = new Set((job.completedGenerations || []).map((g) => g.capability || g.fileName));

  if (search.RUNWAY_NEEDED && allowRunwayIfMissing) {
    const need = search.newRequired.find((n) => /video|broll/i.test(n.capability));
    if (need && !alreadyDone.has(need.capability)) {
      markStepComplete(job.id, "GENERATION", { gate: "GENERATION", status: "GENERATING" });
      const stamp = Date.now().toString(36);
      const genResult = await generateMissingAssets(
        [
          {
            capability: "text_to_video",
            label: need.label,
            fileName: `runway-t2v-p7-${stamp}.mp4`,
            durationSeconds: 2,
            model: "gen4_turbo",
          },
        ],
        {
          outDir: join(GENERATED_LIBRARY, "video"),
          project,
          durationSeconds: 2,
          prompt:
            "Non-person abstract IFCDC gold and ivory geometric motion on deep black. Slow elegant drift. No people, no faces, no readable logos.",
          width: intake.format.width,
          height: intake.format.height,
        },
      );
      generation = { ...generation, ...genResult };
      for (const g of genResult.generated || []) {
        const credits = g.creditsUsed ?? g.CREDITS_USED ?? g.costMetadata?.credits ?? null;
        recordCostEntry({
          provider: g.provider || "runway",
          model: g.model || "gen4_turbo",
          credits,
          purpose: "missing_motion_for_autonomous_draft",
          project,
          capability: g.capability,
          accepted: false,
          metadata: { file: g.file || g.fileName },
        });
        generation.runwayCredits += Number(credits) || 0;
        const completed = [...(readAutonomousJob(job.id)?.completedGenerations || []), g];
        updateAutonomousJob(job.id, {
          completedGenerations: completed,
          providerJobIds: [...(readAutonomousJob(job.id)?.providerJobIds || []), g.jobId].filter(Boolean),
          cost: { runwayCredits: generation.runwayCredits },
        });
        if (g.path && existsSync(g.path)) {
          search.existingToUse.push({
            role: "hero_motion",
            name: basename(g.path),
            path: g.path,
            source: "generated_runway_minimum",
            capability: "text_to_video",
          });
        }
      }
    }
  } else {
    // Reuse path — ledger records zero-credit reuse
    for (const asset of search.existingToUse.filter((a) => a.role === "hero_motion")) {
      recordCostEntry({
        provider: "library_reuse",
        model: null,
        credits: 0,
        purpose: "reuse_approved_runway_clip",
        project,
        capability: asset.capability,
        accepted: true,
        reuse: true,
        reason: "Asset search found approved video before generate",
        metadata: { name: asset.name },
      });
    }
    markStepComplete(job.id, "GENERATION", {
      gate: "GENERATION",
      status: "SKIPPED_REUSE",
      cost: { runwayCredits: 0 },
    });
    generation.runwayCredits = 0;
  }

  // RESOLVE BUILD — assemble draft
  markStepComplete(job.id, "RESOLVE_BUILD", { gate: "RESOLVE_BUILD", status: "BUILDING" });

  const format = intake.format || VERTICAL;
  const stamp = Date.now().toString(36);
  const openStill =
    search.existingToUse.find((a) => a.role === "title_card")?.path ||
    search.existingToUse.find((a) => a.role === "brand_still")?.path ||
    search.existingToUse.find((a) => a.role === "logo")?.path;
  const heroMotion = search.existingToUse.find((a) => a.role === "hero_motion")?.path;
  const endStill =
    search.existingToUse.find((a) => a.role === "end_card")?.path ||
    openStill;
  const musicPathSrc = search.existingToUse.find((a) => a.role === "music")?.path;

  const clips = [];
  if (openStill && existsSync(openStill)) {
    const openClip = join(GENERATED, `${project}-open-${stamp}.mp4`);
    stillToClip(openStill, openClip, { seconds: 2.0, width: format.width, height: format.height });
    clips.push(openClip);
  }

  const flash = join(GENERATED, `${project}-flash-${stamp}.mp4`);
  makeTransitionFlash(flash, format);
  if (clips.length) clips.push(flash);

  if (heroMotion && existsSync(heroMotion)) {
    const heroClip = join(GENERATED, `${project}-hero-${stamp}.mp4`);
    const heroSeconds = Math.min(5, Math.max(2, Number(intake.fields.DURATION_SECONDS) * 0.45));
    remasterClip(heroMotion, heroClip, { seconds: heroSeconds, width: format.width, height: format.height });
    clips.push(heroClip);
  } else if (openStill && existsSync(openStill)) {
    const proof = join(GENERATED, `${project}-proof-${stamp}.mp4`);
    stillToClip(openStill, proof, { seconds: 3.0, width: format.width, height: format.height });
    clips.push(proof);
  }

  if (endStill && existsSync(endStill)) {
    const endClip = join(GENERATED, `${project}-end-${stamp}.mp4`);
    stillToClip(endStill, endClip, {
      seconds: 2.2,
      width: format.width,
      height: format.height,
      fadeOut: true,
    });
    clips.push(endClip);
  }

  const fade = join(GENERATED, `${project}-fade-${stamp}.mp4`);
  makeFadeBlack(fade, { ...format, seconds: 0.9 });
  clips.push(fade);

  let musicPath = null;
  if (musicPathSrc && existsSync(musicPathSrc)) {
    musicPath = join(GENERATED, `${project}-music-${stamp}.m4a`);
    trimAudio(musicPathSrc, musicPath, Math.max(8, Number(intake.fields.DURATION_SECONDS) || 10), 0.26);
  }

  const draftName = `${project}-DRAFT`;
  const draftPath = join(RENDERS, `${draftName}.mp4`);
  const listFile = join(GENERATED, `${project}-concat-${stamp}.txt`);
  writeFileSync(listFile, clips.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

  if (musicPath) {
    const silent = join(GENERATED, `${project}-silent-${stamp}.mp4`);
    runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", silent,
    ]);
    runFfmpeg([
      "-i", silent,
      "-i", musicPath,
      "-shortest",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      draftPath,
    ]);
  } else {
    runFfmpeg([
      "-f", "concat", "-safe", "0", "-i", listFile,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
      "-movflags", "+faststart",
      draftPath,
    ]);
  }

  // Stage under GENERATED (do not overwrite Phase 6 runway originals)
  const staged = join(GENERATED_LIBRARY, "video", `${draftName}-${stamp}.mp4`);
  copyFileSync(draftPath, staged);

  const resolveResults = [];
  const timelineName = `${project}-TL-${stamp.slice(-5)}`;
  let timelineCreated = false;

  if (typeof askResolve === "function") {
    try {
      const created = await askResolve("create_project", {
        name: project,
        frameRate: "24",
        width: format.width,
        height: format.height,
        productionCompany: PRODUCTION_COMPANY,
        productionIdentity: "IFCDC PRODUCTION",
        brandPromoted: intake.brandPromoted,
      });
      resolveResults.push({ action: "create_project", ...created });

      const bin = await askResolve("create_bin", { name: `${project}-BIN` });
      resolveResults.push({ action: "create_bin", ...bin });

      const tl = await askResolve("create_timeline", { name: timelineName });
      resolveResults.push({ action: "create_timeline", ...tl });
      timelineCreated = tl?.ok !== false;

      for (const mediaPath of [...clips, draftPath, musicPath].filter(Boolean)) {
        if (!existsSync(mediaPath)) continue;
        const imported = await askResolve("import_media", { path: mediaPath });
        resolveResults.push({ action: "import_media", path: basename(mediaPath), ...imported });
      }

      // Place hero + open on timeline when API supports add_clip
      for (const mediaPath of clips.slice(0, 4)) {
        try {
          const added = await askResolve("add_clip", { mediaName: basename(mediaPath), timeline: timelineName });
          resolveResults.push({ action: "add_clip", ...added });
        } catch (err) {
          resolveResults.push({ action: "add_clip", ok: false, error: err.message });
        }
      }

      if (musicPath) {
        try {
          const music = await askResolve("add_music", { mediaName: basename(musicPath) });
          resolveResults.push({ action: "add_music", ...music });
        } catch (err) {
          resolveResults.push({ action: "add_music", ok: false, error: err.message });
        }
      }

      try {
        const brand = await askResolve("apply_branding", {
          titleName: "Text",
          titleText: intake.brandPromoted,
        });
        resolveResults.push({ action: "apply_branding", ...brand });
      } catch (err) {
        resolveResults.push({ action: "apply_branding", ok: false, error: err.message });
      }

      await askResolve("save_project", {});

      // Prefer Resolve render; fall back to ffmpeg draft already on disk
      try {
        const renderCmd =
          format.label === "16:9" ? "render_landscape" : format.label === "1:1" ? "render_square" : "render_vertical";
        // bridge uses action "render" via askResolve
        const rendered = await askResolve("render", {
          name: draftName,
          width: format.width,
          height: format.height,
        });
        resolveResults.push({ action: "render", ...rendered });
        if (rendered?.ok && rendered.result?.jobId) {
          const file = await waitForRender(askResolve, rendered.result.jobId, draftName);
          if (file?.path && existsSync(file.path)) {
            copyFileSync(file.path, draftPath);
          }
        }
      } catch (err) {
        resolveResults.push({ action: "render", ok: false, error: err.message, fallback: "ffmpeg_draft" });
      }
    } catch (error) {
      resolveResults.push({ action: "resolve_build", ok: false, error: error.message });
    }
  }

  const duration = probeDuration(draftPath);
  let preview = null;
  if (typeof uploadPreview === "function" && existsSync(draftPath)) {
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

  markStepComplete(job.id, "DRAFT", {
    gate: "DRAFT",
    status: "DRAFT_READY",
    timelineState: {
      project,
      timeline: timelineName,
      created: timelineCreated,
      draft: { name: `${draftName}.mp4`, path: draftPath, duration, format: format.label },
      resolveResults: resolveResults.map((r) => ({ action: r.action, ok: r.ok !== false })),
    },
    previews: preview ? [preview] : [],
  });
  markStepComplete(job.id, "HQ_PREVIEW", { gate: "HQ_PREVIEW", status: "AWAITING_FOUNDER" });

  const pipeline = buildProductionPipeline({
    instruction,
    brandPromoted: intake.brandPromoted,
    projectTitle: intake.projectTitle,
    project,
    format,
    durationSeconds: intake.fields.DURATION_SECONDS,
    script: creative.script,
    scenes: creative.sceneBreakdown,
    shotList: creative.shotList,
    assetInventory: search.EXISTING_ASSETS_TO_USE,
    librarySearch: search,
    generation,
  });

  const costSummary = creditsUsedForProject(project);
  const record = {
    at: new Date().toISOString(),
    company: PRODUCTION_COMPANY,
    phase: 7,
    instruction,
    project,
    mode: "phase7_autonomous",
    searchedBeforeGenerate: true,
    reusedAssets: search.existingToUse.map((a) => a.name),
    runwayCredits: costSummary.RUNWAY_CREDITS_USED,
    render: { name: `${draftName}.mp4`, path: draftPath, duration, preview, format: format.label },
    timeline: timelineName,
    timelineCreated,
    publish: false,
    gate: "HQ_PREVIEW",
  };
  rememberProduction(record);
  rememberEditorial({
    at: record.at,
    project,
    kind: "autonomous_production",
    decisions: [
      `reuse=${search.pictureCoveredByReuse}`,
      `runwayCredits=${costSummary.RUNWAY_CREDITS_USED}`,
      `format=${format.label}`,
    ],
    preferences: {
      musicIntensity: "low",
      logoPlacement: "open-and-end-card",
      titleStyle: "production-kit",
      introOutro: "title-then-motion-then-end",
      cta: intake.fields.CTA,
    },
  });
  appendPreference({
    approved: false,
    kind: "autonomous_draft_style",
    preferences: { formats: [format.label], musicVolume: 0.26, cta: intake.fields.CTA },
    note: `Phase 7 draft ${project}`,
  });
  rememberGate({ gate: "HQ_PREVIEW", at: record.at, project });

  writeFileSync(
    join(ROOT, "last-autonomous-plan.json"),
    JSON.stringify({ intake, creative, search, generation, record, pipeline }, null, 2),
  );

  // Surgical revision path (optional, same run)
  let revisionResult = null;
  if (revisionNote) {
    revisionResult = await runSurgicalRevision({
      jobId: job.id,
      instruction,
      revisionNote,
      sourceDraftPath: draftPath,
      project,
      uploadPreview,
      askResolve,
    });
  }

  const finalJob = readAutonomousJob(job.id);

  return {
    ok: existsSync(draftPath),
    phase: 7,
    publish: false,
    mode: "phase7_autonomous",
    company: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: "IFCDC PRODUCTION",
    brandPromoted: intake.brandPromoted,
    gate: gatePayload("HQ_PREVIEW"),
    gateStates: PHASE7_GATE_STATES,
    jobId: job.id,
    project,
    intake,
    NATURAL_LANGUAGE_INTAKE: intake.fields,
    creative,
    LIBRARY_SEARCH: search,
    ASSET_SEARCH_BEFORE_GENERATION: true,
    generation,
    pipeline,
    plan: {
      ...intake,
      ...creative,
      project,
      PIPELINE: pipeline,
      LIBRARY_SEARCH: search,
      GENERATION: generation,
      render: record.render,
    },
    render: record.render,
    preview,
    revision: revisionResult,
    timeline: timelineName,
    RESOLVE_TIMELINE_CREATED: timelineCreated,
    resolveResults,
    cost: costSummary,
    RUNWAY_CREDITS_USED: costSummary.RUNWAY_CREDITS_USED,
    PROVIDERS_USED: [
      ...(search.pictureCoveredByReuse ? ["library_reuse", "resolve", "ffmpeg"] : []),
      ...(generation.anyGenerated ? ["runway"] : []),
      ...(musicPath ? ["local-music-stage"] : []),
    ],
    job: finalJob,
    conversationalStatus: conversationalStatus({ jobId: job.id, project }),
    inventedMedia: false,
    message: search.pictureCoveredByReuse
      ? "Library reuse covered picture; Resolve draft built; publish=false."
      : "Generated only missing media; Resolve draft built; publish=false.",
  };
}

/**
 * Surgical revision — change only the requested component. Prefer zero Runway.
 */
export async function runSurgicalRevision({
  jobId = null,
  instruction = "",
  revisionNote,
  sourceDraftPath = null,
  project = null,
  uploadPreview = null,
  askResolve = null,
} = {}) {
  const parsed = parseRevision(revisionNote, {
    instruction,
    projectName: project,
    preferences: readCreativeMemory().preferences,
  });
  const job = jobId ? readAutonomousJob(jobId) : findLatestJobForProject(project);
  const proj = project || job?.project || "IFCDC-AURA-YOUTH-PROMO-P7";
  let source =
    sourceDraftPath ||
    job?.timelineState?.draft?.path ||
    join(RENDERS, `${proj}-DRAFT.mp4`);

  if (!existsSync(source)) {
    // find latest project draft
    if (existsSync(RENDERS)) {
      const hit = readdirSync(RENDERS)
        .filter((n) => n.includes(proj) && n.endsWith(".mp4"))
        .map((n) => ({ n, p: join(RENDERS, n), m: statSync(join(RENDERS, n)).mtimeMs }))
        .sort((a, b) => b.m - a.m)[0];
      if (hit) source = hit.p;
    }
  }
  if (!existsSync(source)) {
    return {
      ok: false,
      blocker: "NO_SOURCE_DRAFT",
      revision: parsed,
      message: "No draft available to revise surgically",
      publish: false,
    };
  }

  const stamp = Date.now().toString(36);
  let outFormat = parsed.format || VERTICAL;
  let outName = `${proj}-REV-${stamp}.mp4`;
  let musicVolume = null;
  const intents = parsed.intents || [];

  if (intents.includes("youtube_version") || intents.includes("tiktok_version") || intents.includes("square_version")) {
    outFormat = parsed.format || LANDSCAPE;
    outName = `${proj}-${outFormat.label.replace(":", "x")}-${stamp}.mp4`;
  }
  if (intents.includes("music_down")) {
    musicVolume = parsed.musicVolume ?? 0.12;
    outName = `${proj}-MUSICDOWN-${stamp}.mp4`;
  }

  const outPath = join(RENDERS, outName);
  remasterWithAudio(source, outPath, {
    width: outFormat.width,
    height: outFormat.height,
    musicVolume,
  });

  // Best-effort Resolve note
  const resolveResults = [];
  if (typeof askResolve === "function") {
    try {
      const imported = await askResolve("import_media", { path: outPath });
      resolveResults.push({ action: "import_media", ...imported });
    } catch (err) {
      resolveResults.push({ action: "import_media", ok: false, error: err.message });
    }
  }

  const duration = probeDuration(outPath);
  let preview = null;
  if (typeof uploadPreview === "function") {
    preview = await uploadPreview({
      name: outName,
      path: outPath,
      duration,
      project: proj,
      instruction: `${instruction} | revision: ${revisionNote}`,
      publish: false,
      format: outFormat.label,
    });
  }

  const revisionRecord = {
    at: new Date().toISOString(),
    note: revisionNote,
    intents,
    dryModificationPlan: parsed.dryModificationPlan,
    source: basename(source),
    output: outName,
    format: outFormat.label,
    runwayCalled: false,
    surgical: true,
    publish: false,
  };

  if (job?.id) {
    const history = [...(job.revisionState?.history || []), revisionRecord];
    updateAutonomousJob(job.id, {
      gate: "FOUNDER_REVISION",
      status: "REVISION_READY",
      revisionState: { last: revisionRecord, history },
      previews: preview ? [...(job.previews || []), preview] : job.previews,
    });
  }

  rememberRevision({
    at: revisionRecord.at,
    instruction,
    revisionNote,
    intents,
    project: proj,
    render: { name: outName, path: outPath, duration, preview, format: outFormat.label },
    preferences: parsed.preferences,
    publish: false,
    note: revisionNote,
  });
  appendPreference({
    approved: false,
    kind: "revision",
    preferences: parsed.preferences || {},
    note: revisionNote,
  });
  rememberGate({ gate: "FOUNDER_REVISION", at: revisionRecord.at, project: proj });

  recordCostEntry({
    provider: "local_remaster",
    credits: 0,
    purpose: "surgical_revision",
    project: proj,
    reuse: true,
    reason: revisionNote,
    accepted: false,
    metadata: { intents, format: outFormat.label },
  });

  return {
    ok: existsSync(outPath),
    publish: false,
    mode: "surgical_revision",
    revision: parsed,
    SURGICAL_REVISION: true,
    RUNWAY_CREDITS_USED: 0,
    render: { name: outName, path: outPath, duration, preview, format: outFormat.label },
    preview,
    resolveResults,
    historyEntry: revisionRecord,
    message: `Surgical revision applied (${intents.join(", ")}); no Runway call.`,
  };
}

export { resumeAutonomousJob, PHASE7_GATE_STATES };
