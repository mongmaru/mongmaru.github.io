import {statusLabels} from './ui.mjs';import {eventColors} from './event-colors.mjs';
const labels={title:'내용',description:'메모·답변',schedule:'날짜·시간',recurrence:'반복',status:'상태',completed:'완료 여부',dueDate:'마감일',eventColor:'일정 색상'};
export const conflictLabel=k=>labels[k]||'연결 정보';
export function conflictValue(key,value){
 if(value==null||value==='')return '지정하지 않음';
 if(key==='status')return statusLabels[value]||'상태 확인 필요';
 if(key==='completed')return value?'완료':'미완료';
 if(key==='eventColor')return eventColors.find(c=>c[0]===String(value))?.[1]||'기본 색상';
 if(key==='schedule'){return [value.date,value.endDate&&value.endDate!==value.date?'~ '+value.endDate:'',value.allDay===false?[value.startTime,value.endTime].filter(Boolean).join(' ~ '):'종일',value.timeZone==='Asia/Seoul'?'한국 시간':value.timeZone].filter(Boolean).join(' · ')||'날짜 지정 없음';}
 if(key==='recurrence'){
 const rule=value.rule||value.lines?.find(l=>l.startsWith('RRULE:'));if(!rule)return value.lines?.length?'추가 날짜가 있는 반복':'반복 안 함';
 const parts=Object.fromEntries(rule.replace(/^RRULE:/,'').split(';').map(x=>x.split('='))),unit={DAILY:'일',WEEKLY:'주',MONTHLY:'개월',YEARLY:'년'}[parts.FREQ];
 if(!unit)return '맞춤 반복';let text=`${parts.INTERVAL||1}${unit}마다`;
 if(parts.BYDAY){const days={MO:'월',TU:'화',WE:'수',TH:'목',FR:'금',SA:'토',SU:'일'};text+=' · '+parts.BYDAY.split(',').map(x=>{const day=days[x.slice(-2)];const n=x.slice(0,-2);return (n==='-1'?'마지막 ':n?n+'번째 ':'')+(day||'지정 요일');}).join('·');}
 if(parts.BYMONTHDAY)text+=' · '+parts.BYMONTHDAY+'일';if(parts.COUNT)text+=' · '+parts.COUNT+'회';if(parts.UNTIL)text+=' · '+parts.UNTIL.slice(0,8).replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3')+'까지';if(value.exceptions?.length)text+=' · 제외 '+value.exceptions.length+'일';return text;
 }
 if(['title','description','dueDate'].includes(key)&&typeof value==='string')return value;
 return '연결 정보가 달라 확인이 필요합니다.';
}
