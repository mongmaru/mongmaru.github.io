import {notificationSchedule,dueNotifications,acknowledgeNotification} from './core/notifications.mjs';
import {zonedEpoch} from './core/calendar-recurrence.mjs';
const KEY='hplan-notification-ledger-v1';
export class AppNotifications {
 constructor({getState,getAuth,getNative,onError=()=>{}}){Object.assign(this,{getState,getAuth,getNative,onError});try{this.ledger=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{this.ledger={};}this.enabled=localStorage.getItem('hplan-device-notifications')==='true';this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);}
 persist(){localStorage.setItem(KEY,JSON.stringify(this.ledger));}
 serialize(work){const pending=(this.queue||Promise.resolve()).catch(()=>{}).then(work);this.queue=pending;return pending;}
 version(id){const entries=this.getState().entries,exact=entries.find(e=>e.id===id),suffix=/^(.*):(\d{4}-\d{2}-\d{2})$/.exec(id),master=exact?.seriesId?entries.find(e=>e.id===exact.seriesId):suffix?entries.find(e=>e.id===suffix[1]):null;const entry=exact?.seriesEdited?exact:master?{...master,date:suffix?.[2]||exact.date}:exact;if(!entry)return null;try{return zonedEpoch(entry.date,entry.startTime||'09:00',entry.timeZone||'Asia/Seoul');}catch{return null;}}
 refreshAcknowledgments(){for(const id of Object.keys(this.ledger.acknowledged||{}))if(this.ledger.ackVersions?.[id]!==this.version(id)){delete this.ledger.acknowledged[id];if(this.ledger.ackVersions)delete this.ledger.ackVersions[id];}this.persist();}
 rememberAcknowledgment(id,startAt,persist=true){if(startAt!==undefined&&Date.parse(startAt)!==this.version(id))return false;this.ledger=acknowledgeNotification(this.ledger,id);this.ledger.ackVersions={...this.ledger.ackVersions,[id]:this.version(id)};if(persist)this.persist();return true;}
 async sessionId(auth=this.getAuth()){if(!auth?.connected||!auth.credential?.secret)return 'local';const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(auth.credential.secret)));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
 async acknowledge(id,startAt,sessionId){const auth=this.getAuth(),secret=auth?.credential?.secret;if(sessionId&&(sessionId!==await this.sessionId(auth)||auth!==this.getAuth()||secret!==auth?.credential?.secret))return;if(!this.rememberAcknowledgment(id,startAt))return;/* The service worker owns durable retry for messages carrying its session. */if(!sessionId&&auth?.connected)await auth.request('/v1/push/ack',auth.credential,{method:'POST',body:{entryId:id,...(this.version(id)!==null?{startAt:new Date(this.version(id)).toISOString()}:{})}}).catch(()=>{});}
 async retryAcknowledgments(registration){
  if(!registration.active?.postMessage||typeof MessageChannel==='undefined')return;
  const auth=this.getAuth(),secret=auth?.credential?.secret,sessionId=await this.sessionId(auth),channel=new MessageChannel();
  const result=await new Promise(resolve=>{const finish=value=>{clearTimeout(timer);channel.port1.close();channel.port2.close();resolve(value);},timer=setTimeout(()=>finish(null),6500);channel.port1.onmessage=event=>finish(event.data);try{registration.active.postMessage({type:'hplan.notification.retry'},[channel.port2]);}catch{finish(null);}});
  if(auth!==this.getAuth()||secret!==auth?.credential?.secret||result?.sessionId!==sessionId||!Array.isArray(result.acks))return;
  let changed=false;for(const record of result.acks.slice(0,2000))if(typeof record.entryId==='string'&&!(this.ledger.acknowledged?.[record.entryId]&&this.ledger.ackVersions?.[record.entryId]===Date.parse(record.startAt)))changed=this.rememberAcknowledgment(record.entryId,record.startAt,false)||changed;if(changed)this.persist();
 }
 async enable(){
  if(!this.getAuth().connected)throw Error('웹 푸시 알림은 Google 계정을 연결한 뒤 켜 주세요. Android 앱에서는 기기 알림 설정을 사용할 수 있습니다.');
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('이 브라우저는 웹 알림을 지원하지 않습니다. iPhone은 홈 화면에 설치한 뒤 사용해 주세요.');
  const generation=this.generation=(this.generation||0)+1,auth=this.getAuth(),current=()=>generation===this.generation&&auth===this.getAuth()&&auth.connected;
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('브라우저·기기 설정에서 H.PLAN 알림을 허용해 주세요.');
  if(!current())throw Error('알림 설정이 변경되어 이전 요청을 취소했습니다.');
  const previous=this.enabled;this.enabled=true;try{await this.upload(true);if(!current())throw Error('알림 설정이 변경되어 이전 요청을 취소했습니다.');localStorage.setItem('hplan-device-notifications','true');}catch(e){if(current()){this.enabled=previous;if(!previous)localStorage.removeItem('hplan-device-notifications');}throw e;}
 }
 async disable(){this.generation=(this.generation||0)+1;this.enabled=false;this.uploaded=null;this.suppressed=null;localStorage.removeItem('hplan-device-notifications');const auth=this.getAuth();return this.serialize(async()=>{if(auth.connected)await auth.request('/v1/push',auth.credential,{method:'DELETE'}).catch(()=>{});const registration=await navigator.serviceWorker?.ready;await (await registration?.pushManager?.getSubscription())?.unsubscribe();});}
 upload(force=false){
  const generation=this.generation||0,auth=this.getAuth(),credential=auth?.credential,account=auth?.account?.sub;
  return this.serialize(async()=>{
  this.refreshAcknowledgments();
  const session=()=>this.enabled&&(this.generation||0)===generation&&auth===this.getAuth()&&auth.connected&&auth.account?.sub===account&&auth.credential?.secret===credential?.secret&&typeof Notification!=='undefined'&&Notification.permission==='granted';
  const current=()=>session()&&!this.getNative()?.nativeNotificationsEnabled;
  if(!session()||!auth.request)return false;
  if(this.getNative()?.nativeNotificationsEnabled){const signature=JSON.stringify([account,credential?.server,credential?.secret]);if(this.suppressed!==signature){await auth.request('/v1/push',credential,{method:'DELETE'});if(session()&&this.getNative()?.nativeNotificationsEnabled)this.suppressed=signature;}this.uploaded=null;return false;}
  this.suppressed=null;
  const registration=await navigator.serviceWorker.ready;
  if(!current())return false;
  await this.retryAcknowledgments(registration);
  if(!current())return false;
  let subscription=await registration.pushManager.getSubscription();
  if(!current())return false;
  let created=false;
  if(!subscription){const key=await auth.request('/v1/push',credential);if(!current())return false;if(!key.ready)throw Error('웹 알림 서버 설정을 확인해 주세요.');const bytes=Uint8Array.from(atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});created=true;}
  if(!current()){if(created)await subscription.unsubscribe();return false;}
  // Include the current minute, leaving30s inside the server's90s grace for transit.
  const now=Date.now(),jobs=notificationSchedule(this.getState().entries,{from:new Date(now-60000),to:new Date(now+365*86400000),ledger:this.ledger});
  const signature=JSON.stringify([auth.account?.sub||'',auth.credential?.secret||'',subscription.endpoint,jobs]);if(!force&&signature===this.uploaded)return;
  await auth.request('/v1/push',credential,{method:'POST',body:{subscription:subscription.toJSON(),jobs}});
  if(!current()){this.uploaded=null;await auth.request('/v1/push',credential,{method:'DELETE'}).catch(()=>{});if(created)await subscription.unsubscribe();return false;}
  this.uploaded=signature;return true;
  });
 }
 tick(){return this.serialize(async()=>{
  this.refreshAcknowledgments();
  const generation=this.generation||0,current=()=>this.enabled&&(this.generation||0)===generation&&!this.getNative()?.nativeNotificationsEnabled&&'Notification'in window&&Notification.permission==='granted';
  if(!current())return;
  const registration=await navigator.serviceWorker.ready;
  if(!current())return;
  await this.retryAcknowledgments(registration);
  if(!current())return;
  // A registered push subscription has a single server dispatcher, including while foreground.
  if(await registration.pushManager?.getSubscription())return;
  if(!current())return;
  const sessionId=await this.sessionId();if(!current())return;
  const due=dueNotifications(this.getState().entries,new Date(),this.ledger),previous=this.ledger.sent||{};
  this.ledger.sent=Object.fromEntries(Object.entries(due.ledger.sent).filter(([key])=>Object.hasOwn(previous,key)));
  for(const n of due.notifications){
   if(!current())return;
   await registration.showNotification(n.title,{body:'예정된 일정을 확인해 주세요.',tag:'hplan-'+n.entryId,data:{entryId:n.entryId,startAt:n.startAt,sessionId,url:'./?entry='+encodeURIComponent(n.entryId)}});
   // Failed display remains retryable; record only reminders actually shown.
   const prefix=n.entryId+':'+Date.parse(n.startAt)+':';for(const [key,at]of Object.entries(due.ledger.sent))if(key.startsWith(prefix))this.ledger.sent[key]=at;
   this.persist();
  }
 });}
}
