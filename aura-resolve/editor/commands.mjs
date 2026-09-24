/**
 * High-level AURA video commands. Plans Founder language into allowlisted Resolve steps.
 * Never publishes. Final release stays behind Founder approval.
 */

export const EDITOR_COMMANDS = [
  "create_project",
  "import_assets",
  "create_timeline",
  "add_clip",
  "trim_clip",
  "split_clip",
  "move_clip",
  "add_transition",
  "add_title",
  "add_logo",
  "add_music",
  "add_voiceover",
  "adjust_audio_levels",
  "fade_audio",
  "fade_video",
  "add_subtitles",
  "apply_branding",
  "save_project",
  "render_vertical",
  "render_landscape",
];

const VERTICAL = { width: 1080, height: 1920 };
const LANDSCAPE = { width: 1920, height: 1080 };

export function planInstruction(text) {
  const instruction = String(text || "").trim();
  const lower = instruction.toLowerCase();
  const steps = [];
  const roles = [];
  if (/barber/.test(lower)) roles.push("barber");
  if (/loctician/.test(lower)) roles.push("loctician");
  if (/nail/.test(lower)) roles.push("nail technician");
  if (/shop owner|multi-location/.test(lower)) roles.push("multi-location shop owner");

  const duration = /(\d+)\s*-?\s*second/.exec(lower);
  const vertical = /vertical|tiktok|reel|story/.test(lower);
  const project = /barbers/.test(lower) ? "IFCDC-AURA-BARBERS-COMMERCIAL" : "IFCDC-AURA-EDIT";

  steps.push({ command: "create_project", payload: { name: project, frameRate: "24", ...(vertical ? VERTICAL : LANDSCAPE) } });
  steps.push({ command: "create_timeline", payload: { name: project.replace("PROJECT", "TIMELINE") + "-TIMELINE" } });
  if (roles.length) {
    steps.push({
      command: "clone_roles",
      payload: { roles, durationSeconds: duration ? Number(duration[1]) : 30 },
      executesInResolve: false,
      note: "Generation stays in the clone layer. Resolve only receives approved clips.",
    });
    for (const role of roles) {
      steps.push({ command: "add_clip", payload: { mediaName: `founder-${role.replace(/\s+/g, "-")}.mp4` }, waitsForAsset: true });
      if (role !== roles[roles.length - 1]) steps.push({ command: "add_transition", payload: { kind: "warp" } });
    }
  }
  if (/brand|logo|ifcdc/.test(lower)) steps.push({ command: "apply_branding", payload: { titleName: "Text" } });
  if (/music/.test(lower)) steps.push({ command: "add_music", payload: {}, waitsForAsset: true });
  if (/voiceover|voice over/.test(lower)) steps.push({ command: "add_voiceover", payload: {}, waitsForAsset: true });
  if (/subtitle|caption/.test(lower)) steps.push({ command: "add_subtitles", payload: { lines: [] } });
  if (/fade|smooth ending|ending/.test(lower)) {
    steps.push({ command: "fade_audio", payload: { kind: "audio" } });
    steps.push({ command: "fade_video", payload: { kind: "video" } });
  }
  steps.push({ command: "save_project", payload: {} });
  steps.push({
    command: vertical ? "render_vertical" : "render_landscape",
    payload: { name: project, ...(vertical ? VERTICAL : LANDSCAPE) },
    previewOnly: true,
  });

  return {
    instruction,
    publish: false,
    founderApprovalRequired: true,
    steps,
  };
}

export function toResolveCall(step) {
  if (step.command === "import_assets") {
    const paths = step.payload?.paths || (step.payload?.path ? [step.payload.path] : []);
    return paths.map((path) => ({ action: "import_media", payload: { path } }));
  }
  if (step.command === "render_vertical") {
    return [{ action: "render", payload: { ...VERTICAL, ...step.payload, width: 1080, height: 1920 } }];
  }
  if (step.command === "render_landscape") {
    return [{ action: "render", payload: { ...LANDSCAPE, ...step.payload, width: 1920, height: 1080 } }];
  }
  if (step.command === "fade_audio" || step.command === "fade_video") {
    return [{ action: step.command, payload: { kind: step.command === "fade_audio" ? "audio" : "video", ...step.payload } }];
  }
  if (step.command === "clone_roles" || step.executesInResolve === false || step.waitsForAsset) {
    return [];
  }
  return [{ action: step.command, payload: step.payload || {} }];
}
