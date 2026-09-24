/**
 * Founder Digital Clone pipeline — placeholders only for Phase 3G.
 * No generation engine. No model calls. Resolve only receives approved clips later.
 */

export const CLONE_PROVIDERS = [
  { id: "resolve-fusion", role: "edit, composite, warp, titles, grade, finish", local: true },
  {
    id: "approved-generator",
    role: "still or video identity generation from approved Founder media",
    local: true,
    configured: false,
  },
];

export function clonePlan(instruction) {
  return {
    publish: false,
    founderApprovalRequired: true,
    usesExistingResolveBridge: true,
    status: "PLACEHOLDERS_ONLY",
    modules: {
      founderIdentityLibrary: {
        status: "PLACEHOLDER",
        note: "Approved Founder photos / video / voice will live here. Not configured.",
      },
      approvedPhotosVideoVoice: {
        status: "PLACEHOLDER",
        note: "No Founder-identity assets are imported by creative draft runs.",
      },
      generatedScenesTakes: {
        status: "PLACEHOLDER",
        note: "Scene / take generation stays off until Founder enables a generator.",
      },
      identityConsistency: {
        status: "PLACEHOLDER",
        note: "Likeness locks are defined later against approved sources only.",
      },
      wardrobeEnvironment: {
        status: "PLACEHOLDER",
        note: "Wardrobe and environment variants are not generated in this milestone.",
      },
      roleTransformation: {
        status: "PLACEHOLDER",
        note: "Role transformation (barber / loctician / etc.) waits on approved media.",
      },
      provenance: {
        status: "PLACEHOLDER",
        note: "Provenance tracking will attach to accepted clips before Resolve import.",
      },
    },
    stages: [
      { id: "source", label: "Approved Founder photos and video only" },
      { id: "identity", label: "Lock face, voice, and likeness to those approved sources" },
      { id: "roles", label: "Generate role, clothing, and environment variants" },
      { id: "review-assets", label: "Founder accepts or rejects each generated clip" },
      { id: "resolve", label: "Import accepted clips into the Resolve timeline" },
      { id: "fusion", label: "Warp and transformation scenes in Fusion" },
      { id: "finish", label: "Branding, music, voiceover, transitions, fade" },
      { id: "preview", label: "Show the finished version" },
      { id: "approval", label: "Founder approval before any release" },
    ],
    providers: CLONE_PROVIDERS,
    generator: {
      id: "approved-generator",
      status: "NOT_CONFIGURED",
      note: "No generation model is called. Accepted files are the only assets Resolve will import.",
    },
    instruction: String(instruction || ""),
  };
}
