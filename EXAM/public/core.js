/** Pure exam helpers; no network or DOM dependencies. */
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function timeMs(value,{schedule=false}={}){
 if(value==null||value==='')return NaN;let raw=String(value).trim();
 if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw))raw=raw.replace(' ','T')+(schedule?'+07:00':'Z');
 return Date.parse(raw);
}
export function formatClock(value){if(value==null)return 'Không giới hạn';const n=Math.max(0,Math.ceil(Number(value)||0));const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=String(n%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${String(m).padStart(2,'0')}:${s}`}
export function optionsFor(q){return Array.isArray(q.options)&&q.options.length?q.options.map(String):q.type==='truefalse'?['Đúng','Sai']:[]}
export function answerStatus(q,answers={}){
 const a=answers[q.id];const present=x=>String(x??'').trim()!=='';
 if(q.type==='matching'){const left=optionsFor(q).map(x=>x.split('|||')[0]);const n=left.filter(k=>present(a?.[k])).length;return n===0?'empty':n===left.length?'done':'partial'}
 if(q.type==='ordering'){const aList=Array.isArray(a)?a:[];const n=aList.filter(present).length;return n===0?'empty':n===optionsFor(q).length&&new Set(aList).size===aList.length?'done':'partial'}
 if(q.type==='multi')return Array.isArray(a)&&a.some(present)?'done':'empty';
 if(['file','image','audio'].includes(q.type))return a&&typeof a==='object'&&present(a.file_id)?'done':'empty';
 return present(a)?'done':'empty';
}
export function normalizeExam(raw){
 if(!raw||!Array.isArray(raw.questions)||!raw.questions.length)throw new Error('Kỳ thi hiện chưa có câu hỏi khả dụng.');
 const ids=new Set();const questions=raw.questions.map(q=>{if(!q||q.id==null||!String(q.id)||ids.has(String(q.id)))throw new Error('Cấu trúc câu hỏi không hợp lệ. Vui lòng liên hệ đơn vị tổ chức.');ids.add(String(q.id));return {...q,id:String(q.id),question:String(q.question??''),points:Number.isFinite(Number(q.points))?Math.max(0,Number(q.points)):1,options:optionsFor(q)}});
 return {...raw,title:String(raw.title||'Bài đánh giá'),questions};
}
export function cleanAnswers(raw,questions){const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};return Object.fromEntries(questions.filter(q=>Object.hasOwn(value,q.id)).map(q=>[q.id,value[q.id]]))}
export function eventUnion(...lists){const seen=new Set();return lists.flatMap(x=>Array.isArray(x)?x:[]).filter(e=>{if(!e||e.type==='ui_state')return false;const key=JSON.stringify(e);if(seen.has(key))return false;seen.add(key);return true}).slice(-400)}
export function parseInvite(value,base='https://exam.skyfirst.io.vn'){
 const raw=String(value||'').trim();if(!raw)return '';
 if(!/^(?:https?:\/\/|\/)/i.test(raw))return raw;
 const u=new URL(raw,base);const match=u.pathname.match(/^\/join\/([^/]+)\/?$/);if(match)return decodeURIComponent(match[1]);
 const invite=u.searchParams.get('invite');if(invite)return invite;
 const hash=u.hash.match(/^#assessment-invite\/([^/]+)$/);if(hash)return decodeURIComponent(hash[1]);
 throw new Error('Liên kết này không phải liên kết mời dự thi.');
}
/** Acknowledging an older snapshot must never clear newer edits. */
export class AnswerJournal{
 constructor(){this.version=0;this.ackVersion=0}
 edit(){this.version++}
 get dirty(){return this.version>this.ackVersion}
 acknowledge(version){this.ackVersion=Math.max(this.ackVersion,Math.min(version,this.version))}
}
