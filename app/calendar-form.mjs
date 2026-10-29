import { esc, field, select, checkbox } from './ui.mjs';
const weekdays=[['MO','월'],['TU','화'],['WE','수'],['TH','목'],['FR','금'],['SA','토'],['SU','일']];
const integer=(value,min,max,fallback)=>Math.max(min,Math.min(max,Number.parseInt(value,10)||fallback));
export function ruleFields(rule='') {
  const p=Object.fromEntries(String(rule).replace(/^RRULE:/,'').split(';').map(x=>x.split('=')));
  const nth=/^(-?[1-5])(MO|TU|WE|TH|FR|SA|SU)$/.exec(p.BYDAY||'');
  return {frequency:p.FREQ||'WEEKLY',interval:p.INTERVAL||'1',weekdays:nth?'':p.BYDAY||'',repeatEnd:p.COUNT?'count':p.UNTIL?'until':'never',repeatCount:p.COUNT||'10',repeatUntil:p.UNTIL?`${p.UNTIL.slice(0,4)}-${p.UNTIL.slice(4,6)}-${p.UNTIL.slice(6,8)}`:'',monthMode:nth?'weekday':'date',monthPosition:nth?.[1]||'1',monthWeekday:nth?.[2]||'MO'};
}
export function buildRule(f) {
  const mode=f.get('repeatMode');
  if(mode==='none'||!mode)return null;
  if(mode==='keep')return String(f.get('rawRule')||'')||null;
  const freq=mode==='custom'?String(f.get('frequency')):mode;
  if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(freq))throw Error('반복 주기를 확인해 주세요.');
  if(mode!=='custom')return 'RRULE:FREQ='+freq;
  const out=[`FREQ=${freq}`],n=integer(f.get('interval'),1,999,1);
  if(n>1)out.push(`INTERVAL=${n}`);
  if(freq==='WEEKLY') {
    const days=String(f.get('weekdays')||'').split(',').filter(x=>weekdays.some(([id])=>id===x));
    if(days.length)out.push('BYDAY='+[...new Set(days)].join(','));
  }
  if(freq==='MONTHLY'&&f.get('monthMode')==='weekday') {
    const pos=String(f.get('monthPosition')),day=String(f.get('monthWeekday'));
    if(!['1','2','3','4','-1'].includes(pos)||!weekdays.some(([id])=>id===day))throw Error('매월 반복 요일을 확인해 주세요.');
    out.push(`BYDAY=${pos}${day}`);
  }
  if(f.get('repeatEnd')==='count')out.push(`COUNT=${integer(f.get('repeatCount'),1,10000,10)}`);
  if(f.get('repeatEnd')==='until') {
    const day=String(f.get('repeatUntil'));
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day<String(f.get('date')||''))throw Error('반복 종료일을 확인해 주세요.');
    out.push(`UNTIL=${day.replaceAll('-','')}T235959Z`);
  }
  return 'RRULE:'+out.join(';');
}
export function timingValue(f,entry={}) {
  const get=k=>String(f.get(k)||''),allDay=f.has('allDay'),date=get('date'),endDate=get('endDate')||null;
  if(endDate&&endDate<date)throw Error('기간 종료일은 시작 날짜 이후로 선택해 주세요.');
  if(!allDay&&(!/^\d{2}:\d{2}$/.test(get('startTime'))||!/^\d{2}:\d{2}$/.test(get('endTime'))))throw Error('시작 시간과 종료 시간을 입력해 주세요.');
  if(!allDay&&(!endDate||endDate===date)&&get('endTime')<=get('startTime'))throw Error('종료 시간은 시작 시간 이후로 선택해 주세요.');
  return {allDay,endDate,startTime:allDay?null:get('startTime'),endTime:allDay?null:get('endTime'),timeZone:get('timeZone')||'Asia/Seoul',recurrence:'none',recurrenceRule:buildRule(f),recurrenceUntil:null,origin:entry.origin||'hplan',notifications:{enabled:entry.origin!=='google'&&f.has('notify'),beforeMinutes:integer(get('beforeMinutes'),0,40320,5),repeatMinutes:integer(get('repeatMinutes'),1,1440,5),count:integer(get('notifyCount'),1,5,1)}};
}
export function timingForm(e={}) {
 const legacy={daily:'RRULE:FREQ=DAILY',weekdays:'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',weekly:'RRULE:FREQ=WEEKLY',monthly:'RRULE:FREQ=MONTHLY'};
 const rawRule=e.recurrenceRule||(legacy[e.recurrence]?legacy[e.recurrence]+(e.recurrenceUntil?';UNTIL='+e.recurrenceUntil.replaceAll('-',''):''):null),r=ruleFields(rawRule),mode=rawRule?'keep':'none',n=e.notifications||{};
 return `<details class="full timing-details" ${e.endDate||e.allDay===false||rawRule||n.enabled?'open':''}><summary>기간·시간·반복·알림 설정</summary><fieldset class="full timing"><legend>날짜·시간과 반복</legend><p class="help">기간 종료일까지 같은 일정이 표시됩니다. 업무 마감일은 별도로 관리합니다.</p><div class="form-grid">${checkbox('종일','allDay',e.allDay!==false)}${field('기간 종료일 · 선택','endDate',e.endDate||'','date')}${field('시작 시간','startTime',e.startTime||'09:00','time')}${field('종료 시간','endTime',e.endTime||'10:00','time')}${field('시간대','timeZone',e.timeZone||'Asia/Seoul','text','required list="time-zones"')}<datalist id="time-zones"><option>Asia/Seoul</option><option>Asia/Tokyo</option><option>America/New_York</option><option>Europe/London</option><option>UTC</option></datalist>${select('반복','repeatMode',[['none','반복 안 함'],['DAILY','매일'],['WEEKLY','매주'],['MONTHLY','매월'],['YEARLY','매년'],['custom','맞춤 설정'],...(rawRule?[['keep','기존 반복 유지']]:[])],mode)}<input type="hidden" name="rawRule" value="${esc(rawRule||'')}"><div class="full recurrence-controls form-grid">${select('주기','frequency',[['DAILY','일'],['WEEKLY','주'],['MONTHLY','월'],['YEARLY','년']],r.frequency)}${field('간격','interval',r.interval,'number','min="1" max="999"')}<div class="full"><p class="section-title">반복 요일</p><input type="hidden" name="weekdays" value="${esc(e.recurrence==='weekdays'?'MO,TU,WE,TH,FR':r.weekdays)}"><div class="weekday-choices">${weekdays.map(([id,label])=>checkbox(label+'요일','repeatDay:'+id,(e.recurrence==='weekdays'?'MO,TU,WE,TH,FR':r.weekdays).split(',').includes(id))).join('')}</div></div>${select('매월 기준','monthMode',[['date','시작 날짜와 같은 일'],['weekday','특정 순서의 요일']],r.monthMode)}${select('순서','monthPosition',[['1','첫 번째'],['2','두 번째'],['3','세 번째'],['4','네 번째'],['-1','마지막']],r.monthPosition)}${select('요일','monthWeekday',weekdays,r.monthWeekday)}${select('반복 종료','repeatEnd',[['never','계속'],['until','날짜까지'],['count','횟수']],r.repeatEnd)}${field('종료 날짜','repeatUntil',r.repeatUntil,'date')}${field('총 반복 횟수','repeatCount',r.repeatCount,'number','min="1" max="10000"')}</div></div></fieldset><fieldset class="full timing"><legend>H.PLAN 알림</legend>${e.origin==='google'?'<p class="help">Google에서 만든 일정은 Google 알림을 사용합니다.</p>':`<div class="form-grid">${checkbox('알림 받기','notify',n.enabled)}${field('첫 알림 · 시작 몇 분 전','beforeMinutes',n.beforeMinutes??5,'number','min="0" max="40320"')}${field('반복 간격 · 분','repeatMinutes',n.repeatMinutes??5,'number','min="1" max="1440"')}${field('총 알림 횟수','notifyCount',n.count??1,'number','min="1" max="5"')}<p class="help full notification-preview"></p></div>`}</fieldset></details>`;
}
export function adaptTiming(form) {
 const dayField=form.elements.namedItem('weekdays');if(dayField)dayField.value=weekdays.filter(([id])=>form.elements.namedItem('repeatDay:'+id)?.checked).map(([id])=>id).join(',');
 const allDay=form.elements.namedItem('allDay')?.checked;
 for(const key of ['startTime','endTime']){const el=form.elements.namedItem(key);if(el)el.disabled=allDay;}
 const mode=form.elements.namedItem('repeatMode')?.value;
 const controls=form.querySelector('.recurrence-controls');if(controls)controls.hidden=mode!=='custom';
 const preview=form.querySelector('.notification-preview');
 if(preview){const n=k=>Number(form.elements.namedItem(k)?.value||0);preview.textContent=`시작 ${n('beforeMinutes')}분 전부터 ${n('repeatMinutes')}분 간격으로 총 ${n('notifyCount')}회 표시합니다. 확인하거나 완료하면 남은 알림이 중지됩니다.`;}
}
