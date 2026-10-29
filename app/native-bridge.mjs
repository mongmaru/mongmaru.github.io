import { expandEntries, zonedEpoch } from './core/calendar-recurrence.mjs';
import { done } from './ui.mjs';
const ORIGIN='https://mongmaru.github.io';
export function widgetSnapshot(state,{cacheKey='local',now=Date.now()}={}) {
 const current=new Date(now),start=new Date(Date.UTC(current.getFullYear(),current.getMonth()-1,1,12)).toISOString().slice(0,10),end=new Date(Date.UTC(current.getFullYear()+1,current.getMonth()+1,0,12)).toISOString().slice(0,10);
 const expanded=expandEntries(state.entries.filter(e=>!e.deletedAt),start,end);
 const events=expanded.slice(0,5000).map(e=>({id:e.id,entryId:e.seriesId||e.id,date:e.date,endDate:e.endDate||null,title:(e.text||'제목 없는 일정').slice(0,600),startTime:e.startTime||null,origin:e.origin||'hplan',completed:done(e),startAt:zonedEpoch(e.date,e.startTime||'09:00',e.timeZone||'Asia/Seoul'),notifications:{enabled:false,beforeMinutes:5,repeatMinutes:5,count:1,...e.notifications}}));
 return {generatedAt:now,theme:state.settings.theme||'light',cacheKey,rangeStart:start,rangeEnd:end,truncated:expanded.length>5000,events};
}
export class NativeBridge {
 constructor({getState,getCacheKey,onAck,onReady}={}){Object.assign(this,{getState,getCacheKey,onAck,onReady});this.port=null;this.nonce=null;this.nativeNotificationsEnabled=false;this.listener=e=>this.receive(e);window.addEventListener('message',this.listener);}
 receive(event){
  if(event.origin!==ORIGIN||location.origin!==ORIGIN)return;
  let data=event.data;try{if(typeof data==='string')data=JSON.parse(data);}catch{return;}
  if(data?.type!=='hplan.native.ready'||data.version!==1||typeof data.nonce!=='string'||data.nonce.length<16||data.nonce.length>200||!event.ports?.[0])return;
  this.port?.close();this.port=event.ports[0];this.nonce=data.nonce;
  this.nativeNotificationsEnabled=data.nativeNotificationsEnabled===true&&data.notificationPermission==='granted';
  this.port.onmessage=async e=>{let m=e.data;try{if(typeof m==='string')m=JSON.parse(m);}catch{return;}if(m?.nonce!==this.nonce||m.version!==1)return;if(m.type==='hplan.native.ready'){this.nativeNotificationsEnabled=m.nativeNotificationsEnabled===true&&m.notificationPermission==='granted';this.onReady?.(this);return;}if(m.type==='hplan.native.ack'&&typeof m.occurrenceId==='string'){await this.onAck?.(m.occurrenceId,m.entryId);this.send({type:'hplan.native.ack.received',occurrenceId:m.occurrenceId});}};
  this.port.start?.();this.onReady?.(this);this.update();
 }
 send(message){
  const envelope={...message,nonce:this.nonce,version:1};let serialized=JSON.stringify(envelope);
  if(message.type==='hplan.native.snapshot')while(serialized.length>1800000&&envelope.snapshot.events.length){envelope.snapshot.events.pop();envelope.snapshot.truncated=true;serialized=JSON.stringify(envelope);}
  if(serialized.length<=180000){this.port?.postMessage(serialized);return;}
  const transferId=crypto.randomUUID(),total=Math.ceil(serialized.length/60000);
  for(let index=0;index<total;index++)this.port?.postMessage(JSON.stringify({type:'hplan.native.snapshot.chunk',nonce:this.nonce,version:1,transferId,index,total,data:serialized.slice(index*60000,(index+1)*60000)}));
 }
 update(){if(!this.port)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{try{this.send({type:'hplan.native.snapshot',snapshot:widgetSnapshot(this.getState(),{cacheKey:this.getCacheKey?.()||'local'})});}catch{/* Keep native's previous valid snapshot on malformed imported data. */}},250);}
 stop(){clearTimeout(this.timer);window.removeEventListener('message',this.listener);this.port?.close();}
}
