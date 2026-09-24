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

  if (!intents.length) {
    intents.push("general_revision");
  }

  const isFormatOnly =
    intents.every((i) => /_version$/.test(i)) ||
    (intents.includes("youtube_version") && intents.length === 1) ||
    (intents.includes("tiktok_version") && intents.length === 1) ||
    (intents.includes("square_version") && intents.length === 1);

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
