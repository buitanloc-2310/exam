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
 if(q.type==='matching'||q.type==='drag_drop'||q.type==='diagram_label'||q.type==='matrix_table'){const left=optionsFor(q).map(x=>x.split('|||')[0]);const n=left.filter(k=>present(a?.[k])).length;return n===0?'empty':n===left.length?'done':'partial'}
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
 const u=new URL(raw,base);
 const allowedHost=new URL(base).hostname;
 if(u.hostname!==allowedHost&&!u.hostname.endsWith('.skyfirst.io.vn'))throw new Error('Liên kết này không thuộc hệ thống khảo thí Sky First.');
 const match=u.pathname.match(/^\/join\/([^/]+)\/?$/);if(match)return decodeURIComponent(match[1]);
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

export const SUPPORTED_QUESTION_TYPES = Object.freeze([
  'mcq', 'multi', 'truefalse', 'fill', 'short', 'numeric',
  'matching', 'ordering', 'drag_drop', 'image_hotspot',
  'diagram_label', 'matrix_table', 'case_study', 'math',
  'short_essay', 'essay', 'long', 'structured',
  'coding', 'media_comprehension', 'audio', 'speaking', 'file', 'image'
]);

export const VIRTUAL_MATH_KEYBOARD_GROUPS = Object.freeze({
  numbers_ops: ['0','1','2','3','4','5','6','7','8','9','+','−','×','÷','=','≠','≈','%','±'],
  fractions_powers: ['\\frac{a}{b}','a\\frac{b}{c}','x^{n}','x_{n}','x^{2}','x^{3}'],
  roots_brackets: ['\\sqrt{x}','\\sqrt[3]{x}','\\sqrt[n]{x}','(',')','[',']','{','}','|x|'],
  log_trig: ['\\log','\\ln','\\exp','\\sin','\\cos','\\tan','\\cot','\\arcsin','\\arccos','\\arctan'],
  calculus_series: ['\\lim_{x\\to a}','\\frac{d}{dx}','\\frac{\\partial}{\\partial x}','\\int_{a}^{b}','\\sum_{i=1}^{n}','\\prod_{i=1}^{n}'],
  sets_logic: ['∈','∉','⊂','⊆','∪','∩','∅','∀','∃','∧','∨','¬','⇒','⇔'],
  geometry_stats: ['∠','∥','⊥','∼','≅','△','P(A)','E(X)','\\bar{x}','\\sigma^{2}'],
  greek_matrices_sci: ['α','β','γ','θ','λ','μ','π','σ','Ω','\\vec{v}','\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}','\\begin{cases}eq_1\\\\eq_2\\end{cases}','⇌','→','Δ']
});

export function evaluateScientificExpression(expr, mode = 'DEG') {
  const raw = String(expr || '').trim();
  if (!raw) return { ok: false, error: 'Biểu thức trống' };
  if (/[^0-9a-zA-Z_+\-*/^().,%\sπe√|]/.test(raw)) {
    return { ok: false, error: 'Ký tự không hợp lệ trong máy tính khoa học' };
  }
  const toRad = x => (mode === 'DEG' ? (x * Math.PI) / 180 : x);
  const toDeg = x => (mode === 'DEG' ? (x * 180) / Math.PI : x);
  const env = {
    pi: Math.PI,
    e: Math.E,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    sin: x => Math.sin(toRad(x)),
    cos: x => Math.cos(toRad(x)),
    tan: x => Math.tan(toRad(x)),
    asin: x => toDeg(Math.asin(x)),
    acos: x => toDeg(Math.acos(x)),
    atan: x => toDeg(Math.atan(x)),
    pow: Math.pow
  };
  try {
    const normalized = raw
      .replace(/π/g, 'pi')
      .replace(/√\(/g, 'sqrt(')
      .replace(/\^/g, '**')
      .replace(/%/g, '/100');
    const fn = new Function(...Object.keys(env), `"use strict"; return (${normalized});`);
    const val = Number(fn(...Object.values(env)));
    if (!Number.isFinite(val)) return { ok: false, error: 'Phép tính không xác định (NaN/Infinity)' };
    return { ok: true, expression: raw, mode, result: Number(val.toPrecision(12)) };
  } catch {
    return { ok: false, error: 'Cú pháp biểu thức không hợp lệ' };
  }
}
