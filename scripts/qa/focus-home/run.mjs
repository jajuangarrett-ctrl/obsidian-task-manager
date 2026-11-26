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
  const sectionBar=page.getByRole("tablist",{name:"Objective Manager sections",includeHidden:true});
  const reveal=page.getByRole("button",{name:"Show section toolbar"});
  const hide=page.getByRole("button",{name:"Hide section toolbar"});
  assert.equal(await sectionBar.isVisible(),false,"Home starts without the section toolbar");
  assert.equal(await reveal.getAttribute("aria-expanded"),"false");
  assert.equal(await reveal.getAttribute("aria-controls"),await sectionBar.getAttribute("id"));
  const toggleBox=await reveal.boundingBox();
  assert.ok(toggleBox.width>=44 && toggleBox.height>=44);
  const hiddenY=(await pane1.boundingBox()).y;
  await reveal.tap();
  assert.equal(await home.getAttribute("aria-selected"),"true");
  assert.equal(await hide.getAttribute("aria-expanded"),"true");
  assert.ok((await pane1.boundingBox()).y-hiddenY>=44,"Hiding tabs gives their space back to the list");
  await hide.tap();
  assert.equal((await pane1.boundingBox()).y,hiddenY);
  await pane1.getByRole("heading",{name:"Today",exact:true,level:2}).waitFor();
  assert.equal(await pane2.isVisible(),false);
  assert.equal(await layout.isVisible(),false);
  assert.ok(await width(pane1)>370);
  assert.ok((await pane1.getByRole("button",{name:"Complete Confirm advisor coverage"}).boundingBox()).height>=44);
  const status=pane1.getByRole("combobox",{name:"Status for Confirm advisor coverage"});
  assert.equal(await status.count(),0,"Collapsed rows do not reserve space for a picker");
  assert.ok((await row().locator("..").boundingBox()).height < 72,"Collapsed single-line row is compact");
  await row().click();
  assert.deepEqual(await status.locator("option").allTextContents(),["Inbox","Do First","Do Soon","Ongoing","Delegate","Waiting","On Hold","Completed"]);
  assert.equal(await status.inputValue(),"do-first");
  assert.ok((await status.boundingBox()).height>=44);
  await status.selectOption("waiting");
  assert.equal(await status.inputValue(),"waiting");
  assert.equal(await row().getAttribute("aria-expanded"),"true");
  assert.equal(await status.evaluate(el=>!!el.closest(".fjg-focus-tools")),true);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  assert.equal(await status.inputValue(),"do-first");
  await screen("01-folded-today");

  const quickPlus=page.getByRole("button",{name:"Quick Entry",exact:true});
  const plusBox=await quickPlus.boundingBox();
  assert.equal(await quickPlus.evaluate(el=>!!el.closest(".fjg-focus-toolbar")),true);
  assert.equal(await page.locator(".fjg-focus-addbar").count(),0);
  assert.equal(await quickPlus.count(),1);
  assert.ok(plusBox.width>=44 && plusBox.height>=44);
  assert.equal(await quickPlus.evaluate(el=>getComputedStyle(el).backgroundColor),"rgba(0, 0, 0, 0)");
  assert.ok((await pane1.getByRole("heading",{name:"Checklist"}).boundingBox()).y < (await pane1.getByText("Synthetic objective summary.",{exact:true}).boundingBox()).y);
  const checklist= pane1.getByRole("button",{name:"Check draft schedule"});
  await page.evaluate(()=>window.focusFixture.holdSave());
  await checklist.tap();
  assert.equal(await checklist.getAttribute("aria-pressed"),"true","Checklist reacts before saving finishes");
  assert.equal(await checklist.locator(".fjg-focus-icon").getAttribute("data-icon"),"circle-check");
  assert.equal(await checklist.isDisabled(),true);
  await page.evaluate(()=>window.focusFixture.rerender());
  assert.equal(await checklist.getAttribute("aria-pressed"),"true","Pending mark survives a redraw");
  await page.evaluate(()=>window.focusFixture.finishSave(true));
  await page.getByRole("alert").getByText("Fixture save failed").waitFor();
  assert.equal(await checklist.getAttribute("aria-pressed"),"false");
  assert.equal(await checklist.isEnabled(),true);
  await checklist.tap();
  await page.waitForFunction(()=>document.querySelector(".fjg-focus-action[aria-pressed=true]:not([aria-busy])"));
  const complete=pane1.getByRole("button",{name:"Complete Confirm advisor coverage"});
  await page.evaluate(()=>window.focusFixture.holdSave());
  await complete.tap();
  assert.equal(await complete.getAttribute("aria-pressed"),"true");
  assert.equal(await complete.locator(".fjg-focus-icon").getAttribute("data-icon"),"circle-check");
  await page.evaluate(()=>window.focusFixture.finishSave(false));
  await complete.waitFor({state:"hidden"});
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await complete.waitFor();
  assert.equal(await complete.getAttribute("aria-pressed"),"false");
  await row().getAttribute("aria-expanded").then(async open=>{if(open!=="true")await row().click();});
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
  const reading=page.getByRole("region",{name:"Selected objective"});
  const rightScroller=pane2.locator(".fjg-focus-scroll");
  const rightTop=await rightScroller.evaluate(el=>{el.scrollTop=220;return el.scrollTop;});
  const readingHeading=reading.getByRole("heading",{name:"Confirm advisor coverage",level:2});
  await row().click();
  await readingHeading.waitFor();
  await reading.getByRole("button",{name:"Chat with this objective",exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixtureEvents.find(e=>e.action==="objective-chat").args),[
    "obj_4","08 Tasks/Inbox/Files/Confirm advisor coverage/task.md"
  ]);
  await reading.getByText(/Synthetic objective summary/).waitFor();
  await reading.getByRole("button",{name:"Check draft schedule"}).waitFor();
  assert.ok((await reading.getByRole("heading",{name:"Checklist",exact:true}).boundingBox()).y <
    (await reading.getByRole("heading",{name:"Objective notes",exact:true}).boundingBox()).y);

  await reading.getByRole("combobox",{name:"Status for Confirm advisor coverage"}).waitFor();
  assert.equal(await pane2.isVisible(),false);
  assert.ok((await pane1.boundingBox()).x<(await reading.boundingBox()).x);
  assert.ok(await width(reading)>415 && await width(reading)<450);
  const readingScroll=reading.locator(".fjg-focus-scroll");
  await readingScroll.evaluate(e=>e.dataset.toolbarTestNode="same");
  await reveal.tap();
  await readingHeading.waitFor();
  await page.setViewportSize({width:669,height:871});
  await hide.waitFor();
  await hide.tap();
  assert.equal(await sectionBar.isVisible(),false);
  assert.equal(await readingScroll.getAttribute("data-toolbar-test-node"),"same","Toggle from open detail does not remount the scroller");
  await page.setViewportSize({width:871,height:669});
  await screen("02b-book-split-objective");
  await reading.getByRole("button",{name:"Full Width",exact:true}).click();
  assert.equal(await pane1.isVisible(),false);assert.ok(await width(reading)>850);
  await screen("02c-full-width-landscape");
  await reading.getByRole("button",{name:"Restore layout",exact:true}).click();
  assert.equal(await pane1.isVisible(),true);
  await page.setViewportSize({width:386,height:678});
  assert.equal(await pane1.isVisible(),false); assert.ok(await width(reading)>370);
  await page.setViewportSize({width:871,height:669});
  await reading.getByRole("button",{name:"Back to lists",exact:true}).click();
  assert.equal(await reading.isVisible(),false);await pane2.waitFor();
  assert.equal(await rightScroller.evaluate(el=>el.scrollTop),rightTop);
  assert.equal(await row().evaluate(el=>el===document.activeElement),true);

  const upcomingStatus=pane2.getByRole("combobox",{name:"Status for Prepare workshop agenda"});
  assert.equal(await upcomingStatus.count(),0);
  await pane2.getByRole("button",{name:/^Prepare workshop agenda/}).click();
  await upcomingStatus.selectOption("completed");
  await upcomingStatus.waitFor({state:"hidden"});
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  assert.equal(await upcomingStatus.inputValue(),"do-soon");

  await pane1.getByRole("button",{name:/^Fixture row 00/}).dragTo(pane2.getByRole("heading",{name:"Tomorrow"}));
  await page.getByRole("button",{name:"Undo",exact:true}).waitFor();
  await pane2.getByRole("button",{name:/^Fixture row 00/}).waitFor();
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await pane1.getByRole("button",{name:/^Fixture row 00/}).waitFor();
  await page.getByRole("button",{name:"Quick Entry",exact:true}).dragTo(pane2.getByRole("heading",{name:"Tomorrow"}));
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
  await row().click(); await readingHeading.waitFor();
  assert.ok(await width(reading)>630);
  await page.getByRole("navigation",{name:"Focus lists sidebar"}).waitFor();
  await screen("03b-sidebar-and-objective");
  await reading.getByRole("button",{name:"Full Width",exact:true}).click();
  assert.equal(await page.getByRole("navigation",{name:"Focus lists sidebar"}).isVisible(),false);
  await reading.getByRole("button",{name:"Restore layout",exact:true}).click();
  await reading.getByRole("button",{name:"Back to lists",exact:true}).click();

  assert.equal(await pane2.isVisible(),false);
  await layout.selectOption("single");
  assert.equal(await page.getByRole("navigation",{name:"Focus lists sidebar"}).isVisible(),false);
  await layout.selectOption("split");
  await pane2.getByRole("heading",{name:"Anytime",level:2}).waitFor();

  await page.getByRole("button",{name:"Quick Entry",exact:true}).click();
  assert.equal(await page.getByRole("textbox",{name:"Title",exact:true}).getAttribute("autocapitalize"),"none");
  assert.equal(await page.getByRole("textbox",{name:"Notes",exact:true}).getAttribute("autocapitalize"),"none");
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

  await page.setViewportSize({width:871,height:669});
  await page.locator("body").evaluate(el=>{el.classList.remove("theme-light");el.classList.add("theme-dark","custom-theme");});
  await page.addStyleTag({content:`
    .custom-theme { --background-primary:#111634; --background-secondary:#1d2549; --text-normal:#f1f2ff; --text-muted:#c3cce1; }
    .custom-theme .fjg-focus-home button { height:44px !important; max-height:44px; font-size:19px; }
    .custom-theme .fjg-focus-home .fjg-focus-title { font-size:20px; }
    .custom-theme .fjg-focus-home button span { white-space:nowrap; }
  `});
  const overdue=pane1.getByRole("button",{name:/^Coordinate Three Temporary/});
  const next=pane1.getByRole("button",{name:/^Prepare the Annual Enrollment/});
  for (const [width,height] of [[871,669],[386,678],[669,871]]) {
    await page.setViewportSize({width,height});await overdue.waitFor();
    const a=await overdue.boundingBox(), b=await next.boundingBox();
    assert.ok(a.height>44, "Wrapped title must grow despite a fixed theme button height");
    assert.ok(a.y+a.height+2<=b.y, "Wrapped title and next row must not overlap");
    const inner=await overdue.evaluate(el=>{const t=el.firstElementChild.getBoundingClientRect(),m=el.querySelector(".fjg-focus-meta").getBoundingClientRect();return {titleBottom:t.bottom,metaTop:m.top,metaBottom:m.bottom,rowBottom:el.closest(".fjg-focus-row").getBoundingClientRect().bottom};});
    assert.ok(inner.titleBottom<=inner.metaTop && inner.metaBottom<=inner.rowBottom,"Metadata has space inside its own row");
    await screen("05-theme-long-title-"+width);
  }
  await pane1.getByRole("heading",{name:"Past Due",exact:true,level:3}).waitFor();
  await pane1.getByRole("button",{name:"View all 2 past-due objectives"}).click();
  await pane1.getByRole("heading",{name:/Past Due/,level:2}).waitFor();
  assert.equal(await pane1.locator(".fjg-focus-row").count(),2);
  assert.equal(await pane1.getByText(/Completed overdue fixture/).count(),0);
  assert.equal(await pane1.getByText(/Confirm advisor coverage/).count(),0);
  await pane1.getByRole("button",{name:"Choose primary list"}).click();
  await page.getByRole("button",{name:"Today",exact:true}).click();

  await reveal.tap();
  await all.click();
  assert.equal(await sectionBar.isVisible(),true,"Other sections keep the toolbar");
  await page.getByRole("heading",{name:"All",exact:true}).waitFor();
  await page.getByRole("searchbox",{name:"Search All objectives"}).waitFor();
  await page.getByRole("button",{name:/^All Open/}).waitFor();
  await page.getByRole("button",{name:/^All objectives/}).waitFor();
  for(const [tab,label,summary,expected] of [
    ["All", "Search All objectives", ".fjg-home-count", /1 matching/],
    [/^Overview/, "Search Overview objectives", ".fjg-overview-summary", /^1 of/],
    ["Area", "Search Area objectives", ".fjg-overview-summary", /^1 objectives/],
    ["Move", "Search Move queue", ".fjg-move-search-results p", /^1 matching/],
  ]){
    const target=page.getByRole("tab",{name:tab,exact:typeof tab==="string"});
    if(await target.getAttribute("aria-selected")!=="true")await target.click();
    const search=page.getByRole("searchbox",{name:label,exact:true});
    assert.equal(await search.getAttribute("autocapitalize"),"none");
    const original=await search.elementHandle();
    await search.fill("confirm advisor");
    await page.locator(summary).filter({hasText:expected}).first().waitFor();
    await search.press("End");
    await search.pressSequentially(" coverage",{delay:145});
    assert.equal(await search.inputValue(),"confirm advisor coverage");
    assert.equal(await original.evaluate(el=>el===document.activeElement && el.isConnected),true,"Filtering must not replace or refocus the field.");
    await original.dispose();
  }
  await page.getByRole("tab",{name:"Objectives",exact:true}).click();
  await page.locator('button[data-view="converted"]').click();
  await page.getByRole("searchbox",{name:"Search objectives in the current view"}).fill("");

  const convertedTitle=await page.evaluate(()=>window.focusFixture.convertedTitle);
  const convertedCard=page.locator(".fjg-task-rows .fjg-task-row").filter({has:page.getByRole("button",{name:convertedTitle,exact:true})});
  const convertedName=convertedCard.getByRole("button",{name:convertedTitle,exact:true});
  await convertedName.waitFor();

  const panel=page.locator(".fjg-objective-selection");
  const showBulk=panel.getByRole("button",{name:"Show bulk actions"});
  const hideBulk=panel.getByRole("button",{name:"Hide bulk actions"});
  const copyDelete=panel.getByRole("button",{name:"Copy delete prompt"});
  const selection=convertedCard.getByRole("checkbox",{name:/^Select objective/});
  const panelBox=await panel.boundingBox();
  const toggleSize=await showBulk.boundingBox();
  assert.ok(toggleSize.width>=44 && toggleSize.height>=44);
  assert.equal(await copyDelete.isVisible(),false);
  assert.equal(await showBulk.getAttribute("aria-expanded"),"false");
  assert.equal(await showBulk.getAttribute("aria-controls"),await panel.locator(".fjg-objective-selection-body").getAttribute("id"));
  await showBulk.click();
  assert.ok((await panel.boundingBox()).height>panelBox.height+150,"Collapsing gives substantial vertical space back");
  assert.equal(await copyDelete.isVisible(),true);
  assert.equal(await copyDelete.isEnabled(),false);
  await panel.getByRole("button",{name:"Select visible"}).click();
  await panel.getByText("1 checked",{exact:true}).waitFor();
  assert.equal(await selection.isChecked(),true);
  assert.equal(await copyDelete.isEnabled(),true);
  await hideBulk.focus();
  await hideBulk.press("Enter");
  assert.equal(await showBulk.evaluate(el=>el===document.activeElement),true);
  assert.equal(await selection.isChecked(),true);
  assert.equal(await copyDelete.isVisible(),false);
  await page.locator('button[data-view="completed"]').click();
  await panel.getByText("1 checked · 1 outside this view or filter",{exact:true}).waitFor();
  assert.equal(await showBulk.getAttribute("aria-expanded"),"false");
  await page.locator('button[data-view="converted"]').click();
  assert.equal(await selection.isChecked(),true);
  await showBulk.click();
  assert.equal(await copyDelete.isEnabled(),true);
  await panel.getByRole("button",{name:"Clear selection"}).click();
  assert.equal(await selection.isChecked(),false);
  assert.equal(await copyDelete.isEnabled(),false);
  await hideBulk.click();

  for(const [viewport,pane,stacked] of [[386,386,true],[871,871,true],[1100,340,true],[1280,1280,false]]){
    await page.setViewportSize({width:viewport,height:678});
    await page.locator(".workspace-leaf").evaluate((el,w)=>el.style.width=w+"px",pane);
    assert.equal(await convertedCard.count(),1);
    const metrics=await convertedName.evaluate(el=>{
      const card=el.closest(".fjg-task-row"), main=el.closest(".fjg-task-main"), controls=card.querySelector(".fjg-task-controls");
      const box=card.getBoundingClientRect();
      const labels=[el,...card.querySelectorAll(".fjg-conversion-info button")];
      return {
        width:el.getBoundingClientRect().width,
        stacked:controls.getBoundingClientRect().top>=main.getBoundingClientRect().bottom,
        inside:controls.getBoundingClientRect().right<=box.right+1,
        labelsFit:labels.every(label=>label.scrollWidth<=label.clientWidth+1 && label.scrollHeight<=label.clientHeight+1),
      };
    });
    assert.ok(metrics.width>=Math.min(210,pane*0.56),`Long title must be readable at ${viewport}/${pane}: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.stacked,stacked);
    assert.ok(metrics.inside && metrics.labelsFit,`Card and link labels stay visible at ${viewport}/${pane}: ${JSON.stringify(metrics)}`);
    assert.equal(await convertedCard.getByText("Work continues in the linked action",{exact:true}).isVisible(),true);
  }
  const more=convertedCard.locator(".fjg-task-more > summary");
  await more.click();
  await convertedCard.getByRole("button",{name:`Rename ${convertedTitle}`,exact:true}).click();
  assert.equal(await page.evaluate(()=>window.fixtureEvents.at(-1).action),"rename");
  await page.locator(".workspace-leaf").evaluate(el=>el.style.removeProperty("width"));
  await page.setViewportSize({width:386,height:678});
  await home.click();await pane1.getByRole("heading",{name:"Today",exact:true,level:2}).waitFor();
  assert.equal(await sectionBar.isVisible(),false,"Returning to Home restores the space-saving default");
  assert.equal(await reveal.evaluate(el=>el===document.activeElement),true);
  await page.addStyleTag({content:`
    .is-mobile .modal button { background: #d5daee !important; height: 44px !important; }
    .modal { position: fixed; inset: 8px; z-index: 10; padding: 12px; overflow:auto; background: var(--background-secondary); }
  `});
  for(const w of [386,871]){
    await page.setViewportSize({width:w,height:w===386?678:669});
    await row().click();
    const details=w===386?pane1:reading;
    await details.locator("summary").filter({hasText:"More"}).click();
    await details.getByRole("button",{name:"Move",exact:true}).click();
    const dialog=page.getByRole("dialog",{name:/Move objective/});
    const select=dialog.getByRole("option");
    const confirm=dialog.getByRole("button",{name:"Move objective"});
    assert.equal(await confirm.isDisabled(),true);
    await select.nth(1).tap();
    assert.equal(await select.nth(1).getAttribute("aria-selected"),"true");
    await select.nth(1).getByText("✓ Selected",{exact:true}).waitFor();
    assert.notEqual(await select.nth(0).evaluate(e=>getComputedStyle(e).backgroundColor),await select.nth(1).evaluate(e=>getComputedStyle(e).backgroundColor));
    assert.ok((await select.nth(1).boundingBox()).height>=44);
    await dialog.getByRole("searchbox").fill("Synthetic reference");
    await dialog.getByRole("status").getByText(/Selected folder: .*Long Folder/).waitFor();
    await select.first().tap();
    await dialog.getByRole("status").getByText("Selected folder: 03 Areas/Synthetic reference",{exact:true}).waitFor();
    assert.equal(await confirm.isEnabled(),true);
    await confirm.tap();
    await dialog.waitFor({state:"hidden"});
    if(w!==386)await reading.getByRole("button",{name:"Back to lists",exact:true}).click();
    else await row().click();
  }
  assert.deepEqual(await page.evaluate(()=>window.fixtureEvents.filter(e=>e.action==="move").map(e=>e.args)),[["03 Areas/Synthetic reference"],["03 Areas/Synthetic reference"]]);
  await page.setViewportSize({width:386,height:678});
  const deletion=page.getByRole("dialog",{name:"Delete objective: Synthetic objective"});
  await page.evaluate(()=>window.focusFixture.openDelete());
  await deletion.getByText("Other note.md → Vault/Synthetic/Attachment.md",{exact:true}).waitFor();
  assert.equal(await deletion.getByRole("textbox").count(),0);
  const trash=deletion.getByRole("button",{name:"Move to Trash"});
  assert.equal(await trash.isDisabled(),true);
  await deletion.getByRole("checkbox",{name:"I reviewed what will go to Trash"}).check();
  assert.equal(await trash.isEnabled(),true);
  await trash.tap();
  await deletion.waitFor({state:"hidden"});
  await page.evaluate(()=>window.focusFixture.openDelete(true));
  await deletion.getByText("Contains another objective",{exact:true}).waitFor();
  assert.equal(await trash.count(),0);
  await deletion.getByRole("button",{name:"Close"}).click();
  assert.deepEqual(await page.evaluate(()=>window.fixtureEvents.filter(e=>e.action==="trash-preview").map(e=>e.args)),[[{acknowledgeLinks:true}]]);
  console.log("PASS Home toolbar visibility and space, folded, book split, portrait active pane, sidebar/single, touch targets, checklist, plan/undo retains deadline, capture resize, All, themed Move folder selection, and explicit no-typing Trash confirmation, stable lowercase search fields, readable Converted cards across pane sizes, and collapsible bulk actions without losing selection");
}
