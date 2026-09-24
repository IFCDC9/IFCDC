/**
 * High-level AURA video commands. Plans Founder language into allowlisted Resolve steps.
 * Never publishes. Final release stays behind Founder approval.
 * Every plan inherits IFCDC PRODUCTIONS identity by default.
 */

import {
  PRODUCTION_COMPANY,
  PRODUCTION_IDENTITY,
  PRODUCTION_CREDIT_LINE,
  inferBrandPromoted,
  inferProjectTitle,
  projectMetadataDefaults,
} from "../brand/production-identity.mjs";

export const EDITOR_COMMANDS = [
  "create_project",
  "open_project",
  "import_assets",
  "import_media",
  "create_bin",
  "create_timeline",
  "add_clip",
  "reorder_clips",
  "trim_clip",
  "split_clip",
  "remove_clip",
  "duplicate_clip",
  "set_clip_duration",
  "move_clip",
  "add_transition",
  "fade_video",
  "fade_audio",
  "add_title",
  "add_overlay",
  "add_logo",
  "position_branding",
  "resize_branding",
  "apply_branding",
  "add_music",
  "add_voiceover",
  "adjust_audio_levels",
  "fade_music",
  "duck_music",
  "basic_cleanup",
  "add_subtitles",
  "add_captions",
  "save_project",
  "preview_project",
  "render_vertical",
  "render_landscape",
  "render_square",
  "return_render_to_hq",
];

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };

function formatFromText(lower) {
  if (/square|1\s*:\s*1/.test(lower)) return SQUARE;
  if (/vertical|tiktok|reel|story|9\s*:\s*16/.test(lower)) return VERTICAL;
  if (/landscape|youtube|16\s*:\s*9/.test(lower)) return LANDSCAPE;
  return VERTICAL;
}

function projectNameFrom(lower, brandPromoted) {
  if (/phase\s*4|p4|multi.?format|master/.test(lower)) return "IFCDC-AURA-BARBERS-PROMO-P4";
  if (/barber/.test(lower) && /promo|promotional|commercial|tiktok|draft|youtube/.test(lower)) {
    return "IFCDC-AURA-BARBERS-PROMO-P4";
  }
  if (/barber/.test(lower)) return "IFCDC-AURA-BARBERS-COMMERCIAL";
  const slug = String(brandPromoted || "EDIT")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return `IFCDC-AURA-${slug || "EDIT"}`.slice(0, 40);
}

/**
 * Turn a Founder instruction into a structured creative plan + executable steps.
 * Always sets productionCompany + productionIdentity; brandPromoted is separate.
 */
