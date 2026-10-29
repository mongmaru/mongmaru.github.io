import {notificationSchedule,dueNotifications,acknowledgeNotification} from './core/notifications.mjs';
import {zonedEpoch} from './core/calendar-recurrence.mjs';
const KEY='hplan-notification-ledger-v1';
export class AppNotifications {
 constructor({getState,getAuth,getNative,onError=()=>{}}){Object.assign(this,{getState,getAuth,getNative,onError});try{this.ledger=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{this.ledger={};}this.enabled=localStorage.getItem('hplan-device-notifications')==='true';this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);}
 persist(){localStorage.setItem(KEY,JSON.stringify(this.ledger));}
 version(id){const entries=this.getState().entries,exact=entries.find(e=>e.id===id),suffix=/^(.*):(\d{4}-\d{2}-\d{2})$/.exec(id),master=exact?.seriesId?entries.find(e=>e.id===exact.seriesId):suffix?entries.find(e=>e.id===suffix[1]):null;const entry=exact?.seriesEdited?exact:master?{...master,date:suffix?.[2]||exact.date}:exact;if(!entry)return null;try{return zonedEpoch(entry.date,entry.startTime||'09:00',entry.timeZone||'Asia/Seoul');}catch{return null;}}
 refreshAcknowledgments(){for(const id of Object.keys(this.ledger.acknowledged||{}))if(this.ledger.ackVersions?.[id]!==this.version(id)){delete this.ledger.acknowledged[id];if(this.ledger.ackVersions)delete this.ledger.ackVersions[id];}this.persist();}
 async acknowledge(id){this.ledger=acknowledgeNotification(this.ledger,id);this.ledger.ackVersions={...this.ledger.ackVersions,[id]:this.version(id)};this.persist();const auth=this.getAuth();if(auth.connected)await auth.request('/v1/push/ack',auth.credential,{method:'POST',body:{entryId:id}}).catch(()=>{});}
 async enable(){
  if(!this.getAuth().connected)throw Error('웹 푸시 알림은 Google 계정을 연결한 뒤 켜 주세요. Android 앱에서는 기기 알림 설정을 사용할 수 있습니다.');
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('이 브라우저는 웹 알림을 지원하지 않습니다. iPhone은 홈 화면에 설치한 뒤 사용해 주세요.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('브라우저·기기 설정에서 H.PLAN 알림을 허용해 주세요.');
  const previous=this.enabled;this.enabled=true;try{await this.upload(true);localStorage.setItem('hplan-device-notifications','true');}catch(e){this.enabled=previous;if(!previous)localStorage.removeItem('hplan-device-notifications');throw e;}
 }
 async disable(){this.enabled=false;localStorage.removeItem('hplan-device-notifications');const auth=this.getAuth();if(auth.connected)await auth.request('/v1/push',auth.credential,{method:'DELETE'}).catch(()=>{});const registration=await navigator.serviceWorker?.ready;await (await registration?.pushManager?.getSubscription())?.unsubscribe();}
 async upload(force=false){
  this.refreshAcknowledgments();
  const auth=this.getAuth();if(!this.enabled||!auth.connected||!auth.request||Notification.permission!=='granted')return;
  if(this.getNative()?.nativeNotificationsEnabled){await auth.request('/v1/push',auth.credential,{method:'DELETE'});this.uploaded=null;return;}
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){if(!force)return;const key=await auth.request('/v1/push',auth.credential);if(!key.ready)throw Error('웹 알림 서버 설정을 확인해 주세요.');const bytes=Uint8Array.from(atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});}
  const now=Date.now(),jobs=notificationSchedule(this.getState().entries,{from:new Date(now),to:new Date(now+365*86400000),ledger:this.ledger});
  const signature=JSON.stringify([auth.account?.sub||'',auth.credential?.secret||'',subscription.endpoint,jobs]);if(!force&&signature===this.uploaded)return;
  await auth.request('/v1/push',auth.credential,{method:'POST',body:{subscription:subscription.toJSON(),jobs}});this.uploaded=signature;
 }
 async tick(){
  this.refreshAcknowledgments();
  if(!this.enabled||this.getNative()?.nativeNotificationsEnabled||!('Notification'in window)||Notification.permission!=='granted')return;
  const registration=await navigator.serviceWorker.ready;
  // A registered push subscription has a single server dispatcher, including while foreground.
  if(await registration.pushManager?.getSubscription())return;
  const due=dueNotifications(this.getState().entries,new Date(),this.ledger);this.ledger=due.ledger;this.persist();for(const n of due.notifications)await registration.showNotification(n.title,{body:'예정된 일정을 확인해 주세요.',tag:'hplan-'+n.entryId,data:{entryId:n.entryId,url:'./?entry='+encodeURIComponent(n.entryId)}});
 }
}
