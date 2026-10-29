import {notificationSchedule,dueNotifications,acknowledgeNotification} from './core/notifications.mjs';
import {zonedEpoch} from './core/calendar-recurrence.mjs';
const KEY='hplan-notification-ledger-v1';
export class AppNotifications {
 constructor({getState,getAuth,getNative,onError=()=>{}}){Object.assign(this,{getState,getAuth,getNative,onError});try{this.ledger=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{this.ledger={};}this.enabled=localStorage.getItem('hplan-device-notifications')==='true';this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);}
 persist(){localStorage.setItem(KEY,JSON.stringify(this.ledger));}
 serialize(work){const pending=(this.queue||Promise.resolve()).catch(()=>{}).then(work);this.queue=pending;return pending;}
 version(id){const entries=this.getState().entries,exact=entries.find(e=>e.id===id),suffix=/^(.*):(\d{4}-\d{2}-\d{2})$/.exec(id),master=exact?.seriesId?entries.find(e=>e.id===exact.seriesId):suffix?entries.find(e=>e.id===suffix[1]):null;const entry=exact?.seriesEdited?exact:master?{...master,date:suffix?.[2]||exact.date}:exact;if(!entry)return null;try{return zonedEpoch(entry.date,entry.startTime||'09:00',entry.timeZone||'Asia/Seoul');}catch{return null;}}
 refreshAcknowledgments(){for(const id of Object.keys(this.ledger.acknowledged||{}))if(this.ledger.ackVersions?.[id]!==this.version(id)){delete this.ledger.acknowledged[id];if(this.ledger.ackVersions)delete this.ledger.ackVersions[id];}this.persist();}
 async acknowledge(id){this.ledger=acknowledgeNotification(this.ledger,id);this.ledger.ackVersions={...this.ledger.ackVersions,[id]:this.version(id)};this.persist();const auth=this.getAuth();if(auth.connected)await auth.request('/v1/push/ack',auth.credential,{method:'POST',body:{entryId:id}}).catch(()=>{});}
 async enable(){
  if(!this.getAuth().connected)throw Error('웹 푸시 알림은 Google 계정을 연결한 뒤 켜 주세요. Android 앱에서는 기기 알림 설정을 사용할 수 있습니다.');
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('이 브라우저는 웹 알림을 지원하지 않습니다. iPhone은 홈 화면에 설치한 뒤 사용해 주세요.');
  const generation=this.generation=(this.generation||0)+1,auth=this.getAuth(),current=()=>generation===this.generation&&auth===this.getAuth()&&auth.connected;
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('브라우저·기기 설정에서 H.PLAN 알림을 허용해 주세요.');
  if(!current())throw Error('알림 설정이 변경되어 이전 요청을 취소했습니다.');
  const previous=this.enabled;this.enabled=true;try{await this.upload(true);if(!current())throw Error('알림 설정이 변경되어 이전 요청을 취소했습니다.');localStorage.setItem('hplan-device-notifications','true');}catch(e){if(current()){this.enabled=previous;if(!previous)localStorage.removeItem('hplan-device-notifications');}throw e;}
 }
 async disable(){this.generation=(this.generation||0)+1;this.enabled=false;this.uploaded=null;localStorage.removeItem('hplan-device-notifications');const auth=this.getAuth();return this.serialize(async()=>{if(auth.connected)await auth.request('/v1/push',auth.credential,{method:'DELETE'}).catch(()=>{});const registration=await navigator.serviceWorker?.ready;await (await registration?.pushManager?.getSubscription())?.unsubscribe();});}
 upload(force=false){
  const generation=this.generation||0,auth=this.getAuth(),credential=auth?.credential,account=auth?.account?.sub;
  return this.serialize(async()=>{
  this.refreshAcknowledgments();
  const session=()=>this.enabled&&(this.generation||0)===generation&&auth===this.getAuth()&&auth.connected&&auth.account?.sub===account&&auth.credential?.secret===credential?.secret&&typeof Notification!=='undefined'&&Notification.permission==='granted';
  const current=()=>session()&&!this.getNative()?.nativeNotificationsEnabled;
  if(!session()||!auth.request)return false;
  if(this.getNative()?.nativeNotificationsEnabled){await auth.request('/v1/push',credential,{method:'DELETE'});this.uploaded=null;return false;}
  const registration=await navigator.serviceWorker.ready;
  if(!current())return false;
  let subscription=await registration.pushManager.getSubscription();
  if(!current())return false;
  let created=false;
  if(!subscription){if(!force)return false;const key=await auth.request('/v1/push',credential);if(!current())return false;if(!key.ready)throw Error('웹 알림 서버 설정을 확인해 주세요.');const bytes=Uint8Array.from(atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});created=true;}
  if(!current()){if(created)await subscription.unsubscribe();return false;}
  const now=Date.now(),jobs=notificationSchedule(this.getState().entries,{from:new Date(now),to:new Date(now+365*86400000),ledger:this.ledger});
  const signature=JSON.stringify([auth.account?.sub||'',auth.credential?.secret||'',subscription.endpoint,jobs]);if(!force&&signature===this.uploaded)return;
  await auth.request('/v1/push',credential,{method:'POST',body:{subscription:subscription.toJSON(),jobs}});
  if(!current()){this.uploaded=null;await auth.request('/v1/push',credential,{method:'DELETE'}).catch(()=>{});if(created)await subscription.unsubscribe();return false;}
  this.uploaded=signature;return true;
  });
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
