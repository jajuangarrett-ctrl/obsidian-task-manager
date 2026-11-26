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
  readFile(resolve(here, "../objectives-app/host.css")),
  readFile(resolve(repository, "apps/obsidian-plugin/styles.css")),
  build({
    entryPoints: [resolve(here, "fixture.js")], platform: "browser", bundle: true, write: false,
    plugins: [{ name: "mock-obsidian", setup: b => b.onResolve({ filter: /^obsidian$/ }, () => ({ path: resolve(here, "../objectives-app/obsidian.js") })) }],
  }),
]);
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Focus Home fixture QA</title><link rel="stylesheet" href="/host.css"><link rel="stylesheet" href="/plugin.css"></head>
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
  const page = await browser.newPage({ viewport: { width: 386, height: 678 }, isMobile: true, hasTouch: true });
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
  const pane1=page.getByRole("region",{name:"Primary focus list"});
  const pane2=page.getByRole("region",{name:"Secondary focus list"});
  const home=page.getByRole("tab",{name:"Home",exact:true}), all=page.getByRole("tab",{name:"All",exact:true});
  const screen=async n=>{if(out)await page.screenshot({path:resolve(out,n+".png")});};
  const width=async loc=>(await loc.boundingBox()).width;
  const layout=page.getByRole("combobox",{name:"Home layout"});
  const row=()=>pane1.getByRole("button",{name:/^Confirm advisor coverage/});
  assert.equal(await home.getAttribute("aria-selected"),"true");
  await pane1.getByRole("heading",{name:"Today",exact:true,level:2}).waitFor();
  assert.equal(await pane2.isVisible(),false);
  assert.equal(await layout.isVisible(),false);
  assert.ok(await width(pane1)>370);
  assert.ok((await pane1.getByRole("button",{name:"Complete Confirm advisor coverage"}).boundingBox()).height>=44);
  await screen("01-folded-today");

  await row().click();
  await pane1.getByRole("button",{name:"Check draft schedule"}).click();
  assert.equal(await pane1.getByRole("button",{name:"Check draft schedule"}).getAttribute("aria-pressed"),"true");
  await pane1.getByRole("button",{name:"When",exact:true}).click();
  const dates=await page.evaluate(()=>({tomorrow:window.focusFixture.tomorrow,day:window.focusFixture.day}));
  await page.getByLabel(/Planning day/).fill(dates.tomorrow);
  await pane1.getByRole("button",{name:"Save",exact:true}).click();
  await page.getByRole("button",{name:"Undo",exact:true}).waitFor();
  let event=await page.evaluate(()=>window.fixtureEvents.find(e=>e.action==="plan"));
  assert.equal(event.due,dates.day);assert.equal(event.day,dates.tomorrow);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await page.getByRole("button",{name:"Undo",exact:true}).waitFor({state:"hidden"});

  await page.setViewportSize({width:871,height:669});
  await pane2.waitFor();assert.ok(await width(pane2)>415&&await width(pane2)<450);
  assert.ok((await pane1.boundingBox()).x < (await pane2.boundingBox()).x);
  await screen("02-unfolded-book-split");
  await pane1.getByRole("button",{name:/^Fixture row 00/}).dragTo(pane2.getByRole("heading",{name:"Tomorrow"}));
  await page.getByRole("button",{name:"Undo",exact:true}).waitFor();
  await pane2.getByRole("button",{name:/^Fixture row 00/}).waitFor();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await pane1.getByRole("button",{name:/^Fixture row 00/}).waitFor();
  await pane1.getByRole("button",{name:"Quick Entry",exact:true}).dragTo(pane2.getByRole("heading",{name:"Tomorrow"}));
  assert.equal(await page.getByLabel("When · optional").inputValue(),dates.tomorrow);
  await page.getByRole("button",{name:"Cancel"}).click();


  await pane2.getByRole("button",{name:"Choose second list"}).click();
  await page.getByRole("searchbox",{name:"Find a list"}).fill("anyt");
  await page.getByRole("searchbox",{name:"Find a list"}).press("Enter");
  await pane2.getByRole("heading",{name:"Anytime",level:2}).waitFor();
  await page.setViewportSize({width:669,height:871});
  await pane2.waitFor();
  assert.equal(await pane1.isVisible(),false);assert.ok(await width(pane2)>650);
  await screen("03-portrait-active-page");
  await page.setViewportSize({width:871,height:669});
  await layout.selectOption("sidebar");
  await page.getByRole("navigation",{name:"Focus lists sidebar"}).waitFor();
  assert.equal(await pane2.isVisible(),false);
  await layout.selectOption("single");
  assert.equal(await page.getByRole("navigation",{name:"Focus lists sidebar"}).isVisible(),false);
  await layout.selectOption("split");
  await pane2.getByRole("heading",{name:"Anytime",level:2}).waitFor();

  await pane1.getByRole("button",{name:"Quick Entry",exact:true}).click();
  await page.getByRole("textbox",{name:"Title",exact:true}).fill("Captured from Home");
  await page.getByRole("textbox",{name:"Notes",exact:true}).fill("Keep this draft over rotation");
  await page.getByRole("textbox",{name:/Checklist/}).fill("One\nTwo");
  await page.getByRole("textbox",{name:/Tags/}).fill("Work, Planning");
  await page.setViewportSize({width:386,height:390});
  assert.equal(await page.getByRole("textbox",{name:"Notes",exact:true}).inputValue(),"Keep this draft over rotation");
  const save=await page.getByRole("button",{name:"Save Objective"}).boundingBox();
  assert.ok(save.y>=0 && save.y+save.height<=390);
  assert.equal(await page.getByRole("button",{name:"Save Objective"}).evaluate(b=>{const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true);
  await screen("04-short-viewport-quick-entry");
  await page.getByRole("button",{name:"Save Objective"}).click();
  await page.waitForFunction(()=>window.fixtureEvents.some(e=>e.action==="capture"));
  event=await page.evaluate(()=>window.fixtureEvents.find(e=>e.action==="capture"));
  assert.deepEqual(event.p.initialActions,["One","Two"]);assert.equal(event.p.status,"inbox");

  await all.click();
  await page.getByRole("heading",{name:"All",exact:true}).waitFor();
  await page.getByRole("searchbox",{name:"Search All objectives"}).waitFor();
  await page.getByRole("button",{name:/^All Open/}).waitFor();
  await page.getByRole("button",{name:/^All objectives/}).waitFor();
  await home.click();await pane1.getByRole("heading",{name:"Today",exact:true,level:2}).waitFor();
  console.log("PASS folded, book split, portrait active pane, sidebar/single, touch targets, checklist, plan/undo retains deadline, capture resize and All");
}
