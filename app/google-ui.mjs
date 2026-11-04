import {esc,button} from './ui.mjs';
import {notificationPolicy} from './notification-policy.mjs';
import {connectionMessage} from './connection-message.mjs';
function syncFailureDetails(status) {
 const operationLabels={
  'calendar-list':'캘린더 목록 확인', 'calendar-events':'일정 가져오기',
  'task-lists':'할 일 목록 확인', 'task-list':'할 일 가져오기',
  'link-occurrence':'반복 일정 확인', reconcile:'변경 사항 반영',
  insert:'새 일정 전송', delete:'삭제 반영',
 };
 const operation=operationLabels[status.diagnostic?.operation];
 const httpStatus=Number(status.diagnostic?.status);
 const attempt=status.lastAttempt&&new Date(status.lastAttempt);
 const details=[];
 if(operation)details.push(operation);
 if(Number.isInteger(httpStatus)&&httpStatus>=400&&httpStatus<=599)details.push(`HTTP ${httpStatus}`);
 if(attempt&&Number.isFinite(attempt.getTime()))details.push(`마지막 시도 ${attempt.toLocaleString('ko-KR')}`);
 return details.length?`<p class="help">${esc(details.join(' · '))}</p>`:'';
}
export function googlePanel(calendar,notifications,native,auth,{connecting=false,connectionError=false}={}){
 const policy=notificationPolicy(native),s=calendar?.status||{},cards=[['calendar','Google Calendar','일정의 날짜·시간·반복을 양방향으로 연결합니다.'],['tasks','Google 할 일','날짜가 있는 할 일의 제목·메모·완료를 연결합니다.']];
 return `<section class="panel stack google-services"><p class="section-title">Google Calendar · 할 일</p>${cards.map(([feature,label,description])=>{const st=s.services?.[feature]||{code:'disconnected',label:'계정 연결 필요'},last=st.lastSuccess?new Date(st.lastSuccess).toLocaleString('ko-KR'):'아직 성공한 동기화가 없습니다.';return `<div class="google-feature"><div class="setting-row"><div><strong>${label}</strong><p class="help">${description}</p></div><span class="connection-state ${esc(st.code)}" role="status">${connecting?'계정 연결 중':connectionError&&['connected','pending','error'].includes(st.code)?'연결 유지 · 재시도 대기':esc(st.label)}</span></div><p class="help">${st.lastSuccess?'마지막 동기화 성공: ':''}${esc(last)}</p>${st.error?(/응답이 늦|시간 초과|Timeout|failed to fetch|network|Google에 연결하지 못|대체 통신|자동 연결을 잠시/i.test(String(st.error))?`<details class="help sync-retry-detail"><summary>자동 재시도 안내</summary><p>${esc(connectionMessage(st.error))}</p>${syncFailureDetails(st)}</details>`:`<p class="notice-box">최근 동기화 안내: ${esc(connectionMessage(st.error))}</p>${syncFailureDetails(st)}`):''}<div class="row">${button(st.code==='permission'||st.code==='disconnected'?label+' 연결':'연동 설정',feature+'-manage')}${button('지금 동기화',feature+'-sync')}</div></div>`;}).join('')}<div class="row">${button(`Calendar 수정 충돌 ${s.conflicts?.length||0}개`,'calendar-conflicts')}${button('Google 연결 도움말','google-help')}</div></section>${notificationPanel(notifications,native,policy,auth)}`;
}
function notificationPanel(notifications,native,policy,auth){
 const status=native?.notificationStatus,cloud=status?.mode==='cloud',requested=policy.native&&notifications?.wantsAndroidCloud?.();
 const canPair=auth?.connected&&(policy.native?cloud&&requested:notifications?.enabled);
 return `<section class="panel stack"><p class="section-title">알림과 Android 위젯</p>
 <p class="help">${policy.native?(policy.ready?'Android 앱이 연결되었습니다. 위젯도 이 앱의 테마를 따릅니다.':'Android 앱 연결을 기다립니다. 앱의 위젯 ⋮ 설정에서 H.PLAN 열기를 눌러 다시 연결해 주세요.'):'Android APK를 설치하면 홈 화면에서 H.PLAN 위젯을 추가할 수 있습니다.'}</p>
 ${policy.native?`<p class="help">${esc(native?.status||'Android 연결 확인 필요')}</p>`:''}
 <p role="status">이 기기 알림: ${policy.native?cloud?'PC 연동 알림 사용 중':requested?'PC 연동 알림 연결 확인 중':policy.label:notifications?.enabled?'웹 알림 사용 중':'사용 안 함'}</p>
 <div class="row">${policy.native?button('Android 알림·위젯 설정','native-settings'):button('웹 알림 켜기','notifications-enable')+button('웹 알림 끄기','notifications-disable')}</div>
 ${policy.native?`<p class="help">${cloud?'서버에 등록된 일정은 Chrome의 보안 연결로 H.PLAN에 표시합니다. 기기 예약은 일시 중지됩니다.':requested?'연동 알림 상태를 확인하고 있습니다. 앱과 Chrome의 알림 허용 상태를 확인해 주세요.':'기기 예약을 쓰려면 Android 설정에서 ‘이 기기에서 알림 사용’을 켜세요.'}</p><div class="row">${button(cloud||requested?'Android 기기 예약으로 돌아가기':'PC 연동 알림 켜기',cloud||requested?'notifications-cloud-disable':'notifications-cloud-enable')}</div>`:''}
 ${policy.native&&status&&!cloud?`<p class="help" role="status">${status.mode==='exact'?'Android 정확한 알림 예약 사용 중':status.mode==='inexact'?'정확한 알림 권한이 없어 지연될 수 있습니다. Android 알림·위젯 설정에서 정확한 알림을 허용해 주세요.':status.mode==='blocked'?'Android 알림 권한을 확인해 주세요.':'Android 앱 알림 꺼짐'} · 예약 ${Number(status.scheduled)||0}개${status.nextAt?' · 다음 예약 '+esc(new Date(status.nextAt).toLocaleString('ko-KR')):''}</p>`:''}
 <div class="google-feature"><strong>PC에서 휴대전화로 알림 보내기</strong>
 <p class="help">Google 계정을 연결하고 이 휴대전화의 ${policy.native?'PC 연동 알림':'웹 알림'}을 켜세요. 이곳에서 만든 10분짜리 코드를 같은 계정으로 연결한 PC의 알림 설정에 입력하세요.</p>
 ${canPair?`<div class="row">${button('PC 연결 코드 만들기','notifications-pair')}${button('PC 연결 상태 확인','notifications-pair-status')}${button('PC 알림 연결 끊기','notifications-unpair')}</div>${notifications?.pcPaired?`<p class="help" role="status">PC 알림 연결됨</p>`:''}`:''}
 </div>
 <p class="help">${policy.native?'':'iPhone은 홈 화면에 설치한 뒤 알림을 허용해 주세요. '}Google 원본은 Google 알림을 사용합니다. 절전·네트워크 상태에 따라 알림이 늦어질 수 있습니다.</p></section>`;
}
