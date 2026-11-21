import { build } from "esbuild";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, "../../..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = process.env.SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const [host, plugin, bundle] = await Promise.all([
  readFile(resolve(here, "host.css")),
  readFile(resolve(repository, "apps/obsidian-plugin/styles.css")),
  build({
    entryPoints: [resolve(here, "fixture.js")], platform: "browser", bundle: true, write: false,
    plugins: [{ name: "mock-obsidian", setup: b => b.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve(here, "obsidian.js") })) }],
  }),
]);
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Objectives App fixture QA</title><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/plugin.css"></head>
<body class="is-mobile is-phone theme-light"><div class="workspace-leaf"><div class="view-header">Synthetic Obsidian workspace</div></div><script src="/fixture.js"></script></body></html>`;
const assets = new Map([
  ["/", ["text/html; charset=UTF-8", html]], ["/host.css", ["text/css", host]], ["/plugin.css", ["text/css", plugin]],
  ["/fixture.js", ["text/javascript", bundle.outputFiles[0].contents]],
]);
const server = createServer((req, res) => {
  const file = assets.get(req.url);
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:");
  if (!file) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": file[0] }); res.end(file[1]);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(4000);

  const errors = [];
  const external = [];
  await page.route("**/*", async route => {
    if (route.request().url().startsWith(url)) await route.continue();
    else { external.push(route.request().url()); await route.abort(); }
  });
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(url);
  await page.waitForFunction(() => document.body.dataset.fixtureReady === "true" || document.body.dataset.fixtureError, null, { timeout: 4000 });
  assert.equal(await page.locator("body").getAttribute("data-fixture-error"), null);
  if (process.env.INSPECT === "1") {
    console.log(await page.locator(".view-content").ariaSnapshot());
    console.log(await page.locator(".view-content").evaluate(e => e.innerHTML.slice(0, 12000)));
  } else await runScenarios(page, out);
  assert.deepEqual(errors, [], "Browser runtime errors");
  assert.deepEqual(external, [], "Unexpected outside requests");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

async function runScenarios(page, out) {
  const root = page.locator(".fjg-objectives-app");
  const list = page.getByRole("region", { name: "Objective list", exact: true });
  const listDOM = root.locator(".fjg-app-list");
  const details = page.getByRole("region", { name: "Objective details", exact: true });
  const detailDOM = root.locator(".fjg-app-detail");
  const search = page.getByRole("searchbox", { name: "Search objectives" });
  const back = details.getByRole("button", { name: "Back to objectives", exact: true });
  const more = page.getByRole("combobox", { name: "More views and statuses" });
  const focus = name => page.getByRole("navigation", { name: "Objective focus views" }).getByRole("button", { name, exact: true });
  const row = name => list.getByRole("button", { name: new RegExp("^" + name) });
  const theHeading = name => details.getByRole("heading", { name, exact: true });
  const action = re => details.getByRole("button", { name: re });
  const screenshot = async name => { if (out) await page.screenshot({ path: resolve(out, name + ".png") }); };
  const events = () => page.evaluate(() => window.fixtureEvents);
  const log = (name) => console.log("PASS " + name);
  const visible = async loc => { await loc.waitFor({ state: "visible", timeout: 2500 }); };
  const hidden = async loc => { await loc.waitFor({ state: "hidden", timeout: 2500 }); };
  const box = async loc => { const b = await loc.boundingBox(); assert.ok(b, "Expected a measurable element"); return b; };
  const closeTo = (a, b, slack = 3) => assert.ok(Math.abs(a - b) <= slack, `${a} differs from ${b} by > ${slack}px`);
  const exactEvent = (list, name, args) => assert.ok(list.some(e => e.name === name && JSON.stringify(e.args) === JSON.stringify(args)), `Missing ${name}(${JSON.stringify(args)}): ${JSON.stringify(list)}`);

  // Folded: full list -> single foreground detail, no visible/hittable competing list.
  await visible(row("Fixture Alpha"));
  assert.equal(await focus("Overview").getAttribute("aria-pressed"), "true");
  assert.equal(await focus("Completed").count(), 1);
  assert.equal(await more.locator("option").evaluateAll(options => options.filter(e => e.textContent.trim() === "Completed").length), 0);
  assert.equal(await row("Fixture Legacy Archive").count(), 0);
  assert.equal(await row("Fixture Converted").count(), 0);
  const rootFolded = await box(root);
  closeTo((await box(listDOM)).width, rootFolded.width);
  await screenshot("390-folded-overview");
  await row("Fixture Alpha").click();
  await visible(theHeading("Fixture Alpha"));
  await hidden(listDOM);
  closeTo((await box(detailDOM)).width, rootFolded.width);
  assert.equal(await list.count(), 0, "Hidden folded list must not appear in the accessibility tree");
  assert.equal(await back.evaluate(el => {
    const b = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
  }), true, "Visible detail controls should receive pointer hits");
  assert.ok((await box(back)).height >= 44, "Back is at least a 44px touch target");
  await screenshot("390-folded-detail");
  await back.click();
  assert.equal(await row("Fixture Alpha").evaluate(el => el === document.activeElement), true, "Back restores focus to the selected row");
  log("390px list/detail use the entire pane in turn; Back restores selection focus and hidden list cannot intercept taps");

  // Collapse + temporarily expand matching rows through search; retain filter and scroll.
  const doFirst = list.getByRole("button", { name: /^Do First *[0-9]+/ });
  await doFirst.click();
  assert.equal(await doFirst.getAttribute("aria-expanded"), "false");
  assert.equal(await row("Fixture Alpha").count(), 0);
  await search.fill("Fixture Alpha");
  await visible(row("Fixture Alpha"));
  await search.fill("");
  assert.equal(await doFirst.getAttribute("aria-expanded"), "false");
  await doFirst.click();
  await more.selectOption("status:do-first");
  await search.fill("Scroll Fixture");
  // Ensure a middle row is visible from an intentional nonzero scroll position,
  // rather than relying on Playwright to reposition a hidden target.
  const savedTop = await listDOM.evaluate(el => {
    const target = el.querySelector("[data-app-focus='row-tsk_scroll_13']");
    const outer = el.getBoundingClientRect(), row = target.getBoundingClientRect();
    el.scrollTop = row.top - outer.top - 140;
    return el.scrollTop;
  });
  assert.ok(savedTop > 200, `Folded objective list isn't independently scrollable: ${savedTop}`);
  await row("Scroll Fixture 13").click();
  await visible(theHeading("Scroll Fixture 13"));
  await back.click();
  assert.equal(await more.inputValue(), "status:do-first");
  assert.equal(await search.inputValue(), "Scroll Fixture");
  closeTo(await listDOM.evaluate(el => el.scrollTop), savedTop, 8);
  assert.equal(await row("Scroll Fixture 13").evaluate(el => el === document.activeElement), true);
  log("Search reveals collapsed groups temporarily; folded Back retains explicit status filter, search text, scroll and row focus");

  // Named views keep one Completed scope; status projection never alters stored task files.
  await search.fill("");
  await focus("Completed").click();
  assert.equal(await focus("Completed").getAttribute("aria-pressed"), "true");
  await visible(row("Fixture Completed"));
  await visible(row("Fixture Legacy Archive"));
  assert.equal(await row("Fixture Converted").count(), 0);
  assert.equal(await row("Fixture Alpha").count(), 0);
  await more.selectOption("converted");
  await visible(row("Fixture Converted"));
  assert.equal(await row("Fixture Completed").count(), 0);
  await page.getByRole("button", { name: "Talk to Vault", exact: true }).click();
  await page.getByRole("button", { name: "New objective", exact: true }).click();
  exactEvent(await events(), "openLiveVoice", []);
  exactEvent(await events(), "openQuickCaptureModal", []);
  log("One Completed focus, Converted isolated, and Talk/capture delegate to existing callbacks");

  // Width is actual host width, not a trusted device label. Shrink only height
  // to represent the vertical space remaining above a software keyboard.
  await focus("Overview").click();
  await page.setViewportSize({ width: 867, height: 780 });
  await row("Fixture Alpha").click();
  await visible(list);
  await visible(theHeading("Fixture Alpha"));
  const [left, right, wideRoot] = await Promise.all([box(listDOM), box(detailDOM), box(root)]);
  assert.ok(left.width >= 250 && right.width >= 340, `Narrow panes: ${JSON.stringify({left,right})}`);
  assert.ok(right.x >= left.x + left.width - 2, "Wide detail pane must be beside—not above/over—the list");
  closeTo(right.x + right.width, wideRoot.x + wideRoot.width);
  await screenshot("867-unfolded-two-panes");
  await page.locator(".workspace-leaf").evaluate(el => { el.style.width = "390px"; });
  await hidden(listDOM);
  closeTo((await box(detailDOM)).width, 390);
  await visible(theHeading("Fixture Alpha"));
  await page.locator(".workspace-leaf").evaluate(el => { el.style.removeProperty("width"); });
  await visible(list);
  await visible(theHeading("Fixture Alpha"));
  await search.focus();
  await page.setViewportSize({ width: 867, height: 440 });
  await search.fill("Fixture Alpha");
  const focusState = await search.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const visibleBottom = (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? innerHeight);
    return { focused: el === document.activeElement, bottom: rect.bottom, visibleBottom, pageWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
  assert.ok(focusState.focused && focusState.bottom <= focusState.visibleBottom, JSON.stringify(focusState));
  closeTo(focusState.pageWidth, focusState.clientWidth);
  await visible(theHeading("Fixture Alpha"));
  assert.ok((await box(detailDOM)).x > (await box(listDOM)).x);
  await screenshot("867-unfolded-short-viewport");
  await page.setViewportSize({ width: 867, height: 780 });
  log("867px two panes keep selected detail and keyboard focus at a simulated 440px usable height, without horizontal scrolling");

  // Files never bounce into the old folder browser. Resolve exact file on tap.
  await action(/^Show in Files$/i).click();
  const file = action(/^Notes\.md$/);
  await visible(file);
  await visible(theHeading("Fixture Alpha"));
  assert.equal(await details.locator("code").innerText(), "08 Tasks/Inbox/Files/Fixture Alpha/Files");
  await file.click();
  exactEvent(await events(), "workspace.openFile", ["08 Tasks/Inbox/Files/Fixture Alpha/Files/Notes.md", { active: true }]);
  await action(/^Copy Path$/i).click();
  exactEvent(await events(), "copyTaskFolderPath", ["tsk_alpha", { createMissing: false }]);
  await action(/^Update$/i).click();
  exactEvent(await events(), "openUpdateModal", ["tsk_alpha", { appView: true }]);
  await details.getByRole("navigation", { name: "Objective detail sections" }).getByRole("button", { name: "Actions", exact: true }).click();
  await action(/^Add action$/i).click();
  exactEvent(await events(), "openObjectiveActionModal", ["tsk_alpha", null, { appView: true }]);
  log("Show in Files stays within detail; exact file, Copy Path read-only, Update and Add Action dispatch to original handlers");

  // An ambiguous record after render cannot open a new card or invoke a stale
  // detail action. No fixture callback may silently mutate anything.
  const beforeDuplicate = (await events()).length;
  await page.evaluate(() => window.fixture.duplicate());
  await action(/^Copy Path$/i).click();
  let afterDuplicate = (await events()).slice(beforeDuplicate);
  assert.equal(afterDuplicate.filter(e => e.name !== "notice").length, 0, JSON.stringify(afterDuplicate));
  await back.click();
  await row("Fixture Alpha").click();
  await hidden(theHeading("Fixture Alpha"));
  afterDuplicate = (await events()).slice(beforeDuplicate);
  assert.ok(afterDuplicate.some(e => e.name === "notice" && e.args[0].includes("Duplicate objective ID")), JSON.stringify(afterDuplicate));
  assert.equal(afterDuplicate.filter(e => e.name !== "notice").length, 0);
  log("A newly duplicated ID blocks stale detail actions and new navigation");

  await page.evaluate(() => window.fixture.close());
  assert.equal(await root.count(), 0);
  log("Close unmounts the App View and disposes its hosted detail");
}
