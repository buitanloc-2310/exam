import { apiRequest, API_ORIGIN } from './api.js';
import { getSession, setSession, clearSession, saveLocal, loadLocal, clearLocal } from './storage.js';

const app = document.querySelector('#app');
let { token, attempt } = getSession();
let exam = null, answers = {}, events = [], remaining = null;
let submitted = false, submitting = false, armed = false, dirty = false;
let tick = null, saveTick = null, saving = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const req = (path, options={}) => apiRequest(path, { token, ...options });
const log = (type, meta={}) => { events.push({ type, at:new Date().toISOString(), ...meta }); events = events.slice(-500); dirty = true; persist(); };
const persist = () => saveLocal(attempt, answers, events);

function screen(title, message, { bad=false, action=true }={}) {
  app.className='gate';
  app.innerHTML=`<section class="card"><div class="ey">TRUNG TÂM DỰ THI SKY FIRST</div><h1>${esc(title)}</h1><div class="notice ${bad?'bad':''}">${esc(message)}</div>${action?'<a class="btn primary" href="'+API_ORIGIN+'/#exam-center">Quay lại Trung tâm học tập</a>':''}</section>`;
}

async function boot() {
  try {
    const url = new URL(location.href);
    const launch = url.searchParams.get('launch');
    if (launch) {
      const redeemed = await apiRequest('/api/public/exam-launch/redeem', { method:'POST', body:JSON.stringify({ launch_token: launch }) });
      token = redeemed.access_token; attempt = redeemed.attempt_id; setSession(token, attempt);
      history.replaceState({}, '', '/');
    }
    if (!token || !attempt) {
      screen('Sẵn sàng cho phiên dự thi', 'Để bảo vệ phiên thi, bài làm chỉ được mở từ Trung tâm học tập Sky First.');
      return;
    }
    const result = await req(`/api/exam-attempts/${encodeURIComponent(attempt)}`);
    exam = result.exam; answers = result.answers || {}; events = result.events || []; remaining = result.remaining_seconds;
    const cached = loadLocal(attempt);
    if (cached?.answers && typeof cached.answers === 'object') answers = { ...answers, ...cached.answers };
    if (Array.isArray(cached?.events)) events = [...events, ...cached.events].slice(-500);
    await enter();
  } catch (error) {
    if (error.status === 401 || error.status === 403) clearSession();
    screen('Không thể mở bài thi', error.message, { bad:true });
  }
}

async function save({ force=false }={}) {
  if ((submitted && !force) || saving || !attempt) return;
  persist();
  saving = true;
  const label = document.querySelector('#save');
  try {
    const result = await req(`/api/exam-attempts/${encodeURIComponent(attempt)}/save`, { method:'POST', body:JSON.stringify({ answers, events }) });
    dirty = false;
    if (label) label.textContent = `Đã đồng bộ ${new Date(result.saved_at || Date.now()).toLocaleTimeString('vi-VN')}`;
  } catch (error) {
    if (label) { label.textContent = error.network ? 'Mất kết nối · bài vẫn lưu trên thiết bị' : `Chưa đồng bộ · ${error.message}`; label.classList.add('offline'); }
    throw error;
  } finally { saving = false; }
}

async function submit(auto=false) {
  if (submitted || submitting) return;
  if (!auto && !confirm('Nộp bài và kết thúc phiên thi? Sau khi nộp, bạn không thể sửa câu trả lời.')) return;
  submitting = true;
  const button = document.querySelector('#submit'); if (button) button.disabled = true;
  persist();
  try {
    try { await save({ force:true }); } catch (error) { if (!auto && !confirm('Bài chưa đồng bộ được máy chủ. Vẫn thử nộp trực tiếp ngay bây giờ?')) throw error; }
    const result = await req(`/api/exam-attempts/${encodeURIComponent(attempt)}/submit`, { method:'POST', body:JSON.stringify({ answers, events }) });
    submitted = true; cleanup(); clearLocal(attempt); clearSession();
    try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
    const score = result.show_score !== false && result.score != null ? ` Điểm: ${result.score}/${result.max_score}.` : '';
    const receipt = result.receipt_code ? ` Mã xác nhận: ${result.receipt_code}.` : '';
    screen(auto ? 'Đã hết thời gian — bài đã được nộp' : 'Nộp bài thành công', `${score}${receipt}`.trim() || 'Bài làm đã được hệ thống ghi nhận.', { action:true });
  } catch (error) {
    submitting = false; if (button) button.disabled = false;
    alert(error.message);
  }
}

