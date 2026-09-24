/**
 * Cloud-side creative planner (mirrors aura-resolve/editor/director + commands).
 * Used when HQ cannot reach the Mac loopback bridge for plan preview.
 * Every plan inherits IFCDC PRODUCTIONS identity by default; brandPromoted is separate.
 */

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };
const COMPANY = "IFCDC PRODUCTIONS";
const IDENTITY = "IFCDC PRODUCTION";
const CREDIT = "AN IFCDC PRODUCTION";

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

export function inferBrandPromoted(instruction: string): string {
  const lower = String(instruction || "").toLowerCase();
  if (/barber/.test(lower)) return "IFCDC Barbers App";
  if (/youth/.test(lower)) return "IFCDC youth programs";
  if (/mentor|tapis/.test(lower)) return "IFCDC Mentor";
  if (/inclusive\s*community/.test(lower)) return "Inclusive Community";
  if (/swift.?ware|swiftware/.test(lower)) return "Swift-Ware";
  if (/crypto/.test(lower)) return "CryptoCoin";
  if (/music\s*(app|video)|ifcdc\s*music/.test(lower)) return "IFCDC Music";
  if (/training/.test(lower)) {
    const about = /about\s+(.+?)(?:\.|$)/i.exec(String(instruction || ""));
    if (about?.[1]) return about[1].trim().replace(/\s+/g, " ").slice(0, 80);
    return "IFCDC training";
  }
  if (/documentary/.test(lower)) return "IFCDC documentary subject";
  if (/short\s*film/.test(lower)) return "IFCDC short film subject";
  const cleaned = String(instruction || "")
    .replace(/^aura[,:\s]*/i, "")
    .replace(/^(make|create|produce|shoot|edit)\s+(a|an|the)?\s*/i, "")
    .replace(/\b(short|vertical|tiktok|youtube|promo|promotional|commercial|video|film)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned && !/^ifcdc\s*productions?$/i.test(cleaned)) return cleaned || "IFCDC program";
  return "IFCDC program";
}

function inferProjectTitle(instruction: string, brandPromoted: string) {
  const lower = String(instruction || "").toLowerCase();
  if (/barber/.test(lower) && /commercial|promo/.test(lower)) return "IFCDC Barbers App Commercial";
  if (/train/.test(lower)) return `${brandPromoted} Training Video`;
  if (/music\s*video/.test(lower)) return `${brandPromoted} Music Video`;
  if (/documentar/.test(lower)) return `${brandPromoted} Documentary`;
  if (/short\s*film/.test(lower)) return `${brandPromoted} Short Film`;
  if (/commercial/.test(lower)) return `${brandPromoted} Commercial`;
  if (/promo/.test(lower)) return `${brandPromoted} Promo`;
  return `${brandPromoted} Video`;
}

