import {describe,it,expect} from 'vitest';
import {rewriteMovedLinks} from './move-links';
const moves=[{from:'08 Tasks/Inbox/Files/Example',to:'02 Programs/CalWORKs/CalWORKs Tasks/Example'}];
describe('current-text move references',()=>{
 it('preserves surrounding mail text after frontmatter has changed length',()=>{
 const text='---\nlocation: a newly expanded folder property\n---\nMessage ID: abc@example.com\n\n## Attachments\n\n- [[Evidence.pdf]]\n';
 const result=rewriteMovedLinks(text,moves[0].from+'/Note.md',moves[0].to+'/Note.md',moves,()=>moves[0].from+'/Evidence.pdf');
 expect(result).toBe(text.replace('[[Evidence.pdf]]','[['+moves[0].to+'/Evidence.pdf]]'));
 });
 it('updates full wikilinks with aliases/headings and leaves ordinary text untouched',()=>{
 const before='Keep 08 Tasks/Inbox/Files/Example as historical text. [[08 Tasks/Inbox/Files/Example/task#Next|Label]]';
 expect(rewriteMovedLinks(before,'Other.md','Other.md',moves,()=>undefined)).toBe('Keep 08 Tasks/Inbox/Files/Example as historical text. [[02 Programs/CalWORKs/CalWORKs Tasks/Example/task#Next|Label]]');
 });
 it('keeps relative internal references and adjusts external markdown and HTML targets',()=>{
 const a=moves[0].from+'/Note.md',b=moves[0].to+'/Note.md';
 expect(rewriteMovedLinks('[file](Evidence.pdf) <img src="Evidence.png">',a,b,moves,()=>undefined)).toBe('[file](Evidence.pdf) <img src="Evidence.png">');
 expect(rewriteMovedLinks('[link](../../../../Shared.md)',a,b,moves,()=>undefined)).toBe('[link](../../../../Shared.md)');
 });
 it('preserves frontmatter, URLs, anchors and malformed percent encoding',()=>{
 const s='---\nreference: "[[08 Tasks/Inbox/Files/Example/task]]"\n---\n[x](https://example.com) [y](#section) [[%ZZ]]';
 expect(rewriteMovedLinks(s,'Other.md','Other.md',moves,()=>undefined)).toBe(s);
 });
});
