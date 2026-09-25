/**
 * Revision command understanding — maps Founder follow-ups onto the current production.
 */
import { GATE_STATES } from "./gates.mjs";

const VERTICAL = { width: 1080, height: 1920, label: "9:16" };
const LANDSCAPE = { width: 1920, height: 1080, label: "16:9" };
const SQUARE = { width: 1080, height: 1080, label: "1:1" };

/**
 * @param {string} note
 * @param {{ instruction?: string, projectName?: string, preferences?: object }} [context]
 */
export function parseRevision(note, context = {}) {
  const text = String(note || "").trim();
  const lower = text.toLowerCase();
  const prefs = { ...(context.preferences || {}) };
  const intents = [];

  let format = null;
  if (/youtube|landscape|16\s*:\s*9|horizontal/.test(lower)) {
    format = LANDSCAPE;
    intents.push("youtube_version");
  } else if (/tiktok|vertical|9\s*:\s*16|reel|story/.test(lower)) {
    format = VERTICAL;
    intents.push("tiktok_version");
  } else if (/square|1\s*:\s*1|instagram/.test(lower)) {
    format = SQUARE;
    intents.push("square_version");
  }

  let musicVolume = prefs.musicVolume ?? 0.35;
  if (/music\s*down|quieter\s*music|turn\s*(the\s*)?music\s*down|lower\s*(the\s*)?music|duck\s*music/.test(lower)) {
    musicVolume = Math.min(musicVolume, 0.16);
    intents.push("music_down");
    prefs.music = "ifcdc-bed-quieter";
    prefs.musicVolume = musicVolume;
  } else if (/music\s*up|louder\s*music/.test(lower)) {
    musicVolume = Math.max(musicVolume, 0.45);
    intents.push("music_up");
    prefs.musicVolume = musicVolume;
  }

  let fadeSeconds = prefs.fadeSeconds ?? 1.1;
  let endingStyle = prefs.endings || "smooth-fade-to-black";
  if (/smoother\s*ending|ending\s*smoother|smooth(er)?\s*(the\s*)?end|fade\s*(out\s*)?longer|softer\s*end/.test(lower)) {
    fadeSeconds = Math.max(fadeSeconds, 2.0);
    endingStyle = "extended-smooth-fade-to-black";
    intents.push("smoother_ending");
    prefs.endings = endingStyle;
    prefs.fadeSeconds = fadeSeconds;
  }

  let openSeconds = prefs.openSeconds ?? 2.6;
  if (/shorten\s*(the\s*)?open|shorter\s*open|tighten\s*(the\s*)?open|cut\s*(the\s*)?open/.test(lower)) {
    openSeconds = Math.min(openSeconds, 1.6);
    intents.push("shorten_opening");
    prefs.openSeconds = openSeconds;
  }

  if (/add\s*(the\s*)?logo|logo\s*(on|in)/.test(lower)) {
    intents.push("add_logo");
    prefs.brandingPlacement = "logo-open-lower-third-end-card";
  }

  if (/another\s*clip|different\s*clip|use\s*(another|other|different)\s*(clip|still|shot)/.test(lower)) {
    intents.push("swap_clip");
  }

  if (/change\s*(a\s*)?scene|replace\s*(a\s*)?scene/.test(lower)) {
    intents.push("change_scene");
  }

  if (/darker\s*(scene|look|grade|shot)|make\s*(it|the\s*scene)\s*darker/.test(lower)) {
    intents.push("darker_scene");
    prefs.color = "darker";
  }
  if (/wardrobe|outfit|clothing|clothes/.test(lower)) {
    intents.push("wardrobe");
  }
  if (/location|environment|set\s*dressing|background\s*scene/.test(lower)) {
    intents.push("location");
  }
  if (/camera\s*angle|angle\s*change|wider|tighter\s*framing|close[\s-]?up/.test(lower)) {
    intents.push("camera_angle");
  }
  if (/smoother\s*transition|smooth(er)?\s*transition|soften\s*transition/.test(lower)) {
    intents.push("smoother_transition");
    prefs.transitions = "smoother-brand-flash";
  }
  if (/replace\s*(the\s*)?generated|swap\s*(the\s*)?generated|new\s*generated\s*clip/.test(lower)) {
    intents.push("replace_generated_clip");
  }
  if (/music\s*harder|harder\s*music|more\s*energy|punchier\s*music|drive\s*the\s*music/.test(lower)) {
    intents.push("music_harder");
    prefs.music = "ifcdc-bed-harder";
    musicVolume = Math.max(musicVolume, 0.38);
    prefs.musicVolume = musicVolume;
  }
  if (/duck\s*(under|the)?\s*voice|duck\s*under\s*vo|voice\s*priority/.test(lower)) {
    intents.push("duck_under_voice");
    prefs.ducking = "duck-under-voice";
  }
  if (/smooth\s*fade|smoother\s*fade|fade\s*smooth/.test(lower)) {
    intents.push("smooth_fade");
    fadeSeconds = Math.max(fadeSeconds, 1.8);
    endingStyle = "smooth-fade-to-black";
    prefs.fadeSeconds = fadeSeconds;
    prefs.endings = endingStyle;
  }
  if (/keep\s*everything\s*else|only\s*change|leave\s*the\s*rest/.test(lower)) {
    intents.push("keep_everything_else");
  }

  if (!intents.length) {
    intents.push("general_revision");
  }

  const needsGenerator = intents.some((i) =>
    /wardrobe|location|camera_angle|replace_generated_clip|darker_scene/.test(i),
  );
  const isFormatOnly =
    intents.every((i) => /_version$|keep_everything_else/.test(i)) ||
    (intents.includes("youtube_version") && intents.filter((i) => i !== "keep_everything_else").length === 1) ||
    (intents.includes("tiktok_version") && intents.filter((i) => i !== "keep_everything_else").length === 1) ||
    (intents.includes("square_version") && intents.filter((i) => i !== "keep_everything_else").length === 1);

  const executableWithoutGenerator = intents.every((i) =>
    /_version$|music_down|music_up|music_harder|smoother_ending|smooth_fade|shorten_opening|add_logo|duck_under_voice|smoother_transition|keep_everything_else|general_revision/.test(
      i,
    ),
  );

  const dryModificationPlan = {
    targetsOnlyRequestedComponent: true,
    intents,
    keepEverythingElse: intents.includes("keep_everything_else") || intents.length === 1,
    formatChange: format || null,
    musicVolume,
    fadeSeconds,
    openSeconds,
    endingStyle,
    needsGenerator,
    executableWithoutGenerator,
    executeAgainstExistingMaster: isFormatOnly || (executableWithoutGenerator && !needsGenerator),
    blockedIfMissingGenerator: needsGenerator
      ? intents.filter((i) => /wardrobe|location|camera_angle|replace_generated_clip|darker_scene/.test(i))
      : [],
  };

  return {
    note: text,
    intents,
    format,
    musicVolume,
    fadeSeconds,
    openSeconds,
    endingStyle,
    preferences: prefs,
    remasterFromExisting: isFormatOnly,
    dryModificationPlan,
    projectName: context.projectName || null,
    gate: "FOUNDER_REVISION",
    gateStates: GATE_STATES,
    publish: false,
  };
}

export function formatFromRevisionOrInstruction(revision, instruction) {
  if (revision?.format) return revision.format;
  const lower = String(instruction || "").toLowerCase();
  if (/square|1\s*:\s*1/.test(lower)) return SQUARE;
  if (/landscape|youtube|16\s*:\s*9/.test(lower)) return LANDSCAPE;
  return VERTICAL;
}

export { VERTICAL, LANDSCAPE, SQUARE };
