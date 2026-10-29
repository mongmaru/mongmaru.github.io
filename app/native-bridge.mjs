import { expandEntries, zonedEpoch } from './core/calendar-recurrence.mjs';
import { done } from './ui.mjs';
const ORIGIN='https://mongmaru.github.io';
const MAX_TRANSFER=1800000;
const safeStart=e=>{try{return zonedEpoch(e.date,e.startTime||'09:00',e.timeZone||'Asia/Seoul');}catch{return null;}};
export function widgetSnapshot(state,{cacheKey='local',now=Date.now()}={}) {
 const current=new Date(now),start=new Date(Date.UTC(current.getFullYear(),current.getMonth()-1,1,12)).toISOString().slice(0,10),end=new Date(Date.UTC(current.getFullYear()+1,current.getMonth()+1,0,12)).toISOString().slice(0,10);
 const expanded=expandEntries(state.entries.filter(e=>!e.deletedAt),start,end),projects=new Map(state.projects.map(p=>[p.id,p]));
 const events=expanded.slice(0,5000).map(e=>({id:e.id,entryId:e.seriesId||e.id,date:e.date,endDate:e.endDate||null,projectId:e.projectId||null,projectName:(projects.get(e.projectId)?.name||'').slice(0,180),kind:e.kind||'personal',title:(e.text||'제목 없는 일정').slice(0,600),displayColor:/^#[a-f0-9]{6}$/i.test(e.google?.calendarColor||'')?e.google.calendarColor:(projects.get(e.projectId)?.color||null),eventColorId:e.eventColorId||null,startTime:e.startTime||null,origin:e.origin||'hplan',completed:done(e),startAt:safeStart(e),notifications:{enabled:false,beforeMinutes:5,repeatMinutes:5,count:1,...e.notifications}}));
 return {generatedAt:now,theme:state.settings.theme||'light',cacheKey,rangeStart:start,rangeEnd:end,truncated:expanded.length>5000,events};
}
export class NativeBridge {
 constructor({getState,getCacheKey,onAck,onReady,onState}={}) {
  Object.assign(this,{getState,getCacheKey,onAck,onReady,onState});this.port=null;this.nonce=null;this.nativeNotificationsEnabled=false;this.expected=new URLSearchParams(location.search||'').get('native')==='1';if(this.expected){this.status='Android 연결 통로 대기 중';this.startupTimer=setTimeout(()=>{if(!this.nonce){this.status='Android 연결 통로를 받지 못했습니다 · APK 설정의 연결 단계를 확인해 주세요';this.onState?.();}},12000);}
  this.listener=e=>this.receive(e);window.addEventListener('message',this.listener);window.hplanNativeBridgeActive=true;
  const pending=window.hplanPendingNativeEvent;window.hplanPendingNativeEvent=null;if(pending)this.receive(pending);
 }
 receive(event) {
  if(event.origin!==ORIGIN||location.origin!==ORIGIN)return;
  let data=event.data;const bootstrap=data==='';try{if(typeof data==='string'&&!bootstrap)data=JSON.parse(data);}catch{return;}
  if(!bootstrap&&(data?.type!=='hplan.native.ready'||data.version!==1||typeof data.nonce!=='string'||data.nonce.length<16||data.nonce.length>200)||!event.ports?.[0])return;
  clearTimeout(this.ackTimer);this.port?.close();this.port=event.ports[0];this.nonce=bootstrap?null:data.nonce;this.lastInput=null;this.pendingSnapshot=null;
  this.status='위젯에 일정 전달 중';this.nativeNotificationsEnabled=data.nativeNotificationsEnabled===true&&data.notificationPermission==='granted';
  const port=this.port;
  const acceptReady=m=>{
   if(m?.type!=='hplan.native.ready'||m.version!==1||typeof m.nonce!=='string'||m.nonce.length<16||m.nonce.length>200||this.nonce&&m.nonce!==this.nonce)return false;
   clearTimeout(this.startupTimer);clearTimeout(this.handshakeTimer);this.nonce=m.nonce;this.nativeNotificationsEnabled=m.nativeNotificationsEnabled===true&&m.notificationPermission==='granted';if(m.capabilities?.webReadyAck===true)this.send({type:'hplan.web.ready'});this.onReady?.(this);this.update();return true;
  };
  this.handshakeTimer=setTimeout(()=>{if(port===this.port&&!this.nonce){port.close();this.port=null;this.status='Android 연결 응답 대기 시간 초과';this.onState?.();}},8000);
  port.onmessage=async e=>{
   if(port!==this.port)return;
   let m=e.data;try{if(typeof m==='string')m=JSON.parse(m);}catch{return;}
   if(!this.nonce){acceptReady(m);return;}
   if(m?.nonce!==this.nonce||m.version!==1)return;
   if(m.type==='hplan.native.snapshot.rejected'){clearTimeout(this.ackTimer);this.status='위젯 저장본 형식 확인 필요';this.onState?.();return;}
   if(m.type==='hplan.native.snapshot.accepted'){
    if(this.pendingSnapshot&&m.generatedAt!==this.pendingSnapshot.generatedAt)return;
    clearTimeout(this.ackTimer);this.lastAccepted=m.generatedAt;this.pendingSnapshot=null;this.status='위젯 반영 완료';this.onState?.();return;
   }
   if(m.type==='hplan.native.ready'){acceptReady(m);return;}
   if(m.type==='hplan.native.ack'&&typeof m.occurrenceId==='string'){
    // Legacy APK acknowledgements have no original time. Keep their native
    // acknowledgement local instead of accidentally acknowledging a new time.
    if(typeof m.startAt==='string'&&Number.isFinite(Date.parse(m.startAt))&&m.cacheKey===(this.getCacheKey?.()||'local'))await this.onAck?.(m.occurrenceId,m.entryId,m.startAt,m.cacheKey);
    if(port===this.port)this.send({type:'hplan.native.ack.received',occurrenceId:m.occurrenceId,...(typeof m.ackVersion==='string'?{ackVersion:m.ackVersion,cacheKey:m.cacheKey}:{})});
   }
  };
  port.onmessageerror=()=>{if(port===this.port){this.status='위젯 연결 확인 필요 · 앱을 다시 열어 주세요';this.onState?.();}};
  port.start?.();if(!bootstrap)acceptReady(data);
 }
 send(message) {
  // Binary search caps large payloads in O(log N) serializations. Repeatedly
  // popping/stringifying thousands of long titles caused avoidable renderer work.
  let envelope={...message,nonce:this.nonce,version:1},serialized=JSON.stringify(envelope);
  if(serialized.length>MAX_TRANSFER&&message.type==='hplan.native.snapshot') {
   let low=0,high=message.snapshot.events.length;
   const make=n=>({...envelope,snapshot:{...message.snapshot,events:message.snapshot.events.slice(0,n),truncated:true}});
   while(low<high){const mid=Math.ceil((low+high)/2);if(JSON.stringify(make(mid)).length<=MAX_TRANSFER)low=mid;else high=mid-1;}
   envelope=make(low);serialized=JSON.stringify(envelope);
  }
  if(serialized.length>MAX_TRANSFER)throw Error('위젯 저장본이 너무 큽니다.');
  if(serialized.length<=180000){this.port?.postMessage(serialized);return;}
  const transferId=crypto.randomUUID(),total=Math.ceil(serialized.length/60000);
  for(let index=0;index<total;index++)this.port?.postMessage(JSON.stringify({type:'hplan.native.snapshot.chunk',nonce:this.nonce,version:1,transferId,index,total,data:serialized.slice(index*60000,(index+1)*60000)}));
 }
 deliver(snapshot,attempt=0) {
  if(!this.port||!this.nonce)return;
  clearTimeout(this.ackTimer);this.pendingSnapshot=snapshot;this.send({type:'hplan.native.snapshot',snapshot});
  this.ackTimer=setTimeout(()=>{
   if(this.pendingSnapshot!==snapshot||!this.port)return;
   if(attempt<2){this.status='위젯 전달 다시 확인 중';this.onState?.();this.deliver(snapshot,attempt+1);}
   else{this.status='위젯 반영을 확인하지 못했습니다 · 앱을 다시 열어 주세요';this.onState?.();}
  },5000);
 }
 update() {
  if(!this.port||!this.nonce)return;clearTimeout(this.timer);
  this.timer=setTimeout(()=>{
   try {
    const state=this.getState(),cacheKey=this.getCacheKey?.()||'local',now=new Date();
    // Storage revisions, cursor saves and sync timestamps do not change these
    // inputs. Do not re-expand recurring schedules for every metadata commit.
    const input=JSON.stringify([cacheKey,state.settings.theme,state.entries,state.projects,now.getFullYear(),now.getMonth(),now.getDate()]);
    if(input===this.lastInput)return;
    this.deliver(widgetSnapshot(state,{cacheKey}));this.lastInput=input;
   }catch{this.status='위젯 전달을 확인하지 못했습니다 · 기존 저장본 유지';this.onState?.();}
  },250);
 }
 stop(){clearTimeout(this.startupTimer);clearTimeout(this.handshakeTimer);clearTimeout(this.timer);clearTimeout(this.ackTimer);window.removeEventListener('message',this.listener);window.hplanNativeBridgeActive=false;this.port?.close();this.port=null;this.pendingSnapshot=null;}
}
