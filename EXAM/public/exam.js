import {apiRequest} from './api.js?build=20261030-routes-v2';
import {getSession,setSession,clearSession,saveLocal,loadLocal,clearLocal,storageRestricted,acquireLease,renewLease,releaseLease} from './storage.js?build=20261030-routes-v2';
import {escapeHtml as esc,timeMs,formatClock,answerStatus,optionsFor,normalizeExam,cleanAnswers,eventUnion,parseInvite,AnswerJournal} from './core.js?build=20261030-routes-v2';
const UNIT_NAME='Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First';
const SYSTEM_NAME='Hệ Thống Khảo Thí Và Đánh Giá Sky First';
const app=document.querySelector('#app');
let {token,attempt,mode,invite,candidate,sessionId}=getSession();
let exam=null,answers={},events=[],current=0,marked=new Set(),filter='all',remaining=null,deadlineMs=null,offset=0,revision=0;
let mediaRecorder=null,recorderStream=null,recordingChunks=[],recordingActive=false,recordingPending=false,recordingStopTimer=null,recordingClockTimer=null;
let armed=false,finished=false,submitting=false,timeLocked=false,conflicted=false,savePromise=null,heartbeatBusy=false,lastSave='',saveError='',submitRetry=false,leaseTick=null,clockTick=null,saveTick=null,heartbeatTick=null,debounceTick=null,retryTick=null;
let journal=new AnswerJournal(),fontScale=0,serverAnchor=Date.now(),performanceAnchor=performance.now(),warned15=false,warned5=false;
const serverNow=()=>serverAnchor+performance.now()-performanceAnchor;
const req=(path,opt={})=>apiRequest(path,{token,sessionId,...opt});
const path=(action='')=>`${mode==='guest'?'/api/public':'/api'}/exam-attempts/${encodeURIComponent(attempt)}${action}`;
const stamp=v=>{const ms=timeMs(v);return Number.isFinite(ms)?new Date(ms).toLocaleString('vi-VN'):'—'};
const typeLabel=q=>({mcq:'Chọn một đáp án',multi:'Chọn các đáp án phù hợp',truefalse:'Chọn Đúng hoặc Sai',fill:'Điền câu trả lời',short:'Trả lời ngắn',numeric:'Câu trả lời số',math:'Công thức / lời giải toán',essay:'Câu tự luận',long:'Bài viết dài',structured:'Trả lời có cấu trúc',file:'Nộp tệp',image:'Nộp hình ảnh',audio:'Nộp tệp âm thanh',ordering:'Sắp xếp thứ tự',matching:'Ghép các cặp phù hợp'})[q.type]||'Trả lời câu hỏi';
const questionLanguage=q=>String(q?.content_language||q?.prompt_language||q?.language_code||exam?.content_language||exam?.language_code||'').trim();
const questionDirection=q=>{const explicit=String(q?.script_direction||'auto');if(['ltr','rtl'].includes(explicit))return explicit;return /^(ar|fa|ur|he|ps|sd|ug|yi)(-|$)/i.test(questionLanguage(q))?'rtl':'auto'};
const statuses=()=>exam.questions.map(q=>answerStatus(q,answers));
const doneCount=()=>statuses().filter(s=>s==='done').length;
const copy=value=>JSON.parse(JSON.stringify(value));
const safeResourceUrl=value=>{try{const u=new URL(String(value||''),location.origin);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}};
function stimulusMarkup(q){const raw=q?.stimulus??q?.stimulus_text??null;if(!raw)return '';const st=typeof raw==='object'&&raw?raw:{type:'text',text:String(raw)},url=safeResourceUrl(st.url||q.resource_url),title=esc(st.title||q.resource_title||'Tài liệu / dữ liệu nguồn'),text=esc(st.text||''),lang=questionLanguage(q),dir=questionDirection(q);let body=text?`<div class="stimulus-text" lang="${esc(lang)}" dir="${dir}">${text}</div>`:'';if(url&&st.type==='image')body+=`<img class="stimulus-image" src="${esc(url)}" alt="${title}">`;else if(url&&st.type==='audio')body+=`<audio class="stimulus-audio" controls preload="metadata" src="${esc(url)}"></audio>`;else if(url)body+=`<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Mở tài liệu</a>`;return `<aside class="stimulus-panel"><small>TÀI LIỆU</small><h3 lang="${esc(lang)}" dir="${dir}">${title}</h3>${body}</aside>`}
function persist(){if(!attempt||finished)return;const ok=saveLocal(attempt,answers,events,{current,marked:[...marked],fontScale},{revision,dirty:journal.dirty});if(!ok&&armed)saveError='Trình duyệt không cho lưu dự phòng; giữ trang mở.'}
function log(type,meta={}){events.push({type,at:new Date().toISOString(),...meta});events=events.slice(-400);journal.edit();persist()}
function friendly(e){if(e?.code==='REVISION_CONFLICT')return 'Bài làm trên máy chủ đã thay đổi ở phiên khác. Dừng chỉnh sửa và kiểm tra phiên đang mở trước khi tiếp tục.';if(e?.code==='SESSION_CONFLICT')return 'Phiên thi đang được mở trên tab hoặc thiết bị khác. Chỉ một phiên được quyền ghi bài.';if(e?.code==='ATTEMPT_LOCKED')return e?.detail?.lock_reason||'Phiên thi đang bị tạm khóa theo quy chế giám sát. Vui lòng liên hệ cán bộ coi thi.';if(e?.network)return 'Mất kết nối máy chủ. Giữ trang mở; hệ thống sẽ thử lại khi có mạng.';return e?.message||'Chưa thể xử lý yêu cầu. Vui lòng thử lại.'}
function brand(){return `<a class="gate-brand" href="/" aria-label="${SYSTEM_NAME}"><img src="/sky-first-logo.webp" alt="Sky First"><span><b>${UNIT_NAME}</b><small>${SYSTEM_NAME}</small></span></a>`}
function navLinks(){
 const cur=String(location?.pathname||'/').replace(/\/{2,}/g,'/').replace(/\/+$/,'')||'/';
 const items=[
  ['/','Trang chủ'],
  ['/tra-cuu-ket-qua','Tra cứu kết quả thi'],
  ['/phuc-khao','Phúc khảo'],
  ['/ho-tro','Hỗ trợ'],
  ['/su-co-khan-cap','Sự cố khẩn cấp'],
  ['/to-cao-gian-lan','Tố cáo gian lận']
 ];
 return items.map(([href,label])=>`<a class="text-button ${cur===href?'active-nav':''}" href="${href}">${label}</a>`).join('');
}
function gate(title,body,{ey=UNIT_NAME,wide=false}={}){
 document.title=`${title} — ${UNIT_NAME} · ${SYSTEM_NAME}`;
 app.inert=false;app.className='gate';
 app.innerHTML=`<header class="gate-header">${brand()}<nav class="gate-nav" aria-label="Điều hướng dịch vụ khảo thí">${navLinks()}</nav></header><main class="gate-card ${wide?'gate-wide':''}"><div class="ey">${esc(ey)}</div>${title!==SYSTEM_NAME?`<div class="sys-sub">${esc(SYSTEM_NAME)}</div>`:''}<h1>${esc(title)}</h1>${body}</main><footer class="gate-footer"><div class="footer-unit">${UNIT_NAME}</div><div class="footer-sys">${SYSTEM_NAME}</div><div class="footer-contacts">Nghiệp vụ khảo thí: <a href="mailto:exam@skyfirst.io.vn">exam@skyfirst.io.vn</a> · Hỗ trợ kỹ thuật: <a href="mailto:support@skyfirst.io.vn">support@skyfirst.io.vn</a></div></footer>`;
 enhanceLabels();
}
function showScreen(title,message,{retry=false}={}){gate(title,`<p class="lead">${esc(message)}</p><div class="actions">${retry?'<button class="btn primary" id="retryBoot">Thử lại kết nối</button>':''}<a class="btn" href="/">Về trang chủ</a><a class="btn" href="/su-co-khan-cap">Báo sự cố khẩn cấp</a></div>`);document.querySelector('#retryBoot')?.addEventListener('click',()=>location.reload())}
function toast(message,bad=false){let el=document.querySelector('#toast');if(!el){el=document.createElement('div');el.id='toast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.append(el)}el.className=`toast ${bad?'toast-bad':''}`;el.textContent=message;el.hidden=false;clearTimeout(el.hideTimer);el.hideTimer=setTimeout(()=>el.hidden=true,6000)}
function enhanceLabels(){let seq=0;document.querySelectorAll('.field').forEach(field=>{const label=field.querySelector('label'),input=field.querySelector('input,select,textarea');if(label&&input&&!label.contains(input)){if(!input.id)input.id=`exam-field-${++seq}`;label.htmlFor=input.id}})}
function modal(title,html,actions){
 document.querySelector('.modal-backdrop')?.remove();const previous=document.activeElement,wrap=document.createElement('div');wrap.className='modal-backdrop';wrap.innerHTML=`<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="ey">${UNIT_NAME}</div><div class="sys-sub">${SYSTEM_NAME}</div><h2 id="modalTitle">${esc(title)}</h2>${html}<div class="modal-actions">${actions.map((a,i)=>`<button class="btn ${a.primary?'primary':''}" data-action="${i}">${esc(a.label)}</button>`).join('')}</div></section>`;
 app.inert=true;const close=()=>{app.inert=false;wrap.remove();if(previous?.isConnected)previous.focus()};document.body.append(wrap);wrap.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>{close();actions[Number(b.dataset.action)].run?.()});const buttons=wrap.querySelectorAll('button');buttons[0]?.focus();wrap.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close()}if(e.key==='Tab'){const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}};return close;
}
function prefillCandidate(){
 const u=new URL(location?.href||'https://exam.skyfirst.io.vn');
 return {
  full_name:u.searchParams.get('full_name')||candidate?.full_name||'',
  candidate_code:u.searchParams.get('candidate_code')||candidate?.candidate_code||'',
  class_name:u.searchParams.get('class_name')||candidate?.class_name||'',
  email:u.searchParams.get('email')||candidate?.email||'',
  exam_title:u.searchParams.get('exam_title')||exam?.title||'',
  receipt_code:u.searchParams.get('receipt_code')||'',
  attempt_id:attempt||''
 };
}
function home(){
 gate(SYSTEM_NAME,`
  <p class="lead">Nhập mã dự thi hoặc liên kết mời do đơn vị tổ chức cung cấp để tiếp tục vào kỳ thi. Vui lòng kiểm tra thiết bị và đọc kỹ quy chế trước khi bắt đầu làm bài.</p>
  <form id="openInvite">
    <div class="field">
      <label>Mã dự thi hoặc liên kết mời dự thi</label>
      <input name="code" required maxlength="2000" autocomplete="off" placeholder="Nhập mã dự thi hoặc dán liên kết mời do đơn vị tổ chức cung cấp">
    </div>
    <div id="gateMessage" role="status" aria-live="polite"></div>
    <button class="btn primary wide">Tiếp tục vào kỳ thi →</button>
  </form>
  <div id="publicCatalogWrap" class="catalog-section" hidden>
    <h2 class="subhead">Kỳ thi công khai đang mở</h2>
    <div id="publicCatalogList" class="catalog-list"></div>
  </div>
  <div class="gate-guides">
    <article><b>01 · Chuẩn bị thiết bị & Xác minh</b><p>Sử dụng trình duyệt ổn định, kiểm tra kết nối mạng (${navigator.onLine?'Đang trực tuyến':'Đang ngoại tuyến'}), bộ nhớ phiên (${storageRestricted()?'Hạn chế':'Sẵn sàng'}) và chuẩn bị thông tin thí sinh.</p></article>
    <article><b>02 · Làm bài & Tự động lưu</b><p>Thời gian làm bài đồng bộ theo máy chủ; bài làm được tự động lưu theo phiên bản trong suốt phiên thi.</p></article>
    <article><b>03 · Nộp bài & Nhận mã biên nhận</b><p>Sau khi hoàn tất và nộp bài, lưu lại Mã biên nhận để tra cứu kết quả hoặc thực hiện các thủ tục nghiệp vụ.</p></article>
  </div>
  <div class="section-divider">
    <h2 class="subhead">Các dịch vụ và nghiệp vụ khảo thí</h2>
    <div class="service-grid">
      <a class="service-card" href="/tra-cuu-ket-qua"><div><b>Tra cứu kết quả thi</b><p>Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.</p></div><span>Truy cập /tra-cuu-ket-qua →</span></a>
      <a class="service-card" href="/phuc-khao"><div><b>Phúc khảo kết quả</b><p>Gửi đề nghị xem xét lại kết quả bài thi kèm minh chứng và theo dõi trạng thái xử lý.</p></div><span>Truy cập /phuc-khao →</span></a>
      <a class="service-card" href="/ho-tro"><div><b>Hỗ trợ & Hướng dẫn</b><p>Xem hướng dẫn sử dụng hệ thống và gửi câu hỏi hoặc yêu cầu hỗ trợ thông thường.</p></div><span>Truy cập /ho-tro →</span></a>
      <a class="service-card" href="/su-co-khan-cap"><div><b>Báo sự cố khẩn cấp</b><p>Báo sự cố ảnh hưởng trực tiếp đến phiên thi đang diễn ra (gián đoạn, không lưu được bài).</p></div><span>Truy cập /su-co-khan-cap →</span></a>
      <a class="service-card" href="/to-cao-gian-lan"><div><b>Tố cáo gian lận</b><p>Gửi phản ánh bảo mật kèm minh chứng về dấu hiệu vi phạm quy chế khảo thí.</p></div><span>Truy cập /to-cao-gian-lan →</span></a>
    </div>
  </div>
 `,{wide:true});

 document.querySelector('#openInvite').onsubmit=e=>{e.preventDefault();try{const code=parseInvite(e.currentTarget.elements.code.value,location.origin);if(!code)throw new Error('Vui lòng nhập mã dự thi.');location.href=`/join/${encodeURIComponent(code)}`}catch(error){document.querySelector('#gateMessage').textContent=error.message}};

 apiRequest('/api/public/catalog').then(r=>{
  const list=r?.exams||[];
  const wrap=document.querySelector('#publicCatalogWrap'),box=document.querySelector('#publicCatalogList');
  if(wrap&&box&&list.length){
   wrap.hidden=false;
   box.innerHTML=list.map(x=>`<article class="catalog-item"><div><b>${esc(x.title)}</b><small>${esc(x.assessment_label)} · ${x.time_limit_enabled?`${esc(x.duration_minutes)} phút`:'Không giới hạn'}</small></div><a class="btn primary" href="/join/${encodeURIComponent(x.code)}">Vào kỳ thi →</a></article>`).join('');
  }
 }).catch(()=>{});
}

