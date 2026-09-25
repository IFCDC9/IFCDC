/**
 * Cloud-side creative planner (mirrors aura-resolve/editor/director + commands).
 * Used when HQ cannot reach the Mac loopback bridge for plan preview.
 * Every plan inherits IFCDC PRODUCTIONS identity by default; brandPromoted is separate.
 * Phase 5: full pipeline object, search-before-generate gaps, continuity, kit slots, NL revisions.
 */

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };
const COMPANY = "IFCDC PRODUCTIONS";
const IDENTITY = "IFCDC PRODUCTION";
const CREDIT = "AN IFCDC PRODUCTION";

export const GATE_STATES = [
  "FOUNDER_IDEA",
  "AURA_PLAN",
  "ASSET_SEARCH",
  "GENERATION",
  "RESOLVE_BUILD",
  "DRAFT",
  "HQ_PREVIEW",
  "FOUNDER_REVISION",
  "FOUNDER_APPROVAL",
  "MASTER",
  "DISTRIBUTION_AUTHORIZATION",
];

export const PIPELINE_STAGES = [
  "FOUNDER_IDEA",
  "CREATIVE_BRIEF",
  "SCRIPT",
  "SCENE_BREAKDOWN",
  "SHOT_LIST",
  "ASSET_INVENTORY",
  "GENERATE_MISSING_ASSETS",
  "CONTINUITY",
  "VOICE_MUSIC_SOUND",
  "RESOLVE_TIMELINE",
  "EDIT",
  "COLOR_AUDIO_GRAPHICS",
  "DRAFT",
  "HQ_PREVIEW",
  "REVISION",
  "APPROVAL",
  "FINAL_MASTER",
];

