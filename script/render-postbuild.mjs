#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const required = [
  path.join(root, "dist", "index.cjs"),
  path.join(root, "dist", "index.mjs"),
  path.join(root, "dist", "public", "index.html"),
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`Render postbuild: missing required artifact ${file}`);
    process.exit(1);
  }
}

console.log("Render postbuild: server bundle + SPA index verified");
