import {CalendarClient} from './core/calendar-client.mjs';
import {CalendarSync} from './core/calendar-sync.mjs';
import {permissionState,featureState} from './google-permissions.mjs';
export function describeErrors(errors=[]){const messages=[...new Set(errors.map(e=>/failed to fetch|networkerror|load failed/i.test(e.message||'')?'Google에 연결하지 못했습니다. 연결을 유지하며 잠시 후 다시 시도합니다.':e.message||'Google 연결을 확인해 주세요.'))];return messages.slice(0,3).join(' · ')+(errors.length>1?' ('+errors.length+'건)':'');}
export function googleTransport(auth,stillCurrent=()=>true,transport=globalThis.fetch.bind(globalThis)){
 return async(url,options={})=>{try{return await transport(url,options);}catch(e){
  if(e.name!=='TypeError'||!auth.request||!stillCurrent())throw e;
  const result=await auth.request('/v1/google',auth.credential,{method:'POST',body:{url:String(url),method:options.method||'GET',...(options.body?{body:JSON.parse(options.body)}:{}),...(options.headers?.['If-Match']?{etag:options.headers['If-Match']}:{})}});
  if(!stillCurrent())throw Error('Google 연결이 변경되었습니다.');
  if(!Number.isInteger(result.googleStatus))throw Error('Google 연결 응답을 확인하지 못했습니다.');
  return new Response(result.googleStatus===204?null:JSON.stringify(result.data),{status:result.googleStatus,headers:{'Content-Type':'application/json'}});
 }};
}
export class CalendarIntegration {
 constructor({repo,getAuth,isEditing,onStatus=()=>{},createClient=options=>new CalendarClient(options)}){Object.assign(this,{repo,getAuth,isEditing,onStatus,createClient});this.now=Date.now;this.attempts=new Map();this.taskSignatures=new Map();this.state={busy:false,error:null,lastSyncAt:null,services:{},account:null};}
 options(){return this.repo.record.calendarOptions?.[this.repo.record.activeAccount]||{enabled:false,tasks:false,calendarIds:['primary']};}
 async configure(value){const account=this.repo.record.activeAccount;if(!account)throw Error('Google 계정을 먼저 연결해 주세요.');await this.repo.update(r=>{r.calendarOptions||={};r.calendarOptions[account]={...this.options(),...value};return r;});}
 get status(){const options=this.options(),auth=this.getAuth(),permissions=permissionState(auth),account=this.repo.record.activeAccount,saved=options.serviceStatus||{},current=this.state.account===account?this.state:{busy:false,services:{}};return {...current,...options,permissions,connected:!!auth?.connected,services:Object.fromEntries(['calendar','tasks'].map(feature=>{const details={...saved[feature],...current.services?.[feature]},enabled=feature==='calendar'?options.enabled:options.tasks;return [feature,{...details,...featureState({connected:!!auth?.connected,enabled,granted:permissions[feature],offline:typeof navigator!=='undefined'&&navigator.onLine===false,busy:current.busy&&current.active?.[feature]&&enabled&&permissions[feature],...details})}];})),conflicts:this.repo.state.entries.filter(e=>e.google?.accountId===account&&e.google?.conflicts&&Object.keys(e.google.conflicts).length)};}
 client(){const auth=this.getAuth(),account=this.repo.record.activeAccount,current=()=>auth===this.getAuth()&&this.repo.record.activeAccount===account;return this.createClient({fetch:googleTransport(auth,current),accessToken:(force=false)=>{if(!current())throw Error('Google 연결이 변경되었습니다.');return auth.token(force);}});}
 async calendars(){const result=await this.client().listCalendars();return result.items.filter(c=>['owner','writer'].includes(c.accessRole));}
 taskSignature(account){return JSON.stringify([this.repo.state.entries.filter(e=>e.google?.accountId===account&&e.google.service==='tasks').map(e=>[e.id,e.text,e.notes,e.dueDate,e.status,e.deletedAt]),Object.entries(this.repo.state.calendarDeletions||{}).filter(([,v])=>v.google?.accountId===account&&v.google.service==='tasks')]);}
 async run({reason='manual'}={}){
  if(this.running)return this.running;
  if((!this.options().enabled&&!this.options().tasks)||this.isEditing()||!this.repo.record.activeAccount)return;
  const account=this.repo.record.activeAccount,auth=this.getAuth(),allowed=()=>account===this.repo.record.activeAccount&&auth===this.getAuth()&&!this.isEditing();
  const options=this.options(),permissions=permissionState(auth),active={calendar:options.enabled&&permissions.calendar,tasks:options.tasks&&permissions.tasks};
  const elapsed=feature=>this.now()-(this.attempts.get(account+':'+feature)||0);
  if(reason==='idle'){active.calendar&&=elapsed('calendar')>=5*60000;active.tasks&&=elapsed('tasks')>=15*60000;}
  if(reason==='local')active.tasks&&=this.taskSignatures.get(account)!==this.taskSignature(account);
  if(!active.calendar&&!active.tasks){this.onStatus();return;}
  this.engine=new CalendarSync({now:()=>new Date(this.now()),client:this.client(),accountId:account,getState:()=>this.repo.state,allowed,commit:(next,meta)=>this.repo.applyCalendar(account,next,meta),loadLinkState:()=>this.repo.calendarMeta(account),saveLinkState:(_,next)=>this.repo.saveCalendarMeta(account,next),calendarIds:active.calendar?(options.calendarIds||['primary']):[],tasks:!!active.tasks});
  for(const feature of ['calendar','tasks'])if(active[feature])this.attempts.set(account+':'+feature,this.now());
  this.state={...this.state,active,account,busy:true,error:null,services:options.serviceStatus||{}};this.onStatus();
  this.running=(async()=>{try{
    const result=await this.engine.run(),attempt=result.lastAttemptAt||new Date().toISOString(),services={...this.state.services};
    for(const feature of ['calendar','tasks'])if(active[feature]){const errors=(result.errors||[]).filter(e=>feature==='calendar'?String(e.service).startsWith('calendar'):e.service==='tasks');services[feature]={...services[feature],lastAttempt:attempt,error:describeErrors(errors)||null,...(!errors.length?{lastSuccess:attempt}:{})};}
    if(allowed()){if(active.tasks&&!result.errors?.some(e=>e.service==='tasks'))this.taskSignatures.set(account,this.taskSignature(account));this.state={...this.state,...result,services,error:result.errors?.length?describeErrors(result.errors):null};await this.configure({serviceStatus:services});}return result;
   }catch(e){if(allowed()){this.state.error=e.message;for(const feature of ['calendar','tasks'])if(active[feature])this.state.services[feature]={...this.state.services[feature],error:e.message,lastAttempt:new Date().toISOString()};}throw e;}finally{this.state.busy=false;this.running=null;this.onStatus();}})();
  return this.running;
 }
 async resolve(id,field,choice){if(!this.engine)await this.run();if(!this.engine)throw Error('Calendar를 먼저 동기화해 주세요.');return this.engine.resolve(id,field,choice);}
}
