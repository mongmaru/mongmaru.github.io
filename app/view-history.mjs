// Browser history contains view controls only; never editor text or credentials.
const TAG='hplan-view-v1';
const copy=value=>JSON.parse(JSON.stringify(value));
export class ViewHistory {
 constructor({window:win=window,read,apply,hasModal,closeModal,limit=40}){
  Object.assign(this,{win,read,apply,hasModal,closeModal,limit});this.pushes=0;this.pendingClose=false;this.reopening=false;
  this.current=this.state(read());win.history.replaceState(this.current,'');
  this.listener=e=>this.pop(e.state);win.addEventListener('popstate',this.listener);
 }
 state(view,overlay=false){return {hplan:TAG,view:copy(view),overlay};}
 write(state,push){this.current=state;this.win.history[push?'pushState':'replaceState'](state,'');if(push)this.pushes++;}
 capture(){
  if(this.pendingClose||this.applying||this.hasModal())return;
  const next=this.state(this.read()),old=this.current?.view;
  if(JSON.stringify(next.view)===JSON.stringify(old))return;
  // Query/filter edits update this view; route/date/detail transitions preserve it.
  const key=v=>JSON.stringify([v.route,v.date,v.projectOpen,v.calendarMode,v.overviewFilter]);
  this.write(next,key(next.view)!==key(old||{})&&this.pushes<this.limit);
 }
 openOverlay(){
  if(this.pendingClose){this.reopening=true;return;}
  if(this.current.overlay)return;
  this.capture();this.write(this.state(this.read(),true),true);
 }
 closeOverlay(){
  if(this.pendingClose||!this.current.overlay)return;
  this.pendingClose=true;this.win.history.back();
 }
 pop(target){
  if(this.pendingClose){
   this.pendingClose=false;
   if(target?.hplan===TAG)this.current=target;
   if(this.reopening||this.hasModal()){this.reopening=false;this.write(this.state(this.read(),true),true);}
   else{this.current=this.state(this.read());this.win.history.replaceState(this.current,'');}
   return;
  }
  if(this.hasModal()){
   // Restore the overlay before asking about a draft. Continue keeps the editor;
   // clean/discard/keep closes it through the same guarded UI close path.
   this.write(this.state(this.read(),true),true);this.closeModal();return;
  }
  if(target?.hplan!==TAG)return;
  this.current=this.state(target.view);this.applying=true;
  try{this.apply(copy(target.view));}
  finally{this.applying=false;this.current=this.state(this.read());this.win.history.replaceState(this.current,'');}
 }
 stop(){this.win.removeEventListener('popstate',this.listener);}
}
