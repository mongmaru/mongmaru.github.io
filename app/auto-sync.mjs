// One automatic sync at a time. Keep edits arriving during a run; collapse
// duplicate lifecycle events so launch/pageshow/visibility do not repoll APIs.
export class AutomaticSync {
 constructor(work,{now=Date.now,foregroundInterval=60000}={}){Object.assign(this,{work,now,foregroundInterval});this.lastForeground=-Infinity;}
 request(reason='foreground') {
  if(reason==='foreground'&&this.now()-this.lastForeground<this.foregroundInterval)return this.running||Promise.resolve();
  if(reason==='foreground')this.lastForeground=this.now();
  if(this.running){
   // A genuine resume must survive a request left running before suspension.
   // A full recovery also processes local edits; a local-only run can skip
   // unchanged services, so it must not replace the queued recovery.
   const priority={local:1,foreground:2,online:3};
   if(priority[reason]>(priority[this.pending]||0))this.pending=reason;
   return this.running;
  }
  this.pending=reason;
  this.running=Promise.resolve().then(async()=>{let result;while(this.pending){const next=this.pending;this.pending=null;try{result=await this.work(next);}catch{/* Next lifecycle event can recover without discarding queued edits. */}}return result;}).finally(()=>this.running=null);
  return this.running;
 }
}
