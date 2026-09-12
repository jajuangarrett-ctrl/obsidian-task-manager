/** Ranked keyword retrieval, not semantic/vector search. */
const noise = new Set('a an the and or of to in on for with from about me my please find search show tell all any notes note tasks task objectives objective folder folders'.split(' '));
function words(value: string): string[] { return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []; }
function stem(word: string): string { return word.length > 5 ? word.replace(/ies$/, 'y').replace(/(?:ing|ed|s)$/, '') : word.length > 3 ? word.replace(/s$/, '') : word; }
export function searchScore(query: string, title: string, content = ''): number {
  const raw=words(query), terms=[...new Set(raw.filter(w=>!noise.has(w)).map(stem))];
  if(!raw.length)return 1;
  if(!terms.length)return 0;
  const primary=new Set(words(title).map(stem)), body=new Set(words(content).map(stem));
  const matched=terms.filter(t=>primary.has(t)||body.has(t));
  if(!matched.length)return 0;
  return matched.length/terms.length*100 + matched.filter(t=>primary.has(t)).length*8 + (words(title).join(' ').includes(raw.join(' '))?30:0);
}
