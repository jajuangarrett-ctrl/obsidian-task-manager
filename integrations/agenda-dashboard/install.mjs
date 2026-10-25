import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const bridge = readFileSync(new URL('./objective-agendas.js', import.meta.url), 'utf8');
const marker = '/* FJG objective folder import v1 */';
function replaceOnce(html, anchor, replacement) {
  if (html.split(anchor).length !== 2) throw new Error('Agenda template changed: expected exactly one hook: ' + anchor.slice(0, 70));
  return html.replace(anchor, replacement);
}
export function integrate(html) {
  const inline = '<script id="fjg-objective-agendas">\n' + bridge + '</script>';
  if (html.includes('id="fjg-objective-agendas"')) html = html.replace(/<script id="fjg-objective-agendas">[\s\S]*?<\/script>/, inline);
  else html = replaceOnce(html, '  <script>\n', '  ' + inline + '\n  <script>\n');
  if (!html.includes(marker)) {
    html = replaceOnce(html, '      if (!files.length) return;', `      if (!files.length) return;
      ${marker}
      var snapshotFile = files.find(function(file) { return !isAgentsSource(file) && file.name.toLowerCase() === "_objectives.json"; });
      var snapshot = {version:1, objectives:[]};
      try {
        if (snapshotFile) snapshot = JSON.parse(await snapshotFile.text());
        FJGObjectiveAgendas.validate(snapshot);
      } catch(error) {
        els.sourceInput.value = "";
        announce("Objective snapshot could not be read. The previous agenda has been kept. " + error.message);
        return;
      }
      var importedRoster = state.roster.map(function(member) { return Object.assign({}, member, {tasks:member.tasks.slice()}); });`);
    const start = html.indexOf('    async function importAgendaFiles(event) {');
    const end = html.indexOf('    function parseOpenTasks(', start);
    if(start < 0 || end < 0) throw new Error('Agenda importer hooks missing');
    let importer = html.slice(start,end);
    // Stage roster/Markdown changes until the validated snapshot is merged.
    importer = importer.replaceAll('state.roster', 'importedRoster').replace('var importedRoster = importedRoster.map', 'var importedRoster = state.roster.map');
    importer = replaceOnce(importer, '      state.importedAt =', '      state.roster = FJGObjectiveAgendas.merge(importedRoster, snapshot);\n      state.importedAt =');
    html = html.slice(0,start) + importer + html.slice(end);
    // Append: existing Markdown classification uses numeric category indexes.
    html = replaceOnce(html, '      "Other agenda items"\n    ];', '      "Other agenda items",\n      "Objectives"\n    ];');
    html = replaceOnce(html, '      "Other agenda items": "#657184"', '      "Other agenda items": "#657184",\n      "Objectives": "#16758a"');
    html = replaceOnce(html, '      copy.append(title, meta);', `      if (task.source === "objective" && task.path) {
        var sourceLink = document.createElement("a");
        sourceLink.textContent = "Open objective in Obsidian";
        sourceLink.href = "obsidian://open?vault=" + encodeURIComponent(task.vault || "FJG Vault") + "&file=" + encodeURIComponent(task.path);
        meta.append(" · ", sourceLink);
      }
      copy.append(title, meta);`);
  }
  for (const required of [marker, 'state.roster = FJGObjectiveAgendas.merge(importedRoster, snapshot)', '"Objectives": "#16758a"', 'Open objective in Obsidian']) {
    if (!html.includes(required)) throw new Error('Incomplete integration: ' + required);
  }
  return html;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const check = args.includes('--check'); const vault = args.find(arg => arg !== '--check');
  if (!vault) throw new Error('Usage: node integrations/agenda-dashboard/install.mjs <vault-path> [--check]');
  const path = join(resolve(vault), 'Artifacts/Agenda Dashboard/agenda.html');
  const before = readFileSync(path,'utf8'), after = integrate(before);
  if(check && before !== after) throw new Error('Agenda objective integration is missing or outdated. Run without --check to restore it.');
  if(!check && before !== after) writeFileSync(path,after);
  console.log(check ? 'Agenda objective integration verified.' : 'Agenda objective integration installed.');
}
