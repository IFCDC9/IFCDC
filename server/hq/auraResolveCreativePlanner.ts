/**
 * Cloud-side creative planner (mirrors aura-resolve/editor/commands.mjs).
 * Used when HQ cannot reach the Mac loopback bridge.
 */

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };

function formatFromText(lower: string) {
  if (/square|1\s*:\s*1/.test(lower)) return SQUARE;
  if (/vertical|tiktok|reel|story|9\s*:\s*16/.test(lower)) return VERTICAL;
  if (/landscape|youtube|16\s*:\s*9/.test(lower)) return LANDSCAPE;
  return VERTICAL;
}

function projectNameFrom(lower: string) {
  if (/barber/.test(lower) && /promo|promotional|commercial|tiktok|draft/.test(lower)) {
    return "IFCDC-AURA-BARBERS-PROMO-V1";
  }
  if (/barber/.test(lower)) return "IFCDC-AURA-BARBERS-COMMERCIAL";
  return "IFCDC-AURA-EDIT";
}

export function planAuraCreativeInstruction(text: string) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const format = formatFromText(lower);
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch ? Number(durationMatch[1]) : /short|tiktok|promo/.test(lower) ? 12 : 30;
  const project = projectNameFrom(lower);
  const timeline = `${project}-TL`;
  const wantsMusic = /music|audio|soundtrack|bed/.test(lower);
  const wantsBrand = /brand|logo|ifcdc|barber/.test(lower);
  const wantsFade = /fade|smooth|ending|draft|promo|commercial/.test(lower);
  const wantsTransition = /transition|promo|commercial|tiktok|draft|barber/.test(lower);

  const SCENES = [
    { id: "open", label: "Brand open", seconds: 2 },
    { id: "proof", label: "Product / service proof", seconds: Math.max(4, Math.floor(durationSeconds * 0.45)) },
    { id: "brand", label: "IFCDC branding + title", seconds: 3 },
    { id: "cta", label: "CTA + smooth fade-out", seconds: Math.max(2, durationSeconds - 9) },
  ];

  const steps = [
    { command: "create_project", payload: { name: project, frameRate: "24", width: format.width, height: format.height } },
    { command: "import_assets", payload: { paths: [] } },
    { command: "create_bin", payload: { name: `${project}-BIN` } },
    { command: "create_timeline", payload: { name: timeline } },
    { command: "add_clip", payload: { mediaName: "promo-clip-1.mp4" } },
    wantsTransition
      ? { command: "add_transition", payload: { kind: "brand-flash", mediaName: "aura-transition-flash.mp4", visibleEffect: true } }
      : null,
    { command: "add_clip", payload: { mediaName: "promo-clip-2.mp4" } },
    wantsBrand
      ? { command: "apply_branding", payload: { titleName: "Text", titleText: "IFCDC Barbers App" } }
      : null,
    wantsMusic ? { command: "add_music", payload: {} } : null,
    wantsFade
      ? { command: "fade_video", payload: { kind: "video", mediaName: "aura-fade-out.mp4", visibleEffect: true } }
      : null,
    { command: "save_project", payload: {} },
    {
      command: format === LANDSCAPE ? "render_landscape" : format === SQUARE ? "render_square" : "render_vertical",
      payload: { name: `${project}-DRAFT`, ...format },
      previewOnly: true,
    },
    { command: "return_render_to_hq", payload: { name: `${project}-DRAFT.mp4` }, executesInResolve: false },
  ].filter(Boolean);

  return {
    instruction,
    publish: false,
    founderApprovalRequiredForFinal: true,
    draftAllowedWithoutFinalApproval: true,
    PURPOSE: /barber/.test(lower)
      ? "Promote the IFCDC Barbers App with approved brand assets"
      : "Produce an IFCDC draft from approved assets",
    AUDIENCE: /tiktok|vertical|reel/.test(lower) ? "Short-form social (TikTok / Reels)" : "IFCDC Founder review",
    DURATION: `${durationSeconds}s`,
    FORMAT: format.label,
    format,
    project,
    timeline,
    SCENES,
    ASSETS_REQUIRED: [
      "IFCDC logo",
      "Barbers App logo or store graphic",
      "At least two approved stills or clips",
      wantsMusic ? "Approved IFCDC music bed or test tone" : null,
    ].filter(Boolean),
    SHOT_ORDER: SCENES.map((scene) => scene.label),
    TEXT_TITLES: ["IFCDC Barbers App", "Book in the IFCDC Barbers App"],
    BRANDING: wantsBrand ? "IFCDC + Barbers App logos" : "none",
    MUSIC: wantsMusic ? "Approved IFCDC bed or test tone" : "none",
    VOICEOVER: "none",
    TRANSITIONS: wantsTransition
      ? "Visible brand-flash clips between scenes (API has no native dissolve)"
      : "cuts",
    ENDING: wantsFade ? "Smooth fade-out baked into ending media + Resolve placement" : "hard end",
    RENDER_FORMAT: `${format.width}x${format.height} mp4 H264 draft`,
    steps,
    clonePrep: {
      founderIdentityLibrary: "PLACEHOLDER",
      approvedPhotosVideoVoice: "PLACEHOLDER",
      generatedScenesTakes: "PLACEHOLDER",
      identityConsistency: "PLACEHOLDER",
      wardrobeEnvironment: "PLACEHOLDER",
      roleTransformation: "PLACEHOLDER",
      provenance: "PLACEHOLDER",
      note: "Clone generation is not configured. Placeholders only.",
    },
  };
}
