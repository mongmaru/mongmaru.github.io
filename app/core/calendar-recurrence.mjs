// Shared PC/browser core; regenerate with node scripts/prepare-core.mjs
// RFC 5545 calendar-date recurrence. Unknown components are retained by callers;
// unsupported sub-daily rules must be expanded by Google rather than guessed.
const DAY = 86400000;
const weekdays = ['SU','MO','TU','WE','TH','FR','SA'];
const dateValue = v => new Date(v + 'T12:00:00Z');
const isoDate = v => v.toISOString().slice(0,10);
const shiftDate = (date, days) => isoDate(new Date(dateValue(date).getTime() + days * DAY));
function recurrenceDateValues(lines,prefix,timeZone='Asia/Seoul') {
  return lines.filter(x=>x.startsWith(prefix+':')||x.startsWith(prefix+';')).flatMap(line=>{
    const zone=/;TZID=([^;:]+)/.exec(line)?.[1]||timeZone;
    return line.slice(line.indexOf(':')+1).split(',').map(v=>{
      const date=v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8);
      if(v.includes('T')&&v.length>=15){const time=v.slice(9,11)+':'+v.slice(11,13);try{return dateInZone(v.endsWith('Z')?new Date(date+'T'+time+':'+v.slice(13,15)+'Z'):zonedEpoch(date,time,zone),timeZone);}catch{return date;}}
      return date;
    });
  });
}
const isRecurring=e=>!!(e.recurrenceRule||(e.recurrence&&e.recurrence!=='none')||(e.recurrenceLines||e.google?.resource?.recurrence||[]).some(x=>/^RDATE[;:]/.test(x)));
function parseRule(rule) {
  if (!rule) return null;
  const result = {};
  for (const part of String(rule).replace(/^RRULE:/i,'').toUpperCase().split(';')) {
    const i = part.indexOf('=');
    if (i < 1 || result[part.slice(0,i)] !== undefined) throw Error('반복 규칙이 올바르지 않습니다.');
    result[part.slice(0,i)] = part.slice(i+1);
  }
  if (!['DAILY','WEEKLY','MONTHLY','YEARLY','HOURLY','MINUTELY','SECONDLY'].includes(result.FREQ)) throw Error('반복 주기가 올바르지 않습니다.');
  for (const k of ['INTERVAL','COUNT']) if (result[k] && (!/^\d+$/.test(result[k]) || +result[k] < 1 || +result[k] > 1000000)) throw Error('반복 횟수가 올바르지 않습니다.');
  if (result.UNTIL && !/^\d{8}(T\d{6}Z?)?$/.test(result.UNTIL)) throw Error('반복 종료일이 올바르지 않습니다.');
  if (result.BYDAY && result.BYDAY.split(',').some(v=>!/^([+-]?[1-9]\d?)?(SU|MO|TU|WE|TH|FR|SA)$/.test(v)||Math.abs(+(v.slice(0,-2)||0))>53)) throw Error('반복 요일이 올바르지 않습니다.');
  if(result.WKST&&!weekdays.includes(result.WKST))throw Error('반복 주 시작 요일이 올바르지 않습니다.');
  for (const [k,max] of [['BYMONTH',12],['BYMONTHDAY',31],['BYYEARDAY',366],['BYWEEKNO',53],['BYSETPOS',366]])
    if (result[k] && result[k].split(',').some(v=>!/^[-+]?\d+$/.test(v)||+v===0||Math.abs(+v)>max||(k==='BYMONTH'&&+v<1))) throw Error('반복 날짜가 올바르지 않습니다.');
  return result;
}
function recurrenceDates(entry, through, from = entry.date) {
  const extras=recurrenceDateValues(entry.recurrenceLines||entry.google?.resource?.recurrence||[],'RDATE',entry.timeZone||'Asia/Seoul');
  const exceptions = new Set((entry.recurrenceExceptions||[]).map(x=>typeof x==='string'?x:x.date));
  const finish=values=>[...new Set([...values,...extras])].filter(date=>date>=from&&date<=through&&!exceptions.has(date)).sort();
  let rule = entry.recurrenceRule;
  if (!rule && entry.recurrence && entry.recurrence !== 'none') rule = {
    daily:'FREQ=DAILY',weekdays:'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',weekly:'FREQ=WEEKLY',monthly:'FREQ=MONTHLY',
  }[entry.recurrence];
  if (!rule) return finish([entry.date]);
  const r = parseRule(rule), freq = r.FREQ, interval=+(r.INTERVAL||1), anchor=dateValue(entry.date);
  if (['HOURLY','MINUTELY','SECONDLY'].includes(freq)) return finish([entry.date]);
  let until=through,untilEpoch=null;
  if(r.UNTIL){until=r.UNTIL.slice(0,4)+'-'+r.UNTIL.slice(4,6)+'-'+r.UNTIL.slice(6,8);
    if(r.UNTIL.includes('T')){
      const time=r.UNTIL.slice(9,11)+':'+r.UNTIL.slice(11,13),seconds=+r.UNTIL.slice(13,15);
      untilEpoch=r.UNTIL.endsWith('Z')?Date.parse(until+'T'+time+':'+String(seconds).padStart(2,'0')+'Z'):zonedEpoch(until,time,entry.timeZone||'Asia/Seoul')+seconds*1000;
      if(entry.allDay===false)until=dateInZone(untilEpoch,entry.timeZone||'Asia/Seoul');
    }
  }
  const end = [through,until,entry.recurrenceUntil||through].sort()[0];
  const result=[]; let count=0;
  const monthDays=(y,m)=>new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const wk=weekdays.indexOf(r.WKST||'MO');
  const week1=y=>{const d=new Date(Date.UTC(y,0,4,12));d.setUTCDate(d.getUTCDate()-(d.getUTCDay()-wk+7)%7);return d;};
  let periodYear=anchor.getUTCFullYear();
  function allowed(d) {
    const md=d.getUTCDate(),last=monthDays(d.getUTCFullYear(),d.getUTCMonth());
    const yearDay=Math.round((d-new Date(Date.UTC(d.getUTCFullYear(),0,1,12)))/DAY)+1,yearLength=Math.round((new Date(Date.UTC(d.getUTCFullYear()+1,0,1,12))-new Date(Date.UTC(d.getUTCFullYear(),0,1,12)))/DAY);
    if(r.BYYEARDAY&&!r.BYYEARDAY.split(',').map(Number).some(n=>yearDay===(n>0?n:yearLength+n+1)))return false;
    if(r.BYWEEKNO) {
      let wy=d.getUTCFullYear();if(d<week1(wy))wy--;else if(d>=week1(wy+1))wy++;
      const week=Math.floor((d-week1(wy))/(7*DAY))+1,total=Math.round((week1(wy+1)-week1(wy))/(7*DAY));
      if(freq==='YEARLY'&&wy!==periodYear)return false;
      if(!r.BYWEEKNO.split(',').map(Number).some(n=>week===(n>0?n:total+n+1)))return false;
    }
    if(r.BYMONTH&&!r.BYMONTH.split(',').map(Number).includes(d.getUTCMonth()+1)) return false;
    if(r.BYMONTHDAY&&!r.BYMONTHDAY.split(',').map(Number).some(n=>md===(n>0?n:last+n+1))) return false;
    if(r.BYDAY&&!r.BYDAY.split(',').some(v=>{
      const day=v.slice(-2),ordinal=+(v.slice(0,-2)||0);
      const pos=freq==='YEARLY'&&!r.BYMONTH?yearDay:md,max=freq==='YEARLY'&&!r.BYMONTH?yearLength:last;
      return weekdays[d.getUTCDay()]===day&&(!ordinal||(ordinal>0?Math.ceil(pos/7)===ordinal:-Math.ceil((max-pos+1)/7)===ordinal));
    })) return false;
    return true;
  }
  const wkStart=new Date(anchor);wkStart.setUTCDate(anchor.getUTCDate()-(anchor.getUTCDay()-wk+7)%7);
  for(let n=0;n<100000;n++) {
    let start,endPeriod,candidates=[];
    if(freq==='MONTHLY'||freq==='YEARLY') {
      const y=anchor.getUTCFullYear()+(freq==='YEARLY'?n*interval:0),m=freq==='MONTHLY'?anchor.getUTCMonth()+n*interval:0;
      start=new Date(Date.UTC(y,m,1,12));endPeriod=freq==='YEARLY'?new Date(Date.UTC(y+1,0,1,12)):new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1,12));
      periodYear=y;if(freq==='YEARLY'&&r.BYWEEKNO){start=week1(y);endPeriod=week1(y+1);}
    } else {
      start=new Date((freq==='WEEKLY'?wkStart:anchor).getTime()+n*interval*(freq==='WEEKLY'?7:1)*DAY);
      endPeriod=new Date(start.getTime()+(freq==='WEEKLY'?7:1)*DAY);
    }
    if(isoDate(start)>end) break;
    for(let d=new Date(start);d<endPeriod;d=new Date(d.getTime()+DAY)) {
      if(!allowed(d))continue;
      if(freq==='WEEKLY'&&!r.BYDAY&&d.getUTCDay()!==anchor.getUTCDay())continue;
      if((freq==='MONTHLY'||freq==='YEARLY')&&!r.BYDAY&&!r.BYMONTHDAY&&!r.BYYEARDAY&&!r.BYWEEKNO) {
        // Preserve original H.PLAN monthly end-of-month clamping.
        const target = !entry.recurrenceRule ? Math.min(anchor.getUTCDate(),monthDays(d.getUTCFullYear(),d.getUTCMonth())) : anchor.getUTCDate();
        if(d.getUTCDate()!==target)continue;
      }
      if(freq==='YEARLY'&&!r.BYMONTH&&!r.BYDAY&&!r.BYMONTHDAY&&!r.BYYEARDAY&&!r.BYWEEKNO&&d.getUTCMonth()!==anchor.getUTCMonth())continue;
      candidates.push(isoDate(d));
    }
    if(r.BYSETPOS) candidates=r.BYSETPOS.split(',').map(Number).map(p=>candidates[p>0?p-1:candidates.length+p]).filter(Boolean).sort();
    for(const date of [...new Set(candidates)]) {
      if(date<entry.date||date>end)continue;
      if(untilEpoch!==null&&entry.allDay===false){try{if(zonedEpoch(date,entry.startTime||'00:00',entry.timeZone||'Asia/Seoul')>untilEpoch)continue;}catch{continue;}}
      if(++count>+(r.COUNT||1000000))return finish(result);
      if(date>=from&&!exceptions.has(date))result.push(date);
    }
  }
  return finish(result);
}
function dateInZone(now = new Date(), timeZone='Asia/Seoul') {
  return new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
}
function zonedEpoch(date,time='09:00',timeZone='Asia/Seoul') {
  const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
  const target=Date.UTC(year,month-1,day,hour,minute);let guess=target;
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<4;i++) {
    const p=Object.fromEntries(fmt.formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    const seen=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second),diff=target-seen;
    if(!diff)return guess;guess+=diff;
  }
  // Nonexistent DST wall times must not silently fire at an unrelated time.
  throw Error('시간대의 일광절약시간 전환으로 존재하지 않는 시각입니다.');
}
function expandEntries(entries, from, to) {
  const out=[],overrides=new Map();
  const occurrenceKey=e=>e.seriesId+':'+(e.originalDate||e.google?.originalDate||e.date);
  for(const e of entries)if(e.seriesId){const key=occurrenceKey(e),previous=overrides.get(key);if(!previous||!previous.seriesEdited||e.seriesEdited)overrides.set(key,e);}
  for(const e of entries) {
    if(e.seriesId)continue;
    if(isRecurring(e)) {
      const days=e.endDate?Math.round((dateValue(e.endDate)-dateValue(e.date))/DAY):0;
      for(const date of recurrenceDates(e,to,shiftDate(from,-days))) {
        const replacement=overrides.get(e.id+':'+date);
        out.push(replacement||{...e,id:date===e.date?e.id:e.id+':'+date,date,endDate:e.endDate?shiftDate(date,days):null,seriesId:e.id,recurrence:'none',recurrenceRule:null});
      }
    } else out.push(e);
  }
  // Edited Google instances may have a different ID from a previously
  // materialized scaffold. Never re-add that stale scaffold after replacing it.
  // Distinct edited records remain visible so this view cannot discard user text.
  for(const e of entries)if(e.seriesId&&(overrides.get(occurrenceKey(e))===e||e.seriesEdited)&&!out.some(x=>x.id===e.id))out.push(e);
  return out.filter(e=>!e.deletedAt&&e.date<=to&&(e.endDate||e.date)>=from).sort((a,b)=>a.date.localeCompare(b.date)||String(a.startTime||'').localeCompare(String(b.startTime||''))||a.id.localeCompare(b.id));
}
export {parseRule,recurrenceDates,shiftDate,dateInZone,zonedEpoch,expandEntries,recurrenceDateValues,isRecurring};
