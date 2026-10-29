const VERSION='hplan-mobile-d8d31a9d2a0f';
const FILES=["./","app.css","auto-sync.mjs","calendar-form.mjs","calendar-integration.mjs","config.mjs","conflict-ui.mjs","core/auth-vault.mjs","core/auth.mjs","core/calendar-client.mjs","core/calendar-recurrence.mjs","core/calendar-sync.mjs","core/domain.mjs","core/drive-client.mjs","core/notifications.mjs","core/persistent-auth.mjs","core/reports.mjs","core/repository.mjs","core/sync-model.mjs","core/sync.mjs","event-colors.mjs","fonts/NanumSquareB.ttf","fonts/NanumSquareR.ttf","fonts/OFL.txt","forms.mjs","google-permissions.mjs","google-ui.mjs","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/maskable-512.png","index.html","main.mjs","manifest.webmanifest","native-bootstrap.js","native-bridge.mjs","notifications.mjs","reports-ui.mjs","sync-status.mjs","ui.mjs","vendor/LICENSE-exceljs.txt","vendor/exceljs.min.js"];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('hplan-mobile-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();else if(event.data?.type==='hplan.notification.retry'&&event.source?.url.startsWith(self.registration.scope))event.waitUntil(replayAcknowledgments().then(result=>event.ports?.[0]?.postMessage(result)));});
const ACK_CACHE='hplan-notification-acks-v1',ACK_AGE=31*86400000;
const ackKey=record=>new URL('__notification_ack__/'+[record.sessionId,record.entryId,record.startAt||'legacy'].map(encodeURIComponent).join('/'),self.registration.scope).href;
const ackResponse=record=>new Response(JSON.stringify(record),{headers:{'Content-Type':'application/json'}});
async function currentAuth(){
 const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('hplan-auth-v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);req.onupgradeneeded=()=>req.result.createObjectStore('credentials');});
 const data=await new Promise((resolve,reject)=>{const req=db.transaction('credentials').objectStore('credentials').get('device');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
 const credential=data?.active;if(credential?.server!=='https://hplan-auth.mongmaru4734.workers.dev'||typeof credential.secret!=='string')return null;
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(credential.secret))),sessionId=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 return {credential,sessionId};
}
async function savedAcknowledgments(){
 const cache=await caches.open(ACK_CACHE),records=[];
 for(const key of await cache.keys()){
  let record;try{record=await (await cache.match(key)).json();}catch{}
  if(!record||typeof record.entryId!=='string'||typeof record.sessionId!=='string'||!Number.isFinite(record.savedAt)||record.savedAt<Date.now()-ACK_AGE){await cache.delete(key);continue;}
  records.push(record);
 }
 records.sort((a,b)=>a.savedAt-b.savedAt);
 for(const record of records.splice(0,Math.max(0,records.length-2000)))await cache.delete(ackKey(record));
 return {cache,records};
}
async function sendAcknowledgment(cache,record,auth){
 if(!record.pending||!auth||record.sessionId!==auth.sessionId||record.retryAt>Date.now())return;
 try{const response=await fetch(auth.credential.server+'/v1/push/ack',{method:'POST',headers:{Authorization:'Bearer '+auth.credential.secret,'X-HPlan-Client':'mobile-v1'},body:JSON.stringify({entryId:record.entryId,startAt:record.startAt}),credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});await response.body?.cancel();if(response.ok)record.pending=false;}catch{}
 if(record.pending){record.retryCount=Math.min(6,(record.retryCount||0)+1);record.retryAt=Date.now()+Math.min(3600000,60000*2**record.retryCount);}
 await cache?.put(ackKey(record),ackResponse(record));
}
async function replayAcknowledgments(){
 const auth=await currentAuth().catch(()=>null),sessionId=auth?.sessionId||'local',{cache,records}=await savedAcknowledgments().catch(()=>({cache:null,records:[]})),acks=records.filter(record=>record.sessionId===sessionId);
 await Promise.allSettled(acks.filter(record=>record.pending&&!(record.retryAt>Date.now())).slice(0,4).map(record=>sendAcknowledgment(cache,record,auth)));
 return {sessionId,acks:acks.map(({entryId,startAt})=>({entryId,startAt}))};
}
async function acknowledge(entryId,startAt,sessionId){
 if(typeof entryId!=='string'||entryId.length>240||startAt!==undefined&&!Number.isFinite(Date.parse(startAt)))return;
 const auth=await currentAuth().catch(()=>null);sessionId||=auth?.sessionId||'local';
 const record={entryId,startAt,sessionId,savedAt:Date.now(),pending:sessionId!=='local'};let cache;
 // Persist before network access so a closed-window offline action survives.
 try{cache=await caches.open(ACK_CACHE);await cache.put(ackKey(record),ackResponse(record));await savedAcknowledgments();}catch{cache=null;}
 if(sessionId===(auth?.sessionId||'local')){const all=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const client of all)if(client.url.startsWith(self.registration.scope))client.postMessage({type:'hplan.notification.ack',entryId,startAt,sessionId});}
 await sendAcknowledgment(cache,record,auth);
}
self.addEventListener('push',event=>{event.waitUntil((async()=>{let d;try{d=event.data.json();}catch{return;}if(typeof d.title!=='string'||typeof d.entryId!=='string')return;
 const auth=await currentAuth().catch(()=>null);if(d.sessionId&&d.sessionId!==auth?.sessionId)return;
 const record={entryId:d.entryId,startAt:d.startAt,sessionId:d.sessionId||auth?.sessionId||'local'};let acknowledged;
 try{const cache=await caches.open(ACK_CACHE),saved=await cache.match(ackKey(record));if(saved)acknowledged=await saved.json();if(acknowledged?.savedAt<Date.now()-ACK_AGE)await cache.delete(ackKey(record));}catch{}
 if(acknowledged?.savedAt>=Date.now()-ACK_AGE){await replayAcknowledgments();return;}
 await self.registration.showNotification(d.title,{body:String(d.body||''),tag:String(d.tag||'hplan'),icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',data:{...record,url:new URL('./?entry='+encodeURIComponent(d.entryId),self.registration.scope).href},actions:[{action:'ack',title:'확인했습니다'}]});})());});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const d=event.notification.data||{};if(d.entryId)await acknowledge(d.entryId,d.startAt,d.sessionId).catch(()=>{});if(event.action==='ack')return;const target=new URL(d.url||'./',self.registration.scope);if(target.origin!==self.location.origin||!target.pathname.startsWith(new URL(self.registration.scope).pathname))return;const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(c=>c.url.startsWith(self.registration.scope));if(existing){await existing.navigate(target.href);return existing.focus();}return self.clients.openWindow(target.href);})());});
self.addEventListener('fetch',event=>{const u=new URL(event.request.url),scope=new URL(self.registration.scope);if(event.request.method!=='GET'||u.origin!==scope.origin||!u.pathname.startsWith(scope.pathname))return;
 event.respondWith(caches.open(VERSION).then(async cache=>{const cached=await cache.match(event.request,{ignoreSearch:true});if(cached)return cached;try{return await fetch(event.request);}catch(e){if(event.request.mode==='navigate')return cache.match('./');throw e;}}));});
