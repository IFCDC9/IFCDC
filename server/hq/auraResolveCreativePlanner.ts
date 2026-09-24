/**
 * Cloud-side creative planner (mirrors aura-resolve/editor/director + commands).
 * Used when HQ cannot reach the Mac loopback bridge for plan preview.
 */

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };
const COMPANY = "IFCDC PRODUCTIONS";

const GATE_STATES = [
  "IDEA",
  "PLAN",
  "BUILD",
  "DRAFT",
  "HQ_PREVIEW",
  "FOUNDER_REVISION",
  "APPROVAL",
  "MASTER",
  "DISTRIBUTION",
];

function formatFromText(lower: string) {
  if (/square|1\s*:\s*1/.test(lower)) return SQUARE;
  if (/vertical|tiktok|reel|story|9\s*:\s*16/.test(lower)) return VERTICAL;
  if (/landscape|youtube|16\s*:\s*9/.test(lower)) return LANDSCAPE;
  return VERTICAL;
}

function projectNameFrom(lower: string) {
  if (/phase\s*4|p4|multi.?format|master/.test(lower)) return "IFCDC-AURA-BARBERS-PROMO-P4";
  if (/barber/.test(lower) && /promo|promotional|commercial|tiktok|draft|youtube/.test(lower)) {
    return "IFCDC-AURA-BARBERS-PROMO-P4";
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
    { id: "open", label: "Brand open / title card", seconds: 2.2 },
    { id: "proof", label: "Product / service proof", seconds: Math.max(4, Math.floor(durationSeconds * 0.35)) },
    { id: "brand", label: "Lower-third + IFCDC branding", seconds: 2.6 },
    { id: "cta", label: "CTA + captions", seconds: 2.2 },
    { id: "end", label: "AN IFCDC PRODUCTION end card + fade", seconds: Math.max(2, durationSeconds - 11) },
  ];

  const SCRIPT = [
    { beat: "HOOK", line: "IFCDC Barbers App — book your look." },
    { beat: "PROOF", line: "Real service stills. Real brand." },
    { beat: "CTA", line: "Book in the IFCDC Barbers App." },
    { beat: "CREDIT", line: `AN IFCDC PRODUCTION · ${COMPANY}` },
  ];

  const steps = [
    { command: "create_project", payload: { name: project, frameRate: "24", width: format.width, height: format.height } },
    { command: "import_assets", payload: { paths: [] } },
    { command: "create_bin", payload: { name: `${project}-BIN` } },
    { command: "create_timeline", payload: { name: timeline } },
    { command: "add_clip", payload: { mediaName: "promo-open-title.mp4" } },
    wantsTransition
      ? { command: "add_transition", payload: { kind: "brand-flash", mediaName: "aura-transition-flash.mp4", visibleEffect: true } }
      : null,
    { command: "add_clip", payload: { mediaName: "promo-proof-a.mp4" } },
    wantsBrand
      ? { command: "apply_branding", payload: { titleName: "Text", titleText: "IFCDC Barbers App" } }
      : null,
    wantsMusic ? { command: "add_music", payload: {} } : null,
    { command: "add_clip", payload: { mediaName: "promo-end-card.mp4" } },
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
    company: COMPANY,
    publish: false,
    founderApprovalRequiredForFinal: true,
    draftAllowedWithoutFinalApproval: true,
    gate: { gate: "PLAN", states: GATE_STATES, publish: false, distributionBlocked: true },
    CONCEPT:
      "A polished IFCDC Barbers App promo produced as an IFCDC PRODUCTION with kit templates, captions, and company credit.",
    SCRIPT,
    SCENE_PLAN: SCENES,
    SHOT_LIST: SCENES.map((scene, index) => ({
      shot: index + 1,
      sceneId: scene.id,
      description: scene.label,
      duration: scene.seconds,
      framing: format.label,
    })),
    STORYBOARD: SCENES.map((scene) => ({ id: scene.id, frame: scene.label })),
    PURPOSE: /barber/.test(lower)
      ? "Promote the IFCDC Barbers App as an IFCDC PRODUCTION"
      : "Produce an IFCDC PRODUCTION from approved assets",
    AUDIENCE: format.label === "16:9" ? "YouTube / landscape" : format.label === "1:1" ? "Square social" : "Short-form social (TikTok / Reels)",
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
      "IFCDC Production Kit templates (auto-composed if missing)",
    ].filter(Boolean),
    SHOT_ORDER: SCENES.map((scene) => scene.label),
    TEXT_TITLES: ["IFCDC Barbers App", "Book in the IFCDC Barbers App", COMPANY],
    PRODUCTION_CREDITS: { company: COMPANY, line: "AN IFCDC PRODUCTION", applyAutomatically: true },
    BRANDING: wantsBrand ? "IFCDC production kit + logos" : "none",
    MUSIC: wantsMusic ? "Approved IFCDC bed (ffmpeg leveled/ducked)" : "none",
    VOICEOVER: "none",
    TRANSITIONS: wantsTransition
      ? "Visible brand-flash clips between scenes (API has no native dissolve)"
      : "cuts",
    ENDING: wantsFade ? "AN IFCDC PRODUCTION end card + smooth fade" : "hard end",
    CTA: "Book in the IFCDC Barbers App",
    RENDER_FORMAT: `${format.width}x${format.height} mp4 H264 draft`,
    formatsSupported: ["9:16", "16:9", "1:1"],
    steps,
    clonePrep: {
      status: "ARCHITECTURE_READY",
      generationEngine: "NOT_EXECUTED",
      founderIdentityLibrary: "READY_FOR_APPROVED_UPLOADS",
      approvedPhotosVideoVoice: "WAITING_FOR_APPROVED_MEDIA",
      generatedScenesTakes: "STORAGE_READY_NO_GENERATION",
      identityConsistency: "DEFINED",
      wardrobeEnvironment: "REFERENCE_DIRS_READY",
      roleTransformation: "REFERENCE_DIRS_READY",
      provenance: "ACTIVE",
      note: "Clone pipeline is architecture/storage/provenance only. No generator runs.",
    },
  };
}

export function parseAuraRevisionNote(note: string) {
  const lower = String(note || "").toLowerCase();
  const intents: string[] = [];
  let format: typeof VERTICAL | typeof LANDSCAPE | typeof SQUARE | null = null;
  if (/youtube|landscape|16\s*:\s*9/.test(lower)) {
    format = LANDSCAPE;
    intents.push("youtube_version");
  } else if (/tiktok|vertical|9\s*:\s*16/.test(lower)) {
    format = VERTICAL;
    intents.push("tiktok_version");
  } else if (/square|1\s*:\s*1/.test(lower)) {
    format = SQUARE;
    intents.push("square_version");
  }
  if (/music\s*down|quieter|turn\s*(the\s*)?music\s*down|lower\s*(the\s*)?music/.test(lower)) intents.push("music_down");
  if (/smoother\s*ending|ending\s*smoother|smooth(er)?\s*(the\s*)?end|fade\s*(out\s*)?longer/.test(lower)) intents.push("smoother_ending");
  if (/shorten\s*(the\s*)?open|tighten\s*(the\s*)?open/.test(lower)) intents.push("shorten_opening");
  if (/add\s*(the\s*)?logo/.test(lower)) intents.push("add_logo");
  if (!intents.length) intents.push("general_revision");
  return { note, intents, format, publish: false, gate: "FOUNDER_REVISION" };
}
