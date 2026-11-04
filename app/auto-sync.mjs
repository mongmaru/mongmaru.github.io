// One automatic sync at a time. Keep edits arriving during a run; collapse
// duplicate lifecycle events so launch/pageshow/visibility do not repoll APIs.
export class AutomaticSync {
 constructor(work,{now=Date.now,foregroundInterval=60000,backgroundInterval=30000}={}){Object.assign(this,{work,now,foregroundInterval,backgroundInterval});this.lastForeground=-Infinity;this.lastBackground=-Infinity;}
 request(reason='foreground') {
  if(reason==='background'){
   this.lastForeground=-Infinity;
   if(this.now()-this.lastBackground<this.backgroundInterval)return this.running||Promise.resolve();
   this.lastBackground=this.now();
  }
  if(reason==='foreground'&&this.now()-this.lastForeground<this.foregroundInterval)return this.running||Promise.resolve();
  if(reason==='foreground')this.lastForeground=this.now();
  if(this.running){
   // A genuine resume must survive a request left running before suspension.
   // A full recovery also processes local edits; a local-only run can skip
   // unchanged services, so it must not replace the queued recovery.
   const priority={background:1,local:2,foreground:3,online:4};
   if(priority[reason]>(priority[this.pending]||0))this.pending=reason;
   return this.running;
  }
  this.pending=reason;
  this.running=Promise.resolve().then(async()=>{let result;while(this.pending){const next=this.pending;this.pending=null;try{result=await this.work(next);}catch{/* Next lifecycle event can recover without discarding queued edits. */}}return result;}).finally(()=>this.running=null);
  return this.running;
 }
}

// Start each independent service immediately, observing every failure without
// holding a healthy service behind another provider's stalled request.
export function runIndependentSync(...work){return Promise.allSettled(work.map(run=>Promise.resolve().then(run)));}

export function bindSyncLifecycle({page=globalThis.window,document=globalThis.document,foreground,background}){
 const invoke=work=>()=>{try{Promise.resolve(work()).catch(()=>{});}catch{}};
 const enter=invoke(foreground),leave=invoke(background),visibility=()=>document.hidden?leave():enter();
 const events=[[page,'pageshow',enter],[page,'pagehide',leave],[document,'visibilitychange',visibility],[document,'freeze',leave],[document,'resume',enter]];
 for(const [target,event,listener]of events)target?.addEventListener?.(event,listener);
 return ()=>{for(const [target,event,listener]of events)target?.removeEventListener?.(event,listener);};
}