export function planInstruction(text, options = {}) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const format = formatFromText(lower);
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch ? Number(durationMatch[1]) : /short|tiktok|promo/.test(lower) ? 12 : 30;
  const brandPromoted = options.brandPromoted || inferBrandPromoted(instruction);
  const projectTitle = options.projectTitle || inferProjectTitle(instruction, brandPromoted);
  const identityMeta = projectMetadataDefaults({
    instruction,
    project: options.projectName,
    brandPromoted,
  });
  const project = options.projectName || projectNameFrom(lower, brandPromoted);
  const timeline = `${project}-TL`;
  const wantsMusic = /music|audio|soundtrack|bed/.test(lower);
  const wantsBrand = /brand|logo|ifcdc|barber|youth|training|promo|commercial/.test(lower);
  const wantsFade = /fade|smooth|ending|draft|promo|commercial|training|video/.test(lower);
  const wantsTransition = /transition|promo|commercial|tiktok|draft|barber|training/.test(lower);
  const wantsCaptions = /caption|subtitle/.test(lower);
  const wantsVoice = /voiceover|voice over|vo\b/.test(lower);
  const assets = options.assets || [];
  const isBarbers = /barber/.test(lower);
  const ctaDefault = isBarbers ? "Book in the IFCDC Barbers App" : `Learn more · ${brandPromoted}`;

  const PURPOSE = isBarbers
    ? "Promote the IFCDC Barbers App with approved brand assets"
    : `Produce an IFCDC PRODUCTION promoting ${brandPromoted}`;
  const AUDIENCE = /tiktok|vertical|reel/.test(lower)
    ? "Short-form social (TikTok / Reels)"
    : /train/.test(lower)
      ? "Internal / program audience"
      : "IFCDC Founder review";
  const SCENES = [
    { id: "open", label: "Brand open", seconds: 2 },
    { id: "proof", label: "Product / service proof", seconds: Math.max(4, Math.floor(durationSeconds * 0.45)) },
    { id: "brand", label: "IFCDC branding + title", seconds: 3 },
    { id: "cta", label: "CTA + smooth fade-out", seconds: Math.max(2, durationSeconds - 9) },
  ];
  const ASSETS_REQUIRED = [
    "IFCDC logo",
    isBarbers ? "Barbers App logo or store graphic" : `${brandPromoted} approved media`,
    "At least two approved stills or clips",
    wantsMusic ? "Approved IFCDC music bed or test tone" : null,
  ].filter(Boolean);

  const steps = [];
  steps.push({
    command: "create_project",
    payload: {
      name: project,
      frameRate: "24",
      width: format.width,
      height: format.height,
      productionCompany: PRODUCTION_COMPANY,
      productionIdentity: PRODUCTION_IDENTITY,
      brandPromoted,
    },
  });
  steps.push({
    command: "import_assets",
    payload: {
      paths: assets.map((asset) => asset.mediaPath || asset.path).filter(Boolean),
    },
  });
  steps.push({ command: "create_bin", payload: { name: `${project}-BIN` } });
  steps.push({ command: "create_timeline", payload: { name: timeline } });

  const clipNames = (options.clipMediaNames || []).filter(Boolean);
  const interleaveTransitions = options.interleaveTransitions === true;
  for (let i = 0; i < clipNames.length; i += 1) {
    steps.push({ command: "add_clip", payload: { mediaName: clipNames[i] } });
    if (interleaveTransitions && wantsTransition && i < clipNames.length - 1) {
      steps.push({
        command: "add_transition",
        payload: {
          kind: "brand-flash",
          mediaName: options.transitionMediaName || "aura-transition-flash.mp4",
          visibleEffect: true,
        },
      });
    }
  }

  if (wantsBrand) {
    steps.push({
      command: "apply_branding",
      payload: {
        titleName: "Text",
        titleText: brandPromoted,
        logoPath: options.logoPath || null,
      },
    });
    steps.push({
      command: "add_title",
      payload: { titleName: "Text", titleText: ctaDefault },
    });
  }

  if (wantsMusic && options.musicPath) {
    steps.push({ command: "add_music", payload: { path: options.musicPath } });
  }

  if (wantsVoice && options.voicePath) {
    steps.push({ command: "add_voiceover", payload: { path: options.voicePath }, waitsForAsset: true });
  }

  if (wantsCaptions) {
    steps.push({
      command: "add_captions",
      payload: { lines: [brandPromoted, ctaDefault].filter(Boolean) },
    });
  }

  if (wantsFade && options.fadeMediaName && !clipNames.includes(options.fadeMediaName)) {
    steps.push({
      command: "fade_video",
      payload: { kind: "video", mediaName: options.fadeMediaName, visibleEffect: true },
    });
  }

  // Credit title is metadata-aware; visible burn follows template/Founder — not forced every frame.
  if (options.includeCreditTitle !== false) {
    steps.push({
      command: "add_title",
      payload: {
        titleName: "Text",
        titleText: `${PRODUCTION_CREDIT_LINE} · ${PRODUCTION_COMPANY}`,
        role: "production-credit",
        autoBurn: false,
      },
    });
  }

  steps.push({ command: "save_project", payload: {} });
  steps.push({
    command: format === LANDSCAPE ? "render_landscape" : format === SQUARE ? "render_square" : "render_vertical",
    payload: { name: `${project}-DRAFT`, ...format },
    previewOnly: true,
  });
  steps.push({ command: "return_render_to_hq", payload: { name: `${project}-DRAFT.mp4` }, executesInResolve: false });

  return {
    instruction,
    company: PRODUCTION_COMPANY,
    productionCompany: PRODUCTION_COMPANY,
    productionIdentity: PRODUCTION_IDENTITY,
    PRODUCTION_COMPANY,
    PRODUCTION_IDENTITY,
    brandPromoted,
    projectTitle,
    projectMetadata: identityMeta,
    publish: false,
    founderApprovalRequiredForFinal: true,
    draftAllowedWithoutFinalApproval: true,
    PURPOSE,
    AUDIENCE,
    DURATION: `${durationSeconds}s`,
    FORMAT: format.label,
    format,
    project,
    timeline,
    SCENES,
    ASSETS_REQUIRED,
    SHOT_ORDER: SCENES.map((scene) => scene.label),
    TEXT_TITLES: [brandPromoted, ctaDefault, PRODUCTION_COMPANY],
    PRODUCTION_CREDITS: {
      company: PRODUCTION_COMPANY,
      productionCompany: PRODUCTION_COMPANY,
      productionIdentity: PRODUCTION_IDENTITY,
      line: PRODUCTION_CREDIT_LINE,
      applyAutomatically: true,
      visibleAutoBurn: false,
      creditTemplate: identityMeta.creditTemplate,
    },
    BRANDING: wantsBrand ? `IFCDC production kit + ${brandPromoted}` : "none",
    MUSIC: wantsMusic ? "Approved IFCDC bed or test tone (ffmpeg pre-shaped)" : "none",
    VOICEOVER: wantsVoice ? "Requested" : "none",
    TRANSITIONS: wantsTransition ? "Visible brand-flash clips between scenes (API has no native dissolve)" : "cuts",
    ENDING: wantsFade ? `Smooth fade-out + ${PRODUCTION_CREDIT_LINE} end card (when template asks)` : "hard end",
    CTA: ctaDefault,
    RENDER_FORMAT: `${format.width}x${format.height} mp4 H264 draft`,
    steps,
    blockers: [],
  };
}