function pageTraCuu(){
 const pf=prefillCandidate();
 gate('Tra cứu kết quả thi',`
  <p class="lead">Thí sinh sử dụng thông tin dự thi đã được cấp để tra cứu kết quả và trạng thái công bố.</p>
  <form id="lookupResultForm">
    <div class="two">
      <div class="field"><label>Mã biên nhận nộp bài (*)</label><input name="receipt_code" required maxlength="80" value="${esc(pf.receipt_code)}" placeholder="Ví dụ: EXM-..."></div>
      <div class="field"><label>Mã thí sinh (*)</label><input name="candidate_code" required maxlength="100" value="${esc(pf.candidate_code)}" placeholder="Nhập mã thí sinh của bạn"></div>
    </div>
    <button type="submit" class="btn primary">Tra cứu kết quả</button>
    <div id="lookupResultBox" class="notice" hidden role="status" aria-live="polite"></div>
  </form>
  <div class="notice">
    <b>Hướng dẫn về các trạng thái kết quả &amp; liên hệ hỗ trợ:</b>
    <br>• <b>Chưa có kết quả:</b> Phiên thi chưa hoàn tất nộp hoặc chưa có dữ liệu chấm.
    <br>• <b>Đang chấm thi:</b> Bài thi có câu hỏi tự luận/tệp đính kèm đang được cán bộ chấm thi xử lý.
    <br>• <b>Chờ phê duyệt:</b> Bài thi đã chấm xong và đang chờ người có thẩm quyền phê duyệt trước khi công bố.
    <br>• <b>Đã công bố:</b> Điểm số chính thức đã được phê duyệt và công bố.
    <br>• <b>Đã điều chỉnh theo quy trình được cấp quyền:</b> Điểm số đã được cập nhật theo quyết định giải quyết phúc khảo chính thức.
    <br>• Nếu cần hỗ trợ kiểm tra mã biên nhận, vui lòng truy cập <a href="/ho-tro">Hỗ trợ thí sinh (/ho-tro)</a> hoặc gửi đơn tại <a href="/phuc-khao">Đăng ký phúc khảo (/phuc-khao)</a>.
  </div>
 `,{wide:true});

 document.querySelector('#lookupResultForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const box=document.querySelector('#lookupResultBox');
  const fd=Object.fromEntries(new FormData(ev.currentTarget));
  box.hidden=false;box.className='notice';box.textContent='Đang kiểm tra và tra cứu dữ liệu kết quả…';
  try{
   const {result:res}=await apiRequest('/api/public/results/lookup',{method:'POST',body:JSON.stringify(fd)});
   box.className='notice';
   box.innerHTML=`
     <dl class="receipt" style="margin-top:0;background:#fff">
       <div><dt>Kỳ thi</dt><dd>${esc(res.exam_title)}</dd></div>
       <div><dt>Họ và tên thí sinh</dt><dd>${esc(res.candidate_name)} (${esc(res.candidate_code)})</dd></div>
       ${res.class_name?`<div><dt>Mã lớp / Đơn vị</dt><dd>${esc(res.class_name)}</dd></div>`:''}
       <div><dt>Mã biên nhận</dt><dd>${esc(res.receipt_code)}</dd></div>
       <div><dt>Thời điểm nộp bài</dt><dd>${esc(stamp(res.submitted_at))}</dd></div>
       <div><dt>Trạng thái kết quả</dt><dd><span class="status-badge status-${esc(res.workflow_state)}">${esc(res.result_status_label||res.workflow_state)}</span></dd></div>
       <div><dt>Điểm số chính thức</dt><dd>${res.show_score&&res.score!=null?`<b>${esc(res.score)} / ${esc(res.max_score)}</b>`:'Chưa hiển thị điểm (Đang chấm hoặc đang chờ công bố chính thức)'}</dd></div>
     </dl>
     <div class="actions" style="margin-top:14px">
       <a class="btn primary" href="${esc(res.appeal_url||`/phuc-khao?receipt_code=${encodeURIComponent(res.receipt_code)}&candidate_code=${encodeURIComponent(res.candidate_code)}&exam_title=${encodeURIComponent(res.exam_title)}`)}">Gửi đề nghị phúc khảo cho bài thi này →</a>
     </div>
   `;
  }catch(err){
   box.className='notice bad';
   box.textContent=friendly(err);
  }
 });
}

function pagePhucKhao(){
 const pf=prefillCandidate();
 gate('Gửi và theo dõi yêu cầu phúc khảo',`
  <p class="lead">Trang phục vụ việc gửi đề nghị xem xét lại kết quả bài thi và theo dõi quá trình xử lý của Hội đồng khảo thí.</p>
  <div class="notice">
    <b>Quy định về hồ sơ và minh chứng phúc khảo:</b>
    <br>• Vui lòng cung cấp chính xác thông tin thí sinh, kỳ thi, ngày dự thi và mã biên nhận (hoặc mã kết quả) để hệ thống đối chiếu với bài làm gốc.
    <br>• Tệp minh chứng đính kèm (nếu có) hỗ trợ các định dạng: <code>.pdf, .jpg, .jpeg, .png, .webp, .doc, .docx, .zip</code>, dung lượng tối đa <b>15MB</b>.
    <br>• Sau khi tiếp nhận thành công, hệ thống cấp <b>Mã yêu cầu phúc khảo riêng</b> và gửi email xác nhận từ địa chỉ <code>exam@skyfirst.io.vn</code>.
  </div>
  <form id="publicAppealForm" enctype="multipart/form-data">
    <input type="hidden" name="strict_form" value="1">
    <div class="two">
      <div class="field"><label>Họ và tên (*)</label><input name="full_name" required maxlength="160" value="${esc(pf.full_name)}" placeholder="Nhập đầy đủ họ và tên"></div>
      <div class="field"><label>Số điện thoại (*)</label><input name="phone" type="tel" required maxlength="40" placeholder="Số điện thoại liên hệ"></div>
      <div class="field"><label>Địa chỉ email (*)</label><input name="email" type="email" required maxlength="220" value="${esc(pf.email)}" placeholder="Email nhận thông báo phúc khảo"></div>
      <div class="field"><label>Mã lớp (*)</label><input name="class_name" required maxlength="160" value="${esc(pf.class_name)}" placeholder="Nhập mã lớp hoặc đơn vị"></div>
      <div class="field"><label>Mã thí sinh (*)</label><input name="candidate_code" required maxlength="100" value="${esc(pf.candidate_code)}" placeholder="Ví dụ: SFN-2026-001"></div>
      <div class="field"><label>Tên kỳ thi (*)</label><input name="exam_title" required maxlength="240" value="${esc(pf.exam_title)}" placeholder="Nhập tên kỳ thi đề nghị phúc khảo"></div>
      <div class="field"><label>Ngày dự thi / Ngày diễn ra phiên thi (*)</label><input name="exam_date" required maxlength="80" placeholder="Ví dụ: 29/10/2026"></div>
      <div class="field"><label>Mã biên nhận hoặc mã kết quả (nếu có)</label><input name="receipt_code" maxlength="80" value="${esc(pf.receipt_code)}" placeholder="Ví dụ: EXM-..."></div>
    </div>
    <div class="field">
      <label>Nội dung và lý do đề nghị phúc khảo (*)</label>
      <textarea name="reason" required minlength="10" maxlength="4000" placeholder="Nêu rõ câu hỏi, phần bài làm và lý do cụ thể đề nghị Hội đồng khảo thí xem xét lại…"></textarea>
    </div>
    <div class="field">
      <label>Tài liệu, ảnh chụp màn hình hoặc minh chứng liên quan (Tùy chọn · Tối đa 15MB)</label>
      <input type="file" name="evidence_file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.zip,.txt">
    </div>
    <button type="submit" class="btn primary wide">Gửi yêu cầu phúc khảo →</button>
    <div id="appealResultBox" class="notice" hidden role="status" aria-live="polite"></div>
  </form>

  <div class="section-divider">
    <h2 class="subhead">Tra cứu trạng thái xử lý phúc khảo</h2>
    <p class="footnote">Các trạng thái xử lý: <b>Đã tiếp nhận</b> · <b>Đang xem xét</b> · <b>Cần bổ sung thông tin</b> · <b>Đã giải quyết</b> · <b>Từ chối với lý do phù hợp</b>.</p>
    <form id="trackAppealForm">
      <div class="two">
        <div class="field"><label>Mã yêu cầu phúc khảo (*)</label><input name="request_code" required maxlength="80" placeholder="Ví dụ: PK-..."></div>
        <div class="field"><label>Mã thí sinh hoặc Email đã đăng ký (*)</label><input name="verifier" required maxlength="220" placeholder="Nhập mã thí sinh hoặc email"></div>
      </div>
      <button type="submit" class="btn">Kiểm tra tiến độ phúc khảo</button>
      <div id="trackAppealBox" class="notice" hidden role="status" aria-live="polite"></div>
    </form>
  </div>
 `,{wide:true});

 document.querySelector('#publicAppealForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget,box=document.querySelector('#appealResultBox'),btn=form.querySelector('[type=submit]');
  btn.disabled=true;box.hidden=false;box.className='notice';box.textContent='Đang kiểm tra dữ liệu và lưu hồ sơ phúc khảo…';
  try{
   const fd=new FormData(form);
   const r=await apiRequest('/api/public/appeals',{method:'POST',body:fd,timeout:45000});
   box.className='notice';
   box.innerHTML=`<b>Tiếp nhận yêu cầu phúc khảo thành công!</b><br>• Mã yêu cầu riêng của bạn: <b>${esc(r.request_code||r.appeal_id)}</b><br>• Trạng thái: <b>${esc(r.status_label||'Đã tiếp nhận')}</b><br>• Thông báo email: ${r.email_sent?'Đã gửi email xác nhận từ <code>exam@skyfirst.io.vn</code> tới hộp thư của bạn.':'Yêu cầu đã được lưu an toàn trên máy chủ (dịch vụ gửi email đang chờ cấu hình môi trường).'}<br><small>Vui lòng lưu lại mã <b>${esc(r.request_code||r.appeal_id)}</b> để tra cứu tiến độ bên dưới.</small>`;
   form.reset();
  }catch(err){
   box.className='notice bad';box.textContent=friendly(err);
  }finally{btn.disabled=false}
 });

 document.querySelector('#trackAppealForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const box=document.querySelector('#trackAppealBox');
  const fd=Object.fromEntries(new FormData(ev.currentTarget));
  const v=String(fd.verifier||'').trim();
  const payload={request_code:fd.request_code,email:v.includes('@')?v:'',candidate_code:v.includes('@')?'':v};
  box.hidden=false;box.className='notice';box.textContent='Đang tra cứu trạng thái hồ sơ phúc khảo…';
  try{
   const {appeal:ap}=await apiRequest('/api/public/appeals/track',{method:'POST',body:JSON.stringify(payload)});
   box.className='notice';
   box.innerHTML=`
     <b>Mã yêu cầu:</b> ${esc(ap.request_code)} · <span class="status-badge status-${esc(ap.status)}">${esc(ap.status_label)}</span>
     <br><b>Kỳ thi:</b> ${esc(ap.exam_title)} · <b>Mã thí sinh:</b> ${esc(ap.candidate_code)}
     ${ap.score_before!=null?`<br><b>Điểm trước phúc khảo:</b> ${esc(ap.score_before)}`:''}
     ${ap.score_after!=null?` · <b>Điểm sau phúc khảo:</b> <b>${esc(ap.score_after)}</b>`:''}
     ${ap.resolution_note?`<br><b>Ý kiến / Kết luận của Hội đồng:</b> ${esc(ap.resolution_note)}`:''}
   `;
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}
 });
}

