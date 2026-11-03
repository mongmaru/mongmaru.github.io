// Browser timeout signals count active time. Recheck elapsed time when a page
// resumes so a request from before sleep cannot retain the synchronization lock.
export async function requestDeadline(work, milliseconds, {signal, now=Date.now}={}) {
 const controller=new AbortController(),timeout=AbortSignal.timeout(milliseconds),until=now()+milliseconds;
 const sources=[timeout,signal].filter(Boolean),listeners=[];
 const abort=source=>{if(!controller.signal.aborted)controller.abort(source.reason);};
 for(const source of sources){const listener=()=>abort(source);listeners.push([source,listener]);source.addEventListener('abort',listener,{once:true});if(source.aborted)abort(source);}
 const check=()=>{if(now()>=until&&!controller.signal.aborted)controller.abort(new DOMException('Request deadline elapsed','TimeoutError'));};
 const events=[[globalThis.window,'pageshow'],[globalThis.window,'online'],[globalThis.document,'visibilitychange'],[globalThis.document,'resume']];
 for(const [target,event]of events)target?.addEventListener?.(event,check);
 let onAbort;
 const aborted=new Promise((_,reject)=>{onAbort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',onAbort,{once:true});if(controller.signal.aborted)onAbort();});
 try{return await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return work(controller.signal);}),aborted]);}
 finally{
  for(const [source,listener]of listeners)source.removeEventListener('abort',listener);
  for(const [target,event]of events)target?.removeEventListener?.(event,check);
  controller.signal.removeEventListener('abort',onAbort);
 }
}
