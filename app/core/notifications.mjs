// Shared PC/browser core; regenerate with node scripts/prepare-core.mjs
import {expandEntries,shiftDate,zonedEpoch,dateInZone} from "./calendar-recurrence.mjs";
const terminal=new Set(['done','answered','canceled','moved']);
function notificationSchedule(entries,{from=new Date(),to=new Date(Date.now()+7*86400000),ledger={}}={}) {
  const lo=new Date(from).getTime(),hi=new Date(to).getTime();
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||hi<lo||hi-lo>366*86400000)throw Error('알림 조회 기간이 올바르지 않습니다.');
  const jobs=[],enabled=entries.filter(e=>e.origin!=='google'&&e.notifications?.enabled);
  if(!enabled.length)return jobs;
  // Derive date margins from actual settings: foreground checks should not
  // materialize a full year every fifteen seconds.
  const lead=Math.ceil(Math.max(...enabled.map(e=>e.notifications.beforeMinutes||0))/1440)+2;
  const tail=Math.ceil(Math.max(...enabled.map(e=>(e.notifications.repeatMinutes||5)*((e.notifications.count||5)-1)))/1440)+2;
  const start=shiftDate(new Date(lo).toISOString().slice(0,10),-tail),end=shiftDate(new Date(hi).toISOString().slice(0,10),lead);
  for(const e of expandEntries(entries.filter(e=>e.origin!=='google'&&(e.notifications?.enabled||e.seriesId)),start,end)) {
    const n=e.notifications;if(e.origin==='google'||!n?.enabled||terminal.has(e.status)||ledger.acknowledged?.[e.id])continue;
    let at;try{at=zonedEpoch(e.date,e.startTime||'09:00',e.timeZone||'Asia/Seoul');}catch{continue;}
    for(let index=0;index<Math.min(20,n.count||5);index++) {
      const due=at-(n.beforeMinutes??5)*60000+index*(n.repeatMinutes||5)*60000;
      if(due<lo||due>hi)continue;
      const key=e.id+':'+at+':'+due;
      if(ledger.sent?.[key])continue;
      jobs.push({key,entryId:e.id,at:new Date(due).toISOString(),startAt:new Date(at).toISOString(),title:e.text,body:e.notes||'',index,origin:e.origin||'hplan',google:e.google?JSON.parse(JSON.stringify(e.google)):null,notifications:{...n},timeZone:e.timeZone||'Asia/Seoul'});
    }
  }
  return jobs.sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key));
}
function nextNotificationAt(entry,now=new Date()) {
  return notificationSchedule([entry],{from:now,to:new Date(new Date(now).getTime()+366*86400000)})[0]?.at||null;
}
function acknowledgeNotification(ledger,entryId) {
  return {...ledger,acknowledged:{...(ledger?.acknowledged||{}),[entryId]:true}};
}
function dueNotifications(entries,now=new Date(),ledger={}) {
  const next={...ledger,sent:{...(ledger.sent||{})},acknowledged:{...(ledger.acknowledged||{})}};
  const candidates=notificationSchedule(entries,{from:new Date(new Date(now).getTime()-90000),to:now,ledger:next});
  const latest=new Map();
  for(const job of candidates){next.sent[job.key]=job.at;latest.set(job.entryId,job);}
  // Keep retry/dedupe state bounded; acknowledged records are explicitly managed by caller.
  const threshold=new Date(now).getTime()-31*86400000;
  for(const [key,at] of Object.entries(next.sent))if(Date.parse(at)<threshold)delete next.sent[key];
  return {notifications:[...latest.values()],ledger:next};
}
export {notificationSchedule,nextNotificationAt,acknowledgeNotification,dueNotifications};
