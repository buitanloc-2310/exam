const ACCESS = 'slcs_exam_access';
const ATTEMPT = 'slcs_exam_attempt';
export const getSession = () => ({ token: sessionStorage.getItem(ACCESS) || '', attempt: sessionStorage.getItem(ATTEMPT) || '' });
export const setSession = (token, attempt) => { sessionStorage.setItem(ACCESS, token); sessionStorage.setItem(ATTEMPT, attempt); };
export const clearSession = () => { sessionStorage.removeItem(ACCESS); sessionStorage.removeItem(ATTEMPT); };
const localKey = id => `slcs_exam_${id}`;
export function saveLocal(id, answers, events) { if (!id) return; localStorage.setItem(localKey(id), JSON.stringify({ answers, events, at: Date.now() })); }
export function loadLocal(id) { try { return JSON.parse(localStorage.getItem(localKey(id)) || 'null'); } catch { return null; } }
export function clearLocal(id) { if (id) localStorage.removeItem(localKey(id)); }
