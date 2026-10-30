export interface PathMove {from:string;to:string}
const normalize=(s:string)=>{const out:string[]=[];for(const p of s.split('/')){if(!p||p==='.')continue;if(p==='..')out.pop();else out.push(p);}return out.join('/');};
const parent=(s:string)=>s.slice(0,s.lastIndexOf('/'));
export function movedPath(path:string,moves:readonly PathMove[]):string {
 for(const m of [...moves].sort((a,b)=>b.from.length-a.from.length))if(path===m.from||path.startsWith(m.from+'/'))return m.to+path.slice(m.from.length);
 return path;
}
const relative=(from:string,to:string)=>{const a=parent(from).split('/'),b=to.split('/');while(a.length&&b.length&&a[0]===b[0]){a.shift();b.shift();}return [...a.map(()=> '..'),...b].join('/')||'.';};
/** Rewrite current text, never cached character offsets. Frontmatter is preserved verbatim. */
export function rewriteMovedLinks(text:string,oldSource:string,newSource:string,moves:readonly PathMove[],resolve:(link:string)=>string|undefined):string {
 const front=text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);const header=front?.[0]||'';let body=text.slice(header.length);
 body=body.replace(/\[\[([^\]\n]+)\]\]/g,(whole,inner:string)=>{const pipe=inner.indexOf('|'),raw=pipe<0?inner:inner.slice(0,pipe),alias=pipe<0?'':inner.slice(pipe);const hash=raw.indexOf('#'),link=hash<0?raw:raw.slice(0,hash),anchor=hash<0?'':raw.slice(hash);if(!link)return whole;let decoded:string;try{decoded=decodeURIComponent(link);}catch{return whole;}
  const direct=movedPath(decoded,moves);const resolved=direct!==decoded?decoded:resolve(decoded);if(!resolved)return whole;const target=movedPath(resolved,moves);if(target===resolved&&oldSource===newSource)return whole;
  const output=!/\.md$/i.test(link)&&target.endsWith('.md')?target.slice(0,-3):target;return `[[${output}${anchor}${alias}]]`;});
 const target=(raw:string)=>{if(!raw||raw.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('//'))return raw;let decoded:string;try{decoded=decodeURIComponent(raw);}catch{return raw;}const hash=decoded.indexOf('#'),path=hash<0?decoded:decoded.slice(0,hash),anchor=hash<0?'':decoded.slice(hash);const oldTarget=path.startsWith('/')?normalize(path):normalize(parent(oldSource)+'/'+path),next=movedPath(oldTarget,moves);if(next===oldTarget&&oldSource===newSource)return raw;const result=(path.startsWith('/')?'/'+next:relative(newSource,next))+anchor;return /%[0-9a-f]{2}/i.test(raw)?encodeURI(result).replace(/\(/g,'%28').replace(/\)/g,'%29'):result;};
 body=body.replace(/(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)\n]+)([^)\n]*\))/g,(whole,prefix:string,path:string,suffix:string)=>prefix+(path.startsWith('<')?'<'+target(path.slice(1,-1))+'>':target(path))+suffix);
 body=body.replace(/\b(href|src)=(['"])(.*?)\2/gi,(whole,key:string,quote:string,path:string)=>`${key}=${quote}${target(path).replaceAll(quote,quote==='"'?'%22':'%27')}${quote}`);
 return header+body;
}
