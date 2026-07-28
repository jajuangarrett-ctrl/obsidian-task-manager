import esbuild from "esbuild";
import fs from "node:fs";

fs.mkdirSync("dist", { recursive: true });
for (const [entryPoint, outfile] of [
  ["src/main.ts", "dist/migrate.cjs"],
  ["src/audit.ts", "dist/audit.cjs"]
]) {
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    minify: true,
    banner: { js: "#!/usr/bin/env node" }
  });
  fs.chmodSync(outfile, 0o755);
}
