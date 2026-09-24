/**
 * Founder Digital Clone pipeline.
 * Resolve/Fusion finishes the edit. Generation is a swappable module.
 * Nothing publishes without Founder approval.
 */

export const CLONE_PROVIDERS = [
  { id: "resolve-fusion", role: "edit, composite, warp, titles, grade, finish", local: true },
  { id: "approved-generator", role: "still or video identity generation from approved Founder media", local: true, configured: false },
];

export function clonePlan(instruction) {
  return {
    publish: false,
    founderApprovalRequired: true,
    usesExistingResolveBridge: true,
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