function pageHoTro(){
 const pf=prefillCandidate();
 gate('Hỗ trợ người dùng và hướng dẫn sử dụng',`
  <p class="lead">Hướng dẫn thao tác chuẩn bị dự thi và tiếp nhận các câu hỏi, yêu cầu hỗ trợ không làm gián đoạn trực tiếp phiên thi đang diễn ra.</p>
  <details class="rules" open>
    <summary>1. Hướng dẫn đăng nhập, sử dụng mã dự thi và kiểm tra thiết bị</summary>
    <p>• <b>Sử dụng mã dự thi hoặc liên kết mời:</b> Tại Trang chủ (/), nhập mã dự thi do đơn vị tổ chức cấp hoặc mở trực tiếp liên kết mời (/join/...). Điền chính xác Họ tên, Email, Mã thí sinh và Mã lớp.
• <b>Xác minh email (nếu kỳ thi yêu cầu):</b> Nhấn “Gửi mã xác minh” để nhận mã OTP 6 chữ số từ địa chỉ tự động <code>noreply@skyfirst.io.vn</code>, nhập mã trong thời hạn hiệu lực để mở phòng thi.
• <b>Kiểm tra thiết bị trước khi thi:</b> Đảm bảo trình duyệt cho phép lưu trữ phiên (Session/Local Storage), pin thiết bị và kết nối mạng ổn định. Với câu hỏi thu âm, trình duyệt chỉ yêu cầu quyền Microphone khi bạn chủ động bấm nút ghi âm.</p>
  </details>
  <details class="rules">
    <summary>2. Hướng dẫn xem kết quả, phúc khảo và chọn đúng kênh nghiệp vụ</summary>
    <p>• <b>Tra cứu kết quả thi (/tra-cuu-ket-qua):</b> Dùng Mã biên nhận (cấp sau khi nộp bài) và Mã thí sinh để xem điểm và trạng thái công bố.
• <b>Phúc khảo (/phuc-khao):</b> Dùng khi cần đề nghị Hội đồng chấm phúc khảo xem xét lại kết quả bài thi.
• <b>Sự cố khẩn cấp (/su-co-khan-cap) & Tố cáo gian lận (/to-cao-gian-lan):</b> Nếu gặp sự cố ngay trong lúc đang làm bài thi, hãy sử dụng trang <a href="/su-co-khan-cap">Sự cố khẩn cấp (/su-co-khan-cap)</a> để được ghi nhận dấu thời gian phiên thi.</p>
  </details>

  <div class="section-divider">
    <h2 class="subhead">Gửi câu hỏi / Yêu cầu hỗ trợ</h2>
    <form id="supportRequestForm" enctype="multipart/form-data">
      <input type="hidden" name="strict_form" value="1">
      <div class="two">
        <div class="field"><label>Họ và tên (*)</label><input name="full_name" required maxlength="160" value="${esc(pf.full_name)}" placeholder="Nhập họ và tên"></div>
        <div class="field"><label>Số điện thoại (*)</label><input name="phone" type="tel" required maxlength="40" placeholder="Số điện thoại liên hệ"></div>
        <div class="field"><label>Địa chỉ email (*)</label><input name="email" type="email" required maxlength="220" value="${esc(pf.email)}" placeholder="Email nhận phản hồi từ support@skyfirst.io.vn"></div>
        <div class="field"><label>Mã lớp (*)</label><input name="class_name" required maxlength="160" value="${esc(pf.class_name)}" placeholder="Nhập mã lớp hoặc đơn vị"></div>
        <div class="field"><label>Mã thí sinh (nếu có)</label><input name="candidate_code" maxlength="100" value="${esc(pf.candidate_code)}" placeholder="Ví dụ: SFN-..."></div>
        <div class="field"><label>Kỳ thi liên quan (nếu có)</label><input name="exam_title" maxlength="240" value="${esc(pf.exam_title)}" placeholder="Tên kỳ thi cần hỗ trợ"></div>
      </div>
      <div class="field">
        <label>Ngày dự thi hoặc ngày xảy ra vấn đề (nếu có)</label>
        <input name="exam_date" maxlength="80" placeholder="Ví dụ: 29/10/2026">
      </div>
      <div class="field">
        <label>Nội dung cần hỗ trợ (*)</label>
        <textarea name="message" required maxlength="4000" placeholder="Trình bày rõ câu hỏi hoặc vấn đề bạn cần bộ phận hỗ trợ giải đáp…"></textarea>
      </div>
      <div class="field">
        <label>Ảnh chụp màn hình hoặc tệp minh chứng (Không bắt buộc · Tối đa 15MB)</label>
        <input type="file" name="evidence_file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.zip,.txt">
      </div>
      <button type="submit" class="btn primary wide">Gửi yêu cầu hỗ trợ →</button>
      <div id="supportResultBox" class="notice" hidden role="status" aria-live="polite"></div>
    </form>
  </div>

  <div class="section-divider">
    <h2 class="subhead">Tra cứu trạng thái yêu cầu hỗ trợ / báo lỗi</h2>
    <form id="trackSupportForm">
      <div class="two">
        <div class="field"><label>Mã yêu cầu (HT-... / BL-... / KC-...) (*)</label><input name="request_code" required maxlength="80" placeholder="Nhập mã yêu cầu đã cấp"></div>
        <div class="field"><label>Địa chỉ email đã đăng ký (*)</label><input name="email" type="email" required maxlength="220" placeholder="Nhập email của bạn"></div>
      </div>
      <button type="submit" class="btn">Tra cứu trạng thái</button>
      <div id="trackSupportBox" class="notice" hidden role="status" aria-live="polite"></div>
    </form>
  </div>
 `,{wide:true});

 document.querySelector('#supportRequestForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget,box=document.querySelector('#supportResultBox'),btn=form.querySelector('[type=submit]');
  btn.disabled=true;box.hidden=false;box.className='notice';box.textContent='Đang gửi yêu cầu hỗ trợ…';
  try{
   const fd=new FormData(form);
   const r=await apiRequest('/api/public/support',{method:'POST',body:fd,timeout:45000});
   box.className='notice';
   box.innerHTML=`<b>Đã tiếp nhận yêu cầu hỗ trợ!</b><br>• Mã yêu cầu của bạn: <b>${esc(r.request_code||r.support_id)}</b><br>• Trạng thái: <b>${esc(r.status_label||'Đã tiếp nhận')}</b><br>• Thông báo email: ${r.email_sent?'Đã gửi email xác nhận từ <code>support@skyfirst.io.vn</code>.':'Yêu cầu đã được lưu vào hệ thống hỗ trợ (dịch vụ gửi email đang chờ cấu hình môi trường).'}`;
   form.reset();
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}finally{btn.disabled=false}
 });

 document.querySelector('#trackSupportForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const box=document.querySelector('#trackSupportBox');
  const fd=Object.fromEntries(new FormData(ev.currentTarget));
  box.hidden=false;box.className='notice';box.textContent='Đang tra cứu…';
  try{
   const r=await apiRequest('/api/public/support/track',{method:'POST',body:JSON.stringify(fd)});
   const reqInfo=r.ticket||r.request||{};
   box.className='notice';
   box.innerHTML=`<b>Mã yêu cầu:</b> ${esc(reqInfo.request_code)} · <span class="status-badge status-${esc(reqInfo.status)}">${esc(reqInfo.status_label)}</span>${reqInfo.exam_title?`<br><b>Kỳ thi:</b> ${esc(reqInfo.exam_title)}`:''}${reqInfo.resolution_note?`<br><b>Phản hồi xử lý:</b> ${esc(reqInfo.resolution_note)}`:''}`;
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}
 });
}

function pageSuCoKhanCap(){
 const pf=prefillCandidate();
 gate('Báo sự cố khẩn cấp trong kỳ thi',`
  <p class="lead">Dành riêng cho các sự cố ảnh hưởng trực tiếp đến việc dự thi đang diễn ra: không thể vào phòng thi, không thể tiếp tục làm bài, bài làm không lưu được, phiên thi bị gián đoạn bất thường hoặc đồng hồ phiên thi gặp trục trặc.</p>
  <div class="notice warn">
    <b>Hướng dẫn xử lý ngay trong khi chờ hỗ trợ:</b>
    <br>1. <b>Không đóng tab trình duyệt đang làm bài</b> (nếu phòng thi vẫn đang mở) để trình duyệt giữ nguyên bản lưu dự phòng trên thiết bị.
    <br>2. Kiểm tra nhanh kết nối mạng trên thiết bị và gửi ngay biểu mẫu dưới đây để máy chủ ghi nhận <b>dấu thời gian xảy ra sự cố</b> làm căn cứ đối chiếu.
    <br>3. <b>Lưu ý vận hành:</b> Yêu cầu sự cố khẩn cấp được ghi nhận ngay vào bảng giám sát kỳ thi và nhật ký hệ thống để Hội đồng coi thi xem xét theo lịch trực của từng kỳ thi.
  </div>
  ${pf.attempt_id?`<div class="notice"><b>Đã tự động gắn thông tin phiên thi hiện tại trên thiết bị:</b> Mã phiên <code>${esc(pf.attempt_id)}</code>${pf.candidate_code?` · Mã thí sinh <code>${esc(pf.candidate_code)}</code>`:''}. Bạn có thể kiểm tra và gửi ngay mà không cần nhập lại mã phiên.</div>`:''}
  <form id="emergencyForm" enctype="multipart/form-data">
    <input type="hidden" name="attempt_id" value="${esc(pf.attempt_id)}">
    <div class="two">
      <div class="field"><label>Họ và tên (*)</label><input name="full_name" required maxlength="160" value="${esc(pf.full_name)}" placeholder="Nhập họ và tên thí sinh"></div>
      <div class="field"><label>Số điện thoại (*)</label><input name="phone" type="tel" required maxlength="40" placeholder="Số điện thoại liên hệ nhanh"></div>
      <div class="field"><label>Địa chỉ email (*)</label><input name="email" type="email" required maxlength="220" value="${esc(pf.email)}" placeholder="Email nhận thông tin phản hồi"></div>
      <div class="field"><label>Mã lớp (*)</label><input name="class_name" required maxlength="160" value="${esc(pf.class_name)}" placeholder="Nhập mã lớp hoặc đơn vị"></div>
      <div class="field"><label>Mã thí sinh (*)</label><input name="candidate_code" required maxlength="100" value="${esc(pf.candidate_code)}" placeholder="Nhập mã thí sinh"></div>
      <div class="field"><label>Tên kỳ thi (*)</label><input name="exam_title" required maxlength="240" value="${esc(pf.exam_title)}" placeholder="Nhập tên kỳ thi đang tham gia"></div>
    </div>
    <div class="field">
      <label>Ngày và thời điểm xảy ra sự cố (*)</label>
      <input name="occurred_at" required maxlength="100" value="${esc(new Date().toLocaleString('vi-VN'))}">
    </div>
    <div class="field">
      <label>Mô tả sự cố đang gặp phải (*)</label>
      <textarea name="message" required maxlength="4000" style="min-height:110px" placeholder="Nêu ngắn gọn sự cố (ví dụ: không vào được phòng thi, bị khóa phiên do thông báo hệ điều hành, mất kết nối không lưu được bài)…"></textarea>
    </div>
    <div class="field">
      <label>Ảnh chụp màn hình hoặc tài liệu minh chứng (Không bắt buộc để tránh làm chậm việc báo sự cố)</label>
      <input type="file" name="evidence_file" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.zip">
    </div>
    <button type="submit" class="btn primary wide">Gửi báo cáo sự cố khẩn cấp ngay →</button>
    <div id="emergencyResultBox" class="notice" hidden role="status" aria-live="polite"></div>
  </form>

  <div class="section-divider">
    <h2 class="subhead">Tra cứu trạng thái xử lý sự cố khẩn cấp</h2>
    <form id="trackEmergencyForm">
      <div class="two">
        <div class="field"><label>Mã hồ sơ sự cố (KC-...) (*)</label><input name="request_code" required maxlength="80" placeholder="Ví dụ: KC-..."></div>
        <div class="field"><label>Địa chỉ email đã đăng ký (*)</label><input name="email" type="email" required maxlength="220" value="${esc(pf.email)}" placeholder="Nhập email của bạn"></div>
      </div>
      <button type="submit" class="btn">Tra cứu trạng thái sự cố</button>
      <div id="trackEmergencyBox" class="notice" hidden role="status" aria-live="polite"></div>
    </form>
  </div>
 `,{wide:true});

 document.querySelector('#emergencyForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget,box=document.querySelector('#emergencyResultBox'),btn=form.querySelector('[type=submit]');
  btn.disabled=true;box.hidden=false;box.className='notice';box.textContent='Đang ghi nhận sự cố khẩn cấp lên máy chủ…';
  try{
   const fd=new FormData(form);
   const r=await apiRequest('/api/public/emergency-incidents',{method:'POST',body:fd,timeout:45000});
   box.className='notice';
   box.innerHTML=`<b>Đã ghi nhận báo cáo sự cố khẩn cấp!</b><br>• Mã hồ sơ sự cố: <b>${esc(r.request_code||r.incident_id)}</b><br>• Trạng thái: <b>${esc(r.status_label||'Đã tiếp nhận')}</b><br>• Email xác nhận: ${r.email_sent?'Đã gửi từ <code>support@skyfirst.io.vn</code>.':'Đã lưu dấu thời gian sự cố trên máy chủ (dịch vụ gửi email đang chờ cấu hình môi trường).'}<br>• Nếu tab phòng thi của bạn vẫn đang mở, hãy quay lại tab làm bài và chờ cán bộ coi thi kiểm tra mở khóa hoặc cộng bù thời gian (nếu đủ điều kiện).`;
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}finally{btn.disabled=false}
 });

 document.querySelector('#trackEmergencyForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const box=document.querySelector('#trackEmergencyBox');
  const fd=Object.fromEntries(new FormData(ev.currentTarget));
  box.hidden=false;box.className='notice';box.textContent='Đang tra cứu trạng thái hồ sơ sự cố…';
  try{
   const r=await apiRequest('/api/public/support/track',{method:'POST',body:JSON.stringify(fd)});
   const reqInfo=r.ticket||r.request||{};
   box.className='notice';
   box.innerHTML=`<b>Mã hồ sơ sự cố:</b> ${esc(reqInfo.request_code)} · <span class="status-badge status-${esc(reqInfo.status)}">${esc(reqInfo.status_label)}</span>${reqInfo.exam_title?`<br><b>Kỳ thi:</b> ${esc(reqInfo.exam_title)}`:""}${reqInfo.resolution_note?`<br><b>Phản hồi xử lý:</b> ${esc(reqInfo.resolution_note)}`:""}`;
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}
 });
}

