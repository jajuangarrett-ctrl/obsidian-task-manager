import { build } from "esbuild";
import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(`${tmpdir()}/fjg-live-workspace-`);
await mkdir(out, { recursive: true });
await build({
  entryPoints: [resolve(here, "app.ts")], outfile: resolve(out, "app.js"),
  bundle: true, platform: "browser", format: "iife",
  plugins: [{
    name: "synthetic-only",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve(here, "obsidian.ts") }));
      build.onResolve({ filter: /^\.\/live-session$/ }, () => ({ path: resolve(here, "session.ts") }));
    },
  }],
});
for (const file of ["index.html", "workspace.html", "host.css"]) await copyFile(resolve(here, file), resolve(out, file));
await copyFile(resolve(here, "../../../apps/obsidian-plugin/styles.css"), resolve(out, "plugin.css"));
console.log(out);
