import {CalendarClient} from './core/calendar-client.mjs';
import {CalendarSync} from './core/calendar-sync.mjs';
export class CalendarIntegration {
 constructor({repo,getAuth,isEditing,onStatus=()=>{}}){Object.assign(this,{repo,getAuth,isEditing,onStatus});this.state={busy:false,error:null,lastSyncAt:null};}
 options(){return this.repo.record.calendarOptions?.[this.repo.record.activeAccount]||{enabled:false,tasks:false,calendarIds:['primary']};}
 async configure(value){const account=this.repo.record.activeAccount;if(!account)throw Error('Google 계정을 먼저 연결해 주세요.');await this.repo.update(r=>{r.calendarOptions||={};r.calendarOptions[account]={...this.options(),...value};return r;});}
 get status(){return {...this.state,...this.options(),conflicts:this.repo.state.entries.filter(e=>e.google?.conflicts&&Object.keys(e.google.conflicts).length)};}
 client(){const auth=this.getAuth(),account=this.repo.record.activeAccount;return new CalendarClient({accessToken:()=>{if(auth!==this.getAuth()||this.repo.record.activeAccount!==account)throw Error('Google 연결이 변경되었습니다.');return auth.token();}});}
 async calendars(){const result=await this.client().listCalendars();return result.items.filter(c=>['owner','writer'].includes(c.accessRole));}
 async run(){
  if(this.running)return this.running;
  if((!this.options().enabled&&!this.options().tasks)||this.isEditing()||!this.repo.record.activeAccount)return;
  const account=this.repo.record.activeAccount,auth=this.getAuth(),allowed=()=>account===this.repo.record.activeAccount&&auth===this.getAuth()&&!this.isEditing();
  const options=this.options();
  this.engine=new CalendarSync({client:this.client(),accountId:account,getState:()=>this.repo.state,allowed,commit:(next,meta)=>this.repo.applyCalendar(account,next,meta),loadLinkState:()=>this.repo.calendarMeta(account),saveLinkState:(_,next)=>this.repo.saveCalendarMeta(account,next),calendarIds:options.enabled?(options.calendarIds||['primary']):[],tasks:!!options.tasks});
  this.state.busy=true;this.state.error=null;this.onStatus();
  this.running=(async()=>{try{const result=await this.engine.run();this.state={...this.state,...result,error:result.errors?.length?result.errors.map(x=>x.message||String(x)).join(' · '):null};return result;}catch(e){this.state.error=e.message;throw e;}finally{this.state.busy=false;this.running=null;this.onStatus();}})();
  return this.running;
 }
 async resolve(id,field,choice){if(!this.engine)await this.run();if(!this.engine)throw Error('Calendar를 먼저 동기화해 주세요.');return this.engine.resolve(id,field,choice);}
}
