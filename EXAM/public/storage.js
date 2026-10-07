const memory=new Map();let restricted=false;
const read=(store,key)=>{try{return globalThis[store].getItem(key)}catch{restricted=true;return memory.get(`${store}:${key}`)||null}};
const write=(store,key,value)=>{try{globalThis[store].setItem(key,value);return true}catch{restricted=true;memory.set(`${store}:${key}`,value);return false}};
const remove=(store,key)=>{try{globalThis[store].removeItem(key)}catch{}memory.delete(`${store}:${key}`)};
const keys=['slcs_exam_access','slcs_exam_attempt','slcs_exam_mode','slcs_exam_invite','slcs_exam_candidate','slcs_exam_session_id'];
const newSessionId=()=>globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
export function getSession(){let candidate={};try{candidate=JSON.parse(read('sessionStorage',keys[4])||'{}')}catch{}if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))candidate={};let sessionId=read('sessionStorage',keys[5])||'';if(!sessionId){sessionId=newSessionId();write('sessionStorage',keys[5],sessionId)}return {token:read('sessionStorage',keys[0])||'',attempt:read('sessionStorage',keys[1])||'',mode:read('sessionStorage',keys[2])||'user',invite:read('sessionStorage',keys[3])||'',candidate,sessionId}}
export function setSession(token,attempt,mode='user',invite='',candidate={},sessionId=''){const sid=sessionId||read('sessionStorage',keys[5])||newSessionId();[token,attempt,mode,invite,JSON.stringify(candidate),sid].forEach((v,i)=>write('sessionStorage',keys[i],String(v||'')));return sid}
export const clearSession=()=>keys.slice(0,5).forEach(k=>remove('sessionStorage',k));
export const storageRestricted=()=>restricted;
export function saveLocal(id,answers,events,ui={},meta={}){if(!id)return false;return write('localStorage',`slcs_exam_${id}`,JSON.stringify({answers,events,ui,...meta,at:Date.now()}))}
export function loadLocal(id){try{return JSON.parse(read('localStorage',`slcs_exam_${id}`)||'null')}catch{return null}}
export const clearLocal=id=>remove('localStorage',`slcs_exam_${id}`);
const owner=globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2);let owned='';
export function acquireLease(id){const key=`slcs_exam_lock_${id}`;let lease=null;try{lease=JSON.parse(read('localStorage',key)||'null')}catch{}if(lease&&lease.owner!==owner&&lease.until>Date.now())return false;write('localStorage',key,JSON.stringify({owner,until:Date.now()+20000}));owned=id;return true}
export function renewLease(){return !owned||acquireLease(owned)}
export function releaseLease(){if(!owned)return;const key=`slcs_exam_lock_${owned}`;let lease=null;try{lease=JSON.parse(read('localStorage',key)||'null')}catch{}if(lease?.owner===owner)remove('localStorage',key);owned=''}
