const memory=new Map();let restricted=false;
const read=(store,key)=>{try{return globalThis[store].getItem(key)}catch{restricted=true;return memory.get(`${store}:${key}`)||null}};
const write=(store,key,value)=>{try{globalThis[store].setItem(key,value);return true}catch{restricted=true;memory.set(`${store}:${key}`,value);return false}};
const remove=(store,key)=>{try{globalThis[store].removeItem(key)}catch{}memory.delete(`${store}:${key}`)};
const keys=['skyfirst_exam_access','skyfirst_exam_attempt','skyfirst_exam_mode','skyfirst_exam_invite','skyfirst_exam_candidate','skyfirst_exam_session_id'];
const adminKeys=['skyfirst_admin_token','skyfirst_admin_csrf','skyfirst_admin_user'];
const newSessionId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export function getSession(){let candidate={};try{candidate=JSON.parse(read('sessionStorage',keys[4])||'{}')}catch{}if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))candidate={};let sessionId=read('sessionStorage',keys[5])||'';if(!sessionId){sessionId=newSessionId();write('sessionStorage',keys[5],sessionId)}return {token:read('sessionStorage',keys[0])||'',attempt:read('sessionStorage',keys[1])||'',mode:read('sessionStorage',keys[2])||'user',invite:read('sessionStorage',keys[3])||'',candidate,sessionId}}
export function setSession(token,attempt,mode='user',invite='',candidate={},sessionId=''){const sid=sessionId||read('sessionStorage',keys[5])||newSessionId();[token,attempt,mode,invite,JSON.stringify(candidate),sid].forEach((v,i)=>write('sessionStorage',keys[i],String(v||'')));return sid}
export const clearSession=()=>keys.slice(0,5).forEach(k=>remove('sessionStorage',k));
export function getAdminSession(){let user=null;try{user=JSON.parse(read('sessionStorage',adminKeys[2])||'null')}catch{}return {token:read('sessionStorage',adminKeys[0])||'',csrf:read('sessionStorage',adminKeys[1])||'',user}}
export function setAdminSession(token='',csrf='',user=null){write('sessionStorage',adminKeys[0],String(token||''));write('sessionStorage',adminKeys[1],String(csrf||''));write('sessionStorage',adminKeys[2],JSON.stringify(user||null))}
export const clearAdminSession=()=>adminKeys.forEach(k=>remove('sessionStorage',k));
export const storageRestricted=()=>restricted;
export function saveLocal(id,answers,events,ui={},meta={}){if(!id)return false;return write('localStorage',`skyfirst_exam_${id}`,JSON.stringify({answers,events,ui,...meta,at:Date.now()}))}
export function loadLocal(id){try{return JSON.parse(read('localStorage',`skyfirst_exam_${id}`)||'null')}catch{return null}}
export const clearLocal=id=>remove('localStorage',`skyfirst_exam_${id}`);
const owner=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2);let owned='';
export function acquireLease(id){const key=`skyfirst_exam_lock_${id}`;let lease=null;try{lease=JSON.parse(read('localStorage',key)||'null')}catch{}if(lease&&lease.owner!==owner&&lease.until>Date.now())return false;write('localStorage',key,JSON.stringify({owner,until:Date.now()+20000}));owned=id;return true}
export function renewLease(){return !owned||acquireLease(owned)}
export function releaseLease(){if(!owned)return;const key=`skyfirst_exam_lock_${owned}`;let lease=null;try{lease=JSON.parse(read('localStorage',key)||'null')}catch{}if(lease?.owner===owner)remove('localStorage',key);owned=''}
