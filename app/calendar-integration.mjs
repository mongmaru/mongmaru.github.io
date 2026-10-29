import {CalendarClient} from './core/calendar-client.mjs';
import {CalendarSync} from './core/calendar-sync.mjs';
import {permissionState,featureState} from './google-permissions.mjs';
export class CalendarIntegration {
 constructor({repo,getAuth,isEditing,onStatus=()=>{},createClient=options=>new CalendarClient(options)}){Object.assign(this,{repo,getAuth,isEditing,onStatus,createClient});this.state={busy:false,error:null,lastSyncAt:null,services:{},account:null};}
 options(){return this.repo.record.calendarOptions?.[this.repo.record.activeAccount]||{enabled:false,tasks:false,calendarIds:['primary']};}
 async configure(value){const account=this.repo.record.activeAccount;if(!account)throw Error('Google 계정을 먼저 연결해 주세요.');await this.repo.update(r=>{r.calendarOptions||={};r.calendarOptions[account]={...this.options(),...value};return r;});}
 get status(){const options=this.options(),auth=this.getAuth(),permissions=permissionState(auth),account=this.repo.record.activeAccount,saved=options.serviceStatus||{},current=this.state.account===account?this.state:{busy:false,services:{}};return {...current,...options,permissions,connected:!!auth?.connected,services:Object.fromEntries(['calendar','tasks'].map(feature=>{const details={...saved[feature],...current.services?.[feature]},enabled=feature==='calendar'?options.enabled:options.tasks;return [feature,{...details,...featureState({connected:!!auth?.connected,enabled,granted:permissions[feature],offline:typeof navigator!=='undefined'&&navigator.onLine===false,busy:current.busy&&enabled&&permissions[feature],...details})}];})),conflicts:this.repo.state.entries.filter(e=>e.google?.accountId===account&&e.google?.conflicts&&Object.keys(e.google.conflicts).length)};}
 client(){const auth=this.getAuth(),account=this.repo.record.activeAccount;return this.createClient({accessToken:()=>{if(auth!==this.getAuth()||this.repo.record.activeAccount!==account)throw Error('Google 연결이 변경되었습니다.');return auth.token();}});}
 async calendars(){const result=await this.client().listCalendars();return result.items.filter(c=>['owner','writer'].includes(c.accessRole));}
 async run(){
  if(this.running)return this.running;
  if((!this.options().enabled&&!this.options().tasks)||this.isEditing()||!this.repo.record.activeAccount)return;
  const account=this.repo.record.activeAccount,auth=this.getAuth(),allowed=()=>account===this.repo.record.activeAccount&&auth===this.getAuth()&&!this.isEditing();
  const options=this.options(),permissions=permissionState(auth),active={calendar:options.enabled&&permissions.calendar,tasks:options.tasks&&permissions.tasks};
  if(!active.calendar&&!active.tasks){this.onStatus();return;}
  this.engine=new CalendarSync({client:this.client(),accountId:account,getState:()=>this.repo.state,allowed,commit:(next,meta)=>this.repo.applyCalendar(account,next,meta),loadLinkState:()=>this.repo.calendarMeta(account),saveLinkState:(_,next)=>this.repo.saveCalendarMeta(account,next),calendarIds:active.calendar?(options.calendarIds||['primary']):[],tasks:!!active.tasks});
  this.state={...this.state,account,busy:true,error:null,services:options.serviceStatus||{}};this.onStatus();
  this.running=(async()=>{try{
    const result=await this.engine.run(),attempt=result.lastAttemptAt||new Date().toISOString(),services={...this.state.services};
    for(const feature of ['calendar','tasks'])if(active[feature]){const errors=(result.errors||[]).filter(e=>feature==='calendar'?String(e.service).startsWith('calendar'):e.service==='tasks');services[feature]={...services[feature],lastAttempt:attempt,error:errors.map(e=>e.message).join(' · ')||null,...(!errors.length?{lastSuccess:attempt}:{})};}
    if(allowed()){this.state={...this.state,...result,services,error:result.errors?.length?result.errors.map(x=>x.message||String(x)).join(' · '):null};await this.configure({serviceStatus:services});}return result;
   }catch(e){if(allowed()){this.state.error=e.message;for(const feature of ['calendar','tasks'])if(active[feature])this.state.services[feature]={...this.state.services[feature],error:e.message,lastAttempt:new Date().toISOString()};}throw e;}finally{this.state.busy=false;this.running=null;this.onStatus();}})();
  return this.running;
 }
 async resolve(id,field,choice){if(!this.engine)await this.run();if(!this.engine)throw Error('Calendar를 먼저 동기화해 주세요.');return this.engine.resolve(id,field,choice);}
}
