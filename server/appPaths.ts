import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Application root (Apps/IMPERIAL-FOUNDATION-CDC) — works in dev, bundled dist, and Render. */
export function getAppRoot(): string {
  const cwd = process.cwd();
  const cwdDist = path.join(cwd, "dist", "public", "index.html");
  if (fs.existsSync(cwdDist)) return cwd;

  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const fromModule = moduleDir.endsWith(`${path.sep}dist`)
      ? path.join(moduleDir, "..")
      : moduleDir.endsWith(`${path.sep}server`)
        ? path.join(moduleDir, "..")
        : cwd;
    const moduleDist = path.join(fromModule, "dist", "public", "index.html");
    if (fs.existsSync(moduleDist)) return fromModule;
  } catch {
    /* bundled without import.meta.url */
  }

  return cwd;
}

export function getPublicDir(): string {
  return path.join(getAppRoot(), "public");
}

export function getDistPublicDir(): string {
  return path.join(getAppRoot(), "dist", "public");
}

export function getSpaIndexPath(): string {
  return path.join(getDistPublicDir(), "index.html");
}
