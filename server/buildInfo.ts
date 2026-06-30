import fs from "fs";
import path from "path";
import { getAppRoot } from "./appPaths";

interface BuildInfo {
  commit: string | null;
  builtAt: string | null;
}

let cached: BuildInfo | null = null;

export function getBuildInfo(): BuildInfo {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(path.join(getAppRoot(), "dist", "build-info.json"), "utf8");
    cached = JSON.parse(raw) as BuildInfo;
  } catch {
    cached = { commit: null, builtAt: null };
  }
  return cached;
}
