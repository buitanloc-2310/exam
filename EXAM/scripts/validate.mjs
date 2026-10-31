import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import * as core from '../public/core.js';
import * as secClient from '../public/security-client.js';
import {apiRequest} from '../public/api.js';
import {
  autoScore,
  cleanEvents,
  publicQuestions,
  readJsonBody,
  sanitizeAnswers,
  ADMIN_ROLES,
  PRIVACY_COMPLIANCE_POLICY,
  SECURITY_LEVEL_PRESETS,
  drawQuestionsFromMatrix,
  analyzeExamAnomalies
} from '../src/index.js';
import { RISK_LEVEL_LABELS, evaluateProctoringEventRisk, evaluateDevicePreflightCapabilities } from '../src/security-service.js';

let checks=0;async function test(name,run){await run();console.log('PASS '+name);checks++}

await test('runtime JavaScript syntax across all 16 frontend and backend modules',()=>{
  const jsFiles = [
    'public/api.js','public/storage.js','public/core.js','public/security-client.js','public/exam.js','public/admin.js',
    'src/email-templates.js','src/repository.js','src/adapters.js','src/auth-service.js','src/security-service.js',
    'src/business-service.js','src/exam-service.js','src/page-router.js','src/index.js','functions/health.js'
  ];
  for(const f of jsFiles) assert.equal(spawnSync(process.execPath,['--check',f]).status,0,f);
});

