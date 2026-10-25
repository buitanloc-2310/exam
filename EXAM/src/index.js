const SECURITY = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob: https://slc.skyfirst.io.vn; media-src 'self' blob: https://slc.skyfirst.io.vn; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(self), display-capture=(), geolocation=(), payment=(), usb=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};
const JSON_HEADERS={...SECURITY,'content-type':'application/json; charset=utf-8'};
const CONTROL_ORIGIN='https://slc.skyfirst.io.vn';
const MANUAL_TYPES=new Set(['essay','long','structured','file','image','audio','math']);
const ATTACHMENT_TYPES=new Set(['file','image','audio']);
const MAX_JSON_BODY_BYTES=2_500_000;
const MAX_ANSWER_BYTES=2_000_000;
const str=v=>String(v??'').trim();
const safeJson=(v,f)=>{try{return JSON.parse(v)}catch{return f}};
const nowIso=()=>new Date().toISOString();
const json=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...JSON_HEADERS,...extra}});
const ok=(body={})=>json({ok:true,...body});
const bad=(message,status=400,detail)=>json({ok:false,message,detail},status);
function httpError(message,status,detail){return Object.assign(new Error(message),{status,detail})}
async function readJsonBody(request,maxBytes=MAX_JSON_BODY_BYTES){
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes)throw httpError('Dữ liệu gửi lên vượt giới hạn an toàn.',413);
  if(!request.body)return {};
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel().catch(()=>{});throw httpError('Dữ liệu gửi lên vượt giới hạn an toàn.',413)}chunks.push(value)}
  }catch(error){if(error?.status)throw error;throw httpError('Không thể đọc dữ liệu yêu cầu.',400)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw httpError('Nội dung JSON không hợp lệ.',400)}
}
function cleanEvents(raw,fallback=[]){
  const list=Array.isArray(raw)?raw:(Array.isArray(fallback)?fallback:[]);
  return list.slice(-400).flatMap(event=>{
    if(!event||typeof event!=='object'||Array.isArray(event))return [];
    const type=str(event.type).slice(0,80);if(!type||type==='ui_state')return [];
    const timestamp=Date.parse(str(event.at));const clean={type,at:Number.isFinite(timestamp)?new Date(timestamp).toISOString():nowIso()};
    if(typeof event.fullscreen==='boolean')clean.fullscreen=event.fullscreen;
    return [clean];
  });
}
function sanitizeAnswers(raw,questions=[]){
  if(raw==null)raw={};
  if(typeof raw!=='object'||Array.isArray(raw))throw httpError('Cấu trúc bài làm không hợp lệ.',400);
  const byId=new Map(questions.map(q=>[String(q.id),q])),clean={};
  for(const [id,value] of Object.entries(raw)){
    const q=byId.get(id);if(!q||value===undefined)continue;
    if(value===null||value===''){clean[id]=value;continue}
    const type=str(q.type);
    if(ATTACHMENT_TYPES.has(type)){
      if(!value||typeof value!=='object'||Array.isArray(value))throw httpError('Dữ liệu tệp trả lời không hợp lệ.',400);
      const fileId=str(value.file_id);if(!fileId||fileId.length>200)throw httpError('Mã tệp trả lời không hợp lệ.',400);
      clean[id]={file_id:fileId,name:str(value.name).slice(0,180),mime:str(value.mime).slice(0,120),size:Number.isFinite(Number(value.size))?Math.max(0,Number(value.size)):0};
    }else if(type==='multi'||type==='ordering'){
      if(!Array.isArray(value)||value.length>200)throw httpError('Danh sách lựa chọn không hợp lệ.',400);
      clean[id]=value.map(item=>{if(!['string','number','boolean'].includes(typeof item))throw httpError('Lựa chọn không hợp lệ.',400);const v=String(item);if(v.length>2000)throw httpError('Lựa chọn vượt giới hạn.',413);return v});
    }else if(type==='matching'){
      if(typeof value!=='object'||Array.isArray(value))throw httpError('Cặp ghép không hợp lệ.',400);
      const sourceOptions=Array.isArray(q.options)?q.options:safeJson(q.options,[]),allowed=new Set((Array.isArray(sourceOptions)?sourceOptions:[]).map(item=>String(item).split('|||')[0]));
      const entries=Object.entries(value);if(entries.length>200)throw httpError('Số cặp ghép vượt giới hạn.',413);
      const matches={};for(const [key,item] of entries){if(!allowed.has(key))continue;if(!['string','number','boolean'].includes(typeof item))throw httpError('Lựa chọn ghép không hợp lệ.',400);const v=String(item);if(v.length>2000)throw httpError('Lựa chọn ghép vượt giới hạn.',413);matches[key]=v}clean[id]=matches;
    }else if(typeof value==='string'){
      if(value.length>500_000)throw httpError('Câu trả lời vượt giới hạn an toàn.',413);clean[id]=value;
    }else if(typeof value==='number'){
      if(!Number.isFinite(value))throw httpError('Giá trị câu trả lời không hợp lệ.',400);clean[id]=value;
    }else if(typeof value==='boolean')clean[id]=value;
    else throw httpError('Kiểu dữ liệu câu trả lời không hợp lệ.',400);
  }
  return clean;
}
function withSecurity(response){if(!response||response.status===101)return response;const h=new Headers(response.headers);for(const [k,v] of Object.entries(SECURITY))h.set(k,v);return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h})}
function databaseTimeMs(value){const raw=str(value);if(!raw)return NaN;const utc=/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)?raw.replace(' ','T')+'Z':raw;return Date.parse(utc)}
function examTimeMs(value){const raw=str(value);if(!raw)return null;const explicit=/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);const ms=Date.parse(explicit?raw:raw.replace(' ','T')+'+07:00');return Number.isFinite(ms)?ms:null}
function bearerToken(request){const m=str(request.headers.get('authorization')).match(/^Bearer\s+([A-Za-z0-9._~-]{16,512})$/i);return m?m[1]:''}
async function sha256Text(value){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function publicQuestions(raw='[]'){
  const qs=Array.isArray(raw)?raw:safeJson(raw,[]);
  if(!Array.isArray(qs))return [];
  return qs.filter(q=>q&&typeof q==='object'&&!Array.isArray(q)).map(q=>{
    const clean={id:str(q.id),type:str(q.type),question:String(q.question??''),points:Number.isFinite(Number(q.points??1))?Math.max(0,Number(q.points??1)):1};
    const options=Array.isArray(q.options)?q.options:(typeof q.options==='string'?safeJson(q.options,[]):[]);
    clean.options=Array.isArray(options)?options.map(x=>String(x??'')):[];
    for(const key of ['content_language','prompt_language','language_code','script_direction','stimulus_text','resource_url','resource_title'])if(typeof q[key]==='string')clean[key]=q[key].slice(0,20_000);
    if(typeof q.stimulus==='string')clean.stimulus=q.stimulus.slice(0,100_000);
    else if(q.stimulus&&typeof q.stimulus==='object'&&!Array.isArray(q.stimulus)){
      const st={};for(const key of ['type','title','text','url'])if(typeof q.stimulus[key]==='string')st[key]=q.stimulus[key].slice(0,100_000);clean.stimulus=st;
    }
    for(const key of ['numeric_tolerance','tolerance','recording_duration_seconds'])if(q[key]!=null&&Number.isFinite(Number(q[key])))clean[key]=Number(q[key]);
    return clean;
  });
}
function assessmentScoreVisible(exam={},now=Date.now()){if(Number(exam.show_score)===0)return false;const release=examTimeMs(exam.result_release_at);if(release&&now<release)return false;const policy=str(exam.result_policy||'score_after_submit');if(policy==='score_after_submit'||policy==='score_total_only')return true;if(policy==='full_review_after_close'){const close=examTimeMs(exam.closes_at);return exam.exam_status==='closed'||exam.status==='closed'||!!(close&&now>=close)}return false}
function normalizeValue(v){return str(v).replace(/\s+/g,' ').toLocaleLowerCase('vi-VN')}
function answerEqual(q,actual){const type=str(q?.type),expected=q?.answer;
  if(type==='mcq'||type==='truefalse')return String(actual??'')===String(expected??'');
  if(type==='fill'||type==='short'){let accepted=[];try{const x=typeof expected==='string'?JSON.parse(expected):expected;accepted=Array.isArray(x)?x:[x]}catch{accepted=String(expected??'').split('|')}return accepted.some(x=>normalizeValue(x)===normalizeValue(actual))}
  if(type==='numeric'){const a=Number(actual),e=Number(expected),tol=Math.max(0,Number(q.numeric_tolerance??q.tolerance??0));return Number.isFinite(a)&&Number.isFinite(e)&&Math.abs(a-e)<=tol}
  if(type==='multi'||type==='ordering'){let ex=[];try{ex=Array.isArray(expected)?expected:JSON.parse(expected||'[]')}catch{}const ac=Array.isArray(actual)?actual:[];return type==='multi'?JSON.stringify(ac.map(String).sort())===JSON.stringify(ex.map(String).sort()):JSON.stringify(ac.map(String))===JSON.stringify(ex.map(String))}
  if(type==='matching'){let ex={};try{ex=expected&&typeof expected==='object'?expected:JSON.parse(expected||'{}')}catch{}const ac=actual&&typeof actual==='object'&&!Array.isArray(actual)?actual:{};const keys=Object.keys(ex);return keys.length>0&&keys.every(k=>String(ac[k]??'')===String(ex[k]??''))}
  return false
}
function autoScore(qs=[],answers={}){let score=0,max=0,manual=[];for(const q of qs){const rawPoints=Number(q.points??1),pts=Number.isFinite(rawPoints)?Math.max(0,rawPoints):1;max+=pts;if(MANUAL_TYPES.has(str(q.type))){manual.push(q);continue}if(answerEqual(q,answers[q.id]))score+=pts}return {score,max,manual}}
async function seedManual(env,attemptId,questions=[]){for(const q of questions.filter(x=>MANUAL_TYPES.has(str(x.type))))await env.DB.prepare(`INSERT OR IGNORE INTO assessment_manual_grades(id,attempt_id,question_id,grader_user_id,score,feedback,status,created_at,updated_at) VALUES(?,?,?,'system',NULL,'','draft',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(crypto.randomUUID(),attemptId,str(q.id)).run()}
function attemptDeadline(a){return Number(a.time_limit_enabled)===0?null:databaseTimeMs(a.started_at)+(Number(a.duration_minutes||60)+Number(a.extra_time_minutes||0))*60000}
function candidateFrom(a,source){return source==='guest'?{full_name:a.full_name||'',candidate_code:a.candidate_code||'',class_name:a.class_name||''}:{full_name:a.full_name||'',candidate_code:a.sfn_id||'',class_name:a.class_name||''}}
function sessionId(request){const id=str(request.headers.get('x-exam-session'));return /^[A-Za-z0-9._~-]{16,160}$/.test(id)?id:''}
function applySealedPackage(row){if(!row)return row;const pack=safeJson(row.package_json,null);if(!pack||typeof pack!=='object')return row;const timing=pack.timing&&typeof pack.timing==='object'?pack.timing:{},pol=pack.policies&&typeof pack.policies==='object'?pack.policies:{};const bit=(v,f)=>v===undefined?f:(v?1:0);return {...row,duration_minutes:timing.duration_minutes??row.duration_minutes,time_limit_enabled:bit(timing.time_limit_enabled,row.time_limit_enabled),strict_mode:bit(pol.strict_mode,row.strict_mode),fullscreen_required:bit(pol.fullscreen_required,row.fullscreen_required),allow_clipboard:bit(pol.allow_clipboard,row.allow_clipboard),allow_paste:bit(pol.allow_paste,row.allow_paste),allow_external_links:bit(pol.allow_external_links,row.allow_external_links),security_profile:pol.security_profile||row.security_profile,device_policy:pol.device_policy||row.device_policy,resume_policy:pol.resume_policy||row.resume_policy,calculator_policy:pol.calculator_policy||row.calculator_policy}}
async function claimLease(env,source,attemptId,request){const sid=sessionId(request);if(!sid)throw Object.assign(new Error('SESSION_REQUIRED'),{status:409,detail:{code:'SESSION_REQUIRED'}});await env.DB.prepare(`INSERT OR IGNORE INTO assessment_attempt_leases(attempt_id,source,session_id,claimed_at,last_seen_at) VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(attemptId,source,sid).run();const lease=await env.DB.prepare(`SELECT session_id FROM assessment_attempt_leases WHERE attempt_id=? AND source=?`).bind(attemptId,source).first();if(!lease||lease.session_id!==sid)throw Object.assign(new Error('SESSION_CONFLICT'),{status:409,detail:{code:'SESSION_CONFLICT'}});await env.DB.prepare(`UPDATE assessment_attempt_leases SET last_seen_at=CURRENT_TIMESTAMP WHERE attempt_id=? AND source=? AND session_id=?`).bind(attemptId,source,sid).run();return sid}
async function authorize(env,source,attemptId,request){const raw=bearerToken(request);if(!raw)throw Object.assign(new Error('AUTH'),{status:401});if(source==='guest'){const row=await env.DB.prepare(`SELECT a.*,e.title,e.instructions,e.duration_minutes,e.time_limit_enabled,e.strict_mode,e.fullscreen_required,e.show_score,e.assessment_type,e.assessment_label,e.center_label,e.result_policy,e.result_release_at,e.closes_at,e.status exam_status,e.security_profile,e.allow_clipboard,e.allow_paste,e.allow_external_links,e.device_policy,e.resume_policy,e.calculator_policy,v.snapshot_json package_json,COALESCE(a.question_snapshot_json,e.question_json) question_json FROM exam_guest_attempts a JOIN exams e ON e.id=a.exam_id LEFT JOIN assessment_exam_versions v ON v.id=COALESCE(a.exam_version_id,e.sealed_version_id) WHERE a.id=? AND a.access_key=?`).bind(attemptId,raw).first();if(!row)throw Object.assign(new Error('AUTH'),{status:401});return applySealedPackage(row)}
  const hash=await sha256Text(raw);const row=await env.DB.prepare(`SELECT a.*,e.title,e.instructions,e.duration_minutes,e.time_limit_enabled,e.strict_mode,e.fullscreen_required,e.show_score,e.assessment_type,e.assessment_label,e.center_label,e.result_policy,e.result_release_at,e.closes_at,e.status exam_status,e.security_profile,e.allow_clipboard,e.allow_paste,e.allow_external_links,e.device_policy,e.resume_policy,e.calculator_policy,v.snapshot_json package_json,COALESCE(a.question_snapshot_json,e.question_json) question_json,u.full_name,u.sfn_id,u.email,c.name class_name FROM exam_access_tokens t JOIN exam_attempts a ON a.id=t.attempt_id AND a.user_id=t.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN assessment_exam_versions v ON v.id=COALESCE(a.exam_version_id,e.sealed_version_id) JOIN users u ON u.id=a.user_id LEFT JOIN classes c ON c.id=e.class_id WHERE t.token_hash=? AND t.attempt_id=? AND datetime(t.expires_at)>CURRENT_TIMESTAMP AND u.status='active'`).bind(hash,attemptId).first();if(!row)throw Object.assign(new Error('AUTH'),{status:401});return applySealedPackage(row)}
async function receiptFor(env,a){let r=await env.DB.prepare(`SELECT receipt_code FROM assessment_receipts WHERE attempt_id=? ORDER BY created_at DESC LIMIT 1`).bind(a.id).first();if(r?.receipt_code)return r.receipt_code;const code=`SLC-${String(a.id).slice(0,8).toUpperCase()}`;await env.DB.prepare(`INSERT OR IGNORE INTO assessment_receipts(id,attempt_id,receipt_code,payload_json,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)`).bind(crypto.randomUUID(),a.id,code,JSON.stringify({attempt_id:a.id,exam_id:a.exam_id,status:'submitted'})).run();r=await env.DB.prepare(`SELECT receipt_code FROM assessment_receipts WHERE attempt_id=? ORDER BY created_at DESC LIMIT 1`).bind(a.id).first();if(!r?.receipt_code)throw httpError('Chưa thể xác nhận biên nhận nộp bài. Vui lòng kiểm tra lại trạng thái phiên thi.',503,{code:'RECEIPT_NOT_PERSISTED'});return r.receipt_code}
async function finalResponse(env,a){
  const questions=safeJson(a.question_json??a.question_snapshot_json??'[]',[]),manual=Array.isArray(questions)?questions.filter(q=>MANUAL_TYPES.has(str(q.type))):[];
  let pending=0;
  if(manual.length){
    try{
      await seedManual(env,a.id,manual);
      const result=await env.DB.prepare(`SELECT question_id,status FROM assessment_manual_grades WHERE attempt_id=?`).bind(a.id).all();
      const rows=result?.results||[];
      pending=manual.filter(q=>!rows.some(r=>String(r.question_id)===String(q.id)&&r.status==='published')).length;
    }catch{pending=manual.length}
  }
  const visible=assessmentScoreVisible(a)&&pending===0;
  return {submitted:true,status:'submitted',score:visible?a.score:null,max_score:visible?a.max_score:null,show_score:visible,pending_manual:pending,receipt_code:await receiptFor(env,a)}
}
async function validateAttachmentAnswers(env,attemptId,qs,answers){for(const q of qs){if(!ATTACHMENT_TYPES.has(str(q.type)))continue;const v=answers?.[q.id];if(v==null||v==='')continue;const fileId=str(v?.file_id);if(!fileId)throw Object.assign(new Error('Tệp trả lời không hợp lệ.'),{status:400});const row=await env.DB.prepare(`SELECT 1 ok FROM assessment_response_files WHERE attempt_id=? AND question_id=? AND file_id=? AND status='active'`).bind(attemptId,str(q.id),fileId).first();if(!row)throw Object.assign(new Error('Tệp trả lời không thuộc câu hỏi này.'),{status:403})}}
async function finalize(env,source,a,body,afterDeadline=false,retries=0){
  if(a.status==='submitted')return finalResponse(env,a);
  if(a.status!=='in_progress')throw Object.assign(new Error('Phiên thi không còn hoạt động.'),{status:409,detail:{status:a.status}});
  const qs=safeJson(a.question_json,[]);
  // Submission is based only on the latest answer snapshot accepted by the server.
  // The client must save before submitting; its request body is never treated as authoritative.
  const answers=safeJson(a.answers_json,{}),events=cleanEvents(safeJson(a.event_log_json,[]));
  await validateAttachmentAnswers(env,a.id,qs,answers);
  const scored=autoScore(qs,answers),table=source==='guest'?'exam_guest_attempts':'exam_attempts',expectedRevision=Number(a.answer_revision||0);
  const submittedAudit=JSON.stringify({source,after_deadline:afterDeadline,answer_revision:expectedRevision});
  const change=await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET answers_json=?,event_log_json=?,score=?,max_score=?,status='submitted',submitted_at=COALESCE(submitted_at,CURRENT_TIMESTAMP),last_saved_at=COALESCE(last_saved_at,CURRENT_TIMESTAMP) WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?`).bind(JSON.stringify(answers),JSON.stringify(events),scored.score,scored.max,a.id,expectedRevision),
    env.DB.prepare(`INSERT INTO exam_audit_log(id,exam_id,attempt_id,actor_user_id,event_type,detail_json) SELECT ?,?,?,?,'attempt.submitted',? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='submitted') AND NOT EXISTS(SELECT 1 FROM exam_audit_log WHERE attempt_id=? AND event_type='attempt.submitted')`).bind(crypto.randomUUID(),a.exam_id,a.id,source==='guest'?null:a.user_id,submittedAudit,a.id,a.id),
    env.DB.prepare(`INSERT INTO assessment_result_workflows(attempt_id,source,state,updated_at) SELECT ?,?,?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='submitted') ON CONFLICT(attempt_id) DO UPDATE SET source=excluded.source,state=excluded.state,updated_at=CURRENT_TIMESTAMP`).bind(a.id,source,scored.manual.length?'marking':'graded',a.id)
  ]);
  if(!Number(change?.[0]?.meta?.changes||0)){
    const current=await env.DB.prepare(`SELECT a.*,COALESCE(a.question_snapshot_json,e.question_json) question_json,e.show_score,e.result_policy,e.result_release_at,e.closes_at,e.status exam_status FROM ${table} a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`).bind(a.id).first();
    if(current?.status==='submitted')return finalResponse(env,current);
    const currentRevision=Number(current?.answer_revision||0);
    if(afterDeadline&&current?.status==='in_progress'&&currentRevision!==expectedRevision&&retries<3)return finalize(env,source,current,{},true,retries+1);
    throw Object.assign(new Error('Phiên thi vừa thay đổi. Vui lòng đồng bộ bài làm rồi thử lại.'),{status:409,detail:{code:'REVISION_CONFLICT',status:current?.status||'unknown',answer_revision:currentRevision}});
  }
  await seedManual(env,a.id,scored.manual);
  const fresh={...a,status:'submitted',answers_json:JSON.stringify(answers),event_log_json:JSON.stringify(events),score:scored.score,max_score:scored.max};
  return finalResponse(env,fresh)
}
async function getAttempt(env,source,attemptId,request){const a=await authorize(env,source,attemptId,request);await claimLease(env,source,attemptId,request);if(a.status==='submitted')throw Object.assign(new Error('Phiên thi đã được nộp.'),{status:409,detail:{...(await finalResponse(env,a)),status:'submitted'}});if(a.status!=='in_progress')throw Object.assign(new Error('Phiên thi đã kết thúc.'),{status:409,detail:{status:a.status}});const deadline=attemptDeadline(a);if(deadline&&Date.now()>=deadline){const result=await finalize(env,source,a,{},true);throw Object.assign(new Error('Đã hết thời gian. Bài làm đã được khóa và nộp.'),{status:409,detail:result})}return ok({attempt_id:a.id,exam:{id:a.exam_id,title:a.title,instructions:a.instructions,duration_minutes:a.duration_minutes,time_limit_enabled:Number(a.time_limit_enabled)!==0,strict_mode:Number(a.strict_mode)!==0,fullscreen_required:Number(a.fullscreen_required)!==0,show_score:Number(a.show_score)!==0,assessment_type:a.assessment_type,assessment_label:a.assessment_label,center_label:a.center_label,security_profile:a.security_profile||'STANDARD',allow_clipboard:Number(a.allow_clipboard)!==0,allow_paste:Number(a.allow_paste)!==0,allow_external_links:Number(a.allow_external_links)!==0,device_policy:a.device_policy||'single_session',resume_policy:a.resume_policy||'same_session',calculator_policy:a.calculator_policy||'disabled',questions:publicQuestions(a.question_json)},candidate:candidateFrom(a,source),answers:safeJson(a.answers_json,{}),events:safeJson(a.event_log_json,[]),remaining_seconds:deadline?Math.max(0,Math.ceil((deadline-Date.now())/1000)):null,answer_revision:Number(a.answer_revision||0),last_saved_at:a.last_saved_at||null,server_time:nowIso(),deadline_at:deadline?new Date(deadline).toISOString():null})}
async function saveAttempt(env,source,attemptId,request){
  const a=await authorize(env,source,attemptId,request);await claimLease(env,source,attemptId,request);
  if(a.status==='submitted')throw Object.assign(new Error('Bài làm đã được nộp.'),{status:409,detail:{...(await finalResponse(env,a)),status:'submitted'}});
  if(a.status!=='in_progress')throw Object.assign(new Error('Phiên thi không còn hoạt động.'),{status:409,detail:{status:a.status}});
  const deadline=attemptDeadline(a);if(deadline&&Date.now()>=deadline){const result=await finalize(env,source,a,{},true);throw Object.assign(new Error('Đã hết thời gian. Bài làm đã được khóa và nộp.'),{status:409,detail:result})}
  const body=await readJsonBody(request);if(!body||typeof body!=='object'||Array.isArray(body))throw httpError('Cấu trúc yêu cầu không hợp lệ.',400);
  if(!Object.hasOwn(body,'answers'))throw httpError('Thiếu dữ liệu bài làm.',400);
  const qs=safeJson(a.question_json,[]),answers=sanitizeAnswers(body.answers,qs),answerJson=JSON.stringify(answers);
  if(new TextEncoder().encode(answerJson).byteLength>MAX_ANSWER_BYTES)throw httpError('Dữ liệu bài làm vượt giới hạn an toàn.',413);
  await validateAttachmentAnswers(env,a.id,qs,answers);
  const clientRev=Number(body.revision??a.answer_revision??0);if(!Number.isSafeInteger(clientRev)||clientRev<0)throw httpError('Phiên bản bài làm không hợp lệ.',400);
  if(clientRev!==Number(a.answer_revision||0))throw Object.assign(new Error('Bài làm trên máy chủ đã có phiên bản mới hơn.'),{status:409,detail:{code:'REVISION_CONFLICT',answer_revision:Number(a.answer_revision||0)}});
  const events=cleanEvents(body.events,safeJson(a.event_log_json,[])),eventsJson=JSON.stringify(events),nextRev=Number(a.answer_revision||0)+1,table=source==='guest'?'exam_guest_attempts':'exam_attempts';
  const wr=await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET answers_json=?,event_log_json=?,answer_revision=?,last_saved_at=CURRENT_TIMESTAMP WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=? AND NOT EXISTS(SELECT 1 FROM assessment_answer_revisions WHERE attempt_id=? AND revision=?)`).bind(answerJson,eventsJson,nextRev,a.id,Number(a.answer_revision||0),a.id,nextRev),
    env.DB.prepare(`INSERT INTO assessment_answer_revisions(id,attempt_id,source,revision,answers_json,events_json,accepted_at) SELECT ?,?,?,?,?,?,CURRENT_TIMESTAMP WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?) AND NOT EXISTS(SELECT 1 FROM assessment_answer_revisions WHERE attempt_id=? AND revision=?)`).bind(crypto.randomUUID(),a.id,source,nextRev,answerJson,eventsJson,a.id,nextRev,a.id,nextRev)
  ]);
  if(!Number(wr?.[0]?.meta?.changes||0))throw Object.assign(new Error('Bài làm vừa được cập nhật ở phiên khác.'),{status:409,detail:{code:'REVISION_CONFLICT'}});
  return ok({saved_at:nowIso(),answer_revision:nextRev})
}
async function submitAttempt(env,source,attemptId,request){const a=await authorize(env,source,attemptId,request);await claimLease(env,source,attemptId,request);if(a.status==='submitted')return ok(await finalResponse(env,a));if(a.status!=='in_progress')throw Object.assign(new Error('Phiên thi không còn hoạt động.'),{status:409,detail:{status:a.status}});const body=await readJsonBody(request),deadline=attemptDeadline(a),afterDeadline=!!(deadline&&Date.now()>=deadline);if(!body||typeof body!=='object'||Array.isArray(body))throw httpError('Cấu trúc yêu cầu không hợp lệ.',400);if(!afterDeadline&&body.revision!=null&&(!Number.isSafeInteger(Number(body.revision))||Number(body.revision)!==Number(a.answer_revision||0)))throw Object.assign(new Error('Bài làm trên máy chủ đã có phiên bản mới hơn.'),{status:409,detail:{code:'REVISION_CONFLICT',answer_revision:Number(a.answer_revision||0)}});return ok(await finalize(env,source,a,body,afterDeadline))}
async function recordViolation(env,source,attemptId,request){
  const a=await authorize(env,source,attemptId,request);await claimLease(env,source,attemptId,request);
  if(a.status!=='in_progress')throw Object.assign(new Error('Phiên thi không còn hoạt động.'),{status:409,detail:{status:a.status}});
  const deadline=attemptDeadline(a);if(deadline&&Date.now()>=deadline){const result=await finalize(env,source,a,{},true);throw Object.assign(new Error('Đã hết thời gian.'),{status:409,detail:result})}
  const body=await readJsonBody(request,300_000);if(!body||typeof body!=='object'||Array.isArray(body))throw httpError('Cấu trúc yêu cầu không hợp lệ.',400);
  const reason=str(body.reason).slice(0,120)||'integrity_event',events=cleanEvents(body.events,safeJson(a.event_log_json,[])),table=source==='guest'?'exam_guest_attempts':'exam_attempts',currentRevision=Number(a.answer_revision||0);
  const updated=await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET event_log_json=?,last_saved_at=COALESCE(last_saved_at,CURRENT_TIMESTAMP) WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?`).bind(JSON.stringify(events),a.id,currentRevision),
    env.DB.prepare(`INSERT INTO exam_audit_log(id,exam_id,attempt_id,actor_user_id,event_type,detail_json) SELECT ?,?,?,?,'integrity.signal',? WHERE EXISTS(SELECT 1 FROM ${table} WHERE id=? AND status='in_progress' AND COALESCE(answer_revision,0)=?)`).bind(crypto.randomUUID(),a.exam_id,a.id,source==='guest'?null:a.user_id,JSON.stringify({reason,source}),a.id,currentRevision)
  ]);
  if(!Number(updated?.[0]?.meta?.changes||0))throw Object.assign(new Error('Bài làm vừa được cập nhật ở phiên khác.'),{status:409,detail:{code:'REVISION_CONFLICT'}});
  return ok({recorded:true,terminated:false})
}
function safeName(name='file'){return String(name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,100)||'file'}
function mimeAllowed(file,type,bytes){const mime=str(file.type).toLowerCase(),head=[...bytes.slice(0,12)],isPdf=head[0]===0x25&&head[1]===0x50&&head[2]===0x44&&head[3]===0x46,isJpg=head[0]===0xff&&head[1]===0xd8&&head[2]===0xff,isPng=head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10',isWebp=String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WEBP',isZip=head[0]===0x50&&head[1]===0x4b,isMp3=(head[0]===0x49&&head[1]===0x44&&head[2]===0x33)||(head[0]===0xff&&(head[1]&0xe0)===0xe0),isMp4=String.fromCharCode(...head.slice(4,8))==='ftyp',isWebm=head[0]===0x1a&&head[1]===0x45&&head[2]===0xdf&&head[3]===0xa3,isOgg=String.fromCharCode(...head.slice(0,4))==='OggS',isWav=String.fromCharCode(...head.slice(0,4))==='RIFF'&&String.fromCharCode(...head.slice(8,12))==='WAVE';if(type==='image')return (mime.startsWith('image/jpeg')&&isJpg)||(mime.startsWith('image/png')&&isPng)||(mime.startsWith('image/webp')&&isWebp);if(type==='audio')return (mime.includes('mpeg')&&isMp3)||((mime.includes('mp4')||mime.includes('m4a'))&&isMp4)||(mime.includes('wav')&&isWav)||(mime.includes('webm')&&isWebm)||((mime.includes('ogg')||mime.includes('opus'))&&isOgg);return isPdf||isJpg||isPng||isWebp||isZip||isMp3||isMp4||mime.startsWith('text/plain')||mime.startsWith('text/csv')}
async function uploadAttachment(env,source,attemptId,request){const a=await authorize(env,source,attemptId,request);await claimLease(env,source,attemptId,request);if(a.status!=='in_progress')throw Object.assign(new Error('Phiên thi không còn hoạt động.'),{status:409,detail:{status:a.status}});const deadline=attemptDeadline(a);if(deadline&&Date.now()>=deadline){const result=await finalize(env,source,a,{},true);throw Object.assign(new Error('Đã hết thời gian.'),{status:409,detail:result})}const fd=await request.formData(),file=fd.get('file'),questionId=str(fd.get('question_id'));if(!(file instanceof File)||!file.size||!questionId)throw Object.assign(new Error('Thiếu tệp hoặc mã câu hỏi.'),{status:400});const q=safeJson(a.question_json,[]).find(x=>String(x.id)===questionId);if(!q||!ATTACHMENT_TYPES.has(str(q.type)))throw Object.assign(new Error('Câu hỏi này không nhận tệp đính kèm.'),{status:400});const max=q.type==='audio'?50*1024*1024:30*1024*1024;if(file.size>max)throw Object.assign(new Error(`Tệp vượt quá ${Math.round(max/1024/1024)}MB.`),{status:413});const bytes=new Uint8Array(await file.slice(0,32).arrayBuffer());if(!mimeAllowed(file,q.type,bytes))throw Object.assign(new Error('Định dạng tệp không phù hợp hoặc chữ ký tệp không hợp lệ.'),{status:415});const id=crypto.randomUUID(),key=`exam-responses/${a.exam_id}/${a.id}/${questionId}/${id}-${safeName(file.name)}`;await env.FILES.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});try{await env.DB.batch([env.DB.prepare(`UPDATE assessment_response_files SET status='replaced' WHERE attempt_id=? AND question_id=? AND status='active'`).bind(a.id,questionId),env.DB.prepare(`INSERT INTO files(id,owner_user_id,r2_key,name,mime,size,visibility,created_at) VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(id,source==='guest'?null:a.user_id,key,file.name,file.type||'',file.size,'private'),env.DB.prepare(`INSERT INTO assessment_response_files(id,attempt_id,source,question_id,file_id,status,created_at) VALUES(?,?,?,?,?,'active',CURRENT_TIMESTAMP)`).bind(crypto.randomUUID(),a.id,source,questionId,id)])}catch(error){await env.FILES.delete(key).catch(()=>{});throw error}return ok({file:{file_id:id,name:file.name,mime:file.type||'',size:file.size}})}
async function redeemLaunch(env,request){
  const body=await readJsonBody(request,16_384);if(!body||typeof body!=='object'||Array.isArray(body))throw httpError('Cấu trúc yêu cầu không hợp lệ.',400);
  const raw=str(body.launch_token);if(!raw)return bad('Thiếu mã khởi chạy.',400);if(raw.length>4096)return bad('Mã khởi chạy không hợp lệ hoặc đã hết hạn.',401);
  const hash=await sha256Text(raw),row=await env.DB.prepare(`SELECT token_hash,user_id,attempt_id,expires_at,used_at FROM exam_launch_tokens WHERE token_hash=?`).bind(hash).first(),expires=databaseTimeMs(row?.expires_at);
  if(!row||row.used_at||!Number.isFinite(expires)||expires<=Date.now())return bad('Mã khởi chạy không hợp lệ hoặc đã hết hạn.',401);
  const accessBytes=new Uint8Array(32);crypto.getRandomValues(accessBytes);const access=[...accessBytes].map(x=>x.toString(16).padStart(2,'0')).join(''),accessHash=await sha256Text(access),exp=new Date(Date.now()+12*60*60*1000).toISOString();
  const batch=await env.DB.batch([env.DB.prepare(`UPDATE exam_launch_tokens SET used_at=CURRENT_TIMESTAMP WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>CURRENT_TIMESTAMP`).bind(hash),env.DB.prepare(`INSERT INTO exam_access_tokens(token_hash,user_id,attempt_id,expires_at,created_at) SELECT ?,?,?,?,CURRENT_TIMESTAMP WHERE changes()=1`).bind(accessHash,row.user_id,row.attempt_id,exp)]);
  if(!Number(batch?.[0]?.meta?.changes||0))return bad('Mã khởi chạy đã được sử dụng hoặc hết hạn.',409);
  if(!Number(batch?.[1]?.meta?.changes||0))throw httpError('Không thể tạo phiên truy cập. Vui lòng xin cấp lại liên kết dự thi.',503,{code:'ACCESS_TOKEN_NOT_PERSISTED'});
  const candidate=await env.DB.prepare(`SELECT u.full_name,u.sfn_id candidate_code,c.name class_name FROM exam_attempts a JOIN users u ON u.id=a.user_id JOIN exams e ON e.id=a.exam_id LEFT JOIN classes c ON c.id=e.class_id WHERE a.id=?`).bind(row.attempt_id).first().catch(()=>null);
  return ok({attempt_id:row.attempt_id,access_token:access,expires_at:exp,candidate:candidate||{}})
}
const REQUIRED_SCHEMA_TABLES=['assessment_attempt_leases','exam_launch_tokens','exam_access_tokens','exam_attempts','exam_guest_attempts','exams','assessment_answer_revisions','assessment_response_files','files','assessment_manual_grades','assessment_result_workflows','exam_audit_log','assessment_exam_versions','assessment_receipts','classes','users'];
async function health(env){
  const schema={};
  for(const table of REQUIRED_SCHEMA_TABLES){try{await env.DB.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();schema[table]='available'}catch{schema[table]='unavailable'}}
  const missing=Object.entries(schema).filter(([,state])=>state!=='available').map(([table])=>table),bucketConfigured=!!env.FILES,ready=missing.length===0&&bucketConfigured;
  return json({ok:ready,service:'Sky First Exam',version:'4.1.0',status:ready?'available':'degraded',runtime:{attempt_api:ready?'local-d1':'degraded',control_plane:'independent-after-launch'},dependencies:{d1:missing.length?'degraded':'available',r2_binding:bucketConfigured?'configured':'missing'},schema,missing,time:nowIso},ready?200:503)
}
async function proxyToControl(request){const src=new URL(request.url),target=new URL(src.pathname+src.search,CONTROL_ORIGIN),headers=new Headers(request.headers);headers.delete('host');headers.delete('x-exam-session');const init={method:request.method,headers,redirect:'manual'};if(!['GET','HEAD'].includes(request.method))init.body=request.body;const response=await fetch(new Request(target,init));return withSecurity(response)}
async function api(request,env){const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();if(method==='OPTIONS')return new Response(null,{status:204,headers:SECURITY});if(path==='/health')return health(env);if(path==='/api/public/exam-launch/redeem'&&method==='POST')return redeemLaunch(env,request);
  const guest=path.match(/^\/api\/public\/exam-attempts\/([^/]+)(?:\/(save|submit|violation|upload))?$/);if(guest){const id=decodeURIComponent(guest[1]),action=guest[2]||'';if(!action&&method==='GET')return getAttempt(env,'guest',id,request);if(action==='save'&&method==='POST')return saveAttempt(env,'guest',id,request);if(action==='submit'&&method==='POST')return submitAttempt(env,'guest',id,request);if(action==='violation'&&method==='POST')return recordViolation(env,'guest',id,request);if(action==='upload'&&method==='POST')return uploadAttachment(env,'guest',id,request)}
  const internal=path.match(/^\/api\/exam-attempts\/([^/]+)(?:\/(save|submit|violation|upload))?$/);if(internal){const id=decodeURIComponent(internal[1]),action=internal[2]||'';if(!action&&method==='GET')return getAttempt(env,'internal',id,request);if(action==='save'&&method==='POST')return saveAttempt(env,'internal',id,request);if(action==='submit'&&method==='POST')return submitAttempt(env,'internal',id,request);if(action==='violation'&&method==='POST')return recordViolation(env,'internal',id,request);if(action==='upload'&&method==='POST')return uploadAttachment(env,'internal',id,request)}
  if(path.startsWith('/api/'))return proxyToControl(request);return null
}
export default {async fetch(request,env){try{const apiResponse=await api(request,env);if(apiResponse)return withSecurity(apiResponse);const response=await env.ASSETS.fetch(request);return withSecurity(response)}catch(error){const status=Number(error?.status)||500,detail=error?.detail||undefined,message=status===401?'Quyền truy cập phiên thi không hợp lệ hoặc đã hết hạn.':status===403?'Bạn không có quyền thực hiện thao tác này.':error?.message==='SESSION_REQUIRED'?'Phiên thi cần mã phiên thiết bị hợp lệ.':error?.message==='SESSION_CONFLICT'?'Phiên thi đang được sử dụng trên tab hoặc thiết bị khác.':status>=500?'Dịch vụ dự thi đang gặp sự cố. Bài lưu trên thiết bị vẫn được giữ.':String(error?.message||'Không thể xử lý yêu cầu.');return bad(message,status,detail)}}};

export { autoScore, cleanEvents, mimeAllowed, publicQuestions, readJsonBody, sanitizeAnswers };
