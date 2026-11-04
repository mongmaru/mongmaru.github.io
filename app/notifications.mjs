import {notificationSchedule,dueNotifications,acknowledgeNotification} from './core/notifications.mjs';
import {zonedEpoch} from './core/calendar-recurrence.mjs';
import {usesNativeNotifications} from './notification-policy.mjs';
const KEY='hplan-notification-ledger-v1';
const CLOUD_ACCOUNT='hplan-android-cloud-account-v1';
const CHANGES_KEY='hplan-notification-changes-v1:';
const MAX_CHANGES=10000;
const scheduleInput=entries=>JSON.stringify(entries.filter(e=>e.origin!=='google'&&(e.notifications?.enabled||e.seriesId)));
const scheduleWindow=now=>({from:new Date(now-60000),to:new Date(now+365*86400000)});
export class AppNotifications {
 constructor({getState,getAuth,getNative,onError=()=>{},onMode=()=>{}}){Object.assign(this,{getState,getAuth,getNative,onError,onMode});try{this.ledger=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{this.ledger={};}this.enabled=localStorage.getItem('hplan-device-notifications')==='true';this.cloudAccount=localStorage.getItem(CLOUD_ACCOUNT);this.timer=setInterval(()=>this.tick().catch(()=>{}),30000);}
 persist(){localStorage.setItem(KEY,JSON.stringify(this.ledger));}
 serialize(work){const pending=(this.queue||Promise.resolve()).catch(()=>{}).then(work);this.queue=pending;return pending;}
 wantsAndroidCloud(auth=this.getAuth()){return Boolean(auth?.account?.sub&&[this.cloudAccount,this.cloudPending].includes(auth.account.sub));}
 androidCloudMode(){
  const auth=this.getAuth();
  if(!auth?.connected)return undefined;
  if(!auth.account?.sub||this.cloudAccount!==auth.account.sub)return false;
  return this.cloudConfirmed===auth.credential?.secret?true:undefined;
 }
 canReceiveAndroidCloud(){
  const native=this.getNative?.();
  return Boolean(native?.port&&native?.nonce&&native?.cloudPush&&native?.cloudPushPermission==='granted');
 }
 version(id){const entries=this.getState().entries,exact=entries.find(e=>e.id===id),suffix=/^(.*):(\d{4}-\d{2}-\d{2})$/.exec(id),master=exact?.seriesId?entries.find(e=>e.id===exact.seriesId):suffix?entries.find(e=>e.id===suffix[1]):null;const entry=exact?.seriesEdited?exact:master?{...master,date:suffix?.[2]||exact.date}:exact;if(!entry)return null;try{return zonedEpoch(entry.date,entry.startTime||'09:00',entry.timeZone||'Asia/Seoul');}catch{return null;}}
 refreshAcknowledgments(){let changed=false;for(const id of Object.keys(this.ledger.acknowledged||{}))if(this.ledger.ackVersions?.[id]!==this.version(id)){delete this.ledger.acknowledged[id];if(this.ledger.ackVersions)delete this.ledger.ackVersions[id];changed=true;}if(changed)this.persist();}
 schedule(now){
  const entries=this.getState().entries,key=JSON.stringify([scheduleInput(entries),this.ledger.acknowledged,this.ledger.sent]);
  if(this.scheduleCache?.key===key&&now>=this.scheduleCache.now&&now-this.scheduleCache.now<30000)return this.scheduleCache.jobs;
  const jobs=notificationSchedule(entries,{...scheduleWindow(now),ledger:this.ledger});
  this.scheduleCache={key,now,jobs};
  return jobs;
 }
 tracksLocalChanges(){
  const auth=this.getAuth();
  return auth?.connected&&(usesNativeNotifications(this.getNative?.())?this.wantsAndroidCloud(auth):this.enabled);
 }
 changeKey(auth){return auth?.account?.sub?CHANGES_KEY+encodeURIComponent(auth.account.sub):null;}
 savedChanges(key,session){
  if(!key)return new Map();
  try{
   const saved=JSON.parse(globalThis.localStorage?.getItem?.(key)||'null');
   if(saved?.session!==session||!Array.isArray(saved.changes))return new Map();
   return new Map(saved.changes.slice(-MAX_CHANGES).filter(pair=>Array.isArray(pair)&&typeof pair[0]==='string'&&pair[0].length>0&&pair[0].length<=240&&typeof pair[1]==='string'));
  }catch{return new Map();}
 }
 saveChanges(key,session,changes){
  if(changes.size)localStorage.setItem(key,JSON.stringify({session,changes:[...changes].slice(-MAX_CHANGES)}));
  else localStorage.removeItem(key);
 }
 async noteLocalChanges(before,after){
  if(!this.tracksLocalChanges()||scheduleInput(before)===scheduleInput(after))return;
  const auth=this.getAuth(),secret=auth.credential?.secret,key=this.changeKey(auth);
  if(!key||!secret)return;
  const options=scheduleWindow(Date.now());
  const groups=entries=>{
   const byId=new Map();
   for(const job of notificationSchedule(entries,options)){
    const values=byId.get(job.entryId)||[];
    values.push([job.key,job.title,job.body,job.google?.calendarId,job.google?.id]);
    byId.set(job.entryId,values);
   }
   return byId;
  };
  const old=groups(before),next=groups(after);
  const changed=[...new Set([...old.keys(),...next.keys()])].filter(id=>id.length<=240&&JSON.stringify(old.get(id))!==JSON.stringify(next.get(id)));
  if(!changed.length)return;
  const session=await this.sessionId(auth);
  if(auth!==this.getAuth()||secret!==auth.credential?.secret)return;
  const pending=this.savedChanges(key,session),version=crypto.randomUUID();
  for(const id of changed){pending.delete(id);pending.set(id,version);}
  this.saveChanges(key,session,pending);
 }
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
 async enable(cloud=false){
  if(cloud&&!this.canReceiveAndroidCloud())throw Error('최신 Android 앱을 Chrome으로 다시 열고 Android 알림·위젯 설정에서 H.PLAN 알림을 허용해 주세요.');
  if(!cloud&&usesNativeNotifications(this.getNative?.()))throw Error('Android 앱 알림·위젯 설정에서 기기 알림과 Android 알림 허용을 확인해 주세요. 앱 연결을 기다리는 동안 Chrome 알림으로 전환하지 않습니다.');
  if(!this.getAuth().connected)throw Error('웹 푸시 알림은 Google 계정을 연결한 뒤 켜 주세요. Android 앱에서는 기기 알림 설정을 사용할 수 있습니다.');
  if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('이 브라우저는 웹 알림을 지원하지 않습니다. iPhone은 홈 화면에 설치한 뒤 사용해 주세요.');
  const generation=this.generation=(this.generation||0)+1,auth=this.getAuth(),secret=auth.credential?.secret;
  const current=()=>generation===this.generation&&auth===this.getAuth()&&auth.connected&&secret===auth.credential?.secret&&(cloud?this.canReceiveAndroidCloud():!usesNativeNotifications(this.getNative?.()));
  if(cloud){
   if(Notification.permission!=='granted')throw Error('Chrome에서 H.PLAN 알림 허용 상태를 확인하지 못했습니다. 앱을 닫았다 다시 열고 Android 알림 설정을 확인해 주세요.');
   this.cloudPending=auth.account.sub;
   try{
    if(!await this.upload(true)||!current())throw Error('서버 알림 등록을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    localStorage.setItem(CLOUD_ACCOUNT,auth.account.sub);
    this.cloudAccount=auth.account.sub;this.cloudConfirmed=secret;this.onMode?.();
   }finally{this.cloudPending=null;}
   return;
  }
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('브라우저·기기 설정에서 H.PLAN 알림을 허용해 주세요.');
  if(!current())throw Error('알림 설정이 변경되어 이전 요청을 취소했습니다.');
  const previous=this.enabled;this.enabled=true;try{await this.upload(true);if(!current())throw Error('알림 설정이 변경되어 이전 요청을 취소했습니다.');localStorage.setItem('hplan-device-notifications','true');}catch(e){if(current()){this.enabled=previous;if(!previous)localStorage.removeItem('hplan-device-notifications');}throw e;}
 }
 async suppressWebPush(auth=this.getAuth()){
  if(!auth?.connected||!auth.request||!auth.credential?.secret){this.webPushCleanup='pending';return false;}
  const credential={...auth.credential},account=auth.account?.sub,signature=JSON.stringify([account,credential.server,credential.secret]);
  if(this.suppressed!==signature){
   this.webPushCleanup='pending';
   try{await auth.request('/v1/push',credential,{method:'DELETE'});}catch(error){this.webPushCleanup='failed';throw error;}
   if(auth===this.getAuth()&&auth.connected&&auth.account?.sub===account&&auth.credential?.secret===credential.secret&&usesNativeNotifications(this.getNative?.())){this.suppressed=signature;this.webPushCleanup='complete';}
  }
  this.uploaded=null;return false;
 }
 async disable(cloud=false){
  this.generation=(this.generation||0)+1;
  const auth=this.getAuth(),secret=auth.credential?.secret;
  if(!cloud){this.enabled=false;this.uploaded=null;this.suppressed=null;localStorage.removeItem('hplan-device-notifications');}
  return this.serialize(async()=>{
   if(cloud){
    if(!auth.connected||auth!==this.getAuth()||secret!==auth.credential?.secret)throw Error('Google 계정 연결을 확인한 뒤 다시 시도해 주세요.');
    await auth.request('/v1/push',auth.credential,{method:'DELETE'});
    if(auth!==this.getAuth()||secret!==auth.credential?.secret)return;
    localStorage.removeItem(CLOUD_ACCOUNT);
    this.cloudAccount=this.cloudConfirmed=this.uploaded=this.suppressed=null;this.pairState=null;this.onMode?.();
   }else if(auth.connected)await auth.request('/v1/push',auth.credential,{method:'DELETE'}).catch(()=>{});
   const registration=await navigator.serviceWorker?.ready;
   await (await registration?.pushManager?.getSubscription())?.unsubscribe();
  });
 }
 async pairing(action='GET'){
  const auth=this.getAuth(),secret=auth?.credential?.secret,generation=this.generation||0;
  if(!auth?.connected)throw Error('Google 계정을 연결한 뒤 PC 알림을 연결해 주세요.');
  const current=()=>auth===this.getAuth()&&auth.connected&&secret===auth.credential?.secret&&generation===(this.generation||0);
  if(action==='POST'&&!(await this.upload(true)))throw Error('이 휴대전화의 알림을 켠 뒤 연결 코드를 만들어 주세요.');
  return this.serialize(async()=>{
   if(!current())throw Error('Google 계정 연결이 바뀌었습니다. 다시 시도해 주세요.');
   const result=await auth.request('/v1/push/pair',auth.credential,{method:action,...(action==='POST'?{body:{}}:{})});
   if(!current())throw Error('Google 계정 연결이 바뀌었습니다. 다시 시도해 주세요.');
   if(action!=='POST')this.pairState={auth,secret,paired:result.paired===true};
   return result;
  });
 }
 get pcPaired(){const auth=this.getAuth();return this.pairState?.auth===auth&&this.pairState.secret===auth.credential?.secret&&this.pairState.paired;}
 upload(force=false){
  const generation=this.generation||0,auth=this.getAuth(),credential={...auth?.credential},account=auth?.account?.sub;
  return this.serialize(async()=>{
  this.refreshAcknowledgments();
  const native=()=>usesNativeNotifications(this.getNative?.()),cloud=()=>native()&&this.wantsAndroidCloud(auth);
  const current=()=>(cloud()?this.canReceiveAndroidCloud():!native()&&this.enabled)&&(this.generation||0)===generation&&auth===this.getAuth()&&auth.connected&&auth.account?.sub===account&&auth.credential?.secret===credential?.secret&&typeof Notification!=='undefined'&&Notification.permission==='granted';
  if(native()&&!cloud())return this.suppressWebPush(auth);
  if(!current()||!auth.request)return false;
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
  // During the first Android registration reserve no reminders until the APK
  // confirms it has paused local alarms. This avoids two dispatchers during handover.
  const awaitingAndroid=cloud()&&this.getNative?.()?.notificationStatus?.mode!=='cloud';
  const jobs=awaitingAndroid?[]:this.schedule(Date.now()),key=awaitingAndroid?null:this.changeKey(auth);
  const session=key?await this.sessionId(auth):null;
  if(!current())return false;
  const changed=[...this.savedChanges(key,session)],signature=JSON.stringify([auth.account?.sub||'',auth.credential?.secret||'',subscription.endpoint,jobs]);if(!force&&!changed.length&&signature===this.uploaded)return;
  await auth.request('/v1/push',credential,{method:'POST',body:{subscription:subscription.toJSON(),jobs,...(changed.length?{changedEntryIds:changed.map(([id])=>id)}:{})}});
  if(!current()){this.uploaded=null;if(native()&&!cloud()&&auth===this.getAuth()&&credential.secret===auth.credential?.secret)await this.suppressWebPush(auth);else if(!cloud()||this.cloudAccount!==account)await auth.request('/v1/push',credential,{method:'DELETE'}).catch(()=>{});if(created&&(!cloud()||this.cloudAccount!==account))await subscription.unsubscribe();return false;}
  this.uploaded=signature;
  if(changed.length){
   const pending=this.savedChanges(key,session);let removed=false;
   for(const [id,version] of changed)if(pending.get(id)===version){pending.delete(id);removed=true;}
   if(removed)this.saveChanges(key,session,pending);
  }
  if(cloud()&&this.cloudAccount===account&&this.cloudConfirmed!==credential.secret){this.cloudConfirmed=credential.secret;this.onMode?.();}
  return true;
  });
 }
 tick(){return this.serialize(async()=>{
  this.refreshAcknowledgments();
  if(usesNativeNotifications(this.getNative?.()))return this.wantsAndroidCloud()?false:this.suppressWebPush();
  const generation=this.generation||0,current=()=>this.enabled&&(this.generation||0)===generation&&!usesNativeNotifications(this.getNative?.())&&'Notification'in window&&Notification.permission==='granted';
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
