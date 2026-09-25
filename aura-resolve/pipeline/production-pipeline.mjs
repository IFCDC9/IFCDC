/**
 * Idea → production pipeline object (Phase 5).
 * Plan stages always; GENERATE MISSING ASSETS only runs when a provider is configured.
 */
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

export const APPROVAL_GATE_STATES = [
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

/**
 * Build the full pipeline plan object for a new project.
 * Does not execute generation or Resolve render by itself.
 */
export function buildProductionPipeline({
  instruction,
  brandPromoted,
  projectTitle,
  project,
  format,
  durationSeconds,
  script,
  scenes,
  shotList,
  assetInventory,
  librarySearch,
  continuity,
  creativeMemory,
  generation,
  productionCompany = "IFCDC PRODUCTIONS",
  productionIdentity = "IFCDC PRODUCTION",
} = {}) {
  const stages = PIPELINE_STAGES.map((id, index) => {
    const base = {
      id,
      order: index + 1,
      status: "PENDING",
    };
    switch (id) {
      case "FOUNDER_IDEA":
        return { ...base, status: "DONE", payload: { instruction } };
      case "CREATIVE_BRIEF":
        return {
          ...base,
          status: "DONE",
          payload: {
            productionCompany,
            productionIdentity,
            brandPromoted,
            projectTitle,
            project,
            format: format?.label || format,
            durationSeconds,
            publish: false,
          },
        };
      case "SCRIPT":
        return { ...base, status: script?.length ? "DONE" : "PENDING", payload: { script } };
      case "SCENE_BREAKDOWN":
        return { ...base, status: scenes?.length ? "DONE" : "PENDING", payload: { scenes } };
      case "SHOT_LIST":
        return { ...base, status: shotList?.length ? "DONE" : "PENDING", payload: { shotList } };
      case "ASSET_INVENTORY":
        return {
          ...base,
          status: "DONE",
          payload: {
            inventory: assetInventory,
            librarySearch,
            searchBeforeGenerate: true,
          },
        };
      case "GENERATE_MISSING_ASSETS":
        return {
          ...base,
          status: generation?.anyGenerated
            ? "PARTIAL"
            : generation?.missing?.length
              ? "BLOCKED_NOT_CONFIGURED"
              : "SKIPPED_NONE_NEEDED",
          payload: generation || {
            note: "Providers not invoked yet — plan only",
            runOnlyIfConfigured: true,
          },
        };
      case "CONTINUITY":
        return { ...base, status: continuity ? "DONE" : "PENDING", payload: { continuity } };
      case "VOICE_MUSIC_SOUND":
        return {
          ...base,
          status: "PLANNED",
          payload: {
            voice: generation?.skipped?.filter((s) => /voice/i.test(s.capability || s.role || "")) || [],
            music: "search library first; stage approved bed only",
          },
        };
      case "RESOLVE_TIMELINE":
      case "EDIT":
      case "COLOR_AUDIO_GRAPHICS":
        return {
          ...base,
          status: generation?.anyGenerated ? "READY_WHEN_QUEUED" : "WAIT_FOR_ASSETS_OR_PLAN_ONLY",
        };
      case "DRAFT":
      case "HQ_PREVIEW":
        return {
          ...base,
          status: generation?.anyGenerated ? "READY_WHEN_QUEUED" : "PLAN_ONLY_UNTIL_MEDIA",
        };
      case "REVISION":
      case "APPROVAL":
        return { ...base, status: "GATED", payload: { publish: false, founderApprovalRequired: true } };
      case "FINAL_MASTER":
        return {
          ...base,
          status: "BLOCKED",
          payload: { publish: false, requires: "FOUNDER_APPROVAL" },
        };
      default:
        return base;
    }
  });

  return {
    version: 1,
    company: productionCompany,
    productionCompany,
    productionIdentity,
    brandPromoted,
    projectTitle,
    project,
    publish: false,
    auraMay: ["plan", "generate_if_configured", "edit", "render_drafts", "alternatives", "requested_revisions"],
    auraMayNot: ["publish", "distribution_authorization"],
    stages: PIPELINE_STAGES,
    stageDetails: stages,
    currentStage: generation?.anyGenerated ? "GENERATE_MISSING_ASSETS" : "ASSET_INVENTORY",
    gate: {
      gate: generation?.anyGenerated ? "GENERATE" : "PLAN",
      states: APPROVAL_GATE_STATES,
      publish: false,
      distributionBlocked: true,
    },
    creativeMemorySummary: creativeMemory
      ? { preferencesCount: Object.keys(creativeMemory.preferences || {}).length, appendOnly: true }
      : null,
    librarySearch,
    continuity,
    generation: generation || null,
  };
}
