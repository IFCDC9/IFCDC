import { createRequire } from "node:module";
import esbuild from "esbuild";

const require = createRequire(import.meta.url);

async function build() {
  await esbuild.build({
    entryPoints: ["server/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/index.cjs",
    packages: "external",
  });
  console.log("Server built to dist/index.cjs");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