export function toResolveCall(step) {
  if (!step || step.executesInResolve === false) return [];
  if (step.command === "import_assets" || step.command === "import_media") {
    const paths = step.payload?.paths || (step.payload?.path ? [step.payload.path] : []);
    return paths.map((path) => ({ action: "import_media", payload: { path } }));
  }
  if (step.command === "render_vertical") {
    return [{ action: "render", payload: { ...VERTICAL, ...step.payload, width: 1080, height: 1920 } }];
  }
  if (step.command === "render_landscape") {
    return [{ action: "render", payload: { ...LANDSCAPE, ...step.payload, width: 1920, height: 1080 } }];
  }
  if (step.command === "render_square") {
    return [{ action: "render", payload: { ...SQUARE, ...step.payload, width: 1080, height: 1080 } }];
  }
  if (step.command === "add_captions") {
    return [{ action: "add_subtitles", payload: step.payload || {} }];
  }
  if (step.command === "fade_music") {
    return [{ action: "fade_audio", payload: { kind: "audio", ...(step.payload || {}) } }];
  }
  if (step.command === "duck_music" || step.command === "adjust_audio_levels") {
    return [{ action: "adjust_audio_levels", payload: step.payload || {} }];
  }
  if (step.command === "open_project") {
    return [{ action: "create_project", payload: step.payload || {} }];
  }
  if (step.command === "preview_project") {
    return [{ action: "status", payload: {} }];
  }
  if (step.command === "add_overlay" || step.command === "position_branding" || step.command === "resize_branding") {
    return [{ action: "apply_branding", payload: step.payload || {} }];
  }
  if (step.command === "create_bin") {
    return [{ action: "create_bin", payload: step.payload || {} }];
  }
  if (step.command === "reorder_clips" || step.command === "remove_clip" || step.command === "duplicate_clip" || step.command === "set_clip_duration" || step.command === "basic_cleanup") {
    return [{ action: step.command, payload: step.payload || {} }];
  }
  if (step.waitsForAsset && !step.payload?.path && !step.payload?.mediaName) {
    return [];
  }
  return [{ action: step.command, payload: step.payload || {} }];
}
