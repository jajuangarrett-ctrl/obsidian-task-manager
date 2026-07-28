import esbuild from "esbuild";
import fs from "node:fs";

fs.mkdirSync("dist", { recursive: true });
await esbuild.build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/migrate.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: true,
  banner: { js: "#!/usr/bin/env node" }
});
fs.chmodSync("dist/migrate.cjs", 0o755);