function pageToCaoGianLan(){
 const pf=prefillCandidate();
 gate('Tiếp nhận phản ánh, tố cáo dấu hiệu gian lận',`
  <p class="lead">Biểu mẫu chuyên biệt tiếp nhận thông tin phản ánh về dấu hiệu vi phạm quy chế hoặc gian lận trong kỳ thi.</p>
  <div class="notice">
    <b>Nguyên tắc bảo mật và xử lý phản ánh:</b>
    <br>• Hệ thống <b>bảo mật tuyệt đối</b> thông tin người tố cáo, không hiển thị công khai nội dung tố cáo và không cho phép bất kỳ người dùng công khai nào xem thông tin của người phản ánh.
    <br>• <b>Nguyên tắc xác minh:</b> Nội dung tố cáo chỉ là nguồn thông tin để xác minh. Hệ thống không tự động kết luận thí sinh gian lận, không tự động hủy kết quả hay cấm thi chỉ vì có phản ánh; mọi quyết định xử lý đều phải được Hội đồng xem xét theo quy chế, bằng chứng xác thực và thẩm quyền quy định.
  </div>
  <form id="fraudReportForm" enctype="multipart/form-data">
    <div class="two">
      <div class="field"><label>1. Họ và tên người tố cáo (*)</label><input name="reporter_name" required maxlength="160" value="${esc(pf.full_name)}" placeholder="Nhập họ và tên của bạn"></div>
      <div class="field"><label>2. Số điện thoại liên hệ (*)</label><input name="phone" type="tel" required maxlength="40" placeholder="Số điện thoại xác minh khi cần"></div>
      <div class="field"><label>3. Địa chỉ email (*)</label><input name="email" type="email" required maxlength="220" value="${esc(pf.email)}" placeholder="Email nhận mã tiếp nhận từ noreply@skyfirst.io.vn"></div>
      <div class="field"><label>4. Mã lớp (*)</label><input name="class_name" required maxlength="160" value="${esc(pf.class_name)}" placeholder="Nhập mã lớp hoặc đơn vị"></div>
      <div class="field"><label>5. Tên kỳ thi (*)</label><input name="exam_title" required maxlength="240" value="${esc(pf.exam_title)}" placeholder="Nhập tên kỳ thi liên quan"></div>
      <div class="field"><label>6. Ngày diễn ra phiên thi (*)</label><input name="exam_date" required maxlength="80" placeholder="Ví dụ: 29/10/2026"></div>
    </div>
    <div class="two">
      <div class="field"><label>Mã thí sinh bị phản ánh (Nếu biết)</label><input name="reported_candidate_code" maxlength="100" placeholder="Nhập mã thí sinh bị phản ánh (không bắt buộc)"></div>
      <div class="field"><label>Thông tin nhận diện người bị phản ánh (Nếu chưa biết mã thí sinh)</label><input name="reported_info" maxlength="500" placeholder="Phòng thi, ca thi hoặc đặc điểm nhận diện trong phiên thi"></div>
    </div>
    <div class="field">
      <label>7. Nội dung tố cáo, mô tả rõ sự việc và thời điểm xảy ra (*)</label>
      <textarea name="content" required minlength="15" maxlength="5000" placeholder="Trình bày cụ thể sự việc, thời điểm xảy ra và các dấu hiệu nghi vấn vi phạm quy chế…"></textarea>
    </div>
    <div class="notice warn">
      <b>8. Minh chứng bắt buộc (*):</b> Vui lòng cung cấp <b>ít nhất một</b> trong hai hình thức minh chứng hợp lệ dưới đây (tải lên tệp minh chứng hoặc nhập đường dẫn bài viết/nội dung liên quan).
    </div>
    <div class="two">
      <div class="field">
        <label>Tệp minh chứng đính kèm (Ảnh chụp màn hình, hình ảnh, tài liệu PDF/DOCX/ZIP · Tối đa 15MB)</label>
        <input type="file" name="evidence_file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.zip,.txt,.mp3,.mp4">
      </div>
      <div class="field">
        <label>Hoặc đường dẫn bài viết / nội dung liên quan (http:// hoặc https://)</label>
        <input name="evidence_url" type="url" maxlength="1000" placeholder="https://...">
      </div>
    </div>
    <button type="submit" class="btn primary wide">Gửi phản ánh và minh chứng →</button>
    <div id="fraudResultBox" class="notice" hidden role="status" aria-live="polite"></div>
  </form>

  <div class="section-divider">
    <h2 class="subhead">Tra cứu trạng thái tiếp nhận phản ánh</h2>
    <form id="trackFraudForm">
      <div class="two">
        <div class="field"><label>Mã tiếp nhận (TC-...) (*)</label><input name="request_code" required maxlength="80" placeholder="Ví dụ: TC-..."></div>
        <div class="field"><label>Email người gửi (*)</label><input name="email" type="email" required maxlength="220" placeholder="Nhập email bạn đã dùng khi gửi"></div>
      </div>
      <button type="submit" class="btn">Kiểm tra trạng thái hồ sơ</button>
      <div id="trackFraudBox" class="notice" hidden role="status" aria-live="polite"></div>
    </form>
  </div>
 `,{wide:true});

 document.querySelector('#fraudReportForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const form=ev.currentTarget,box=document.querySelector('#fraudResultBox'),btn=form.querySelector('[type=submit]');
  const fileInput=form.elements.evidence_file,urlInput=form.elements.evidence_url;
  if((!fileInput?.files?.length||!fileInput.files[0].size)&&!String(urlInput?.value||'').trim()){
   box.hidden=false;box.className='notice bad';
   box.textContent='Vui lòng đính kèm ít nhất một tệp minh chứng hoặc nhập đường dẫn liên quan hợp lệ trước khi gửi.';
   return;
  }
  btn.disabled=true;box.hidden=false;box.className='notice';box.textContent='Đang kiểm tra tính an toàn của minh chứng và lưu hồ sơ…';
  try{
   const fd=new FormData(form);
   const r=await apiRequest('/api/public/fraud-reports',{method:'POST',body:fd,timeout:45000});
   box.className='notice';
   box.innerHTML=`<b>Đã tiếp nhận phản ánh thành công!</b><br>• Mã tiếp nhận riêng của bạn: <b>${esc(r.request_code||r.report_id)}</b><br>• Trạng thái: <b>${esc(r.status_label||'Đã tiếp nhận để xác minh')}</b><br>• Email xác nhận: ${r.email_sent?'Đã gửi từ <code>noreply@skyfirst.io.vn</code> tới hộp thư của bạn.':'Hồ sơ đã được lưu bảo mật trên máy chủ (dịch vụ gửi email đang chờ cấu hình môi trường).'}`;
   form.reset();
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}finally{btn.disabled=false}
 });

 document.querySelector('#trackFraudForm')?.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const box=document.querySelector('#trackFraudBox');
  const fd=Object.fromEntries(new FormData(ev.currentTarget));
  box.hidden=false;box.className='notice';box.textContent='Đang tra cứu…';
  try{
   const {report:rep}=await apiRequest('/api/public/fraud-reports/track',{method:'POST',body:JSON.stringify(fd)});
   box.className='notice';
   box.innerHTML=`<b>Mã tiếp nhận:</b> ${esc(rep.request_code)} · <span class="status-badge status-${esc(rep.status)}">${esc(rep.status_label)}</span><br><b>Kỳ thi:</b> ${esc(rep.exam_title)} (${esc(rep.exam_date)})${rep.resolution_note?`<br><b>Ghi chú xử lý:</b> ${esc(rep.resolution_note)}`:''}`;
  }catch(err){box.className='notice bad';box.textContent=friendly(err)}
 });
}