async function violation(reason) {
  if (!armed || submitted || !exam?.strict_mode) return;
  log(reason);
  try {
    const result = await req(`/api/exam-attempts/${encodeURIComponent(attempt)}/violation`, { method:'POST', body:JSON.stringify({ reason, answers, events }) });
    if (result.terminated) { submitted=true; cleanup(); clearSession(); screen('Phiên thi đã kết thúc', 'Phiên thi đã bị kết thúc theo cấu hình giám sát.', { bad:true }); }
  } catch (error) {
    // Violation is security-relevant: retain it locally and retry through the next save/reconnect.
    persist();
    const label=document.querySelector('#save'); if(label){label.textContent='Sự kiện giám sát đang chờ đồng bộ';label.classList.add('offline');}
  }
}

function cleanup(){ clearInterval(tick); clearInterval(saveTick); }
function answered(q){ const a=answers[q.id]; return Array.isArray(a)?a.some(Boolean):a&&typeof a==='object'?Object.values(a).some(Boolean):String(a??'').trim()!==''; }
function paint(){ const time=document.querySelector('#time'); if(time) time.textContent=remaining==null?'Không giới hạn':`${Math.floor(Math.max(0,remaining)/60)}:${String(Math.max(0,remaining)%60).padStart(2,'0')}`; document.querySelectorAll('[data-j]').forEach((b,i)=>b.classList.toggle('done',answered(exam.questions[i]))); }