await test('UTC database dates independent from host timezone',()=>{assert.equal(core.timeMs('2026-10-05 09:00:00'),Date.parse('2026-10-05T09:00:00Z'));assert.equal(core.timeMs(null),NaN)});
await test('legacy schedules use Vietnam timezone',()=>assert.equal(core.timeMs('2026-10-05T09:00',{schedule:true}),Date.parse('2026-10-05T02:00:00Z')));
await test('clock handles unlimited, minutes, hours and elapsed deadline',()=>{assert.equal(core.formatClock(null),'Không giới hạn');assert.equal(core.formatClock(61),'01:01');assert.equal(core.formatClock(3661),'1:01:01');assert.equal(core.formatClock(-5),'00:00')});
await test('all supported question types have correct progress status',()=>{for(const type of ['mcq','multi','truefalse','matching','ordering','fill','short','numeric','math','essay','long','structured','file','image','audio']){const q={id:'q',type,options:type==='matching'?['A|||B','C|||D']:['A','B']};assert.equal(core.answerStatus(q,{}),'empty');const a=type==='multi'?['A']:type==='matching'?{A:'B',C:'D'}:type==='ordering'?['A','B']:['file','image','audio'].includes(type)?{file_id:'f1',name:'answer'}:'A';assert.equal(core.answerStatus(q,{q:a}),'done')}});
await test('partial matching and duplicate ordering are not complete',()=>{assert.equal(core.answerStatus({id:'q',type:'matching',options:['A|||B','C|||D']},{q:{A:'B'}}),'partial');assert.equal(core.answerStatus({id:'q',type:'ordering',options:['A','B']},{q:['A','A']}),'partial')});
await test('zero and false are meaningful answers',()=>{assert.equal(core.answerStatus({id:'q',type:'short'},{q:0}),'done');assert.equal(core.answerStatus({id:'q',type:'truefalse'},{q:false}),'done')});
await test('invalid exam and duplicate question IDs rejected',()=>{assert.throws(()=>core.normalizeExam({questions:[]}));assert.throws(()=>core.normalizeExam({questions:[{id:'q'},{id:'q'}]}))});
await test('HTML escaping blocks injected markup',()=>assert.equal(core.escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
await test('public question payload uses an allowlist and strips nested scoring secrets',()=>{const [q]=publicQuestions([{id:'q1',type:'mcq',question:'Q',options:['A','B'],points:1,answer:'A',correct_answers:['A'],answer_key:'secret',rubric:{answer:'leak'},private_metadata:{token:'leak'},stimulus:{type:'text',title:'Context',text:'Read this',answer:'nested leak'}}]);assert.equal(q.answer,undefined);assert.equal(q.answer_key,undefined);assert.equal(q.private_metadata,undefined);assert.equal(q.rubric,undefined);assert.deepEqual(q.stimulus,{type:'text',title:'Context',text:'Read this'});assert.deepEqual(Object.keys(q).sort(),['id','options','points','question','stimulus','type'])});
await test('server answer sanitizer drops unknown question IDs and rejects wrong answer shapes',()=>{const qs=[{id:'q1',type:'mcq',options:['A','B']},{id:'q2',type:'multi',options:['A','B']},{id:'q3',type:'matching',options:['Left|||Right']}];assert.deepEqual(sanitizeAnswers({q1:'A',unknown:'SECRET',q2:['A'],q3:{Left:'Right',Secret:'value'}},qs),{q1:'A',q2:['A'],q3:{Left:'Right'}});assert.throws(()=>sanitizeAnswers({q1:{answer:'A'}},qs),/Kiểu dữ liệu/);assert.throws(()=>sanitizeAnswers({q2:'A'},qs),/Danh sách lựa chọn/)});
await test('integrity events store only bounded approved fields',()=>{const [event]=cleanEvents([{type:'blur',at:'invalid-time',fullscreen:true,away_ms:1500,token:'secret'},{type:'ui_state'},{extra:'ignored'}]);assert.equal(event.type,'blur');assert.ok(Number.isFinite(Date.parse(event.at)));assert.equal(event.fullscreen,true);assert.equal(event.away_ms,1500);assert.equal(event.token,undefined);assert.equal(cleanEvents([{type:'ui_state'}]).length,0)});
await test('server accepted zero-point items remain zero-point',()=>assert.deepEqual(autoScore([{id:'free',type:'mcq',answer:'A',points:0},{id:'graded',type:'mcq',answer:'A',points:2}],{free:'A',graded:'A'}),{score:2,max:2,manual:[]}));
await test('JSON request reader enforces byte cap before parsing',async()=>{assert.deepEqual(await readJsonBody(new Request('https://exam.test/api/save',{method:'POST',headers:{'content-type':'application/json'},body:'{"ok":true}'})),{ok:true});await assert.rejects(readJsonBody(new Request('https://exam.test/api/save',{method:'POST',body:'12345678901234567890'}),8),e=>e.status===413)});
await test('cache answers scoped to current questions',()=>assert.deepEqual(core.cleanAnswers({q:'A',unknown:'B'},[{id:'q'}]),{q:'A'}));
await test('journal never acknowledges edits made during pending save',()=>{const j=new core.AnswerJournal();j.edit();const snapshot=j.version;j.edit();j.acknowledge(snapshot);assert.equal(j.dirty,true);j.acknowledge(j.version);assert.equal(j.dirty,false)});
await test('events deduplicated and legacy UI state excluded',()=>{const e={type:'blur',at:'test'};assert.deepEqual(core.eventUnion([e],[e,{type:'ui_state'}]),[e])});
await test('invitation parsing supports direct code, /join/* URL and Sky First links while rejecting external domains',()=>{assert.equal(core.parseInvite('ABC'),'ABC');assert.equal(core.parseInvite('https://exam.skyfirst.io.vn/join/ABC'),'ABC');assert.equal(core.parseInvite('https://exam.skyfirst.io.vn/?invite=ABC'),'ABC');assert.throws(()=>core.parseInvite('https://other.test/join/ABC'))});

const oldFetch=globalThis.fetch;
await test('API sends bearer token without session cookies by default',async()=>{globalThis.fetch=async(url,opts)=>{assert.equal(opts.headers.get('authorization'),'Bearer test');assert.equal(opts.credentials,'omit');return Response.json({ok:true})};assert.equal((await apiRequest('/api/test',{token:'test'})).ok,true)});
await test('API preserves revision conflict details',async()=>{globalThis.fetch=async()=>Response.json({ok:false,message:'Conflict',detail:{code:'REVISION_CONFLICT'}},{status:409});await assert.rejects(apiRequest('/api/test'),e=>e.code==='REVISION_CONFLICT'&&e.status===409)});
await test('API rejects successful HTML, null and array payloads',async()=>{for(const payload of [null,[], 'html']){globalThis.fetch=async()=>payload==='html'?new Response('<html>'):Response.json(payload);await assert.rejects(apiRequest('/api/test'),/phản hồi không hợp lệ/)}});
await test('network errors distinguished from server rejection',async()=>{globalThis.fetch=async()=>{throw new TypeError('offline')};await assert.rejects(apiRequest('/api/test'),e=>e.network===true)});
globalThis.fetch=oldFetch;

const data=new Map();const mockStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};globalThis.localStorage=mockStorage;globalThis.sessionStorage=mockStorage;
const storage=await import('../public/storage.js');
await test('session roundtrip includes candidate identity and admin session helpers',()=>{storage.setSession('key','id','guest','invite',{full_name:'Test'});assert.equal(storage.getSession().candidate.full_name,'Test');storage.clearSession();assert.equal(storage.getSession().token,'');storage.setAdminSession('adm-tok','csrf-tok',{email:'adm@skyfirst.io.vn'});assert.equal(storage.getAdminSession().token,'adm-tok');assert.equal(storage.getAdminSession().csrf,'csrf-tok');storage.clearAdminSession();assert.equal(storage.getAdminSession().token,'')});
await test('local snapshot keeps revision and dirty edits',()=>{storage.saveLocal('id',{q:'A'},[],{current:1},{revision:2,dirty:true});assert.equal(storage.loadLocal('id').revision,2);assert.equal(storage.loadLocal('id').dirty,true)});
await test('active tab lease cannot be taken by another owner',()=>{data.set('skyfirst_exam_lock_id',JSON.stringify({owner:'other',until:Date.now()+20000}));assert.equal(storage.acquireLease('id'),false);data.delete('skyfirst_exam_lock_id');assert.equal(storage.acquireLease('id'),true);storage.releaseLease()});
await test('blocked browser storage has safe fallback',()=>{Object.defineProperty(globalThis,'localStorage',{get(){throw new Error('denied')},configurable:true});assert.equal(storage.saveLocal('fallback',{q:'A'},[]),false);assert.equal(storage.loadLocal('fallback').answers.q,'A');assert.equal(storage.storageRestricted(),true)});

const source=fs.readFileSync('public/exam.js','utf8');
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',value:'',disabled:false,classList:{toggle(){},add(){},remove(){}},setAttribute(){},addEventListener(){},focus(){},scrollIntoView(){}});return nodes.get(id)};
let timers=[];const doc={querySelector:q=>q==='.skip-link'?null:q==='.modal-backdrop'?null:node(q),querySelectorAll:()=>[],addEventListener(){},title:'',documentElement:{}};
const sandbox={performance,...core,...secClient,esc:core.escapeHtml,document:doc,navigator:{onLine:true},window:{addEventListener(){},scrollTo(){}},location:{origin:'https://exam.test'},history:{},console,URL,Blob,CSS:{escape:s=>s},setInterval:()=>1,clearInterval(){},setTimeout:fn=>{timers.push(fn);return 1},clearTimeout(){},apiRequest:async()=>({ok:true}),getSession:()=>({token:'token',attempt:'attempt',mode:'user',invite:'',candidate:{}}),setSession(){},clearSession(){},saveLocal:()=>true,loadLocal:()=>null,clearLocal(){},storageRestricted:()=>false,acquireLease:()=>true,renewLease:()=>true,releaseLease(){}};
vm.createContext(sandbox);vm.runInContext(source.replace(/^import .*;\n/gm,'').replace(/\nboot\(\);\s*$/,'')+'\nglobalThis.t={render,save,paintClock,optionMarkup,completion,syncTiming,serverNow,set:v=>{exam=v.exam;answers=v.answers||{};journal=new AnswerJournal();journal.edit();armed=true;remaining=600},edit:()=>journal.edit(),dirty:()=>journal.dirty};',sandbox);

await test('workstation renders all supported question types with escaped content',()=>{for(const type of ['mcq','multi','truefalse','matching','ordering','fill','short','numeric','math','essay','long','structured','file','image','audio']){sandbox.t.set({exam:{title:'Exam',questions:[{id:'q',type,question:'<script>test</script>',options:type==='matching'?['A|||B']:['A','B']}]}});sandbox.t.render();assert.match(node('#app').innerHTML,/BẢNG CÂU HỎI/);assert.match(node('#app').innerHTML,/&lt;script&gt;/);assert.match(node('#app').innerHTML,/Nộp bài/)}});
await test('saving older payload cannot mark newer typing as saved',async()=>{let resolveSave;sandbox.apiRequest=async()=>await new Promise(resolve=>resolveSave=resolve);sandbox.t.set({exam:{questions:[{id:'q',type:'mcq'}]},answers:{q:'A'}});const task=sandbox.t.save();sandbox.t.edit();resolveSave({answer_revision:1,saved_at:new Date().toISOString()});await task;assert.equal(sandbox.t.dirty(),true)});
await test('simultaneous autosaves share one request',async()=>{let calls=0,resolveSave;sandbox.apiRequest=async()=>{calls++;return await new Promise(resolve=>resolveSave=resolve)};sandbox.t.set({exam:{title:'Test',questions:[{id:'q',type:'mcq'}]},answers:{q:'A'}});const a=sandbox.t.save(),b=sandbox.t.save();resolveSave({answer_revision:2,saved_at:new Date().toISOString()});await Promise.all([a,b]);assert.equal(calls,1);assert.equal(sandbox.t.dirty(),false)});
await test('server clock advances by monotonic performance time',()=>{let clock=1000;sandbox.performance={now:()=>clock};sandbox.t.syncTiming({server_time:'2026-10-05T02:00:00Z',remaining_seconds:60});clock=3500;assert.equal(sandbox.t.serverNow(),Date.parse('2026-10-05T02:00:00Z')+2500)});
await test('completion respects hidden score policy',()=>{sandbox.t.set({exam:{title:'Test',questions:[{id:'q',type:'mcq'}]},answers:{q:'A'}});sandbox.t.completion({score:99,max_score:100,show_score:false,receipt_code:'TEST-RECEIPT'},false);assert.doesNotMatch(node('#app').innerHTML,/Kết quả/);assert.match(node('#app').innerHTML,/TEST-RECEIPT/)});
await test('multilingual question content preserves per-question language and Unicode',()=>{const q=core.normalizeExam({title:'Bài kiểm tra đa ngôn ngữ',questions:[{id:'ar-1',type:'short',question:'مرحبا — Xin chào',content_language:'ar',script_direction:'rtl'}]}).questions[0];assert.equal(q.content_language,'ar');assert.equal(q.script_direction,'rtl');assert.match(q.question,/مرحبا/)});
await test('rendered exam localizes an RTL audio question and displays the recorder controls',()=>{sandbox.t.set({exam:{title:'اختبار',questions:[{id:'ar-audio',type:'audio',question:'تحدث عن نفسك',content_language:'ar',script_direction:'rtl',recording_duration_seconds:30}]},answers:{}});sandbox.t.render();const html=node('#app').innerHTML;assert.match(html,/lang="ar" dir="rtl"/);assert.match(html,/id="startRecording"/);assert.match(html,/تحدث عن نفسك/);sandbox.t.set({exam:{title:'Essay',questions:[{id:'essay',type:'essay',question:'Write your answer'}]},answers:{}});sandbox.t.render();assert.doesNotMatch(node('#app').innerHTML,/id="startRecording"/)});
await test('speaking runtime records only after an explicit microphone action and zero screen-capture APIs exist',()=>{
  assert.match(source,/getUserMedia\(\{audio:/);
  assert.match(source,/id=\\?"startRecording/);
  assert.match(source,/function stopAudioRecording/);
  assert.match(fs.readFileSync('public/_headers','utf8'),/microphone=\(self\)/);
  assert.match(fs.readFileSync('src/index.js','utf8'),/microphone=\(self\)/);
  assert.equal(PRIVACY_COMPLIANCE_POLICY.screen_capture_enabled, false);
  assert.equal(PRIVACY_COMPLIANCE_POLICY.screen_video_recording_enabled, false);
  assert.equal(PRIVACY_COMPLIANCE_POLICY.display_media_api_allowed, false);
  for(const f of ['public/exam.js','public/security-client.js','public/admin.js','src/security-service.js','src/exam-service.js']){
    assert.doesNotMatch(fs.readFileSync(f,'utf8'),/getDisplayMedia\s*\(/,`Forbidden screen capture call in ${f}`);
  }
});
await test('MediaRecorder audio containers require valid WebM/Ogg signatures',async()=>{const {mimeAllowed}=await import('../src/index.js');assert.equal(mimeAllowed({type:'audio/webm;codecs=opus'},'audio',Uint8Array.of(0x1a,0x45,0xdf,0xa3)),true);assert.equal(mimeAllowed({type:'audio/webm'},'audio',Uint8Array.of(0,1,2,3)),false);assert.equal(mimeAllowed({type:'audio/ogg;codecs=opus'},'audio',new TextEncoder().encode('OggS\x00\x02')),true);assert.equal(mimeAllowed({type:'audio/ogg'},'audio',new TextEncoder().encode('RIFFxxxxWAVE')),false)});
await test('large candidate logo converted to a smaller WebP asset',()=>{assert.ok(fs.existsSync('public/sky-first-logo.webp'));assert.ok(fs.statSync('public/sky-first-logo.webp').size<250*1024);assert.match(fs.readFileSync('public/index.html','utf8'),/sky-first-logo\.webp/)});
await test('Times New Roman is enforced globally across interface controls and components',()=>{const css=fs.readFileSync('public/styles.css','utf8'),html=fs.readFileSync('public/index.html','utf8');assert.match(css,/:root\{font-family:"Times New Roman",Times,serif/);assert.match(css,/\*::before,\*::after\{font-family:"Times New Roman",Times,serif!important\}/);assert.doesNotMatch(css,/Segoe UI|Arial|system-ui/);assert.match(html,/styles\.css\?build=20261030-routes-v2/);assert.match(html,/exam\.js\?build=20261030-routes-v2/)});
await test('submission body and server finalizer rely on the saved server snapshot',()=>{const backend=fs.readFileSync('src/exam-service.js','utf8'),frontend=fs.readFileSync('public/exam.js','utf8');assert.match(backend,/const answers = safeJson\(a\.answers_json, \{\}\)/);assert.match(backend,/COALESCE\(answer_revision,0\)=\?/);assert.match(frontend,/JSON\.stringify\(\{revision\}\)/)});
await test('/admin route has dedicated HTML entrypoint, SPA routing, and RBAC roles',()=>{const examJs=fs.readFileSync('public/exam.js','utf8'),adminJs=fs.readFileSync('public/admin.js','utf8'),adminHtml=fs.readFileSync('public/admin.html','utf8');assert.ok(examJs.includes('/admin(?:\\/|$)/.test(u.pathname)'));assert.match(examJs,/import\('\.\/admin\.js/);assert.match(adminJs,/export async function bootAdmin/);assert.match(adminHtml,/\/admin\.js\?build=20261030-routes-v2/);assert.doesNotMatch(adminHtml,/<script[^>]*>[^<]+<\/script>/);assert.equal(ADMIN_ROLES.length,10)});
await test('SLC control-plane proxy and URLs are completely removed from runtime files',()=>{for(const f of ['src/index.js','src/exam-service.js','functions/health.js','public/_headers','public/exam.js','public/admin.js','public/core.js','public/storage.js','public/api.js']){const txt=fs.readFileSync(f,'utf8');assert.doesNotMatch(txt,/slc\.skyfirst\.io\.vn/,`Found slc.skyfirst.io.vn in ${f}`);assert.doesNotMatch(txt,/proxyToControl/,`Found proxyToControl in ${f}`)}});
await test('Unified branding: Unit Name is always present, precedes System Name, and deprecated brand names are removed', () => {
  const unitName = 'Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First';
  const sysName = 'Hệ Thống Khảo Thí Và Đánh Giá Sky First';
  for (const f of ['public/index.html', 'public/exam.js', 'public/admin.js', 'public/admin.html', 'src/index.js', 'src/page-router.js', 'src/email-templates.js']) {
    const txt = fs.readFileSync(f, 'utf8');
    assert.ok(txt.includes(unitName), `Missing unit name in ${f}`);
    assert.ok(txt.includes(sysName), `Missing system name in ${f}`);
    assert.doesNotMatch(txt, /Cổng Khảo Thí Độc Lập/i, `Deprecated label Cổng Khảo Thí Độc Lập found in ${f}`);
    assert.doesNotMatch(txt, /Cổng Khảo thí và Đánh giá Trực tuyến/i, `Deprecated label Cổng Khảo thí và Đánh giá Trực tuyến found in ${f}`);
    assert.doesNotMatch(txt, /TRUNG TÂM KHẢO THÍ VÀ ĐÁNH GIÁ SKY FIRST/, `Deprecated label TRUNG TÂM KHẢO THÍ found in ${f}`);
    assert.doesNotMatch(txt, /SKYFIRST-2026-ADMIN/, `Hardcoded bootstrap secret found in ${f}`);
  }
  const pubExam = fs.readFileSync('public/exam.js', 'utf8');
  const pubHtml = fs.readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(pubExam, /href="\/admin"/, 'Public exam.js must not link to /admin');
  assert.doesNotMatch(pubExam, /Quản trị \(\/admin\)/, 'Public exam.js must not display Quản trị (/admin)');
  assert.doesNotMatch(pubHtml, /\/admin/, 'Public index.html must not reference /admin');
});

await test('All 18 dedicated HTML email templates exist in src/emails/, have 18 unique HTML designs, and support all 24 business email events', async () => {
  const { EMAIL_SENDERS, EMAIL_TEMPLATES, EMAIL_EVENT_ALIASES, renderEmailTemplate } = await import('../src/email-templates.js');
  const expectedFiles = [
    ['exam_result', 'exam-result.html', EMAIL_SENDERS.EXAM],
    ['appeal_received', 'appeal-received.html', EMAIL_SENDERS.EXAM],
    ['appeal_update', 'appeal-update.html', EMAIL_SENDERS.EXAM],
    ['appeal_result', 'appeal-result.html', EMAIL_SENDERS.EXAM],
    ['exam_announcement', 'exam-announcement.html', EMAIL_SENDERS.EXAM],
    ['email_verification', 'email-verification.html', EMAIL_SENDERS.NOREPLY],
    ['login_verification_code', 'login-verification-code.html', EMAIL_SENDERS.NOREPLY],
    ['exam_entry', 'exam-entry.html', EMAIL_SENDERS.NOREPLY],
    ['exam_session_ended', 'exam-session-ended.html', EMAIL_SENDERS.NOREPLY],
    ['exam_session_cancelled', 'exam-session-cancelled.html', EMAIL_SENDERS.NOREPLY],
    ['integrity_warning', 'integrity-warning.html', EMAIL_SENDERS.NOREPLY],
    ['fraud_report', 'fraud-report.html', EMAIL_SENDERS.NOREPLY],
    ['exam_ban_notice', 'exam-ban-notice.html', EMAIL_SENDERS.NOREPLY],
    ['system_notification', 'system-notification.html', EMAIL_SENDERS.NOREPLY],
    ['support_request_received', 'support-request-received.html', EMAIL_SENDERS.SUPPORT],
    ['support_request_update', 'support-request-update.html', EMAIL_SENDERS.SUPPORT],
    ['support_request_resolved', 'support-request-resolved.html', EMAIL_SENDERS.SUPPORT],
    ['technical_incident', 'technical-incident.html', EMAIL_SENDERS.SUPPORT]
  ];
  assert.equal(Object.keys(EMAIL_TEMPLATES).length, 18);
  const hashes = new Set();
  for (const [ev, file, sender] of expectedFiles) {
    const diskPath = `src/emails/${file}`;
    assert.ok(fs.existsSync(diskPath), `Missing email template file: ${diskPath}`);
    const diskHtml = fs.readFileSync(diskPath, 'utf8');
    hashes.add(createHash('sha256').update(diskHtml).digest('hex'));
    const unitIdx = diskHtml.indexOf('Mạng Lưới Giáo Dục Và Phát Triển Cộng Đồng Sky First');
    const sysIdx = diskHtml.indexOf('Hệ Thống Khảo Thí Và Đánh Giá Sky First');
    assert.ok(unitIdx > -1 && sysIdx > unitIdx, `Unit name must appear before System name in ${file}`);
    const rendered = renderEmailTemplate(ev, { recipient_name: 'Nguyễn Văn A', exam_title: 'Kỳ thi Mẫu', request_code: 'REQ-123', otp_code: '654321' });
    assert.equal(rendered.from, sender);
    assert.equal(rendered.template_file, file);
    assert.ok(rendered.html.includes('Nguyễn Văn A'));
    assert.ok(rendered.text.includes('Nguyễn Văn A'));
  }
  assert.equal(hashes.size, 18, 'Each of the 18 HTML email templates must be distinct');
  assert.ok(Object.keys(EMAIL_EVENT_ALIASES).length >= 24, 'All 24 business email events must be mapped');
});

await test('Question Bank Matrix drawer, 3 Security Levels, 4-Tier Risk Classification (Mức 1-4), and Post-Exam Anomaly Analyzer work deterministically', () => {
  assert.equal(Object.keys(RISK_LEVEL_LABELS).length, 4);
  assert.equal(evaluateProctoringEventRisk('window_blur', { repeatCount: 1 }).risk_level, 1);
  assert.equal(evaluateProctoringEventRisk('tab_switch', { repeatCount: 1 }).risk_level, 2);
  assert.equal(evaluateProctoringEventRisk('multi_monitor_detected', { repeatCount: 1 }).risk_level, 3);
  assert.equal(evaluateProctoringEventRisk('multiple_faces_detected', { repeatCount: 1 }).risk_level, 4);
  assert.equal(evaluateProctoringEventRisk('remote_desktop_detected', { repeatCount: 1 }).risk_level, 4);
  assert.equal(evaluateProctoringEventRisk('remote_desktop_detected', { repeatCount: 1 }).auto_cancel_exam, false);
  const pf = evaluateDevicePreflightCapabilities({ camera_ready: false }, { security_config_json: JSON.stringify({ require_camera: true }) });
  assert.equal(pf.passed, false);
  assert.ok(pf.blockers.length >= 1);
  assert.equal(Object.keys(SECURITY_LEVEL_PRESETS).length, 3);
  const bank = [
    { id: 'b1', subject: 'Toán', topic: 'Đại số', cognitive_level: 'recognition', difficulty: 'easy', type: 'mcq', question: '1+1?', options_json: '["1","2"]', answer_json: '"2"', points: 1, status: 'active' },
    { id: 'b2', subject: 'Toán', topic: 'Đại số', cognitive_level: 'understanding', difficulty: 'medium', type: 'mcq', question: '2+2?', options_json: '["3","4"]', answer_json: '"4"', points: 2, status: 'active' },
    { id: 'b3', subject: 'Toán', topic: 'Hình học', cognitive_level: 'application', difficulty: 'hard', type: 'essay', question: 'Chứng minh', points: 3, status: 'active' }
  ];
  const drawn = drawQuestionsFromMatrix(bank, [
    { subject: 'Toán', difficulty: 'easy', count: 1 },
    { subject: 'Toán', difficulty: 'hard', count: 1 }
  ], 'seed-2026');
  assert.equal(drawn.length, 2);
  const report = analyzeExamAnomalies([
    { id: 'a1', candidate_code: 'C1', full_name: 'A', started_at: '2026-10-30T01:00:00Z', submitted_at: '2026-10-30T01:20:00Z', answers_json: '{"q1":"A","q2":"B","q3":"C"}', event_log_json: '[{"type":"fullscreen_exit","at":"2026-10-30T01:05:00Z"}]' },
    { id: 'a2', candidate_code: 'C2', full_name: 'B', started_at: '2026-10-30T01:00:00Z', submitted_at: '2026-10-30T01:21:00Z', answers_json: '{"q1":"A","q2":"B","q3":"C"}', event_log_json: '[]' }
  ], 2);
  assert.equal(report.auto_disqualification_enabled, false);
  assert.equal(report.similarity_alerts.length, 1);
  assert.equal(report.similarity_alerts[0].similarity_percent, 100);
});

await test('Project file inventory equals exactly 50 files and all 9 routes + dual hostnames are configured', () => {
  function listProjectFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.wrangler', 'dist'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...listProjectFiles(full));
      else out.push(full);
    }
    return out;
  }
  const files = listProjectFiles('.');
  assert.equal(files.length, 50, `Expected exactly 50 project files, found ${files.length}: ${files.join(', ')}`);

  const redirects = fs.readFileSync('public/_redirects', 'utf8');
  const pageRouter = fs.readFileSync('src/page-router.js', 'utf8');
  const examJs = fs.readFileSync('public/exam.js', 'utf8');
  for (const route of ['/tra-cuu', '/tra-cuu-ket-qua', '/phuc-khao', '/ho-tro', '/bao-loi', '/su-co-khan-cap', '/to-cao-gian-lan']) {
    assert.ok(pageRouter.includes(`'${route}'`), `Missing route definition for ${route} in src/page-router.js`);
    assert.ok(examJs.includes(`'${route}'`), `Missing route handler for ${route} in public/exam.js`);
    assert.ok(!redirects.split(/\r?\n/).some(line => line.trim().startsWith(route + ' ')), `${route} must not be redirected/proxied by _redirects`);
  }
  const wranglerCfg = JSON.parse(fs.readFileSync('wrangler.json', 'utf8'));
  assert.equal(wranglerCfg.assets.not_found_handling, '404-page');
  assert.equal(wranglerCfg.routes.length, 2);
  assert.ok(fs.existsSync('public/404.html'));
});


await test('Milestone 6: Candidate file upload forbidden in UI, 20 question types, scientific calculator, virtual math keyboard, and Sky First proprietary anti-cheat engines', async () => {
  const examJs = fs.readFileSync('public/exam.js', 'utf8');
  assert.doesNotMatch(examJs, /data-file-answer/i, 'Candidate exam workstation must not contain data-file-answer upload inputs');
  sandbox.t.set({exam:{title:'Exam',questions:[{id:'qf',type:'file',question:'Legacy file item'}]},answers:{}});sandbox.t.render();
  assert.doesNotMatch(node('#app').innerHTML, /type="file"/i, 'Rendered exam workstation must never display <input type="file">');
  assert.ok(core.SUPPORTED_QUESTION_TYPES.length >= 20, 'Must support at least 20 question types');
  assert.ok((Array.isArray(core.VIRTUAL_MATH_KEYBOARD_GROUPS) ? core.VIRTUAL_MATH_KEYBOARD_GROUPS.length : Object.keys(core.VIRTUAL_MATH_KEYBOARD_GROUPS).length) >= 8, 'Must support comprehensive math symbol groups');
  assert.equal(core.evaluateScientificExpression('sin(30) + sqrt(16)', 'DEG').result, 4.5);
  assert.equal(core.evaluateScientificExpression('ln(e) + log(100)', 'RAD').result, 3);

  const sec = await import('../src/security-service.js');
  const dna = sec.generateExamDnaFingerprint({ examId: 'ex1', attemptId: 'att1', candidateCode: 'SF01', questions: [{ id: 'q1' }, { id: 'q2' }], seed: 'seed1' });
  assert.match(dna.dna_id, /^DNA-/);
  const ht = sec.injectExamHoneytokens([{ id: 'q1', question: '2 + 2 bằng bao nhiêu?', options: ['3', '4'] }], 'att1', 'SF01');
  assert.match(ht.canary_token, /^HTK-/);
  const leak = sec.traceHoneytokenLeak(`Rò rỉ đề câu hỏi có mã ${ht.canary_token}`, [{ id: 'att1', exam_id: 'ex1', candidate_code: 'SF01', started_at: '2026-10-30T01:00:00Z' }], [{ id: 'q1', question: '2 + 2 bằng bao nhiêu?' }]);
  assert.equal(leak.leak_detected, true);
  assert.equal(leak.matched_sources[0].attempt_id, 'att1');
  const sim = sec.runAdversarialExamSimulation();
  assert.equal(sim.total_scenarios, 8);
  assert.equal(sim.true_positive_rate_percent, 100);
  assert.equal(sim.false_positive_rate_percent, 0);
});

console.log(`EXAM VALIDATION: ${checks}/${checks} PASS`);
