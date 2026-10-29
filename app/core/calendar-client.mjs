// Shared PC/browser core; regenerate with node scripts/prepare-core.mjs
const CALENDAR_API='https://www.googleapis.com/calendar/v3';
const TASKS_API='https://tasks.googleapis.com/tasks/v1';
const GOOGLE_CALENDAR_SCOPES=['https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/tasks'];
const enc=value=>encodeURIComponent(String(value));
class CalendarApiError extends Error {
  constructor(status){super(status===401?'Google 연결을 다시 확인해 주세요.':status===403?'Calendar/할 일 접근 권한 또는 API 사용 설정을 확인해 주세요.':status===412?'Google에서 같은 항목이 변경됐습니다.':`Google 일정 요청에 실패했습니다. (${status})`);this.status=status;this.name='CalendarApiError';}
}
class CalendarClient {
  constructor({accessToken,fetch=globalThis.fetch}={}) {
    this.accessToken=accessToken;this.fetch=fetch.bind(globalThis);
  }
  async request(url,{method='GET',body,etag}={},refreshed=false) {
    if(![CALENDAR_API,TASKS_API].some(base=>url.startsWith(base+'/')))throw Error('허용되지 않은 Google API 주소입니다.');
    const token=typeof this.accessToken==='function'?await this.accessToken(refreshed):this.accessToken;
    if(typeof token!=='string'||!token)throw Error('Google Calendar에 먼저 연결해 주세요.');
    const headers={Authorization:'Bearer '+token,Accept:'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';if(etag)headers['If-Match']=etag;
    const response=await this.fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
    if(response.status===401&&!refreshed&&typeof this.accessToken==='function')return this.request(url,{method,body,etag},true);
    if(!response.ok)throw new CalendarApiError(response.status);
    if(response.status===204)return null;
    const text=await response.text();if(text.length>20*1024*1024)throw Error('Google 일정 응답이 너무 큽니다.');
    return text?JSON.parse(text):null;
  }
  async pages(url,params={}) {
    const items=[];let pageToken=null,nextSyncToken;
    const seen=new Set();
    for(let page=0;page<1000;page++) {
      const query=new URLSearchParams();for(const [key,value]of Object.entries({...params,pageToken}))if(value!==undefined&&value!==null)query.set(key,String(value));
      const res=await this.request(url+'?'+query);
      if(!res||!Array.isArray(res.items||[]))throw Error('Google 목록 응답이 올바르지 않습니다.');
      items.push(...(res.items||[]));if(items.length>200000)throw Error('Google 일정 수가 너무 많습니다.');
      if(!res.nextPageToken)return {items,nextSyncToken:res.nextSyncToken||nextSyncToken};
      if(seen.has(res.nextPageToken))throw Error('Google 목록 페이지가 반복됩니다.');seen.add(res.nextPageToken);pageToken=res.nextPageToken;
    }
    throw Error('Google 목록 페이지 한도를 초과했습니다.');
  }
  listCalendars(){return this.pages(CALENDAR_API+'/users/me/calendarList',{maxResults:250,showDeleted:false});}
  listEvents(calendarId,{syncToken,timeMin}={}) {return this.pages(CALENDAR_API+'/calendars/'+enc(calendarId)+'/events',{maxResults:2500,singleEvents:false,showDeleted:true,syncToken:syncToken||undefined,timeMin:syncToken?undefined:timeMin});}
  getEvent(calendarId,id){return this.request(CALENDAR_API+'/calendars/'+enc(calendarId)+'/events/'+enc(id));}
  listInstances(calendarId,id,{timeMin,timeMax}={}){return this.pages(CALENDAR_API+'/calendars/'+enc(calendarId)+'/events/'+enc(id)+'/instances',{maxResults:2500,showDeleted:true,timeMin,timeMax});}
  insertEvent(calendarId,event){return this.request(CALENDAR_API+'/calendars/'+enc(calendarId)+'/events?supportsAttachments=true&conferenceDataVersion=1',{method:'POST',body:event});}
  patchEvent(calendarId,id,patch,etag){if(!etag)throw Error('Google 일정 버전이 없어 안전하게 수정할 수 없습니다.');return this.request(CALENDAR_API+'/calendars/'+enc(calendarId)+'/events/'+enc(id)+'?supportsAttachments=true&conferenceDataVersion=1',{method:'PATCH',body:patch,etag});}
  deleteEvent(calendarId,id,etag){if(!etag)throw Error('Google 일정 버전이 없어 안전하게 삭제할 수 없습니다.');return this.request(CALENDAR_API+'/calendars/'+enc(calendarId)+'/events/'+enc(id),{method:'DELETE',etag});}
  listTaskLists(){return this.pages(TASKS_API+'/users/@me/lists',{maxResults:1000});}
  listTasks(taskListId){return this.pages(TASKS_API+'/lists/'+enc(taskListId)+'/tasks',{maxResults:100,showCompleted:true,showHidden:true,showDeleted:true});}
  getTask(taskListId,id){return this.request(TASKS_API+'/lists/'+enc(taskListId)+'/tasks/'+enc(id));}
  patchTask(taskListId,id,patch,etag){return this.request(TASKS_API+'/lists/'+enc(taskListId)+'/tasks/'+enc(id),{method:'PATCH',body:patch,etag});}
  deleteTask(taskListId,id,etag){return this.request(TASKS_API+'/lists/'+enc(taskListId)+'/tasks/'+enc(id),{method:'DELETE',etag});}
}
export {CalendarClient,CalendarApiError,GOOGLE_CALENDAR_SCOPES};
