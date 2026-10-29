import {notificationSchedule,dueNotifications,acknowledgeNotification} from './core/notifications.mjs';
const KEY='hplan-notification-ledger-v1';
export class AppNotifications {
 constructor({getState,getAuth,getNative,onError=()=>{}}){Object.assign(this,{getState,getAuth,getNative,onError});try{this.ledger=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{this.ledger={};}this.enabled=localStorage.getItem('hplan-device-notifications')==='true';this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);}
 persist(){localStorage.setItem(KEY,JSON.stringify(this.ledger));}
 async acknowledge(id){this.ledger=acknowledgeNotification(this.ledger,id);this.persist();const auth=this.getAuth();if(auth.connected)await auth.request('/v1/push/ack',auth.credential,{method:'POST',body:{entryId:id}}).catch(()=>{});}
 async enable(){
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('이 브라우저는 웹 알림을 지원하지 않습니다. iPhone은 홈 화면에 설치한 뒤 사용해 주세요.');
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('브라우저·기기 설정에서 H.PLAN 알림을 허용해 주세요.');
  this.enabled=true;localStorage.setItem('hplan-device-notifications','true');await this.upload(true);
 }
 async disable(){this.enabled=false;localStorage.removeItem('hplan-device-notifications');const auth=this.getAuth();if(auth.connected)await auth.request('/v1/push',auth.credential,{method:'DELETE'}).catch(()=>{});const registration=await navigator.serviceWorker?.ready;await (await registration?.pushManager?.getSubscription())?.unsubscribe();}
 async upload(force=false){
  const auth=this.getAuth();if(!this.enabled||!auth.connected||!auth.request||Notification.permission!=='granted')return;
  if(this.getNative()?.nativeNotificationsEnabled){await auth.request('/v1/push',auth.credential,{method:'DELETE'});return;}
  const registration=await navigator.serviceWorker.ready;
  let subscription=await registration.pushManager.getSubscription();
  if(!subscription){if(!force)return;const key=await auth.request('/v1/push',auth.credential);if(!key.ready)throw Error('웹 알림 서버 설정을 확인해 주세요.');const bytes=Uint8Array.from(atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});}
  const now=Date.now(),jobs=notificationSchedule(this.getState().entries,{from:new Date(now),to:new Date(now+365*86400000),ledger:this.ledger});
  const signature=JSON.stringify(jobs);if(!force&&signature===this.uploaded)return;
  await auth.request('/v1/push',auth.credential,{method:'POST',body:{subscription:subscription.toJSON(),jobs}});this.uploaded=signature;
 }
 async tick(){
  if(!this.enabled||this.getNative()?.nativeNotificationsEnabled||!('Notification'in window)||Notification.permission!=='granted')return;
  const registration=await navigator.serviceWorker.ready;
  // A registered push subscription has a single server dispatcher, including while foreground.
  if(await registration.pushManager?.getSubscription())return;
  const due=dueNotifications(this.getState().entries,new Date(),this.ledger);this.ledger=due.ledger;this.persist();for(const n of due.notifications)await registration.showNotification(n.title,{body:'예정된 일정을 확인해 주세요.',tag:'hplan-'+n.entryId,data:{entryId:n.entryId,url:'./?entry='+encodeURIComponent(n.entryId)}});
 }
}