export const LIBRARY_CATEGORIES = [
  "Founder",
  "IFCDC",
  "Barbers App",
  "Programs",
  "Youth",
  "Community",
  "Music",
  "Logos",
  "Branding",
  "Voice",
  "Sound Effects",
  "B-roll",
  "Generated Images",
  "Generated Video",
  "Finished Productions",
  "Templates",
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
    .replace(/\b(short|vertical|tiktok|youtube|promo|promotional|commercial|video|film|bumper)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  if (cleaned && !/^ifcdc\s*productions?$/i.test(cleaned)) return cleaned || "IFCDC program";
  return "IFCDC program";
}

function inferProjectTitle(instruction: string, brandPromoted: string) {
  const lower = String(instruction || "").toLowerCase();
  if (/barber/.test(lower) && /commercial|promo/.test(lower)) return "IFCDC Barbers App Commercial";
  if (/bumper/.test(lower)) return `${brandPromoted} Training Bumper`;
  if (/train/.test(lower)) return `${brandPromoted} Training Video`;
  if (/music\s*video/.test(lower)) return `${brandPromoted} Music Video`;
  if (/documentar/.test(lower)) return `${brandPromoted} Documentary`;
  if (/short\s*film/.test(lower)) return `${brandPromoted} Short Film`;
  if (/commercial/.test(lower)) return `${brandPromoted} Commercial`;
  if (/promo/.test(lower)) return `${brandPromoted} Promo`;
  return `${brandPromoted} Video`;
}

function projectNameFrom(lower: string, brandPromoted: string) {
  if (/youth/.test(lower) && /promo|promotional|program/.test(lower)) return "IFCDC-AURA-YOUTH-PROMO-P7";
  if (/phase\s*7|\bp7\b/.test(lower)) {
    const slug = String(brandPromoted || "EDIT")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20);
    return `IFCDC-AURA-${slug || "EDIT"}-P7`.slice(0, 40);
  }
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

function cloudLibrarySearch(instruction: string, brandPromoted: string) {
  const lower = instruction.toLowerCase();
  const query = [brandPromoted, /youth/i.test(lower) ? "youth" : "", "logo", "template"].filter(Boolean).join(" ");
  // Cloud mirror: categories + expected gaps. Live Mac search runs on the Production node.
  const expectedGaps = [
    {
      capability: "graphics_title_graphics",
      label: `${brandPromoted} title / bumper graphic`,
      status: "MAY_GENERATE_IF_LOCAL_GRAPHICS_CONFIGURED",
    },
    {
      capability: "background_scene_broll",
      label: "Youth / training B-roll or approved still",
      status: "MISSING_PROVIDER:background_scene_broll",
    },
    {
      capability: "video_generation",
      label: "Generated motion bumper",
      status: "MISSING_PROVIDER:video_generation",
    },
    {
      capability: "image_generation",
      label: "Model image generation",
      status: "MISSING_PROVIDER:image_generation",
    },
    {
      capability: "voice_generation",
      label: "Voice generation",
      status: "MISSING_PROVIDER:voice_generation",
    },
  ];
  return {
    query,
    searchedBeforeGenerate: true,
    categories: LIBRARY_CATEGORIES,
    matchCount: null,
    note: "Live search executes on the Production Mac asset library; HQ lists categories + exact missing capabilities.",
    expectedGaps,
  };
}

export function planAuraCreativeInstruction(text: string) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const format = formatFromText(lower);
  const durationMatch = /(\d+)\s*-?\s*second/.exec(lower);
  const durationSeconds = durationMatch
    ? Number(durationMatch[1])
    : /short|tiktok|promo|bumper/.test(lower)
      ? 10
      : 30;
  const brandPromoted = inferBrandPromoted(instruction);
  const projectTitle = inferProjectTitle(instruction, brandPromoted);
  const project = projectNameFrom(lower, brandPromoted);
  const timeline = `${project}-TL`;
  const isBarbers = /barber/.test(lower);
  const wantsMusic = /music|audio|soundtrack|bed|aggressive/.test(lower) || /youth|promo|commercial/.test(lower);
  const wantsBrand = /brand|logo|ifcdc|barber|youth|training|promo|commercial|bumper/.test(lower);
  const wantsFade = /fade|smooth|ending|draft|promo|commercial|training|video|bumper/.test(lower);
  const wantsTransition = /transition|promo|commercial|tiktok|draft|barber|training|bumper|youth/.test(lower);
  const cta = isBarbers
    ? "Book in the IFCDC Barbers App"
    : /youth/.test(lower)
      ? "Join IFCDC youth programs"
      : `Learn more · ${brandPromoted}`;
  const librarySearch = cloudLibrarySearch(instruction, brandPromoted);

  const NATURAL_LANGUAGE_INTAKE = {
    PROJECT_TYPE: /commercial/.test(lower)
      ? "commercial"
      : /train|bumper/.test(lower)
        ? "training_bumper"
        : /promo/.test(lower)
          ? "promotional"
          : "promotional",
    TARGET_AUDIENCE:
      format.label === "16:9"
        ? "YouTube / landscape"
        : /youth/.test(lower)
          ? "Youth program participants + community"
          : "Short-form social (TikTok / Reels)",
    DURATION: `${durationSeconds}s`,
    ASPECT_RATIO: format.label,
    BRAND: brandPromoted,
    STYLE: [/gold|brand/.test(lower) ? "gold_branding" : null, /aggressive/.test(lower) ? "aggressive" : null, /youth/.test(lower) ? "youth_program" : "ifcdc_branded"]
      .filter(Boolean)
      .join("+"),
    SCENES: [
      { id: "open", label: "Brand open / title card", order: 1 },
      { id: "proof", label: "Program / product proof", order: 2 },
      { id: "cta", label: "CTA + end credit", order: 3 },
    ],
    VOICE: /synthetic|tts|voice.?over/.test(lower) ? "synthetic_speech_if_requested" : "none",
    MUSIC: /aggressive/.test(lower) ? "aggressive_bed" : wantsMusic ? "approved_ifcdc_bed_if_available" : "none",
    CTA: cta,
    PLATFORM: /tiktok/.test(lower) ? "tiktok" : /youtube/.test(lower) ? "youtube" : "short_form_social",
    EXISTING_ASSETS_TO_USE: [] as string[],
    NEW_ASSETS_REQUIRED: [] as string[],
    FOUNDER_APPROVAL_REQUIRED: true,
  };

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

  const continuity = {
    characterIdentity: { subject: "non-person / brand-led unless Founder clone approved", founderClone: false },
    wardrobe: { locked: false },
    hairstyle: { locked: false },
    accessories: { locked: false },
    environment: { locked: false },
    lighting: { description: "IFCDC gold accent on black / ivory" },
    camera: { framing: format.label },
    color: { palette: ["#C9A227", "#0B0B0B", "#F5F0E6"] },
    aspectRatio: format.label,
    props: { items: [] },
    brand: {
      productionCompany: COMPANY,
      productionIdentity: IDENTITY,
      brandPromoted,
      visibleAutoBurn: false,
    },
    voice: { cloneApproved: false },
    sceneOrder: SCENES.map((s, i) => ({ order: i + 1, id: s.id, label: s.label })),
  };

  const generation = {
    searchedBeforeGenerate: true,
    inventMedia: false,
    willGenerateOnlyIfConfigured: true,
    phase: "6C",
    needs: librarySearch.expectedGaps,
    capabilities: {
      graphics_title_graphics: { status: "CONFIGURED_ON_MAC_IF_LOCAL_GRAPHICS", provider: "local-graphics" },
      image_generation: {
        status: "PROVIDER_ROUTED_IF_OPENAI_IMAGE_ACCESS",
        provider: "openai|hq-openai-proxy",
        blocker: "MISSING_MODEL_ACCESS:image_generation until dall-e-3/gpt-image-1 callable",
      },
      image_editing: { status: "ARCHITECTURE_READY", blocker: "MISSING_PROVIDER_OR_MODEL:image_editing" },
      video_generation: {
        status: "PROVIDER_ROUTED_IF_RUNWAY_KEY",
        provider: "runway|hq-runway-proxy",
        blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY until PRESENT on HQ",
      },
      image_to_video: {
        status: "PROVIDER_ROUTED_IF_RUNWAY_KEY",
        provider: "runway|hq-runway-proxy",
        blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY until PRESENT on HQ",
      },
      text_to_video: {
        status: "PROVIDER_ROUTED_IF_RUNWAY_KEY",
        provider: "runway|hq-runway-proxy",
        blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY until PRESENT on HQ",
      },
      background_scene_broll: {
        status: "PROVIDER_ROUTED_IF_RUNWAY_KEY",
        provider: "runway|hq-runway-proxy",
        blocker: "MISSING_CREDENTIAL:RUNWAY_API_KEY until PRESENT on HQ",
      },
      reference_continuity: {
        status: "PROVIDER_ROUTED_IF_RUNWAY_KEY",
        provider: "runway|hq-runway-proxy",
        blocker: "NOT_AVAILABLE_ON_ACCOUNT until Runway reference endpoint accepts the key",
      },
      voice_generation: {
        status: "PROVIDER_ROUTED_IF_OPENAI_TTS_ACCESS",
        provider: "openai|hq-openai-proxy",
        synthetic: true,
        blocker: "MISSING_MODEL_ACCESS:voice_generation until tts-1 callable",
      },
      founder_voice_clone: {
        status: "ARCHITECTURE_READY",
        blocker: "FOUNDATION_MEDIA_MISSING + MISSING_PROVIDER:founder_voice_clone",
      },
      founder_visual_clone: {
        status: "ARCHITECTURE_READY",
        blocker: "FOUNDATION_MEDIA_MISSING + MISSING_PROVIDER:founder_visual_clone",
      },
      music_sound_integration: { status: "CONFIGURED_ON_MAC_IF_APPROVED_BED", provider: "local-music-stage" },
    },
  };

  const pipeline = {
    version: 1,
    stages: PIPELINE_STAGES,
    currentStage: "ASSET_INVENTORY",
    auraMay: ["plan", "generate_if_configured", "edit", "render_drafts", "alternatives", "requested_revisions"],
    auraMayNot: ["publish", "distribution_authorization"],
    publish: false,
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
    gate: { gate: "AURA_PLAN", states: GATE_STATES, publish: false, distributionBlocked: true },
    NATURAL_LANGUAGE_INTAKE,
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
          : /train|bumper/.test(lower)
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
    ASSET_GAPS: librarySearch.expectedGaps,
    LIBRARY_SEARCH: librarySearch,
    GENERATION: generation,
    PIPELINE: pipeline,
    CONTINUITY: continuity,
    PRODUCTION_KIT_SLOTS: {
      note: "Live PRESENT/MISSING inventory is computed on the Production Mac",
      slots: [
        "gold-circle-logo",
        "transparent-logos",
        "official-fonts",
        "opening-card",
        "closing-card",
        "lower-thirds",
        "animated-logo",
        "title-cta-templates",
        "vertical-template",
        "landscape-template",
        "square-template",
      ],
    },
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
    phase: 7,
    planOnlyUnlessGenerated: !isBarbers,
    autonomous: true,
    clonePrep: {
      status: "ARCHITECTURE_READY",
      generationEngine: "NOT_EXECUTED_FOR_PERSON",
      founderIdentityLibrary: "READY_FOR_APPROVED_UPLOADS",
      ORIGINAL_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/ORIGINAL_FOUNDER_MEDIA",
      GENERATED_FOUNDER_MEDIA: "IFCDC-PRODUCTIONS/GENERATED_FOUNDER_MEDIA",
      approvedPhotosVideoVoice: "WAITING_FOR_APPROVED_MEDIA",
      generatedScenesTakes: "STORAGE_READY_NO_GENERATION",
      identityConsistency: "DEFINED",
      wardrobeEnvironment: "REFERENCE_DIRS_READY",
      roleTransformation: "REFERENCE_DIRS_READY",
      provenance: "ACTIVE",
      foundationMediaMissing: true,
      note: "Clone pipeline is architecture/storage/provenance only. No person generator runs without approved provider + approved source.",
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
  if (/music\s*harder|harder\s*music|more\s*energy|punchier\s*music/.test(lower)) intents.push("music_harder");
  if (/smoother\s*ending|ending\s*smoother|smooth(er)?\s*(the\s*)?end|fade\s*(out\s*)?longer/.test(lower)) {
    intents.push("smoother_ending");
  }
  if (/smooth\s*fade|smoother\s*fade/.test(lower)) intents.push("smooth_fade");
  if (/shorten\s*(the\s*)?open|tighten\s*(the\s*)?open/.test(lower)) intents.push("shorten_opening");
  if (/add\s*(the\s*)?logo/.test(lower)) intents.push("add_logo");
  if (/darker\s*(scene|look|grade)/.test(lower)) intents.push("darker_scene");
  if (/wardrobe|outfit|clothing/.test(lower)) intents.push("wardrobe");
  if (/location|environment/.test(lower)) intents.push("location");
  if (/camera\s*angle|wider|tighter\s*framing|close[\s-]?up/.test(lower)) intents.push("camera_angle");
  if (/smoother\s*transition|smooth(er)?\s*transition/.test(lower)) intents.push("smoother_transition");
  if (/replace\s*(the\s*)?generated|swap\s*(the\s*)?generated/.test(lower)) intents.push("replace_generated_clip");
  if (/duck\s*(under|the)?\s*voice|duck\s*under\s*vo/.test(lower)) intents.push("duck_under_voice");
  if (/keep\s*everything\s*else|only\s*change|leave\s*the\s*rest/.test(lower)) intents.push("keep_everything_else");
  if (!intents.length) intents.push("general_revision");

  const needsGenerator = intents.some((i) =>
    /wardrobe|location|camera_angle|replace_generated_clip|darker_scene/.test(i),
  );
  const executableWithoutGenerator = intents.every((i) =>
    /_version$|music_down|music_up|music_harder|smoother_ending|smooth_fade|shorten_opening|add_logo|duck_under_voice|smoother_transition|keep_everything_else|general_revision/.test(
      i,
    ),
  );

  return {
    note,
    intents,
    format,
    publish: false,
    gate: "FOUNDER_REVISION",
    dryModificationPlan: {
      targetsOnlyRequestedComponent: true,
      intents,
      keepEverythingElse: intents.includes("keep_everything_else") || intents.length === 1,
      formatChange: format,
      needsGenerator,
      executableWithoutGenerator,
      executeAgainstExistingMaster: !needsGenerator && executableWithoutGenerator,
      blockedIfMissingGenerator: needsGenerator
        ? intents.filter((i) => /wardrobe|location|camera_angle|replace_generated_clip|darker_scene/.test(i))
        : [],
    },
  };
}
