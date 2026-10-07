/** Local SLCS + EXAM integration test. Supply the SLCS src/index.js path; no network or production DB is used. */
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import examWorker from '../src/index.js';
import {apiRequest} from '../public/api.js';

const source=process.argv[2];if(!source){console.error('Usage: node scripts/validate-integration.mjs /absolute/path/to/SLCS/src/index.js');process.exit(2)}
const {handleApiRequest}=await import(pathToFileURL(path.resolve(source)).href);
const db=new DatabaseSync(':memory:');
class Stmt{constructor(sql,params=[]){this.sql=sql;this.params=params}bind(...params){return new Stmt(this.sql,params)}async first(){return db.prepare(this.sql).get(...this.params)||null}async all(){return {results:db.prepare(this.sql).all(...this.params)}}async run(){const x=db.prepare(this.sql).run(...this.params);return {success:true,meta:{changes:Number(x.changes)}}}}
const DB={prepare:sql=>new Stmt(sql),batch:async statements=>{db.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
const FILES={put:async()=>{},delete:async()=>{},get:async()=>null};
const slcsEnv={DB,SETUP_TOKEN:'integration-only-token',APP_URL:'https://slc.skyfirst.io.vn',EXAM_URL:'https://exam.skyfirst.io.vn'};
const examEnv={DB,FILES,ASSETS:{fetch:async()=>new Response('not-found',{status:404})}};
const pending=[];const ctx={waitUntil:p=>pending.push(p)};let cookie='';
async function slcs(url,body,method){const verb=method||(body===undefined?'GET':'POST');const r=await handleApiRequest(new Request(slcsEnv.APP_URL+url,{method:verb,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),slcsEnv,ctx);const value=await r.json();assert.equal(r.status,200,`${verb} ${url}: ${JSON.stringify(value)}`);if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return value}
await slcs('/api/setup/install',{setup_token:slcsEnv.SETUP_TOKEN});
await slcs('/api/setup/bootstrap',{setup_token:slcsEnv.SETUP_TOKEN,email:'integration@example.test',password:'IntegrationPassword123!',full_name:'Integration'});
await slcs('/api/auth/login',{login:'integration@example.test',password:'IntegrationPassword123!'});
const cls=await slcs('/api/classes',{name:'Integration class'});
const ex=await slcs(`/api/classes/${cls.id}/exams`,{title:'Integration exam',public_access:true,questions:[{id:'q1',type:'mcq',question:'2+2?',options:['3','4'],answer:'4',points:1}]});
// Follow the real lifecycle so publish seals an immutable package.
await slcs(`/api/exams/${ex.id}`,{status:'review'},'PATCH');
await slcs(`/api/exams/${ex.id}`,{status:'approved'},'PATCH');
await slcs(`/api/exams/${ex.id}`,{status:'published'},'PATCH');

const oldFetch=globalThis.fetch;let slcsOnline=true;
globalThis.fetch=async(input,opt={})=>{const absolute=new URL(typeof input==='string'?input:input.url,slcsEnv.EXAM_URL);const req=new Request(absolute,{...opt,headers:new Headers(opt.headers||{})});if(absolute.origin===slcsEnv.EXAM_URL)return examWorker.fetch(req,examEnv);if(absolute.origin===slcsEnv.APP_URL){if(!slcsOnline)throw new Error('SLCS intentionally unavailable in resilience test');return handleApiRequest(req,slcsEnv,ctx)}throw new Error('Unexpected network target '+absolute.origin)};
let count=0;const pass=name=>{count++;console.log('PASS '+name)};
const sessionA='integration-session-0000000000001',sessionB='integration-session-0000000000002';
try{
 const start=await slcs(`/api/exams/${ex.id}/start`,{});const launch=await slcs(`/api/exam-attempts/${start.attempt_id}/launch`,{});const launchToken=new URL(launch.launch_url).searchParams.get('launch');const redeemed=await apiRequest('/api/public/exam-launch/redeem',{method:'POST',body:JSON.stringify({launch_token:launchToken})});assert.equal(redeemed.attempt_id,start.attempt_id);pass('launch token redeemed directly by EXAM using shared D1');
 slcsOnline=false;const opts={token:redeemed.access_token,sessionId:sessionA};const r=await apiRequest(`/api/exam-attempts/${start.attempt_id}`,opts);assert.equal(r.exam.questions[0].answer,undefined);assert.ok(r.remaining_seconds>0);pass('EXAM loads attempt from D1 while SLCS control plane is unavailable');slcsOnline=true;
 await assert.rejects(apiRequest(`/api/exam-attempts/${start.attempt_id}`,{token:redeemed.access_token,sessionId:sessionB}),e=>e.code==='SESSION_CONFLICT');pass('second tab/device cannot claim concurrent write lease');
 const saved=await apiRequest(`/api/exam-attempts/${start.attempt_id}/save`,{...opts,method:'POST',body:JSON.stringify({answers:{q1:'4'},events:[],revision:r.answer_revision})});assert.equal(saved.answer_revision,1);pass('revisioned answer saved on EXAM runtime');
 await assert.rejects(apiRequest(`/api/exam-attempts/${start.attempt_id}/save`,{...opts,method:'POST',body:JSON.stringify({answers:{q1:'3'},revision:0})}),e=>e.code==='REVISION_CONFLICT');pass('stale revision rejected');
 const result=await apiRequest(`/api/exam-attempts/${start.attempt_id}/submit`,{...opts,method:'POST',body:JSON.stringify({answers:{q1:'4'},events:[],revision:1})});assert.equal(result.score,1);assert.ok(result.receipt_code);pass('submission is scored and returns server receipt');
 const repeated=await apiRequest(`/api/exam-attempts/${start.attempt_id}/submit`,{...opts,method:'POST',body:JSON.stringify({answers:{q1:'3'},events:[],revision:1})});assert.equal(repeated.receipt_code,result.receipt_code);assert.equal(repeated.score,1);pass('repeat submit is idempotent');
 // Guest creation is a control-plane action; execution after start is direct on EXAM.
 const pub=db.prepare('SELECT public_token FROM exams WHERE id=?').get(ex.id).public_token;
 const guest=await slcs(`/api/public/assessments/${pub}/start`,{full_name:'Guest',email:'guest@example.test',candidate_code:'TEST',class_name:'Integration'});
 const guestOpts={token:guest.access_key,sessionId:'guest-session-000000000000001'};const gr=await apiRequest(`/api/public/exam-attempts/${guest.attempt_id}`,guestOpts);assert.ok(gr.exam.questions.length);assert.equal(gr.exam.questions[0].answer,undefined);pass('guest attempt executes directly on EXAM');
 const gs=await apiRequest(`/api/public/exam-attempts/${guest.attempt_id}/save`,{...guestOpts,method:'POST',body:JSON.stringify({answers:{q1:'4'},revision:gr.answer_revision,events:[]})});const done=await apiRequest(`/api/public/exam-attempts/${guest.attempt_id}/submit`,{...guestOpts,method:'POST',body:JSON.stringify({answers:{q1:'4'},revision:gs.answer_revision,events:[]})});assert.equal(done.score,1);assert.ok(done.receipt_code);pass('guest save and submit use direct D1 runtime');
 // Deadline is server-authoritative: accepted data is preserved, later edits are rejected and finalization is idempotent.
 const late=await slcs(`/api/public/assessments/${pub}/start`,{full_name:'Late Guest',email:'late@example.test',candidate_code:'LATE',class_name:'Integration'});const lateOpts={token:late.access_key,sessionId:'late-session-000000000000001'};const lr=await apiRequest(`/api/public/exam-attempts/${late.attempt_id}`,lateOpts);const ls=await apiRequest(`/api/public/exam-attempts/${late.attempt_id}/save`,{...lateOpts,method:'POST',body:JSON.stringify({answers:{q1:'4'},revision:lr.answer_revision,events:[]})});db.prepare(`UPDATE exam_guest_attempts SET started_at='2020-01-01 00:00:00' WHERE id=?`).run(late.attempt_id);await assert.rejects(apiRequest(`/api/public/exam-attempts/${late.attempt_id}/save`,{...lateOpts,method:'POST',body:JSON.stringify({answers:{q1:'3'},revision:ls.answer_revision,events:[]})}),e=>e.status===409&&e.detail?.status==='submitted');const lateRow=db.prepare('SELECT answers_json,status,score FROM exam_guest_attempts WHERE id=?').get(late.attempt_id);assert.equal(JSON.parse(lateRow.answers_json).q1,'4');assert.equal(lateRow.status,'submitted');assert.equal(lateRow.score,1);const lateDone=await apiRequest(`/api/public/exam-attempts/${late.attempt_id}/submit`,{...lateOpts,method:'POST',body:JSON.stringify({answers:{q1:'3'},revision:ls.answer_revision})});assert.equal(lateDone.score,1);pass('hard deadline rejects late edits, preserves last accepted answer and submits once');
 const health=await examWorker.fetch(new Request(slcsEnv.EXAM_URL+'/health'),examEnv);const hj=await health.json();assert.equal(health.status,200);assert.equal(hj.runtime.control_plane,'independent-after-launch');pass('EXAM health confirms independent attempt runtime');
 console.log(`EXAM / SLCS INTEGRATION: ${count}/${count} PASS`);
}finally{globalThis.fetch=oldFetch;await Promise.allSettled(pending);db.close()}
