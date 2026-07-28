import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const outdir = "dist";
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    popup: "src/popup.ts",
    settings: "src/settings.ts",
    background: "src/background.ts"
  },
  bundle: true,
  outdir,
  format: "iife",
  target: "chrome120",
  minify: true,
  sourcemap: false
});

for (const file of ["manifest.json", "popup.html", "settings.html", "style.css"]) {
  fs.copyFileSync(path.join("src", file), path.join(outdir, file));
}
