// Shared PC/browser core; regenerate with node scripts/prepare-core.mjs
import {clone,validate,apply,dateOK,notificationDefaults} from "./domain.mjs";
import {shiftDate,dateInZone,zonedEpoch,recurrenceDateValues,isRecurring,recurrenceDates,parseRule} from "./calendar-recurrence.mjs";
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const safeEntryId=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
// Four independent 32-bit hashes yield compact deterministic identifiers on Node
// and browsers without platform-specific crypto. Collisions are checked on import.
function hashId(text) {
  return [2166136261,2246822519,3266489917,668265263].map(seed=>{
    let n=seed;for(let i=0;i<text.length;i++){n^=text.charCodeAt(i);n=Math.imul(n,16777619);n^=n>>>13;}
    return (n>>>0).toString(16).padStart(8,'0');
  }).join('');
}
const stableEventId=id=>'hplan'+hashId(String(id));
const stableRemoteId=(service,account,container,id)=>(service==='tasks'?'gtask:':'gcal:')+hashId(JSON.stringify([account,container,id]));
const done=e=>['done','answered'].includes(e.status);
function recurrenceLines(e) {
  const rule=e.recurrenceRule||{daily:'RRULE:FREQ=DAILY',weekdays:'RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',weekly:'RRULE:FREQ=WEEKLY',monthly:'RRULE:FREQ=MONTHLY'}[e.recurrence];
  let normalized=rule?(rule.startsWith('RRULE:')?rule:'RRULE:'+rule):null;
  if(!e.recurrenceRule&&e.recurrence==='monthly'&&+e.date.slice(-2)>28)normalized+=';BYMONTHDAY='+Array.from({length:+e.date.slice(-2)-27},(_,i)=>28+i).join(',')+';BYSETPOS=-1';
  if(normalized&&e.recurrenceUntil){normalized=normalized.replace(/;UNTIL=[^;]+/,'');
    if(/;COUNT=/.test(normalized)){const count=recurrenceDates({...e,recurrenceUntil:null,recurrenceExceptions:[],google:undefined},e.recurrenceUntil).length;normalized=normalized.replace(/;COUNT=(\d+)/,(_,n)=>';COUNT='+Math.max(1,Math.min(+n,count)));}
    else {const until=e.allDay===false?new Date(zonedEpoch(shiftDate(e.recurrenceUntil,1),'00:00',e.timeZone||'Asia/Seoul')-1000).toISOString().replace(/[-:]/g,'').replace('.000Z','Z'):e.recurrenceUntil.replaceAll('-','');normalized+=';UNTIL='+until;}}
  const rawLines=e.recurrenceLines||e.google?.resource?.recurrence||[];
  const extras=rawLines.filter(x=>!/^RRULE:|^EXDATE[;:]/.test(x));
  const remaining=new Set(e.recurrenceExceptions||[]);
  for(const line of rawLines.filter(x=>/^EXDATE[;:]/.test(x))) {
    const values=line.slice(line.indexOf(':')+1).split(','),dates=recurrenceDateValues([line],'EXDATE',e.timeZone||'Asia/Seoul');
    const kept=values.filter((v,i)=>remaining.has(dates[i]));
    for(const date of dates)remaining.delete(date);
    if(kept.length)extras.push(line.slice(0,line.indexOf(':')+1)+kept.join(','));
  }
  if(remaining.size){const dates=[...remaining].sort().map(x=>x.replaceAll('-',''));
    extras.push(e.allDay===false?'EXDATE;TZID='+(e.timeZone||'Asia/Seoul')+':'+dates.map(date=>date+'T'+e.startTime.replace(':','')+'00').join(','):'EXDATE;VALUE=DATE:'+dates.join(','));}
  return [...(normalized?[normalized]:[]),...extras];
}
function entryToEvent(e,projects=[]) {
  const project=projects.find(p=>p.id===e.projectId),projectName=project?.name||'';
  const description=(e.notes||'')+(e.answer?'\n\n[답변]\n'+e.answer:'');
  let start,end;
  if(e.allDay!==false){start={date:e.date};end={date:shiftDate(e.endDate||e.date,1)};}
  else {
    const zone=e.timeZone||'Asia/Seoul';
    start={dateTime:new Date(zonedEpoch(e.date,e.startTime,zone)).toISOString(),timeZone:zone};
    end={dateTime:new Date(zonedEpoch(e.endDate||e.date,e.endTime,zone)).toISOString(),timeZone:zone};
  }
  return {colorId:e.eventColorId===undefined?(e.google?.resource?.colorId||null):(e.eventColorId||null),summary:(projectName?'['+projectName+'] ':'')+e.text,description,start,end,recurrence:recurrenceLines(e),
    extendedProperties:{private:{hplanId:e.id,hplanOrigin:e.origin||'hplan',hplanKind:e.kind,hplanStatus:e.status,hplanDueDate:e.dueDate||'',hplanEndDate:e.endDate||'',hplanTimeZone:e.timeZone||'Asia/Seoul',hplanProjectId:e.projectId||'',hplanProjectName:projectName}},
    ...((e.origin||'hplan')==='hplan'?{reminders:{useDefault:false,overrides:[]}}:{}),};
}
function wallParts(value,zone) {
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return {date:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
}
function splitDescription(description) {
  const marker='\n\n[답변]\n',i=description.indexOf(marker);return i<0?{notes:description,answer:''}:{notes:description.slice(0,i),answer:description.slice(i+marker.length)};
}
function eventProjection(event,defaultTimeZone='Asia/Seoul') {
  const props=event.extendedProperties?.private||{},allDay=!!event.start?.date;
  const timeZone=event.start?.timeZone||event.end?.timeZone||props.hplanTimeZone||defaultTimeZone;
  const start=allDay?{date:event.start.date,time:null}:wallParts(event.start.dateTime,timeZone);
  const end=allDay?{date:shiftDate(event.end?.date||shiftDate(start.date,1),-1),time:null}:wallParts(event.end?.dateTime||event.start.dateTime,timeZone);
  const endDate=end.date===start.date&&!props.hplanEndDate?null:end.date;
  const lines=event.recurrence||[];
  const exceptions=recurrenceDateValues(lines,'EXDATE',timeZone).filter(dateOK);
  return {eventColor:event.colorId||null,title:event.summary||'(제목 없음)',description:event.description||'',schedule:{date:start.date,endDate,allDay,startTime:start.time,endTime:end.time,timeZone},recurrence:{rule:lines.find(x=>/^RRULE:/.test(x))||null,exceptions,lines:[...lines].sort()},status:props.hplanStatus||'planned',dueDate:dateOK(props.hplanDueDate)?props.hplanDueDate:null};
}
function localProjection(e,projects) {
  if(e.google?.service==='tasks')return {title:e.text,description:e.notes||'',dueDate:e.dueDate||null,completed:done(e)};
  const event=entryToEvent(e,projects);return eventProjection(event);
}
function writeProjection(e,fields,projects=[]) {
  if(fields.title!==undefined){const name=projects.find(p=>p.id===e.projectId)?.name||e.google?.resource?.extendedProperties?.private?.hplanProjectName;const prefix=name?'['+name+'] ':'';e.text=prefix&&fields.title.startsWith(prefix)?fields.title.slice(prefix.length):fields.title;}
  if(fields.eventColor!==undefined)e.eventColorId=fields.eventColor;
  if(fields.description!==undefined){if(e.google?.service==='tasks')e.notes=fields.description;else Object.assign(e,splitDescription(fields.description));}
  if(fields.schedule)Object.assign(e,fields.schedule);
  if(fields.recurrence){e.recurrenceRule=fields.recurrence.rule;e.recurrence='none';e.recurrenceExceptions=fields.recurrence.exceptions;e.recurrenceLines=fields.recurrence.lines;}
  if(fields.dueDate!==undefined)e.dueDate=fields.dueDate;
  if(fields.status!==undefined){const valid=e.kind==='question'?['open','waiting','answered','hold']:['planned','progress','waiting','done','canceled','moved'];if(valid.includes(fields.status)){e.status=fields.status;e.doneAt=done(e)?e.doneAt||new Date().toISOString():null;}}
  if(fields.completed!==undefined){if(fields.completed){e.status=e.kind==='question'?'answered':'done';e.doneAt=e.doneAt||new Date().toISOString();}else if(done(e)){e.status=e.kind==='question'?'open':'planned';e.doneAt=null;}}
}
function eventToEntry(event,{accountId,calendarId='primary',now=new Date(),timeZone='Asia/Seoul'}={}) {
  const props=event.extendedProperties?.private||{},hplan=props.hplanOrigin==='hplan',fields=eventProjection(event,timeZone),stamp=new Date(now).toISOString();
  const originalDate=event.originalStartTime?.date||(event.originalStartTime?.dateTime?wallParts(event.originalStartTime.dateTime,fields.schedule.timeZone).date:null);
  const proposed=event.recurringEventId&&props.hplanId?props.hplanId+':'+originalDate:props.hplanId;
  const id=safeEntryId(proposed)?proposed:stableRemoteId('calendar',accountId,calendarId,event.id);
  const e={id,kind:'personal',date:fields.schedule.date,text:fields.title,projectId:null,status:'planned',parentId:null,order:0,notes:'',answer:'',target:'',dueDate:null,reviewDate:null,priority:false,color:null,recurrence:'none',recurrenceUntil:null,deletedAt:null,createdAt:event.created||stamp,updatedAt:event.updated||stamp,doneAt:null,origin:hplan?'hplan':'google',notifications:{...notificationDefaults},
    google:{service:'calendar',accountId,calendarId,id:event.id,etag:event.etag||null,base:fields,resource:clone(event),conflicts:{}}};
  if(hplan&&['task','question','personal'].includes(props.hplanKind))e.kind=props.hplanKind;
  writeProjection(e,fields);
  if(event.recurringEventId){e.seriesId=safeEntryId(props.hplanId)?props.hplanId:stableRemoteId('calendar',accountId,calendarId,event.recurringEventId);e.seriesEdited=true;e.originalDate=originalDate||e.date;e.google.originalDate=e.originalDate;}
  return e;
}
function taskProjection(task){return {title:task.title||'(제목 없음)',description:task.notes||'',dueDate:task.due?.slice(0,10)||null,completed:task.status==='completed'};}
function taskToEntry(task,{accountId,taskListId,now=new Date()}={}) {
  const fields=taskProjection(task),date=fields.dueDate||dateInZone(task.updated||now),stamp=new Date(now).toISOString();
  return {id:stableRemoteId('tasks',accountId,taskListId,task.id),kind:'personal',date,text:fields.title,notes:fields.description,answer:'',target:'',projectId:null,parentId:null,order:0,status:fields.completed?'done':'planned',doneAt:fields.completed?(task.completed||stamp):null,dueDate:fields.dueDate,reviewDate:null,priority:false,color:null,recurrence:'none',recurrenceUntil:null,allDay:true,endDate:null,startTime:null,endTime:null,timeZone:'Asia/Seoul',origin:'google',notifications:{...notificationDefaults},deletedAt:null,createdAt:task.updated||stamp,updatedAt:task.updated||stamp,google:{service:'tasks',accountId,taskListId,id:task.id,etag:task.etag||null,base:fields,resource:clone(task),conflicts:{}}};
}
function mergeFields(base,local,remote,at) {
  const merged={},conflicts={};
  for(const field of Object.keys(remote)) {
    if(same(local[field],base?.[field]))merged[field]=remote[field];
    else if(same(remote[field],base?.[field])||same(local[field],remote[field]))merged[field]=local[field];
    else {merged[field]=local[field];conflicts[field]={base:base?.[field]??null,local:local[field],google:remote[field],at};}
  }
  return {merged,conflicts};
}
function occurrenceBase(master,occurrence,projects) {
  const base=clone(master.google?.base||localProjection(master,projects)),date=occurrence.originalDate||occurrence.google?.originalDate||occurrence.date;
  if(base.schedule){const duration=base.schedule.endDate?Math.round((Date.parse(base.schedule.endDate+'T12:00:00Z')-Date.parse(base.schedule.date+'T12:00:00Z'))/86400000):null;
    base.schedule={...base.schedule,date,endDate:duration===null?null:shiftDate(date,duration)};}
  base.recurrence={rule:null,exceptions:[],lines:[]};base.status=occurrence.kind==='question'?'open':'planned';
  return base;
}
function inImportRange(entry,cutoff) {
  if((entry.endDate||entry.date)>=cutoff)return true;
  if(!isRecurring(entry))return false;
  const duration=entry.endDate?Math.round((Date.parse(entry.endDate+'T12:00:00Z')-Date.parse(entry.date+'T12:00:00Z'))/86400000):0;
  // A recurring master may have ended before the cutoff while its final
  // occurrence still overlaps the first imported day, including across UTC.
  if(recurrenceDates(entry,cutoff,shiftDate(cutoff,-duration)).length)return true;
  if(recurrenceDateValues(entry.recurrenceLines||entry.google?.resource?.recurrence||[],'RDATE',entry.timeZone).some(date=>date>=cutoff))return true;
  const rule=entry.recurrenceRule?parseRule(entry.recurrenceRule):null;if(!rule)return false;
  if(rule.UNTIL&&recurrenceDateValues(['RDATE:'+rule.UNTIL],'RDATE',entry.timeZone)[0]<=cutoff)return false;
  if(rule.COUNT&&recurrenceDates({...entry,google:undefined,recurrenceExceptions:[]},shiftDate(cutoff,-1)).length>=+rule.COUNT)return false;
  return true;
}
function eventPatch(e,desired,remote,conflicts,projects) {
  const event=entryToEvent(e,projects),patch={};
  if(!conflicts.eventColor&&!same(desired.eventColor,remote.eventColor))patch.colorId=desired.eventColor;
  if(!conflicts.title&&!same(desired.title,remote.title))patch.summary=event.summary;
  if(!conflicts.description&&!same(desired.description,remote.description))patch.description=event.description;
  if(!conflicts.schedule&&!same(desired.schedule,remote.schedule)){patch.start=event.start;patch.end=event.end;}
  if(!conflicts.recurrence&&!same(desired.recurrence,remote.recurrence))patch.recurrence=event.recurrence;
  if((!conflicts.status&&!same(desired.status,remote.status))||(!conflicts.dueDate&&!same(desired.dueDate,remote.dueDate))) {
    const privateProps={...(e.google.resource?.extendedProperties?.private||{}),...event.extendedProperties.private};
    if(conflicts.status)privateProps.hplanStatus=e.google.resource?.extendedProperties?.private?.hplanStatus||'planned';
    if(conflicts.dueDate)privateProps.hplanDueDate=remote.dueDate||'';
    patch.extendedProperties={...(e.google.resource?.extendedProperties||{}),private:privateProps};
  }
  if(e.origin==='hplan'&&(!same(e.google.resource?.reminders,{useDefault:false,overrides:[]})))patch.reminders={useDefault:false,overrides:[]};
  return patch;
}
class CalendarSync {
  constructor({client,accountId,getState,commit,loadLinkState=async()=>null,saveLinkState=async()=>{},now=()=>new Date(),calendarIds=['primary'],tasks=true,allowed=()=>true}={}) {
    if(!/^[A-Za-z0-9_.@:-]{1,200}$/.test(accountId||'')||['__proto__','constructor','prototype'].includes(accountId))throw Error('Google 계정이 올바르지 않습니다.');
    Object.assign(this,{client,accountId,getState,commit,loadLinkState,saveLinkState,now,calendarIds,tasks,allowed});this.running=null;
  }
  guard(){if(!this.allowed())throw Object.assign(Error('Google 계정 또는 편집 상태가 변경되어 동기화를 보류했습니다.'),{code:'CALENDAR_CANCELLED'});}
  async change(fn,reason='google-calendar') {
    this.guard();const basis=clone(await this.getState()),next=clone(basis);fn(next);next.updatedAt=new Date(this.now()).toISOString();validate(next);this.guard();
    if(!same({...basis,updatedAt:null},{...next,updatedAt:null}))await this.commit(next,{reason,basis});return next;
  }
  async persist(){this.guard();await this.saveLinkState(this.accountId,clone(this.ledger));}
  run(){if(this.running)return this.running;this.running=this.perform().finally(()=>{this.running=null;});return this.running;}
  async perform() {
    this.guard();const loaded=await this.loadLinkState(this.accountId);
    this.ledger={version:1,links:{},calendars:{},...(loaded||{})};this.result={imported:0,exported:0,deleted:0,conflicts:[],errors:[],lastSyncAt:loaded?.lastSyncAt||null,lastAttemptAt:null,cutoff:null};
    const shared=(await this.getState()).calendarAccounts?.[this.accountId]?.cutoff;
    const previousCutoff=this.ledger.cutoff;
    this.ledger.cutoff=[shared,this.ledger.cutoff,dateInZone(this.now()).slice(0,7)+'-01'].filter(Boolean).sort()[0];this.result.cutoff=this.ledger.cutoff;
    if(previousCutoff&&this.ledger.cutoff<previousCutoff)this.ledger.calendars={};
    await this.change(s=>{s.calendarAccounts={...(s.calendarAccounts||{}),[this.accountId]:{cutoff:this.ledger.cutoff}};},'google-calendar-cutoff');
    for(const e of (await this.getState()).entries)if(e.google?.accountId===this.accountId&&(!e.seriesId||e.seriesEdited)){
      this.ledger.links[e.id]={...(this.ledger.links[e.id]||{}),...clone(e.google),origin:e.origin||'hplan'};
      // A restore performed before a delayed first-export deletion must cancel
      // that pending deletion, rather than removing the live record again.
      if(!e.deletedAt)this.ledger.links[e.id].pendingDelete=false;
    }
    await this.persist();
    if(this.calendarIds.length&&typeof this.client.listCalendars==='function') {
      try{const list=await this.client.listCalendars();this.ledger.timeZones={...(this.ledger.timeZones||{})};this.ledger.colors||={};for(const calendar of list.items)if(/^#[a-f0-9]{6}$/i.test(calendar.backgroundColor||"")){this.ledger.colors[calendar.id]=calendar.backgroundColor;if(calendar.primary)this.ledger.colors.primary=calendar.backgroundColor;}for(const calendar of list.items)if(calendar.timeZone){this.ledger.timeZones[calendar.id]=calendar.timeZone;if(calendar.primary)this.ledger.timeZones.primary=calendar.timeZone;}}
      catch(error){this.error(error,'calendar-list');}
    }
    for(const calendarId of this.calendarIds)await this.service('calendar',calendarId);
    if(this.tasks) {
      try {const lists=await this.client.listTaskLists();for(const list of lists.items)await this.service('tasks',list.id);}catch(e){this.error(e,'tasks');}
    }
    this.result.lastAttemptAt=new Date(this.now()).toISOString();this.ledger.lastAttemptAt=this.result.lastAttemptAt;
    if(!this.result.errors.length){this.result.lastSyncAt=this.result.lastAttemptAt;this.ledger.lastSyncAt=this.result.lastSyncAt;}await this.persist();
    this.result.conflicts=(await this.getState()).entries.filter(e=>e.google?.accountId===this.accountId&&Object.keys(e.google.conflicts||{}).length).map(e=>({entryId:e.id,fields:clone(e.google.conflicts)}));
    return this.result;
  }
  error(e,service,id){if(e.code==='CALENDAR_CANCELLED')throw e;this.result.errors.push({service,id:id||null,status:e.status||null,message:e.message||'Google 동기화에 실패했습니다.'});}
  selected(link,service,container){return link.service===service&&(service==='calendar'?link.calendarId:link.taskListId)===container;}
  async remote(link){return link.service==='calendar'?this.client.getEvent(link.calendarId,link.id):this.client.getTask(link.taskListId,link.id);}
  async removeRemote(link){
    this.guard();let resource;try{resource=await this.remote(link);}catch(e){if(e.status===404||e.status===410)return;throw e;}
    if(!resource||resource.status==='cancelled'||resource.deleted)return;
    this.guard();if(link.service==='calendar')await this.client.deleteEvent(link.calendarId,link.id,resource.etag);else await this.client.deleteTask(link.taskListId,link.id,resource.etag);
  }
  async service(service,container) {
    try {
      this.guard();
      // Process missing local records before imports so offline deletion cannot
      // be mistaken for a brand-new Google item on the next connection.
      const current=await this.getState();
      const sharedDeletes=current.calendarDeletions||{};
      for(const [id,tombstone]of Object.entries(sharedDeletes))if(tombstone.google?.accountId===this.accountId)this.ledger.links[id]={...tombstone.google,origin:tombstone.origin,deleted:true};
      for(const [id,link]of Object.entries(this.ledger.links))if(this.selected(link,service,container)&&(!current.entries.some(e=>e.id===id)||link.pendingDelete)) {
        await this.removeRemote(link);link.deleted=true;link.pendingDelete=false;await this.persist();
      }
      let listing,cursor,cachedResources={};
      if(service==='calendar') {
        const checkpoint=this.ledger.calendars[container];cursor=checkpoint?.syncToken;
        // Only this device's API observations paired with its cursor are trusted.
        // entry.google/links can be replaced by an older Drive snapshot.
        if(cursor)cachedResources=checkpoint.resources||{};
        try{listing=await this.client.listEvents(container,{syncToken:cursor});}catch(e){if(e.status!==410)throw e;cursor=null;listing=await this.client.listEvents(container,{});}
      } else listing=await this.client.listTasks(container);
      const resources=new Map(service==='calendar'&&cursor?Object.entries(cachedResources):[]);
      const listedIds=new Set(listing.items.map(resource=>resource.id));
      for(const resource of listing.items)resources.set(resource.id,resource);
      if(service==='calendar')await this.linkOccurrences(container);
      // Masters first, then moved/cancelled recurrence exceptions.
      for(const resource of [...listing.items].sort((a,b)=>Number(!!a.recurringEventId)-Number(!!b.recurringEventId))) {
        this.guard();
        const entries=(await this.getState()).entries;
        const existing=entries.find(e=>e.google?.accountId===this.accountId&&this.selected(e.google,service,container)&&e.google.id===resource.id&&(!e.seriesId||e.seriesEdited));
        if(existing)continue;
        const ledger=Object.entries(this.ledger.links).find(([,link])=>this.selected(link,service,container)&&link.id===resource.id);
        if(ledger?.[1].deleted||ledger&&!entries.some(e=>e.id===ledger[0]))continue;
        if(service==='calendar'&&resource.recurringEventId&&resource.status==='cancelled'){await this.cancelOccurrence(resource,container);continue;}
        if(resource.deleted||resource.status==='cancelled')continue;
        const imported=service==='calendar'?eventToEntry(resource,{accountId:this.accountId,calendarId:container,now:this.now(),timeZone:this.ledger.timeZones?.[container]}):taskToEntry(resource,{accountId:this.accountId,taskListId:container,now:this.now()});
        if(!inImportRange(imported,this.ledger.cutoff)&&(service!=='tasks'||(resource.updated||'').slice(0,10)<this.ledger.cutoff))continue;
        if(resource.recurringEventId){const master=entries.find(e=>e.google?.id===resource.recurringEventId&&e.google.accountId===this.accountId);if(master)imported.seriesId=master.id;}
        const duplicate=entries.find(e=>e.id===imported.id);
        if(duplicate){if(duplicate.google&&duplicate.google.id!==resource.id)throw Error('같은 일정 식별자가 다른 Google 항목에 연결되어 있습니다.');await this.change(s=>{const e=s.entries.find(x=>x.id===duplicate.id);e.google=clone(imported.google);e.origin=e.origin||imported.origin;
          if(resource.recurringEventId){const master=s.entries.find(x=>x.id===imported.seriesId);if(master)e.google.base=occurrenceBase(master,{...e,originalDate:imported.originalDate},s.projects);e.seriesId=imported.seriesId;e.originalDate=imported.originalDate;e.seriesEdited=true;}
        });}
        else {await this.change(s=>{s.entries.push(imported);});this.result.imported++;}
        this.ledger.links[imported.id]={...clone(imported.google),origin:imported.origin};
      }
      const linked=(await this.getState()).entries.filter(e=>e.google?.accountId===this.accountId&&this.selected(e.google,service,container)&&(!e.seriesId||e.seriesEdited));
      for(const entry of linked) {
        try {
          let resource=resources.get(entry.google.id);
          // ETags are opaque: an observation merged from Drive may be either
          // older or newer than this cursor's cached view. Confirm only that
          // changed link instead of guessing which device observed it last.
          if(service==='calendar'&&resource&&!listedIds.has(entry.google.id)&&!same(resource,entry.google.resource))resource=null;
          if(!resource)try{resource=await this.remote(entry.google);}catch(e){if(e.status===404||e.status===410)resource={id:entry.google.id,status:'cancelled',deleted:true};else throw e;}
          const synced=await this.reconcile(entry.id,resource);
          if(service==='calendar')resources.set(entry.google.id,synced||resource);
        }catch(e){this.error(e,service,entry.id);}
      }
      if(service==='calendar') {
        // Calendar is the sole export destination for H.PLAN-created entries.
        const unlinked=(await this.getState()).entries.filter(e=>!e.deletedAt&&!e.google&&(!e.origin||e.origin==='hplan'||e.calendarTarget?.accountId===this.accountId)&&!e.seriesId&&(e.calendarTarget?.calendarId||this.calendarIds[0])===container);
        for(const entry of unlinked)try{await this.insert(entry.id,container);}catch(e){this.error(e,service,entry.id);}
        if(listing.nextSyncToken) {
          // Retain only observed resources belonging to linked records, keeping
          // historical items outside the import window out of the local cache.
          const ids=new Set(Object.values(this.ledger.links).filter(link=>this.selected(link,service,container)).map(link=>link.id));
          this.ledger.calendars[container]={syncToken:listing.nextSyncToken,resources:Object.fromEntries([...resources].filter(([id])=>ids.has(id)))};
        }
      }
      await this.persist();
    }catch(e){this.error(e,service,container);}
  }
  async cancelOccurrence(resource,calendarId) {
    await this.change(s=>{const master=s.entries.find(e=>e.google?.accountId===this.accountId&&e.google.calendarId===calendarId&&e.google.id===resource.recurringEventId);if(master){
      const original=resource.originalStartTime,zone=master.timeZone||original?.timeZone||this.ledger.timeZones?.[calendarId]||'Asia/Seoul';
      const date=original?.date||(original?.dateTime?wallParts(original.dateTime,zone).date:null);if(!dateOK(date))return;
      if(s.entries.some(e=>e.seriesId===master.id&&(e.originalDate||e.date)===date&&e.calendarRestorePending))return;master.recurrenceExceptions=[...new Set([...(master.recurrenceExceptions||[]),date])];master.updatedAt=new Date(this.now()).toISOString();s.entries=s.entries.filter(e=>!(e.seriesId===master.id&&(e.originalDate||e.date)===date&&!e.seriesEdited));}});
  }
  async linkOccurrences(calendarId) {
    for(const occurrence of (await this.getState()).entries.filter(e=>e.seriesId&&e.seriesEdited&&!e.deletedAt)) {
      const state=await this.getState(),master=state.entries.find(e=>e.id===occurrence.seriesId);
      if(master?.google?.service!=='calendar'||master.google.accountId!==this.accountId||master.google.calendarId!==calendarId)continue;
      if(occurrence.google?.id&&occurrence.google.id!==master.google.id)continue;
      const date=occurrence.originalDate||occurrence.date,zone=master.timeZone||'Asia/Seoul';
      const instances=await this.client.listInstances(calendarId,master.google.id,{timeMin:new Date(zonedEpoch(shiftDate(date,-1),'00:00',zone)).toISOString(),timeMax:new Date(zonedEpoch(shiftDate(date,2),'00:00',zone)).toISOString()});
      const resource=instances.items.find(e=>(e.originalStartTime?.date||(e.originalStartTime?.dateTime?wallParts(e.originalStartTime.dateTime,zone).date:null))===date);
      if(!resource)throw Error('Google 반복 회차를 찾지 못했습니다. 원본 반복 일정은 유지했습니다.');
      if(resource.status==='cancelled')continue;
      await this.change(s=>{const target=s.entries.find(e=>e.id===occurrence.id);if(target){target.google={service:'calendar',accountId:this.accountId,calendarId,id:resource.id,etag:resource.etag,base:occurrenceBase(master,{...target,originalDate:date},s.projects),resource:clone(resource),originalDate:date,conflicts:{}};delete target.calendarRestorePending;}});
    }
  }
  async reconcile(id,resource,retry=true) {
    this.guard();const state=await this.getState(),e=state.entries.find(x=>x.id===id);if(!e)return;
    const link=e.google,deleted=resource.status==='cancelled'||resource.deleted;
    if(e.deletedAt){await this.removeRemote(link);await this.change(s=>{const x=s.entries.find(x=>x.id===id);if(x)x.google={...x.google,deleted:true,deletionAt:x.deletedAt};});this.ledger.links[id]={...link,origin:e.origin,deleted:true};this.result.deleted++;return {id:link.id,status:'cancelled',deleted:true};}
    if(deleted) {
      if(e.origin==='hplan'&&link.deleted){await this.insert(id,link.calendarId,(link.generation||0)+1);return;}
      await this.change(s=>{apply(s,{type:'entry.delete',ids:[id],scope:!e.seriesId&&isRecurring(e)?'all':undefined,occurrenceDate:e.date});const x=s.entries.find(x=>x.id===id);if(x)x.google={...x.google,deleted:true,deletionAt:x.deletedAt};});this.ledger.links[id]={...link,origin:e.origin,deleted:true};this.result.deleted++;return;
    }
    const remote=link.service==='tasks'?taskProjection(resource):eventProjection(resource,this.ledger.timeZones?.[link.calendarId]||e.timeZone),local=localProjection(e,state.projects),at=new Date(this.now()).toISOString();
    const {merged,conflicts}=mergeFields({...remote,...(link.base||{}),...(link.base&&!Object.hasOwn(link.base,"eventColor")?{eventColor:link.resource?.colorId||null}:{})},local,remote,at);
    const updated=clone(e);updated.google={...link,resource:clone(resource),etag:resource.etag||link.etag};writeProjection(updated,merged,state.projects);
    let patch={};
    if(link.service==='tasks') {
      if(!conflicts.title&&!same(merged.title,remote.title))patch.title=merged.title;
      if(!conflicts.description&&!same(merged.description,remote.description))patch.notes=merged.description;
      if(!conflicts.dueDate&&!same(merged.dueDate,remote.dueDate))patch.due=merged.dueDate?merged.dueDate+'T00:00:00.000Z':null;
      if(!conflicts.completed&&!same(merged.completed,remote.completed)){patch.status=merged.completed?'completed':'needsAction';patch.completed=merged.completed?at:null;}
    }else patch=eventPatch(updated,merged,remote,conflicts,state.projects);
    let synced=resource;
    if(Object.keys(patch).length){
      this.guard();try{synced=link.service==='tasks'?await this.client.patchTask(link.taskListId,link.id,patch,resource.etag):await this.client.patchEvent(link.calendarId,link.id,patch,resource.etag);this.result.exported++;}
      catch(error){if(error.status===412&&retry){const fresh=await this.remote(link);return this.reconcile(id,fresh,false);}throw error;}
    }
    const base={...merged};for(const key of Object.keys(conflicts))base[key]=link.base?.[key]??remote[key];
    await this.change(s=>{const target=s.entries.find(x=>x.id===id);if(!target)return;
      // A fresh field merge protects typing that happened during HTTP requests.
      const latest=localProjection(target,s.projects),newer=mergeFields(local,latest,merged,at);
      writeProjection(target,newer.merged,s.projects);
      const pending={...conflicts,...newer.conflicts};
      for(const [field,conflict]of Object.entries(pending)){
        const previous=target.google?.conflicts?.[field];
        if(previous&&same({...previous,at:null},{...conflict,at:null}))conflict.at=previous.at;
      }
      target.google={...target.google,calendarColor:this.ledger.colors?.[link.calendarId]||target.google.calendarColor||null,etag:synced.etag||resource.etag,resource:clone(synced),base,conflicts:pending,deleted:false};
      // API caches and ETags must persist, without looking like a content edit
      // on every device that independently observes the same Google resource.
      if(!same({...e,google:null,updatedAt:null},{...target,google:null,updatedAt:null}))target.updatedAt=at;
    });
    const latest=(await this.getState()).entries.find(x=>x.id===id);if(latest)this.ledger.links[id]={...clone(latest.google),origin:latest.origin};
    return synced;
  }
  async insert(id,calendarId,generation=0) {
    this.guard();const state=await this.getState(),e=state.entries.find(x=>x.id===id);if(!e||e.deletedAt)return;
    const event={...entryToEvent(e,state.projects),id:stableEventId(generation?id+':'+generation:id)};
    this.ledger.links[id]={service:'calendar',accountId:this.accountId,calendarId,id:event.id,origin:e.origin||'hplan',pendingCreate:true};await this.persist();
    let resource;
    try{resource=await this.client.insertEvent(calendarId,event);}catch(error){if(error.status!==409)throw error;resource=await this.client.getEvent(calendarId,event.id);if(resource.extendedProperties?.private?.hplanId!==id)throw Error('Google 일정 식별자가 다른 항목에 사용됐습니다.');}
    const link={service:'calendar',accountId:this.accountId,calendarId,id:resource.id,etag:resource.etag,generation,base:eventProjection(resource),resource:clone(resource),conflicts:{}};
    const after=await this.change(s=>{const target=s.entries.find(x=>x.id===id);if(!target){s.calendarDeletions={...(s.calendarDeletions||{}),[id]:{entryId:id,google:clone(link),origin:e.origin||'hplan',at:new Date(this.now()).toISOString()}};return;}target.origin=target.origin||'hplan';target.google=link;});
    const target=after.entries.find(x=>x.id===id);
    this.ledger.links[id]={...link,origin:e.origin||'hplan',deleted:!target||!!target.deletedAt,pendingDelete:!target||!!target.deletedAt};await this.persist();
    if(!target||target.deletedAt){await this.removeRemote(link);this.ledger.links[id].pendingDelete=false;await this.persist();}
    this.result.exported++;
  }
  async resolve(entryId,field,choice) {
    if(!['local','google'].includes(choice))throw Error('충돌 해결 방법을 확인해 주세요.');
    return this.change(s=>{const e=s.entries.find(x=>x.id===entryId);if(e?.google?.accountId!==this.accountId)throw Error('현재 연결된 Google 계정의 충돌만 해결할 수 있습니다.');
      const conflict=Object.hasOwn(e.google.conflicts||{},field)?e.google.conflicts[field]:null;if(!conflict)throw Error('해결할 Google 충돌을 찾을 수 없습니다.');
      const local=localProjection(e,s.projects);if(!Object.hasOwn(local,field))throw Error('지원하지 않는 Google 충돌 항목입니다.');
      writeProjection(e,{[field]:choice==='local'?local[field]:conflict.google},s.projects);e.google.base[field]=conflict.google;delete e.google.conflicts[field];e.updatedAt=new Date(this.now()).toISOString();},'google-calendar-resolve');
  }
}
export {CalendarSync,entryToEvent,eventToEntry,taskToEntry,stableEventId,stableRemoteId,mergeFields};
