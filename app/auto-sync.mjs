// One automatic sync at a time. Keep edits arriving during a run; collapse
// duplicate lifecycle events so launch/pageshow/visibility do not repoll APIs.
export class AutomaticSync {
 constructor(work,{now=Date.now,foregroundInterval=60000}={}){Object.assign(this,{work,now,foregroundInterval});this.lastForeground=-Infinity;}
 request(reason='foreground') {
  if(reason==='foreground'&&this.now()-this.lastForeground<this.foregroundInterval)return this.running||Promise.resolve();
  if(reason==='foreground')this.lastForeground=this.now();
  if(this.running){if(reason==='local'||reason==='online')this.pending=reason==='local'||!this.pending?reason:this.pending;return this.running;}
  this.pending=reason;
  this.running=Promise.resolve().then(async()=>{let result;while(this.pending){const next=this.pending;this.pending=null;try{result=await this.work(next);}catch{/* Next lifecycle event can recover without discarding queued edits. */}}return result;}).finally(()=>this.running=null);
  return this.running;
 }
}