async function guestGate(code){
 invite=code;const {exam:e}=await apiRequest(`/api/public/assessments/${encodeURIComponent(code)}`);if(!e)throw new Error('Không tải được thông tin kỳ thi.');
 const scheduled=e.schedule?['opens_at','closes_at'].map((key,i)=>{const ms=timeMs(e.schedule[key],{schedule:true});return Number.isFinite(ms)?`<span>${i?'Đóng':'Mở'}: <b>${esc(new Date(ms).toLocaleString('vi-VN'))}</b></span>`:''}).join(''):'';
 gate(e.title||'Xác nhận dự thi',`<p class="lead">Điền đúng thông tin để đơn vị tổ chức đối chiếu bài làm.</p><div class="notice">${esc(e.public_status||'Liên kết mời dự thi')}</div><div class="schedule-info">${scheduled}</div>${e.instructions?`<details class="rules"><summary>Hướng dẫn và quy chế</summary><p>${esc(e.instructions)}</p></details>`:''}<form id="guestForm"><div class="two"><div class="field"><label>Họ và tên</label><input name="full_name" required maxlength="160" autocomplete="name"></div><div class="field"><label>Email nhận thông tin</label><input name="email" type="email" required maxlength="220" autocomplete="email"></div><div class="field"><label>Mã học viên / mã dự thi</label><input name="candidate_code" required maxlength="100"></div><div class="field"><label>Lớp / đơn vị</label><input name="class_name" required maxlength="160"></div></div>${e.require_email_verify?'<div class="two"><div class="field"><label>Mã xác minh 6 số</label><input name="verification_code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><button class="btn verify-btn" type="button" id="sendCode">Gửi mã xác minh</button></div>':''}<label class="consent"><input type="checkbox" required>Tôi đã kiểm tra thông tin và đọc hướng dẫn dự thi.</label><div id="gateMessage" role="status" aria-live="polite"></div><button type="submit" class="btn primary wide">Xác nhận và vào phòng thi →</button><p class="footnote">Thời gian làm bài được tính từ khi máy chủ mở phiên, kể cả khi bạn đang đọc hướng dẫn.</p></form>`,{wide:true});
 const form=document.querySelector('#guestForm'),message=document.querySelector('#gateMessage');
 document.querySelector('#sendCode')?.addEventListener('click',async ev=>{const email=form.elements.email;if(!email.reportValidity())return;const button=ev.currentTarget;button.disabled=true;button.textContent='Đang gửi…';try{await apiRequest(`/api/public/assessments/${encodeURIComponent(invite)}/request-verification`,{method:'POST',body:JSON.stringify({email:email.value.trim()})});message.textContent='Đã gửi mã xác minh 6 chữ số đến hộp thư của bạn.'}catch(error){message.textContent=friendly(error)}finally{button.disabled=false;button.textContent='Gửi mã xác minh'}});
 form.onsubmit=async ev=>{ev.preventDefault();if(form.dataset.pending)return;form.dataset.pending='1';const button=ev.submitter||form.querySelector('[type=submit]');button.disabled=true;button.textContent='Đang chuẩn bị phiên thi…';const data=Object.fromEntries(new FormData(form));try{const r=await apiRequest(`/api/public/assessments/${encodeURIComponent(invite)}/start`,{method:'POST',body:JSON.stringify(data)});if(!r.access_key||!r.attempt_id)throw new Error('Máy chủ chưa cấp được phiên dự thi.');token=r.access_key;attempt=r.attempt_id;mode='guest';candidate={full_name:data.full_name,candidate_code:data.candidate_code,class_name:data.class_name,email:data.email};sessionId=setSession(token,attempt,mode,invite,candidate,sessionId);history.replaceState({},'',`/exam/${encodeURIComponent(attempt)}`);await loadAttempt()}catch(error){message.textContent=friendly(error);button.disabled=false;button.textContent='Xác nhận và vào phòng thi →';delete form.dataset.pending}};
}
async function boot(){try{
 const u=new URL(location.href),launch=u.searchParams.get('launch'),cleanPath=(u.pathname.replace(/\/{2,}/g,'/').replace(/\/+$/,'')||'/').toLowerCase();
 if(/^\/admin(?:\/|$)/.test(u.pathname)){
  const {bootAdmin}=await import('./admin.js?build=20261030-routes-v2');
  return await bootAdmin(app);
 }
 if(cleanPath==='/tra-cuu-ket-qua')return pageTraCuu();
 if(cleanPath==='/phuc-khao')return pagePhucKhao();
 if(cleanPath==='/ho-tro')return pageHoTro();
 if(cleanPath==='/su-co-khan-cap')return pageSuCoKhanCap();
 if(cleanPath==='/to-cao-gian-lan')return pageToCaoGianLan();
 let inviteUrl='';if(u.pathname.startsWith('/join/'))inviteUrl=decodeURIComponent(u.pathname.split('/')[2]||'');else inviteUrl=u.searchParams.get('invite')||'';
 if(launch){gate('Đang mở phiên dự thi','<p class="lead">Đang xác nhận mã khởi chạy dự thi…</p>');const r=await apiRequest('/api/public/exam-launch/redeem',{method:'POST',body:JSON.stringify({launch_token:launch})});if(!r.access_token||!r.attempt_id)throw new Error('Không nhận được thông tin phiên thi.');token=r.access_token;attempt=r.attempt_id;mode='user';invite='';candidate=r.candidate||{};sessionId=setSession(token,attempt,mode,invite,candidate,sessionId);history.replaceState({},'',`/exam/${encodeURIComponent(attempt)}`);return await loadAttempt()}
 if(inviteUrl)return await guestGate(inviteUrl);
 const requested=u.pathname.match(/^\/exam\/([^/]+)\/?$/);if(requested&&attempt&&decodeURIComponent(requested[1])!==attempt)return showScreen('Liên kết không khớp phiên dự thi','Hãy mở lại bài thi từ liên kết dự thi hoặc mã mời được cung cấp.');
 if(token&&attempt&&requested)return await loadAttempt();
 if(requested)return showScreen('Cần mở lại liên kết dự thi','Quyền truy cập của phiên này không có trên trình duyệt. Hãy vào bài thi từ liên kết dự thi hoặc mã mời.');
 if(token&&attempt&&cleanPath==='/')return await loadAttempt();
 if(cleanPath!=='/')return showScreen('Không tìm thấy trang (404)','Đường dẫn này không tồn tại trên Hệ Thống Khảo Thí Và Đánh Giá Sky First.');
 home();
 }catch(error){await handleError(error,'Không thể mở bài thi')}
}
function syncTiming(r){const server=timeMs(r.server_time);if(Number.isFinite(server)){offset=server-Date.now();serverAnchor=server;performanceAnchor=performance.now();}const deadline=timeMs(r.deadline_at);if(Number.isFinite(deadline))deadlineMs=deadline;else if(r.remaining_seconds!=null&&Number.isFinite(Number(r.remaining_seconds)))deadlineMs=serverNow()+Number(r.remaining_seconds)*1000;else if(r.remaining_seconds===null)deadlineMs=null;remaining=deadlineMs==null?null:Math.max(0,Math.ceil((deadlineMs-serverNow())/1000))}
async function loadAttempt(){
 if(!acquireLease(attempt))return showScreen('Phiên thi đang mở ở tab khác','Quay lại tab đang làm bài. Đóng tab đó trước khi mở lại phiên ở đây.',{retry:true});
 const r=await req(path());exam=normalizeExam(r.exam);answers=cleanAnswers(r.answers,exam.questions);events=eventUnion(r.events);revision=Number(r.answer_revision||0);syncTiming(r);if(r.candidate&&typeof r.candidate==='object'&&!Array.isArray(r.candidate))candidate=r.candidate;
 const cached=loadLocal(attempt);journal=new AnswerJournal();if(cached){const ui=cached.ui||(Array.isArray(cached.events)?cached.events.findLast(e=>e?.type==='ui_state'):null)||{};current=Math.min(Math.max(0,Number(ui.current)||0),exam.questions.length-1);marked=new Set((Array.isArray(ui.marked)?ui.marked:[]).filter(x=>Number.isInteger(x)&&x>=0&&x<exam.questions.length));fontScale=Math.min(2,Math.max(0,Number(ui.fontScale)||0));
 if(cached.dirty&&Number(cached.revision)===revision){answers=cleanAnswers(cached.answers,exam.questions);events=eventUnion(events,cached.events);journal.edit();lastSave='Đã khôi phục bản lưu trên thiết bị'}
 else if(cached.dirty&&Number(cached.revision)!==revision){saveError='Bản trên máy chủ mới hơn; bản lưu thiết bị được giữ để đối chiếu.'}
 }
 leaseTick=setInterval(()=>{if(!renewLease()&&!finished){conflicted=true;armed=false;cleanup();persist();showScreen('Phiên thi đã được mở ở tab khác','Bản lưu trên thiết bị được giữ. Chỉ tiếp tục tại một tab hoặc thiết bị.',{retry:true})}},6000);
 preflight();startClock();
}
function preflight(){gate(exam.title,`<div class="preflight-meta"><article><small>SỐ CÂU HỎI</small><b>${exam.questions.length}</b></article><article><small>THỜI GIAN CÒN LẠI</small><b id="time">${formatClock(remaining)}</b></article><article><small>TRẠNG THÁI</small><b>Sẵn sàng dự thi</b></article></div><div class="candidate-block"><b>${esc(candidate.full_name||'Phiên dự thi cá nhân')}</b><span>${esc(candidate.candidate_code||`Mã phiên: ${attempt.slice(0,12).toUpperCase()}`)}${candidate.class_name?` · ${esc(candidate.class_name)}`:''}</span></div>${exam.instructions?`<details class="rules" open><summary>Hướng dẫn của đơn vị tổ chức</summary><p>${esc(exam.instructions)}</p></details>`:''}<ol class="checklist"><li>Chọn câu trong bảng điều hướng; đánh dấu các câu cần xem lại.</li><li>Đọc trạng thái lưu bài. Giữ trang mở nếu kết nối bị gián đoạn.</li><li>Kiểm tra tổng quan và chỉ kết thúc khi thấy xác nhận nộp bài.</li></ol><div class="notice ${storageRestricted()?'bad':''}">${storageRestricted()?'Trình duyệt đang hạn chế lưu trữ. Không đóng hoặc tải lại trang khi làm bài.':'Bài làm được lưu trực tuyến và có bản dự phòng trên thiết bị.'} Đồng hồ đã chạy từ lúc máy chủ mở phiên.${exam.fullscreen_required?' Kỳ thi yêu cầu toàn màn hình.':''}</div><label class="consent"><input type="checkbox" id="agreeRules">Tôi đã đọc hướng dẫn và sẵn sàng làm bài.</label><div id="preflightMessage" role="status"></div><button class="btn primary wide" id="beginExam" disabled>Vào màn hình làm bài →</button>`,{ey:UNIT_NAME,wide:true});
 const button=document.querySelector('#beginExam');document.querySelector('#agreeRules').onchange=e=>button.disabled=!e.target.checked;
 button.onclick=async()=>{button.disabled=true;if(timeLocked)return submit(true);if(exam.fullscreen_required){try{if(!document.documentElement.requestFullscreen)throw new Error('Không hỗ trợ');await document.documentElement.requestFullscreen()}catch{document.querySelector('#preflightMessage').textContent='Chưa bật được toàn màn hình. Vui lòng dùng trình duyệt hỗ trợ và thử lại để đáp ứng quy chế.';button.disabled=false;return}}
 armed=true;log('exam_enter',{fullscreen:!!document.fullscreenElement});render();startTasks()};
}
function startClock(){if(clockTick)return;clockTick=setInterval(()=>{if(finished||conflicted)return;remaining=deadlineMs==null?null:Math.max(0,Math.ceil((deadlineMs-serverNow())/1000));paintClock();if(armed&&remaining!=null&&remaining<=8&&remaining>0&&journal.dirty)save().catch(()=>{});if(remaining===0&&!timeLocked){timeLocked=true;if(recordingActive)discardRecording();document.querySelector('.modal-backdrop')?.remove();if(armed)render();submit(true)}},250);paintClock()}
function startTasks(){if(!saveTick)saveTick=setInterval(()=>{if(journal.dirty&&!timeLocked)save().catch(()=>{})},5000);if(!heartbeatTick)heartbeatTick=setInterval(heartbeat,15000);heartbeat()}
function paintClock(){const el=document.querySelector('#time');if(el)el.textContent=remaining===0?'Đã hết giờ':formatClock(remaining);document.querySelector('.clock')?.classList.toggle('clock-warning',remaining!=null&&remaining<=300);if(armed&&remaining!=null){if(remaining<=900&&remaining>300&&!warned15){warned15=true;toast('Còn 15 phút');}if(remaining<=300&&remaining>0&&!warned5){warned5=true;toast('Còn 5 phút',true);}document.title=`${remaining===0?'Đã hết giờ':formatClock(remaining)} · ${exam.title} | ${UNIT_NAME} — ${SYSTEM_NAME}`}}
function candidateMarkup(){return `<div class="candidate-panel"><div class="candidate-avatar" aria-hidden="true">${esc((candidate.full_name||'S').split(/\s+/).at(-1)?.[0]||'S')}</div><div><small>THÍ SINH / PHIÊN DỰ THI</small><b>${esc(candidate.full_name||'Phiên dự thi cá nhân')}</b><span>${esc(candidate.candidate_code||attempt.slice(0,12).toUpperCase())}</span>${candidate.class_name?`<span>${esc(candidate.class_name)}</span>`:''}</div></div>`}
function optionMarkup(q){const value=answers[q.id],disabled=timeLocked||submitting||conflicted?' disabled':'';
 if(q.type==='mcq'||q.type==='truefalse'||q.type==='multi')return optionsFor(q).map((o,i)=>`<label class="option"><input type="${q.type==='multi'?'checkbox':'radio'}" name="answer" data-answer-input value="${esc(o)}" ${(q.type==='multi'?Array.isArray(value)&&value.includes(o):String(value??'')===o)?'checked':''}${disabled}><span class="option-letter">${String.fromCharCode(65+i)}</span><span class="option-text" lang="${esc(questionLanguage(q))}" dir="${questionDirection(q)}">${esc(o)}</span></label>`).join('');
 if(q.type==='ordering')return optionsFor(q).map((_,i)=>`<label class="matching-row"><span>Vị trí ${i+1}</span><select data-order="${i}"${disabled}><option value="">Chọn nội dung…</option>${optionsFor(q).map(o=>`<option value="${esc(o)}" ${value?.[i]===o?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`).join('');
 if(q.type==='matching'){const opts=optionsFor(q);return opts.map(pair=>{const left=pair.split('|||')[0];return `<label class="matching-row"><span>${esc(left)}</span><select data-match="${esc(left)}"${disabled}><option value="">Chọn nội dung ghép…</option>${opts.map(o=>o.split('|||')[1]||'').map(o=>`<option value="${esc(o)}" ${value?.[left]===o?'selected':''}>${esc(o)}</option>`).join('')}</select></label>`}).join('')}
 if(['file','image','audio'].includes(q.type)){const accept=q.type==='image'?'image/jpeg,image/png,image/webp':q.type==='audio'?'audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm,audio/ogg,application/ogg':'.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,image/jpeg,image/png,image/webp,audio/mpeg,audio/mp4';return `<div class="file-response">${value?.file_id?`<div class="uploaded-file"><b>Đã chọn:</b> ${esc(value.name||'Tệp đã tải')}<br><small>${Math.max(1,Math.round(Number(value.size||0)/1024))} KB</small></div>`:''}${q.type==='audio'?`<div class="record-panel"><p class="muted">Bạn có thể ghi âm câu trả lời ngay tại đây hoặc tải lên tệp âm thanh. Microphone chỉ được yêu cầu sau khi bạn bấm “Bắt đầu ghi âm”. Giới hạn: ${Math.round(Math.min(1800,Math.max(15,Number(q.recording_duration_seconds)||180))/60*10)/10} phút.</p><div class="record-actions"><button type="button" class="btn" id="startRecording"${disabled}>🎙 Bắt đầu ghi âm</button><button type="button" class="btn danger" id="stopRecording" hidden disabled>⏹ Dừng và tải bản ghi</button></div><div id="recordingStatus" class="upload-state" role="status" aria-live="polite"></div></div>`:''}<div class="notice">Theo quy định khảo thí Sky First, thí sinh không tải tệp lên để nộp bài. Vui lòng trình bày trực tiếp câu trả lời vào trình soạn thảo bên dưới (hoặc bấm nút ghi âm trực tiếp đối với câu hỏi nói).</div><textarea class="long-writing" data-written${disabled} placeholder="Trình bày trực tiếp bài làm của bạn tại đây…">${esc(typeof value==='string'?value:'')}</textarea><div class="word-count" id="wordCount"></div></div>`}
 if(['essay','short_essay','long','structured','math','coding','case_study'].includes(q.type))return `<div class="rich-editor-shell"><div class="editor-toolbar" role="toolbar" aria-label="Công cụ soạn thảo & Toán học"><button type="button" class="text-button" data-insert-snippet="## Tiêu đề mục\n">H2</button><button type="button" class="text-button" data-insert-snippet="**Chữ đậm**"><b>B</b></button><button type="button" class="text-button" data-insert-snippet="*Chữ nghiêng*"><i>I</i></button><button type="button" class="text-button" data-insert-snippet="\n- Ý 1\n- Ý 2\n">Danh sách</button><button type="button" class="text-button" data-insert-snippet="\n| Cột 1 | Cột 2 |\n|---|---|\n| Giá trị | Giá trị |\n">Bảng</button><button type="button" class="text-button" id="toggleMathKeyboard">∑ Bàn phím Toán học &amp; Công thức</button>${exam?.calculator_policy&&exam.calculator_policy!=='disabled'?'<button type="button" class="text-button" id="toggleSciCalc">🖩 Máy tính khoa học</button>':''}</div><div id="virtualMathPad" class="math-keyboard-panel" hidden><div class="math-group"><b>Phân số / Căn / Giải tích:</b> <button type="button" data-math-ins="\\frac{a}{b}">a/b</button> <button type="button" data-math-ins="x^{2}">x²</button> <button type="button" data-math-ins="x_{i}">xᵢ</button> <button type="button" data-math-ins="\\sqrt{x}">√x</button> <button type="button" data-math-ins="\\sqrt[n]{x}">ⁿ√x</button> <button type="button" data-math-ins="\\lim_{x\\to 0}">lim</button> <button type="button" data-math-ins="\\frac{d}{dx}">d/dx</button> <button type="button" data-math-ins="\\int_{a}^{b} f(x)dx">∫</button> <button type="button" data-math-ins="\\sum_{i=1}^{n}">∑</button> <button type="button" data-math-ins="\\prod_{i=1}^{n}">∏</button></div><div class="math-group"><b>Tập hợp / Logic / Hình học / Hy Lạp:</b> <button type="button" data-math-ins="∈">∈</button> <button type="button" data-math-ins="∉">∉</button> <button type="button" data-math-ins="⊂">⊂</button> <button type="button" data-math-ins="⊆">⊆</button> <button type="button" data-math-ins="∪">∪</button> <button type="button" data-math-ins="∩">∩</button> <button type="button" data-math-ins="∅">∅</button> <button type="button" data-math-ins="∀">∀</button> <button type="button" data-math-ins="∃">∃</button> <button type="button" data-math-ins="⇒">⇒</button> <button type="button" data-math-ins="⇔">⇔</button> <button type="button" data-math-ins="∠">∠</button> <button type="button" data-math-ins="∥">∥</button> <button type="button" data-math-ins="⊥">⊥</button> <button type="button" data-math-ins="α">α</button> <button type="button" data-math-ins="β">β</button> <button type="button" data-math-ins="γ">γ</button> <button type="button" data-math-ins="θ">θ</button> <button type="button" data-math-ins="λ">λ</button> <button type="button" data-math-ins="π">π</button> <button type="button" data-math-ins="σ">σ</button> <button type="button" data-math-ins="Ω">Ω</button> <button type="button" data-math-ins="\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}">Ma trận</button> <button type="button" data-math-ins="\\begin{cases}x+y=1\\\\x-y=0\\end{cases}">Hệ PT</button></div></div><div id="sciCalcPanel" class="sci-calc-panel" hidden><div class="two"><input id="sciCalcInput" placeholder="Nhập biểu thức: sin(30) + sqrt(16) + 2^3"><button type="button" class="btn" id="runSciCalc">Tính (=)</button></div><div id="sciCalcResult" class="muted">Chế độ DEG · Máy tính khoa học nội bộ</div></div><label class="sr-only" for="writtenAnswer">Câu trả lời của bạn</label><textarea id="writtenAnswer" class="long-writing" data-written${disabled} placeholder="Trình bày trực tiếp bài làm, lời giải từng bước hoặc công thức toán học (LaTeX) tại đây…" lang="${esc(questionLanguage(q))}" dir="auto">${esc(value??'')}</textarea><div id="mathLivePreview" class="math-preview" aria-live="polite"></div><div class="word-count" id="wordCount"></div></div>`;
 if(q.type==='numeric')return `<label class="field short-answer"><span>Câu trả lời của bạn</span><input type="number" inputmode="decimal" data-written${disabled} value="${esc(value??'')}" autocomplete="off" placeholder="Nhập giá trị số…"></label>`;
 return `<label class="field short-answer"><span>Câu trả lời của bạn</span><input data-written${disabled} value="${esc(value??'')}" autocomplete="off" placeholder="Nhập câu trả lời…" lang="${esc(questionLanguage(q))}" dir="auto"></label>`;
}
function mapMarkup(){const states=statuses();return exam.questions.map((q,i)=>{if(filter==='unanswered'&&states[i]==='done'||filter==='marked'&&!marked.has(i))return '';return `<button type="button" data-q="${i}" class="question-index ${states[i]} ${current===i?'current':''} ${marked.has(i)?'flagged':''}" aria-label="Câu ${i+1}: ${states[i]==='done'?'đã trả lời':states[i]==='partial'?'chưa hoàn tất':'chưa trả lời'}${marked.has(i)?', đánh dấu xem lại':''}" ${current===i?'aria-current="step"':''}>${i+1}</button>`}).join('')||'<p class="map-empty">Không có câu phù hợp.</p>'}
function render(){app.inert=false;const q=exam.questions[current];app.className=`exam-app font-${fontScale}`;app.innerHTML=`<header class="exam-header"><div class="exam-brand"><img src="/sky-first-logo.webp" alt="Sky First"><div><b>${UNIT_NAME}</b><small>${SYSTEM_NAME}</small></div></div><div class="exam-title"><small>KỲ THI / BÀI ĐÁNH GIÁ</small><h1>${esc(exam.title)}</h1></div><div class="clock"><small>THỜI GIAN CÒN LẠI</small><b id="time">${formatClock(remaining)}</b></div></header><div class="session-bar"><div class="connection"><i id="connectionDot" class="status-dot"></i><span id="networkState">${navigator.onLine?'Kết nối trực tuyến':'Ngoại tuyến'}</span><span class="bar-divider">|</span><span id="saveState" role="status" aria-live="polite"></span></div><div class="session-tools"><a class="text-button" href="/su-co-khan-cap" target="_blank" rel="noopener">Báo sự cố khẩn cấp</a><button class="text-button" id="help">Hướng dẫn</button><button class="text-button" id="font" aria-label="Thay đổi kích thước chữ">A⁺</button><button class="text-button" id="fullscreen">Toàn màn hình</button></div></div><div class="mobile-status"><button class="btn" id="openMap" aria-expanded="false" aria-controls="questionNav">☷ Bảng câu hỏi</button><span>${doneCount()}/${exam.questions.length} hoàn tất</span></div><div class="workspace"><main class="question-stage" id="questionStage" tabindex="-1"><div class="stage-head"><div><span class="section-label">PHẦN LÀM BÀI</span><h2>Câu ${current+1}<small> / ${exam.questions.length}</small></h2></div><div class="question-badges"><span>${esc(typeLabel(q))}</span><span>${Number(q.points??1)} điểm</span></div></div>${timeLocked?'<div class="notice bad" role="alert">Đã hết thời gian. Bài làm được khóa; đang xử lý nộp bài.</div>':''}${conflicted?'<div class="notice bad">Bài làm thay đổi ở phiên khác hoặc đang tạm khóa. Kiểm tra lại trạng thái phiên thi.</div>':''}<section class="question-sheet ${q.stimulus||q.stimulus_text||q.resource_url?'has-stimulus':''}">${stimulusMarkup(q)}<div class="response-panel"><h3 class="question-text" lang="${esc(questionLanguage(q))}" dir="${questionDirection(q)}">${esc(q.question)}</h3><div class="answer-instruction">${esc(typeLabel(q))}</div><div class="answer-area">${optionMarkup(q)}</div><button class="text-button clear-answer" id="clearAnswer" ${timeLocked||submitting||conflicted?'disabled':''}>Xóa câu trả lời của câu này</button></div></section><div class="question-actions"><button class="btn" id="previous" ${current===0?'disabled':''}>← Câu trước</button><button class="btn mark-button ${marked.has(current)?'selected':''}" id="mark">${marked.has(current)?'★ Đã đánh dấu':'☆ Đánh dấu xem lại'}</button><button class="btn primary" id="next">${current===exam.questions.length-1?'Tổng quan bài làm':'Câu tiếp theo →'}</button></div><div class="exam-note">${exam.strict_mode?'Kỳ thi có ghi nhận sự kiện rời trang và mất tiêu điểm theo quy chế.':'Kiểm tra trạng thái lưu bài trước khi nộp.'} Hệ thống không truy cập camera. Microphone chỉ được dùng nếu câu hỏi yêu cầu ghi âm và bạn chủ động bấm nút ghi âm.</div></main><aside class="question-nav" id="questionNav" aria-label="Bảng điều hướng câu hỏi"><button id="closeMap" class="nav-close" aria-label="Đóng bảng câu hỏi">×</button>${candidateMarkup()}<div class="nav-summary"><b>Tiến độ làm bài</b><strong id="progressText">${doneCount()}/${exam.questions.length}</strong></div><progress id="answerProgress" max="${exam.questions.length}" value="${doneCount()}" aria-label="Số câu hoàn tất"></progress><div class="map-heading"><b>BẢNG CÂU HỎI</b><button id="overview" class="text-button">Tổng quan</button></div><div class="map-filters" role="group" aria-label="Lọc câu hỏi"><button data-filter="all" class="${filter==='all'?'active':''}">Tất cả</button><button data-filter="unanswered" class="${filter==='unanswered'?'active':''}">Chưa xong</button><button data-filter="marked" class="${filter==='marked'?'active':''}">Đánh dấu</button></div><div class="question-map" id="questionMap">${mapMarkup()}</div><div class="legend"><span><i class="legend-box done"></i>Đã hoàn tất</span><span><i class="legend-box empty"></i>Chưa trả lời</span><span><i class="legend-box partial"></i>Chưa hoàn tất</span><span><i class="legend-box flagged"></i>Đánh dấu xem lại</span></div><button class="btn submit-button wide" id="submit" ${submitting||conflicted||finished?'disabled':''}>${submitting?'Đang nộp bài…':'Nộp bài'}</button><small class="nav-footnote">Chỉ kết thúc khi nhận được xác nhận nộp bài từ máy chủ.</small></aside></div><div class="map-shade" id="mapShade" hidden></div>`;
 bind();paintClock();paintSave();updateWordCount();if(conflicted)lockInputs();
}
function lockInputs(){document.querySelectorAll('.answer-area input,.answer-area select,.answer-area textarea,#clearAnswer').forEach(x=>x.disabled=true)}
function go(index){current=Math.min(Math.max(0,index),exam.questions.length-1);persist();render();document.querySelector('#questionStage')?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'})}
function changeAnswer(){if(timeLocked||submitting||conflicted)return;if(!renewLease()){conflicted=true;lockInputs();toast('Phiên này đang được mở tại tab khác.',true);return;}const q=exam.questions[current];if(q.type==='multi')answers[q.id]=[...document.querySelectorAll('[data-answer-input]:checked')].map(x=>x.value);else if(q.type==='mcq'||q.type==='truefalse')answers[q.id]=document.querySelector('[data-answer-input]:checked')?.value||'';else if(q.type==='ordering')answers[q.id]=[...document.querySelectorAll('[data-order]')].map(x=>x.value);else if(q.type==='matching')answers[q.id]=Object.fromEntries([...document.querySelectorAll('[data-match]')].map(x=>[x.dataset.match,x.value]));else answers[q.id]=document.querySelector('[data-written]').value;
 journal.edit();persist();refreshMap();paintSave();updateWordCount();clearTimeout(debounceTick);debounceTick=setTimeout(()=>save().catch(()=>{}),remaining!=null&&remaining<=15?150:650);
}
function refreshMap(){document.querySelector('#questionMap').innerHTML=mapMarkup();bindMap();const done=doneCount();document.querySelector('#progressText').textContent=`${done}/${exam.questions.length}`;document.querySelector('#answerProgress').value=done;const mobile=document.querySelector('.mobile-status span');if(mobile)mobile.textContent=`${done}/${exam.questions.length} hoàn tất`}
function updateWordCount(){const el=document.querySelector('#wordCount'),input=document.querySelector('[data-written]');if(el&&input)el.textContent=`${input.value.trim().split(/\s+/).filter(Boolean).length} từ · ${input.value.length} ký tự`}
function bindMap(){document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>go(Number(b.dataset.q)))}
function toggleMap(open){document.querySelector('#questionNav').classList.toggle('open',open);document.querySelector('#mapShade').hidden=!open;document.querySelector('#openMap').setAttribute('aria-expanded',String(open));if(open)document.querySelector('#closeMap').focus();else document.querySelector('#openMap').focus()}
function bind(){bindMap();document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));refreshMap()});document.querySelectorAll('[data-answer-input], [data-order], [data-match]').forEach(x=>x.onchange=changeAnswer);document.querySelector('[data-written]')?.addEventListener('input',changeAnswer);
 document.querySelectorAll('[data-insert-snippet]').forEach(btn=>{btn.onclick=()=>{const ta=document.querySelector('[data-written]');if(!ta||ta.disabled)return;const s=btn.dataset.insertSnippet||'';const st=ta.selectionStart??ta.value.length,en=ta.selectionEnd??ta.value.length;ta.value=ta.value.slice(0,st)+s+ta.value.slice(en);ta.focus();changeAnswer()}});
 document.querySelector('#toggleMathKeyboard')?.addEventListener('click',()=>{const p=document.querySelector('#virtualMathPad');if(p)p.hidden=!p.hidden});
 document.querySelectorAll('[data-math-ins]').forEach(btn=>{btn.onclick=()=>{const ta=document.querySelector('[data-written]');if(!ta||ta.disabled)return;const s=btn.dataset.mathIns||'';const st=ta.selectionStart??ta.value.length,en=ta.selectionEnd??ta.value.length;ta.value=ta.value.slice(0,st)+s+ta.value.slice(en);const prev=document.querySelector('#mathLivePreview');if(prev)prev.textContent='Xem trước công thức: '+ta.value.slice(Math.max(0,st-20),st+s.length+20);ta.focus();changeAnswer()}});
 document.querySelector('#toggleSciCalc')?.addEventListener('click',()=>{const p=document.querySelector('#sciCalcPanel');if(p)p.hidden=!p.hidden});
 document.querySelector('#runSciCalc')?.addEventListener('click',()=>{const inp=document.querySelector('#sciCalcInput'),out=document.querySelector('#sciCalcResult');if(!inp||!out)return;try{const raw=String(inp.value||'').trim().replace(/π/g,'Math.PI').replace(/√\(/g,'Math.sqrt(').replace(/\^/g,'**');const v=Function('"use strict";return ('+raw+')')();out.textContent=Number.isFinite(v)?'Kết quả = '+Number(v.toPrecision(12)):'Biểu thức không hợp lệ';log('calculator_used',{expr:String(inp.value||'').slice(0,60)})}catch{out.textContent='Biểu thức không hợp lệ'}});
 document.querySelector('#startRecording')?.addEventListener('click',startAudioRecording);
 document.querySelector('#stopRecording')?.addEventListener('click',()=>stopAudioRecording(false));
 document.querySelector('#previous').onclick=()=>go(current-1);document.querySelector('#next').onclick=()=>current===exam.questions.length-1?overview():go(current+1);document.querySelector('#mark').onclick=()=>{marked.has(current)?marked.delete(current):marked.add(current);persist();render()};document.querySelector('#clearAnswer').onclick=()=>{if(timeLocked||submitting||conflicted)return;delete answers[exam.questions[current].id];journal.edit();persist();render();save().catch(()=>{})};document.querySelector('#overview').onclick=overview;document.querySelector('#submit').onclick=()=>reviewSubmit();document.querySelector('#font').onclick=()=>{fontScale=(fontScale+1)%3;persist();render()};document.querySelector('#help').onclick=()=>modal('Hướng dẫn làm bài',`<div class="rules-content">${esc(exam.instructions||'Chọn câu trong bảng điều hướng. Có thể đánh dấu và quay lại sửa trước khi nộp.')}<p>Phím tắt: Alt + ← / → chuyển câu. Đồng hồ chạy theo máy chủ; tải lại không bắt đầu lại thời gian.</p></div>`,[{label:'Đã hiểu'}]);document.querySelector('#fullscreen').onclick=async()=>{try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else if(!exam.fullscreen_required)await document.exitFullscreen();else toast('Kỳ thi yêu cầu giữ toàn màn hình.',true)}catch{toast('Trình duyệt chưa bật được toàn màn hình.',true)}};document.querySelector('#openMap').onclick=()=>toggleMap(true);document.querySelector('#closeMap').onclick=()=>toggleMap(false);document.querySelector('#mapShade').onclick=()=>toggleMap(false);
}
async function uploadCurrentFile(ev){if(timeLocked||submitting||conflicted||recordingActive||recordingPending)return;const input=ev.currentTarget,file=input.files?.[0],q=exam.questions[current],state=input.closest('.file-response')?.querySelector('.upload-state');if(!file)return;input.disabled=true;await uploadQuestionFile(q,file,state);if(input.isConnected)input.disabled=false}
async function uploadQuestionFile(q,file,state){if(!file||!q)return;recordingPending=true;if(state)state.textContent='Đang tải tệp lên máy chủ…';const fd=new FormData();fd.set('file',file);fd.set('question_id',q.id);try{const r=await req(path('/upload'),{method:'POST',body:fd,timeout:70000});answers[q.id]=r.file;journal.edit();persist();render();await save();return true}catch(error){if(state)state.textContent=friendly(error);else toast(friendly(error),true);return false}finally{recordingPending=false}}
async function startAudioRecording(){if(timeLocked||submitting||conflicted||recordingActive||recordingPending)return;if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){toast('Trình duyệt này chưa hỗ trợ ghi âm trực tiếp. Bạn vẫn có thể tải lên tệp âm thanh.',true);return}const start=document.querySelector('#startRecording'),stop=document.querySelector('#stopRecording'),status=document.querySelector('#recordingStatus'),q=exam.questions[current];if(!q||q.type!=='audio')return;start.disabled=true;if(status)status.textContent='Đang yêu cầu quyền microphone…';try{recorderStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});recordingChunks=[];const preference=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];const mime=preference.find(type=>MediaRecorder.isTypeSupported?.(type));mediaRecorder=mime?new MediaRecorder(recorderStream,{mimeType:mime}):new MediaRecorder(recorderStream);const recorder=mediaRecorder,started=Date.now(),maxSeconds=Math.min(1800,Math.max(15,Number(q.recording_duration_seconds)||180));recordingActive=true;recorder.ondataavailable=event=>{if(event.data?.size)recordingChunks.push(event.data)};recorder.onerror=()=>{toast('Có lỗi khi ghi âm. Hãy thử lại hoặc tải lên tệp âm thanh.',true);discardRecording()};recorder.onstop=async()=>{clearTimeout(recordingStopTimer);clearInterval(recordingClockTimer);recordingActive=false;for(const track of recorderStream?.getTracks?.()||[])track.stop();recorderStream=null;const chunks=recordingChunks;recordingChunks=[];mediaRecorder=null;const blobType=recorder.mimeType||chunks[0]?.type||'audio/webm';const blob=new Blob(chunks,{type:blobType});if(!blob.size){if(status)status.textContent='Không có dữ liệu ghi âm. Hãy thử lại.';if(start?.isConnected)start.disabled=false;return}const extension=/ogg/i.test(blobType)?'ogg':/mp4/i.test(blobType)?'m4a':'webm';const file=new File([blob],`SkyFirst-ban-ghi-${String(q.id).replace(/[^a-zA-Z0-9_-]/g,'_')}.${extension}`,{type:blobType});if(status)status.textContent=`Đã ghi ${(Date.now()-started)/1000|0} giây · đang tải bản ghi…`;await uploadQuestionFile(q,file,status);};recorder.start(1000);if(stop){stop.hidden=false;stop.disabled=false}if(start)start.hidden=true;if(status)status.textContent=`Đang ghi âm · 00:${String(0).padStart(2,'0')} · tối đa ${Math.ceil(maxSeconds/60)} phút`;recordingClockTimer=setInterval(()=>{if(status){const sec=Math.floor((Date.now()-started)/1000);status.textContent=`Đang ghi âm · ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')} / ${String(Math.floor(maxSeconds/60)).padStart(2,'0')}:${String(maxSeconds%60).padStart(2,'0')}`}},1000);recordingStopTimer=setTimeout(()=>stopAudioRecording(true),maxSeconds*1000)}catch(error){discardRecording();if(start?.isConnected)start.disabled=false;if(status)status.textContent='Không thể bật microphone. Kiểm tra quyền của trình duyệt hoặc tải lên tệp âm thanh.';toast('Không thể bật microphone. Bạn vẫn có thể chọn tệp âm thanh.',true)}}
function stopAudioRecording(auto=false){if(!recordingActive||!mediaRecorder)return;const status=document.querySelector('#recordingStatus'),stop=document.querySelector('#stopRecording');if(stop)stop.disabled=true;if(status)status.textContent=auto?'Đã đến giới hạn thời lượng. Đang hoàn tất bản ghi…':'Đang hoàn tất bản ghi…';try{mediaRecorder.stop()}catch{discardRecording()}}
function discardRecording(){clearTimeout(recordingStopTimer);clearInterval(recordingClockTimer);recordingActive=false;recordingPending=false;try{if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.onstop=null;mediaRecorder.stop()}}catch{}mediaRecorder=null;for(const track of recorderStream?.getTracks?.()||[])track.stop();recorderStream=null;recordingChunks=[];const start=document.querySelector('#startRecording'),stop=document.querySelector('#stopRecording');if(start){start.hidden=false;start.disabled=false}if(stop){stop.hidden=true;stop.disabled=true}}
function overview(){const ss=statuses();modal('Tổng quan bài làm',`<div class="summary-grid"><div><b>${doneCount()}</b><span>Hoàn tất</span></div><div><b>${ss.filter(s=>s!=='done').length}</b><span>Chưa hoàn tất</span></div><div><b>${marked.size}</b><span>Đánh dấu</span></div></div><p>Chọn bộ lọc “Chưa xong” hoặc “Đánh dấu” trong bảng câu hỏi để kiểm tra các câu cần chú ý.</p>`,[{label:'Tiếp tục làm bài'},{label:'Kiểm tra trước khi nộp',primary:true,run:reviewSubmit}])}
function reviewSubmit(){if(recordingActive||recordingPending){toast('Hãy dừng ghi âm và chờ tải bản ghi xong trước khi nộp bài.',true);return}if(submitting||conflicted||finished)return;if(timeLocked)return submit(true);const missing=exam.questions.length-doneCount();modal('Xác nhận nộp bài',`<div class="summary-grid"><div><b>${doneCount()}</b><span>Hoàn tất</span></div><div><b>${missing}</b><span>Chưa hoàn tất</span></div><div><b>${marked.size}</b><span>Đánh dấu xem lại</span></div></div>${missing?'<p class="notice bad">Bạn vẫn còn câu chưa trả lời hoặc chưa hoàn tất.</p>':''}<p>Sau khi máy chủ xác nhận nộp bài, bạn không thể thay đổi câu trả lời.</p>`,[{label:'Quay lại kiểm tra'},{label:'Xác nhận nộp bài',primary:true,run:()=>submit(false)}])}
function paintSave(){const el=document.querySelector('#saveState');if(!el)return;el.textContent=saveError|| (savePromise?'Đang lưu…':journal.dirty?'Chưa lưu':lastSave||'Đã lưu ✓');el.classList.toggle('save-warning',!!saveError||journal.dirty)}
async function save(){if(finished||conflicted||!attempt||timeLocked)return;if(!renewLease()){conflicted=true;lockInputs();throw new Error('Phiên thi đã được mở tại tab khác.');}if(savePromise){await savePromise;if(journal.dirty&&!timeLocked)return save();return}if(!journal.dirty)return;
 const version=journal.version,payload={answers:copy(answers),events:copy(events),revision};persist();
 savePromise=(async()=>{try{const r=await req(path('/save'),{method:'POST',body:JSON.stringify(payload)});revision=Number(r.answer_revision??revision);journal.acknowledge(version);lastSave=`Đã lưu ✓ · ${new Date(timeMs(r.saved_at)||Date.now()).toLocaleTimeString('vi-VN')}`;saveError=storageRestricted()?'Đã lưu trực tuyến; lưu dự phòng bị hạn chế.':'';persist()}catch(error){saveError=error.network?'Mất kết nối · đang giữ bài trên thiết bị':friendly(error);if(error.code==='REVISION_CONFLICT'||error.code==='ATTEMPT_LOCKED'){conflicted=true;lockInputs();toast(saveError,true)}if(['expired','terminated','submitted'].includes(error.detail?.status))await handleEnded(error);throw error}finally{savePromise=null;paintSave()}})();paintSave();return savePromise;
}
async function submit(auto){if(recordingActive){if(auto)discardRecording();else{toast('Chưa thể nộp bài khi đang ghi âm. Hãy dừng và tải bản ghi trước.',true);return}}if(recordingPending){if(!auto){toast('Chưa thể nộp bài khi tệp đính kèm đang được tải lên.',true);return}const waitUntil=Date.now()+72000;while(recordingPending&&!finished&&Date.now()<waitUntil)await new Promise(resolve=>setTimeout(resolve,100));if(finished)return;if(recordingPending){toast('Máy chủ vẫn đang xử lý tệp. Bài làm trên thiết bị được giữ; hãy kiểm tra trạng thái kết nối.',true);return}}if(finished||submitting||conflicted)return;submitting=true;submitRetry=false;clearTimeout(retryTick);document.querySelector('.modal-backdrop')?.remove();app.inert=false;lockInputs();const button=document.querySelector('#submit');if(button){button.disabled=true;button.textContent='Đang nộp bài…'}persist();
 try{await violationQueue;if(finished)return;if(!timeLocked)await save();else if(savePromise){try{await savePromise}catch{}}
 if(conflicted)throw new Error('Không thể nộp khi có xung đột phiên.');const r=await req(path('/submit'),{method:'POST',body:JSON.stringify({revision})});finished=true;armed=false;cleanup();clearLocal(attempt);releaseLease();clearSession();try{if(document.fullscreenElement)await document.exitFullscreen()}catch{}completion(r,auto);
 }catch(error){submitting=false;if(error.detail?.status&&['submitted','expired','terminated'].includes(error.detail.status))return handleEnded(error);submitRetry=!!error.network;if(armed){render();toast(`Chưa nhận được xác nhận nộp bài. ${friendly(error)}`,true)}else{gate('Chưa thể nộp bài',`<p class="lead">${esc(friendly(error))}</p><button class="btn primary wide" id="retrySubmit">Thử nộp lại</button>`);document.querySelector('#retrySubmit').onclick=()=>submit(true)}if(timeLocked)lockInputs();if(submitRetry)retryTick=setTimeout(()=>submit(auto),5000)}
}
function completion(r,auto){gate('Bài làm đã được ghi nhận',`<div class="success-mark" aria-hidden="true">✓</div><p class="lead">${auto?'Hệ thống đã nộp bài sau khi hết thời gian.':'Máy chủ đã xác nhận nộp bài thành công.'}</p><dl class="receipt"><div><dt>Kỳ thi</dt><dd>${esc(exam.title)}</dd></div>${candidate.full_name?`<div><dt>Thí sinh</dt><dd>${esc(candidate.full_name)}</dd></div>`:''}<div><dt>Mã phiên</dt><dd>${esc(attempt)}</dd></div><div><dt>Thời điểm xác nhận trên thiết bị</dt><dd>${esc(new Date().toLocaleString('vi-VN'))}</dd></div>${r.receipt_code?`<div><dt>Mã biên nhận</dt><dd>${esc(r.receipt_code)}</dd></div>`:''}${r.score!=null&&r.show_score!==false?`<div><dt>Kết quả</dt><dd>${esc(r.score)} / ${esc(r.max_score)}</dd></div>`:''}<div><dt>Trạng thái</dt><dd>${r.pending_manual?'Đã nộp · chờ chấm tự luận':'Đã nộp thành công'}</dd></div></dl><div class="actions"><button class="btn primary" id="downloadReceipt">Tải biên nhận</button>${r.review_available?'<button class="btn" id="review">Xem bài làm</button>':''}<a class="btn" href="/tra-cuu-ket-qua">Tra cứu kết quả</a><a class="btn" href="/">Trang chủ</a></div>`,{ey:UNIT_NAME});
 document.querySelector('#downloadReceipt').onclick=()=>{const data={unit:UNIT_NAME,service:SYSTEM_NAME,exam_title:exam.title,candidate,attempt_id:attempt,receipt_code:r.receipt_code||null,status:'submitted',confirmation_time_on_device:new Date().toISOString(),score:r.show_score===false?null:r.score??null,max_score:r.show_score===false?null:r.max_score??null,pending_manual:r.pending_manual||0};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`SkyFirst-BienNhan-${r.receipt_code||attempt.slice(0,8)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};document.querySelector('#review')?.addEventListener('click',reviewGuest);
}
async function reviewGuest(){try{const r=await req(path('/review'));gate(r.title||'Xem lại bài làm',`<div class="review-list">${(r.questions||[]).map((q,i)=>`<article class="review-question"><small>CÂU ${i+1}</small><h3>${esc(q.question)}</h3><p><b>Bài làm:</b> ${esc(typeof q.user_answer==='object'?JSON.stringify(q.user_answer):q.user_answer??'Chưa trả lời')}</p><p><b>Đáp án:</b> ${esc(typeof q.answer==='object'?JSON.stringify(q.answer):q.answer??'—')}</p>${q.explanation?`<p><b>Giải thích:</b> ${esc(q.explanation)}</p>`:''}${q.manual_grade?.feedback?`<p><b>Nhận xét:</b> ${esc(q.manual_grade.feedback)}</p>`:''}</article>`).join('')}</div><a class="btn" href="/">Kết thúc</a>`,{wide:true})}catch(error){toast(friendly(error),true)}}
async function handleEnded(error){finished=true;armed=false;cleanup();releaseLease();clearSession();const status=error.detail?.status;if(status==='submitted'&&error.detail?.show_score!==undefined)return completion(error.detail,false);showScreen(status==='submitted'?'Phiên thi đã được nộp':status==='terminated'?'Phiên thi đã kết thúc theo quy chế':'Thời gian dự thi đã kết thúc',status==='submitted'?'Máy chủ xác nhận phiên này đã nộp bài. Bạn có thể tra cứu kết quả bằng mã biên nhận tại trang Tra cứu kết quả (/tra-cuu-ket-qua).':'Bản dự phòng trên thiết bị được giữ. Liên hệ đơn vị tổ chức để đối chiếu trạng thái bài làm.');}
async function handleError(error,title){if(['submitted','expired','terminated'].includes(error.detail?.status))return handleEnded(error);if(error.status===423||error.code==='ATTEMPT_LOCKED'){releaseLease();return showScreen('Phiên thi đang bị tạm khóa theo quy chế',friendly(error),{retry:true})}if(error.status===401||error.status===403)clearSession();releaseLease();showScreen(title,friendly(error),{retry:!!error.network})}
async function heartbeat(){if(heartbeatBusy||!armed||finished||submitting||conflicted||timeLocked||(remaining!=null&&remaining<=30))return;heartbeatBusy=true;try{const r=await req(path());syncTiming(r);document.querySelector('#networkState').textContent='Kết nối trực tuyến';document.querySelector('#connectionDot').classList.remove('offline');if(Number(r.answer_revision||0)>revision&&!savePromise){conflicted=true;lockInputs();saveError='Bài làm đã thay đổi ở phiên khác.';paintSave();toast(saveError,true)}}catch(error){if(['submitted','expired','terminated'].includes(error.detail?.status))await handleEnded(error);else if(error.status===423||error.code==='ATTEMPT_LOCKED'){conflicted=true;lockInputs();saveError=friendly(error);paintSave();toast(saveError,true)}else{const n=document.querySelector('#networkState');if(n)n.textContent='Kết nối không ổn định';document.querySelector('#connectionDot')?.classList.add('offline')}}finally{heartbeatBusy=false}}
let violationQueue=Promise.resolve();
function violation(reason){if(!armed||finished||submitting||!exam?.strict_mode||timeLocked)return;log(reason);violationQueue=violationQueue.then(async()=>{if(finished||submitting||conflicted)return;try{await save();if(finished||submitting)return;const r=await req(path('/violation'),{method:'POST',body:JSON.stringify({reason,events:copy(events),revision}),keepalive:true});if(r.locked){conflicted=true;lockInputs();saveError='Phiên thi đã bị khóa do vi phạm quy chế giám sát.';paintSave();toast(saveError,true)}if(r.terminated)await handleEnded({detail:{status:'terminated'}})}catch(error){persist();if(error.detail?.status)await handleEnded(error)}})}
function cleanup(){[clockTick,saveTick,heartbeatTick,leaseTick].forEach(clearInterval);clearTimeout(debounceTick);clearTimeout(retryTick);clockTick=saveTick=heartbeatTick=leaseTick=null;discardRecording()}
window.addEventListener('online',()=>{if(finished||conflicted)return;toast('Đã kết nối lại. Đang lưu lại bài làm.');if(submitRetry||timeLocked)submit(timeLocked);else save().catch(()=>{})});window.addEventListener('offline',()=>{const n=document.querySelector('#networkState');if(n)n.textContent='Ngoại tuyến';document.querySelector('#connectionDot')?.classList.add('offline');saveError=storageRestricted()?'Mất mạng; không có lưu dự phòng. Giữ trang mở.':'Mất mạng · bài đang được giữ trên thiết bị';persist();paintSave()});
let awayStartMs=0,fsExitCount=0;
document.addEventListener('visibilitychange',()=>{if(document.hidden){awayStartMs=Date.now();persist();violation('visibility_hidden')}else if(armed){const awayMs=awayStartMs?Math.max(0,Date.now()-awayStartMs):0;awayStartMs=0;if(awayMs>0)log('visibility_restored',{away_ms:awayMs});renewLease();paintClock();heartbeat()}});
window.addEventListener('blur',()=>{if(typeof isBenignMobileViewportChange==='function'&&isBenignMobileViewportChange())return;awayStartMs=awayStartMs||Date.now();violation('window_blur')});
window.addEventListener('focus',()=>{if(armed&&awayStartMs){const awayMs=Math.max(0,Date.now()-awayStartMs);awayStartMs=0;log('window_focus',{away_ms:awayMs})}});
document.addEventListener('fullscreenchange',()=>{if(armed&&(exam?.fullscreen_required||exam?.security_config?.require_fullscreen)&&!document.fullscreenElement){fsExitCount++;violation('fullscreen_exit');const warnMsg=typeof FULLSCREEN_FIRST_WARNING_MESSAGE==='string'?FULLSCREEN_FIRST_WARNING_MESSAGE:'Bạn đã rời khỏi chế độ toàn màn hình. Vui lòng quay lại chế độ thi để tiếp tục làm bài. Hoạt động này đã được ghi nhận trong nhật ký kỳ thi.';toast(warnMsg,true)}});
document.addEventListener('cut',e=>{if(armed&&!finished&&exam&&(!exam.allow_clipboard||exam.security_config?.block_copy)){e.preventDefault();violation('cut_blocked');toast('Thao tác cắt nội dung bị hạn chế theo quy chế kỳ thi.',true)}});
document.addEventListener('dragstart',e=>{if(armed&&!finished&&exam&&(!exam.allow_clipboard||exam.security_config?.block_copy)&&e.target?.closest?.('.question-sheet')){e.preventDefault();violation('drag_blocked')}});
document.addEventListener('contextmenu',e=>{if(armed&&!finished&&exam&&exam.strict_mode&&e.target?.closest?.('.question-sheet')){e.preventDefault();violation('contextmenu_blocked')}});
document.addEventListener('copy',e=>{if(armed&&!finished&&exam&&!exam.allow_clipboard){e.preventDefault();violation('copy_blocked');toast('Sao chép bị hạn chế theo quy chế kỳ thi.',true)}});document.addEventListener('paste',e=>{if(armed&&!finished&&exam&&!exam.allow_paste){e.preventDefault();violation('paste_blocked');toast('Dán nội dung bị hạn chế theo quy chế kỳ thi.',true)}});
window.addEventListener('beforeunload',e=>{if(armed&&!finished){persist();e.preventDefault();e.returnValue=''}});window.addEventListener('pagehide',()=>{persist();releaseLease()});window.addEventListener('pageshow',e=>{if(e.persisted&&armed&&!acquireLease(attempt)){conflicted=true;lockInputs();toast('Phiên đã được mở ở tab khác.',true)}});
document.querySelector('.skip-link')?.addEventListener('click',e=>{e.preventDefault();document.querySelector('#questionStage')?.focus();document.querySelector('#questionStage')?.scrollIntoView({block:'start'})});
window.addEventListener('keydown',e=>{if(!armed||finished)return;if(e.key==='Escape'&&document.querySelector('#questionNav.open'))toggleMap(false);if(e.key==='Tab'&&document.querySelector('#questionNav.open')){const items=[...document.querySelectorAll('#questionNav button:not(:disabled)')];const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}if(e.altKey&&!document.querySelector('.modal-backdrop')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();go(current+(e.key==='ArrowRight'?1:-1))}});
boot();
