export const GOOGLE_SCOPES={
 drive:['openid','email','https://www.googleapis.com/auth/drive.file'],
 calendar:['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
 tasks:['https://www.googleapis.com/auth/tasks'],
};
export const scopesFor=({calendar=false,tasks=false}={})=>[...GOOGLE_SCOPES.drive,...(calendar?GOOGLE_SCOPES.calendar:[]),...(tasks?GOOGLE_SCOPES.tasks:[])];
export function permissionState(auth){
 const connected=typeof auth?.connected==='boolean'?auth.connected:!!auth?.account&&!!auth?.tokenValue;
 const raw=auth?.scopes??auth?.credential?.scopes,scopes=new Set(Array.isArray(raw)?raw:[]);
 return {drive:connected&&(raw===undefined||scopes.has(GOOGLE_SCOPES.drive[2])),calendar:connected&&GOOGLE_SCOPES.calendar.every(s=>scopes.has(s)),tasks:connected&&GOOGLE_SCOPES.tasks.every(s=>scopes.has(s))};
}
export function featureState({connected,enabled,granted,busy,error,lastSuccess,offline=false}={}){
 if(!connected)return {code:'disconnected',label:'계정 연결 필요'};
 if(!granted)return {code:'permission',label:'추가 권한 필요'};
 if(!enabled)return {code:'disabled',label:'사용 안 함'};
 if(offline)return {code:'offline',label:'오프라인 · 대기'};
 if(busy)return {code:'syncing',label:'동기화 중'};
 if(error)return {code:'error',label:'연결 확인 필요'};
 return lastSuccess?{code:'connected',label:'연동 중'}:{code:'pending',label:'첫 동기화 대기'};
}