function projectNameFrom(lower: string, brandPromoted: string) {
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

export function planAuraCreativeInstruction(text: string) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const format = formatFromText(lower);
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch ? Number(durationMatch[1]) : /short|tiktok|promo/.test(lower) ? 12 : 30;
  const brandPromoted = inferBrandPromoted(instruction);
  const projectTitle = inferProjectTitle(instruction, brandPromoted);
  const project = projectNameFrom(lower, brandPromoted);
  const timeline = `${project}-TL`;
  const isBarbers = /barber/.test(lower);
  const wantsMusic = /music|audio|soundtrack|bed/.test(lower);
  const wantsBrand = /brand|logo|ifcdc|barber|youth|training|promo|commercial/.test(lower);
  const wantsFade = /fade|smooth|ending|draft|promo|commercial|training|video/.test(lower);
  const wantsTransition = /transition|promo|commercial|tiktok|draft|barber|training/.test(lower);
  const cta = isBarbers ? "Book in the IFCDC Barbers App" : `Learn more · ${brandPromoted}`;

  const SCENES = [
    { id: "open", label: "Brand open / title card", seconds: 2.2 },
    { id: "proof", label: "Product / service proof", seconds: Math.max(4, Math.floor(durationSeconds * 0.35)) },
    { id: "brand", label: "Lower-third + IFCDC branding", seconds: 2.6 },
    { id: "cta", label: "CTA + captions", seconds: 2.2 },
    { id: "end", label: `${CREDIT} end card + fade`, seconds: Math.max(2, durationSeconds - 11) },
  ];

  const SCRIPT = [
    { beat: "HOOK", line: isBarbers ? "IFCDC Barbers App — book your look." : `${brandPromoted} — ${projectTitle}.` },
    { beat: "PROOF", line: isBarbers ? "Real service stills. Real brand." : `Approved media for ${brandPromoted}.` },
    { beat: "CTA", line: cta },
    { beat: "CREDIT", line: `${CREDIT} · ${COMPANY}` },
  ];

  const creditTemplate = {
    company: COMPANY,
    presents: "presents",
    projectTitle,
    credit: CREDIT,
    lines: [COMPANY, "presents", projectTitle, CREDIT],
  };

  const steps = [
    {
      command: "create_project",
      payload: {
        name: project,
        frameRate: "24",
        width: format.width,
        height: format.height,
        productionCompany: COMPANY,
        productionIdentity: IDENTITY,
        brandPromoted,
      },
    },
    { command: "import_assets", payload: { paths: [] } },
    { command: "create_bin", payload: { name: `${project}-BIN` } },
    { command: "create_timeline", payload: { name: timeline } },
    { command: "add_clip", payload: { mediaName: "promo-open-title.mp4" } },
    wantsTransition
      ? { command: "add_transition", payload: { kind: "brand-flash", mediaName: "aura-transition-flash.mp4", visibleEffect: true } }
      : null,
    { command: "add_clip", payload: { mediaName: "promo-proof-a.mp4" } },
    wantsBrand ? { command: "apply_branding", payload: { titleName: "Text", titleText: brandPromoted } } : null,
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
    productionCompany: COMPANY,
    productionIdentity: IDENTITY,
    PRODUCTION_COMPANY: COMPANY,
    PRODUCTION_IDENTITY: IDENTITY,
    brandPromoted,
    projectTitle,
    projectMetadata: {
      PRODUCTION_COMPANY: COMPANY,
      PRODUCTION_IDENTITY: IDENTITY,
      productionCompany: COMPANY,
      productionIdentity: IDENTITY,
      productionCredit: CREDIT,
      brandPromoted,
      projectTitle,
      project,
      creditTemplate,
      visibleBrandingAutoBurn: false,
      publish: false,
      globalRuleId: "IFCDC_PRODUCTIONS_GLOBAL_IDENTITY",
    },
    publish: false,
    founderApprovalRequiredForFinal: true,
    draftAllowedWithoutFinalApproval: true,
    gate: { gate: "PLAN", states: GATE_STATES, publish: false, distributionBlocked: true },
    CONCEPT: isBarbers
      ? "A polished IFCDC Barbers App promo produced as an IFCDC PRODUCTION with kit templates, captions, and company credit."
      : `An IFCDC PRODUCTION promoting ${brandPromoted}: ${projectTitle}.`,
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
    PURPOSE: isBarbers
      ? "Promote the IFCDC Barbers App as an IFCDC PRODUCTION"
      : `Produce an IFCDC PRODUCTION promoting ${brandPromoted}`,
    AUDIENCE:
      format.label === "16:9"
        ? "YouTube / landscape"
        : format.label === "1:1"
          ? "Square social"
          : /train/.test(lower)
            ? "Internal / program audience"
            : "Short-form social (TikTok / Reels)",
    DURATION: `${durationSeconds}s`,
    FORMAT: format.label,
    format,
    project,
    timeline,
    SCENES,
    ASSETS_REQUIRED: [
      "IFCDC logo",
      isBarbers ? "Barbers App logo or store graphic" : `${brandPromoted} approved media`,
      "At least two approved stills or clips",
      wantsMusic ? "Approved IFCDC music bed or test tone" : null,
      "IFCDC Production Kit templates (auto-composed if missing)",
    ].filter(Boolean),
    SHOT_ORDER: SCENES.map((scene) => scene.label),
    TEXT_TITLES: [brandPromoted, cta, COMPANY],
    PRODUCTION_CREDITS: {
      company: COMPANY,
      productionCompany: COMPANY,
      productionIdentity: IDENTITY,
      line: CREDIT,
      applyAutomatically: true,
      visibleAutoBurn: false,
      creditTemplate,
    },
    BRANDING: wantsBrand ? `IFCDC production kit + ${brandPromoted}` : "none",
    MUSIC: wantsMusic ? "Approved IFCDC bed (ffmpeg leveled/ducked)" : "none",
    VOICEOVER: "none",
    TRANSITIONS: wantsTransition
      ? "Visible brand-flash clips between scenes (API has no native dissolve)"
      : "cuts",
    ENDING: wantsFade ? `${CREDIT} end card + smooth fade (when template asks)` : "hard end",
    CTA: cta,
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
