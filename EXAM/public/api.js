export const API_ORIGIN='';
export async function apiRequest(path,{token='',sessionId='',timeout=18000,...options}={}){
 if(!/^\/api\//.test(path))throw new Error('Đường dẫn yêu cầu không hợp lệ.');
 const headers=new Headers(options.headers||{});if(token)headers.set('authorization',`Bearer ${token}`);if(sessionId)headers.set('x-exam-session',sessionId);
 if(options.body&&!(options.body instanceof FormData)&&!headers.has('content-type'))headers.set('content-type','application/json');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);let response,payload;
 try{response=await fetch(API_ORIGIN+path,{...options,headers,signal:controller.signal,credentials:'omit',cache:'no-store'});try{payload=await response.json()}catch(cause){if(cause.name==='AbortError')throw cause;payload=null}
 if(!payload||typeof payload!=='object'||Array.isArray(payload)){const error=new Error('Máy chủ trả phản hồi không hợp lệ. Vui lòng thử lại.');error.status=response.status;throw error}
 if(!response.ok||payload.ok===false){const error=new Error(payload.message||`Yêu cầu thất bại (${response.status}).`);error.status=response.status;error.detail=payload.detail;error.code=payload.detail?.code||payload.code||'';throw error}return payload;
 }catch(cause){if(cause.status)throw cause;const error=new Error(cause.name==='AbortError'?'Kết nối máy chủ quá thời gian chờ.':'Không thể kết nối máy chủ.');error.network=true;error.cause=cause;throw error}finally{clearTimeout(timer)}
}
