const ACCESS='slcs_exam_access',ATTEMPT='slcs_exam_attempt',MODE='slcs_exam_mode',INVITE='slcs_exam_invite';
export const getSession=()=>({token:sessionStorage.getItem(ACCESS)||'',attempt:sessionStorage.getItem(ATTEMPT)||'',mode:sessionStorage.getItem(MODE)||'user',invite:sessionStorage.getItem(INVITE)||''});
export const setSession=(token,attempt,mode='user',invite='')=>{sessionStorage.setItem(ACCESS,token);sessionStorage.setItem(ATTEMPT,attempt);sessionStorage.setItem(MODE,mode);if(invite)sessionStorage.setItem(INVITE,invite);else sessionStorage.removeItem(INVITE)};
export const clearSession=()=>{[ACCESS,ATTEMPT,MODE,INVITE].forEach(k=>sessionStorage.removeItem(k))};
const localKey=id=>`slcs_exam_${id}`;
export function saveLocal(id,answers,events){if(id)localStorage.setItem(localKey(id),JSON.stringify({answers,events,at:Date.now()}))}
export function loadLocal(id){try{return JSON.parse(localStorage.getItem(localKey(id))||'null')}catch{return null}}
export function clearLocal(id){if(id)localStorage.removeItem(localKey(id))}
