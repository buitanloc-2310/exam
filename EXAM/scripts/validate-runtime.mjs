/** Standalone EXAM runtime integration tests using an ephemeral SQLite database. No SLCS source, network, or production binding is used. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import examWorker from '../src/index.js';

const db=new DatabaseSync(':memory:');
const schema=`
PRAGMA foreign_keys=ON;
CREATE TABLE exams(id TEXT PRIMARY KEY,title TEXT,instructions TEXT,duration_minutes INTEGER,time_limit_enabled INTEGER,strict_mode INTEGER,fullscreen_required INTEGER,show_score INTEGER,assessment_type TEXT,assessment_label TEXT,center_label TEXT,result_policy TEXT,result_release_at TEXT,closes_at TEXT,status TEXT,security_profile TEXT,allow_clipboard INTEGER,allow_paste INTEGER,allow_external_links INTEGER,device_policy TEXT,resume_policy TEXT,calculator_policy TEXT,question_json TEXT,class_id TEXT,sealed_version_id TEXT);
CREATE TABLE users(id TEXT PRIMARY KEY,full_name TEXT,sfn_id TEXT,email TEXT,status TEXT);
CREATE TABLE classes(id TEXT PRIMARY KEY,name TEXT);
CREATE TABLE assessment_exam_versions(id TEXT PRIMARY KEY,snapshot_json TEXT);
CREATE TABLE exam_attempts(id TEXT PRIMARY KEY,exam_id TEXT,user_id TEXT,status TEXT,started_at TEXT,duration_minutes INTEGER,time_limit_enabled INTEGER,extra_time_minutes INTEGER DEFAULT 0,answers_json TEXT,event_log_json TEXT,score REAL,max_score REAL,submitted_at TEXT,last_saved_at TEXT,answer_revision INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT);
CREATE TABLE exam_guest_attempts(id TEXT PRIMARY KEY,exam_id TEXT,status TEXT,started_at TEXT,duration_minutes INTEGER,time_limit_enabled INTEGER,extra_time_minutes INTEGER DEFAULT 0,answers_json TEXT,event_log_json TEXT,score REAL,max_score REAL,submitted_at TEXT,last_saved_at TEXT,answer_revision INTEGER DEFAULT 0,question_snapshot_json TEXT,exam_version_id TEXT,access_key TEXT,full_name TEXT,candidate_code TEXT,class_name TEXT);
CREATE TABLE exam_access_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,attempt_id TEXT,expires_at TEXT,created_at TEXT);
CREATE TABLE exam_launch_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT,attempt_id TEXT,expires_at TEXT,used_at TEXT);
CREATE TABLE assessment_attempt_leases(attempt_id TEXT,source TEXT,session_id TEXT,claimed_at TEXT,last_seen_at TEXT,PRIMARY KEY(attempt_id,source));
CREATE TABLE assessment_answer_revisions(id TEXT PRIMARY KEY,attempt_id TEXT,source TEXT,revision INTEGER,answers_json TEXT,events_json TEXT,accepted_at TEXT,UNIQUE(attempt_id,revision));
CREATE TABLE assessment_response_files(id TEXT PRIMARY KEY,attempt_id TEXT,source TEXT,question_id TEXT,file_id TEXT,status TEXT,created_at TEXT);
CREATE TABLE files(id TEXT PRIMARY KEY,owner_user_id TEXT,r2_key TEXT,name TEXT,mime TEXT,size INTEGER,visibility TEXT,created_at TEXT);
CREATE TABLE assessment_manual_grades(id TEXT PRIMARY KEY,attempt_id TEXT,question_id TEXT,grader_user_id TEXT,score REAL,feedback TEXT,status TEXT,created_at TEXT,updated_at TEXT,UNIQUE(attempt_id,question_id));
CREATE TABLE assessment_receipts(id TEXT PRIMARY KEY,attempt_id TEXT,receipt_code TEXT,payload_json TEXT,created_at TEXT,UNIQUE(attempt_id));
CREATE TABLE assessment_result_workflows(attempt_id TEXT PRIMARY KEY,source TEXT,state TEXT,updated_at TEXT);
CREATE TABLE exam_audit_log(id TEXT PRIMARY KEY,exam_id TEXT,attempt_id TEXT,actor_user_id TEXT,event_type TEXT,detail_json TEXT);
`;
db.exec(schema);
class Statement{
  constructor(sql,params=[]){this.sql=sql;this.params=params}
  bind(...params){return new Statement(this.sql,params)}
  async first(){return db.prepare(this.sql).get(...this.params)||null}
  async all(){return {results:db.prepare(this.sql).all(...this.params)}}
  async run(){const result=db.prepare(this.sql).run(...this.params);return {success:true,meta:{changes:Number(result.changes)}}}
}
const DB={
  prepare:sql=>new Statement(sql),
  async batch(statements){db.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());db.exec('COMMIT');return results}catch(error){db.exec('ROLLBACK');throw error}}
};
const env={DB,FILES:{async put(){},async delete(){},async get(){return null}},ASSETS:{async fetch(){return new Response('not found',{status:404})}}};
const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
let checks=0;
async function test(name,run){await run();console.log('PASS runtime '+name);checks++}
function addExamAttempt({id,examId=id,questions,showScore=1,status='in_progress',answers={},revision=0}){
  db.prepare(`INSERT INTO exams(id,title,instructions,duration_minutes,time_limit_enabled,strict_mode,fullscreen_required,show_score,assessment_type,assessment_label,center_label,result_policy,result_release_at,closes_at,status,security_profile,allow_clipboard,allow_paste,allow_external_links,device_policy,resume_policy,calculator_policy,question_json,class_id,sealed_version_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    examId,'Runtime Test','Instructions',60,1,0,0,showScore,'assessment','Assessment','Sky First','score_after_submit',null,null,'published','STANDARD',1,1,0,'single_session','same_session','disabled',JSON.stringify(questions),null,null
  );
  db.prepare(`INSERT INTO users(id,full_name,sfn_id,email,status) VALUES(?,?,?,?,?)`).run('user-'+id,'Test Candidate','SFN-'+id,'candidate@example.test','active');
  db.prepare(`INSERT INTO exam_attempts(id,exam_id,user_id,status,started_at,duration_minutes,time_limit_enabled,extra_time_minutes,answers_json,event_log_json,score,max_score,submitted_at,last_saved_at,answer_revision,question_snapshot_json,exam_version_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,examId,'user-'+id,status,now(),60,1,0,JSON.stringify(answers),'[]',null,null,null,null,revision,null,null
  );
  const rawToken='access-token-'+id+'-0123456789abcdef';
  db.prepare(`INSERT INTO exam_access_tokens(token_hash,user_id,attempt_id,expires_at,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)`).run(hash(rawToken),'user-'+id,id,new Date(Date.now()+60*60*1000).toISOString());
  return {token:rawToken,session:'runtime-session-'+id+'-0123456789'};
}
async function call(path,{token,session,method='GET',body}={}){
  return examWorker.fetch(new Request('https://exam.test'+path,{method,headers:{...(token?{authorization:`Bearer ${token}`} :{}),...(session?{'x-exam-session':session}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})}),env);
}
try{
  const qs=[{id:'q1',type:'mcq',question:'2+2?',options:['3','4'],answer:'4',answer_key:'must-not-leak',rubric:{answer:'must-not-leak'},points:1}];
  const access=addExamAttempt({id:'attempt-runtime',questions:qs});
  let response=await call('/api/exam-attempts/attempt-runtime',{...access});
  let value=await response.json();
  await test('load attempt returns no answer/rubric metadata',()=>{assert.equal(response.status,200);assert.equal(value.exam.questions[0].answer,undefined);assert.equal(value.exam.questions[0].answer_key,undefined);assert.equal(value.exam.questions[0].rubric,undefined);assert.equal(value.exam.questions[0].question,'2+2?')});

  response=await call('/api/exam-attempts/attempt-runtime/save',{...access,method:'POST',body:{revision:value.answer_revision,answers:{q1:'4',unknown_field:'private'},events:[{type:'exam_enter',at:now(),fullscreen:false,token:'do-not-store'},{type:'ui_state'}]}});
  value=await response.json();
  await test('save persists revisioned sanitized answers and events',()=>{assert.equal(response.status,200);assert.equal(value.answer_revision,1);const row=db.prepare('SELECT answers_json,event_log_json,answer_revision FROM exam_attempts WHERE id=?').get('attempt-runtime');assert.deepEqual(JSON.parse(row.answers_json),{q1:'4'});assert.equal(row.answer_revision,1);const history=db.prepare('SELECT revision,answers_json FROM assessment_answer_revisions WHERE attempt_id=? AND revision=1').get('attempt-runtime');assert.equal(history.revision,1);assert.deepEqual(JSON.parse(history.answers_json),{q1:'4'});const events=JSON.parse(row.event_log_json);assert.equal(events.length,1);assert.equal(events[0].token,undefined)});

  response=await call('/api/exam-attempts/attempt-runtime/save',{...access,method:'POST',body:{revision:0,answers:{q1:'3'},events:[]}});
  value=await response.json();
  await test('stale save is rejected with revision conflict',()=>{assert.equal(response.status,409);assert.equal(value.detail.code,'REVISION_CONFLICT')});

  response=await call('/api/exam-attempts/attempt-runtime/submit',{...access,method:'POST',body:{revision:1,answers:{q1:'3'},events:[]}});
  value=await response.json();
  await test('submit scores only the server-accepted snapshot, not client-supplied answers',()=>{assert.equal(response.status,200);assert.equal(value.status,'submitted');assert.equal(value.score,1);assert.equal(value.max_score,1);assert.ok(value.receipt_code);const row=db.prepare('SELECT answers_json,score,status FROM exam_attempts WHERE id=?').get('attempt-runtime');assert.deepEqual(JSON.parse(row.answers_json),{q1:'4'});assert.equal(row.score,1);assert.equal(row.status,'submitted');assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_audit_log WHERE attempt_id=? AND event_type='attempt.submitted'").get('attempt-runtime').n,1);assert.equal(db.prepare('SELECT state FROM assessment_result_workflows WHERE attempt_id=?').get('attempt-runtime').state,'graded')});

  response=await call('/api/exam-attempts/attempt-runtime/submit',{...access,method:'POST',body:{revision:1,answers:{q1:'3'}}});
  value=await response.json();
  await test('duplicate submit is idempotent',()=>{assert.equal(response.status,200);assert.equal(value.score,1);assert.equal(value.receipt_code,db.prepare('SELECT receipt_code FROM assessment_receipts WHERE attempt_id=?').get('attempt-runtime').receipt_code)});

  addExamAttempt({id:'attempt-manual',questions:[{id:'essay1',type:'essay',question:'Explain',answer:'not-public',points:3}]});
  const manual=db.prepare('SELECT token_hash,user_id,attempt_id FROM exam_access_tokens WHERE attempt_id=?').get('attempt-manual');
  const rawManual='access-token-attempt-manual-0123456789abcdef';
  // Replace the hashed token with a known test-only value for this attempt.
  db.prepare('DELETE FROM exam_access_tokens WHERE attempt_id=?').run('attempt-manual');
  db.prepare('INSERT INTO exam_access_tokens(token_hash,user_id,attempt_id,expires_at,created_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP)').run(hash(rawManual),manual.user_id,manual.attempt_id,new Date(Date.now()+60*60*1000).toISOString());
  const manualAccess={token:rawManual,session:'runtime-session-manual-0123456789'};
  response=await call('/api/exam-attempts/attempt-manual',{...manualAccess});value=await response.json();
  response=await call('/api/exam-attempts/attempt-manual/save',{...manualAccess,method:'POST',body:{revision:0,answers:{essay1:'My essay'},events:[]}});value=await response.json();
  response=await call('/api/exam-attempts/attempt-manual/submit',{...manualAccess,method:'POST',body:{revision:1}});value=await response.json();
  await test('manual grading stays pending and auto-score is hidden until publication',()=>{assert.equal(response.status,200);assert.equal(value.status,'submitted');assert.equal(value.show_score,false);assert.equal(value.score,null);assert.equal(value.pending_manual,1);const grade=db.prepare('SELECT status FROM assessment_manual_grades WHERE attempt_id=?').get('attempt-manual');assert.equal(grade.status,'draft');assert.equal(db.prepare('SELECT state FROM assessment_result_workflows WHERE attempt_id=?').get('attempt-manual').state,'marking')});

  // A failed revision-history write must roll back the answer snapshot and revision update together.
  const saveAtomic=addExamAttempt({id:'attempt-save-atomic',questions:qs});
  db.exec(`CREATE TRIGGER fail_revision_write BEFORE INSERT ON assessment_answer_revisions WHEN NEW.attempt_id='attempt-save-atomic' BEGIN SELECT RAISE(ABORT,'test-only revision journal failure'); END;`);
  response=await call('/api/exam-attempts/attempt-save-atomic/save',{...saveAtomic,method:'POST',body:{revision:0,answers:{q1:'4'},events:[]}});value=await response.json();
  const rowAfterSaveFailure=db.prepare('SELECT answer_revision,answers_json FROM exam_attempts WHERE id=?').get('attempt-save-atomic');
  db.exec('DROP TRIGGER fail_revision_write');
  await test('answer save rolls back if revision journal cannot be persisted',()=>{assert.equal(response.status,500);assert.equal(rowAfterSaveFailure.answer_revision,0);assert.deepEqual(JSON.parse(rowAfterSaveFailure.answers_json),{})});

  // A failed submission audit write must not leave the attempt marked submitted without its transaction-bound audit.
  const submitAtomic=addExamAttempt({id:'attempt-submit-atomic',questions:qs});
  await call('/api/exam-attempts/attempt-submit-atomic/save',{...submitAtomic,method:'POST',body:{revision:0,answers:{q1:'4'},events:[]}});
  db.exec(`CREATE TRIGGER fail_submit_audit BEFORE INSERT ON exam_audit_log WHEN NEW.attempt_id='attempt-submit-atomic' AND NEW.event_type='attempt.submitted' BEGIN SELECT RAISE(ABORT,'test-only audit failure'); END;`);
  const failedSubmitResponse=await call('/api/exam-attempts/attempt-submit-atomic/submit',{...submitAtomic,method:'POST',body:{revision:1}});
  const failedSubmitPayload=await failedSubmitResponse.json();
  const stateAfterFailedSubmit=db.prepare('SELECT status,score FROM exam_attempts WHERE id=?').get('attempt-submit-atomic');
  db.exec('DROP TRIGGER fail_submit_audit');
  const recoveredSubmitResponse=await call('/api/exam-attempts/attempt-submit-atomic/submit',{...submitAtomic,method:'POST',body:{revision:1}});
  const recoveredSubmitPayload=await recoveredSubmitResponse.json();
  await test('submission state and audit log are atomic and recover after audit failure',()=>{assert.equal(failedSubmitResponse.status,500);assert.ok(failedSubmitPayload.ok===false);assert.equal(stateAfterFailedSubmit.status,'in_progress');assert.equal(stateAfterFailedSubmit.score,null);assert.equal(recoveredSubmitResponse.status,200);assert.equal(recoveredSubmitPayload.status,'submitted');assert.equal(db.prepare("SELECT COUNT(*) n FROM exam_audit_log WHERE attempt_id=? AND event_type='attempt.submitted'").get('attempt-submit-atomic').n,1)});

  // A receipt failure must not return a fabricated receipt code; retry can persist and return a real receipt.
  const receiptAtomic=addExamAttempt({id:'attempt-receipt-atomic',questions:qs});
  await call('/api/exam-attempts/attempt-receipt-atomic/save',{...receiptAtomic,method:'POST',body:{revision:0,answers:{q1:'4'},events:[]}});
  db.exec(`CREATE TRIGGER fail_receipt_write BEFORE INSERT ON assessment_receipts WHEN NEW.attempt_id='attempt-receipt-atomic' BEGIN SELECT RAISE(ABORT,'test-only receipt failure'); END;`);
  const failedReceiptResponse=await call('/api/exam-attempts/attempt-receipt-atomic/submit',{...receiptAtomic,method:'POST',body:{revision:1}});
  const failedReceiptPayload=await failedReceiptResponse.json();
  const missingReceipt=db.prepare('SELECT receipt_code FROM assessment_receipts WHERE attempt_id=?').get('attempt-receipt-atomic');
  db.exec('DROP TRIGGER fail_receipt_write');
  const recoveredReceiptResponse=await call('/api/exam-attempts/attempt-receipt-atomic/submit',{...receiptAtomic,method:'POST',body:{revision:1}});
  const recoveredReceiptPayload=await recoveredReceiptResponse.json();
  await test('receipt failure is reported until a receipt is durably persisted',()=>{assert.equal(failedReceiptResponse.status,500);assert.equal(failedReceiptPayload.ok,false);assert.equal(missingReceipt,undefined);assert.equal(recoveredReceiptResponse.status,200);assert.ok(recoveredReceiptPayload.receipt_code);assert.equal(db.prepare('SELECT receipt_code FROM assessment_receipts WHERE attempt_id=?').get('attempt-receipt-atomic').receipt_code,recoveredReceiptPayload.receipt_code)});

  // Launch redemption is single-use and only inserts an access token when claim succeeds.
  const launchAttempt=addExamAttempt({id:'attempt-launch-runtime',questions:qs});
  const rawLaunch='launch-runtime-token-0123456789abcdef';
  const dbExpiry=new Date(Date.now()+60*60*1000).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'');
  db.prepare('INSERT INTO exam_launch_tokens(token_hash,user_id,attempt_id,expires_at,used_at) VALUES(?,?,?,?,NULL)').run(hash(rawLaunch),'user-attempt-launch-runtime','attempt-launch-runtime',dbExpiry);
  const accessCountBefore=db.prepare('SELECT COUNT(*) n FROM exam_access_tokens WHERE attempt_id=?').get('attempt-launch-runtime').n;
  const firstRedemption=await call('/api/public/exam-launch/redeem',{method:'POST',body:{launch_token:rawLaunch}});
  const firstRedemptionPayload=await firstRedemption.json();
  await test('launch redemption accepts a valid SQLite UTC timestamp and persists one access token',()=>{assert.equal(firstRedemption.status,200);assert.ok(firstRedemptionPayload.access_token);assert.ok(firstRedemptionPayload.attempt_id);assert.equal(db.prepare('SELECT COUNT(*) n FROM exam_access_tokens WHERE attempt_id=?').get('attempt-launch-runtime').n,accessCountBefore+1)});
  const replayRedemption=await call('/api/public/exam-launch/redeem',{method:'POST',body:{launch_token:rawLaunch}});
  const replayPayload=await replayRedemption.json();
  // Simulate a stale read in a competing request: it sees the token as unused, but the UPDATE must claim zero rows.
  const racingDb={prepare(sql){const statement=DB.prepare(sql);if(sql.includes('SELECT token_hash,user_id,attempt_id,expires_at,used_at FROM exam_launch_tokens'))return {bind(...params){const bound=statement.bind(...params);return {async first(){const row=await bound.first();return row?{...row,used_at:null}:row}}}};return statement},batch:(statements)=>DB.batch(statements)};
  const racingRequest=await examWorker.fetch(new Request('https://exam.test/api/public/exam-launch/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({launch_token:rawLaunch})}),{...env,DB:racingDb});
  const racingPayload=await racingRequest.json();
  await test('replayed/racing launch token is rejected without an orphan access token',()=>{assert.ok([401,409].includes(replayRedemption.status));assert.equal(replayPayload.ok,false);assert.equal(racingRequest.status,409);assert.equal(racingPayload.ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM exam_access_tokens WHERE attempt_id=?').get('attempt-launch-runtime').n,accessCountBefore+1)});

  const invalidExpiryAttempt=addExamAttempt({id:'attempt-launch-invalid-expiry',questions:qs});
  const invalidExpiryToken='launch-invalid-expiry-0123456789abcdef';
  db.prepare('INSERT INTO exam_launch_tokens(token_hash,user_id,attempt_id,expires_at,used_at) VALUES(?,?,?,?,NULL)').run(hash(invalidExpiryToken),'user-attempt-launch-invalid-expiry','attempt-launch-invalid-expiry','not-a-date');
  const invalidExpiryResponse=await call('/api/public/exam-launch/redeem',{method:'POST',body:{launch_token:invalidExpiryToken}});
  const invalidExpiryPayload=await invalidExpiryResponse.json();
  await test('malformed launch expiry is rejected instead of treated as non-expiring',()=>{assert.equal(invalidExpiryResponse.status,401);assert.equal(invalidExpiryPayload.ok,false);assert.equal(db.prepare('SELECT COUNT(*) n FROM exam_access_tokens WHERE attempt_id=?').get('attempt-launch-invalid-expiry').n,1)});

  response=await call('/health');value=await response.json();
  await test('health checks the required local schema and R2 binding',()=>{assert.equal(response.status,200);assert.equal(value.status,'available');assert.equal(value.dependencies.d1,'available');assert.equal(value.dependencies.r2_binding,'configured');assert.equal(Object.values(value.schema).every(v=>v==='available'),true)});

  const missingEnv={...env,DB:{prepare(sql){return {first(){if(sql.includes('assessment_manual_grades'))throw new Error('missing table');return {ok:1}}}}}};
  response=await examWorker.fetch(new Request('https://exam.test/health'),missingEnv);value=await response.json();
  await test('health fails closed when a required schema table is missing',()=>{assert.equal(response.status,503);assert.equal(value.status,'degraded');assert.ok(value.missing.includes('assessment_manual_grades'))});

  console.log(`EXAM RUNTIME VALIDATION: ${checks}/${checks} PASS`);
}finally{db.close()}