function question(q,i){
  let body=''; const id=esc(q.id);
  if(q.type==='multi') body=(q.options||[]).map(o=>`<label class="opt"><input type="checkbox" data-multi="${id}" value="${esc(o)}" ${(answers[q.id]||[]).includes(o)?'checked':''}> ${esc(o)}</label>`).join('');
  else if(q.type==='mcq'||q.type==='truefalse') body=((q.options&&q.options.length)?q.options:(q.type==='truefalse'?['Đúng','Sai']:[])).map(o=>`<label class="opt"><input type="radio" name="q_${id}" value="${esc(o)}" ${String(answers[q.id]??'')===String(o)?'checked':''}> ${esc(o)}</label>`).join('');
  else if(q.type==='ordering') body=(q.options||[]).map((_,p)=>`<label>Vị trí ${p+1}<select data-order="${id}" data-pos="${p}"><option value="">— Chọn —</option>${(q.options||[]).map(o=>`<option value="${esc(o)}" ${(answers[q.id]||[])[p]===o?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`).join('');
  else if(q.type==='matching') body=(q.options||[]).map(pair=>{const [left]=String(pair).split('|||'),rights=(q.options||[]).map(x=>String(x).split('|||')[1]);return `<label>${esc(left)}<select data-match="${id}" data-left="${esc(left)}"><option value="">— Chọn —</option>${rights.map(r=>`<option value="${esc(r)}" ${(answers[q.id]||{})[left]===r?'selected':''}>${esc(r)}</option>`).join('')}</select></label>`}).join('');
  else body=`<textarea data-answer="${id}" placeholder="Nhập câu trả lời...">${esc(answers[q.id]??'')}</textarea>`;
  return `<article class="card" id="q${i}"><div class="ey">CÂU ${i+1} · ${Number(q.points||1)} ĐIỂM</div><h3 class="question-title">${esc(q.question)}</h3>${body}</article>`;
}

function render(){
  app.className='';
  app.innerHTML=`<header class="top"><div><div class="ey">${esc(exam.center_label||'TRUNG TÂM DỰ THI SKY FIRST')}</div><h1>${esc(exam.title)}</h1><div class="statusbar"><span id="save" class="save">Bài làm được tự động lưu.</span><span class="pill" id="net">${navigator.onLine?'Đang trực tuyến':'Mất kết nối'}</span></div></div><div class="clock"><div>Còn lại</div><b id="time"></b></div></header><div class="wrap"><aside class="card nav"><b>Tiến độ</b><div class="map">${exam.questions.map((_,i)=>`<button data-j="q${i}">${i+1}</button>`).join('')}</div><div class="notice">${exam.strict_mode?'Chế độ giám sát đang bật. Sự kiện rời trang có thể được ghi nhận.':'Hãy kiểm tra lại bài trước khi nộp.'}</div></aside><main>${exam.instructions?`<section class="card"><div class="ey">HƯỚNG DẪN</div><div class="instructions">${esc(exam.instructions)}</div></section>`:''}${exam.questions.map(question).join('')}<section class="card"><b>Hoàn tất bài làm</b><p>Kiểm tra các câu trả lời trước khi nộp.</p><button id="submit" class="btn warn">Nộp bài & kết thúc</button></section></main></div>`;
  bind(); paint();
  if(remaining!=null) tick=setInterval(()=>{remaining=Math.max(0,remaining-1);paint();if(remaining<=0){clearInterval(tick);submit(true)}},1000);
  saveTick=setInterval(()=>{ if(dirty) save().catch(()=>{}); },10000);
}

function bind(){
  document.querySelectorAll('[data-j]').forEach(b=>b.onclick=()=>document.querySelector(`#${b.dataset.j}`)?.scrollIntoView({behavior:'smooth'}));
  document.querySelectorAll('input[type=radio]').forEach(x=>x.onchange=()=>{answers[x.name.slice(2)]=x.value;dirty=true;persist();paint()});
  document.querySelectorAll('[data-multi]').forEach(x=>x.onchange=()=>{const id=x.dataset.multi;answers[id]=[...document.querySelectorAll(`[data-multi="${CSS.escape(id)}"]:checked`)].map(n=>n.value);dirty=true;persist();paint()});
  document.querySelectorAll('[data-answer]').forEach(x=>x.oninput=()=>{answers[x.dataset.answer]=x.value;dirty=true;persist();paint()});
  document.querySelectorAll('[data-order]').forEach(x=>x.onchange=()=>{const id=x.dataset.order;answers[id]=[...document.querySelectorAll(`[data-order="${CSS.escape(id)}"]`)].sort((a,b)=>+a.dataset.pos-+b.dataset.pos).map(n=>n.value);dirty=true;persist();paint()});
  document.querySelectorAll('[data-match]').forEach(x=>x.onchange=()=>{const id=x.dataset.match;answers[id]=Object.fromEntries([...document.querySelectorAll(`[data-match="${CSS.escape(id)}"]`)].map(n=>[n.dataset.left,n.value]));dirty=true;persist();paint()});
  document.querySelector('#submit').onclick=()=>submit(false);
}

async function enter(){
  if(exam.fullscreen_required){
    screen(exam.title,'Bài thi yêu cầu bật toàn màn hình trước khi hiển thị câu hỏi.',{action:false});
    const card=app.querySelector('.card'); const button=document.createElement('button');button.className='btn primary';button.textContent='Bắt đầu toàn màn hình';card.append(button);
    button.onclick=async()=>{try{await document.documentElement.requestFullscreen();armed=true;log('fullscreen_enter');render()}catch{alert('Không thể bật toàn màn hình. Hãy cấp quyền rồi thử lại.')}};
  } else { armed=true; render(); }
}

document.addEventListener('visibilitychange',()=>{if(document.hidden)violation('visibility_hidden')});
window.addEventListener('blur',()=>violation('window_blur'));
document.addEventListener('fullscreenchange',()=>{if(armed&&exam?.fullscreen_required&&!document.fullscreenElement)violation('fullscreen_exit')});
document.addEventListener('contextmenu',e=>{if(armed&&exam?.strict_mode)e.preventDefault()});
window.addEventListener('online',()=>{const n=document.querySelector('#net');if(n)n.textContent='Đang trực tuyến';if(dirty)save().catch(()=>{})});
window.addEventListener('offline',()=>{const n=document.querySelector('#net');if(n)n.textContent='Mất kết nối'});
window.addEventListener('beforeunload',()=>persist());
boot();
