import {esc,button} from './ui.mjs';
import {notificationPolicy} from './notification-policy.mjs';
export function googlePanel(calendar,notifications,native,auth,{connecting=false,connectionError=false}={}){
 const policy=notificationPolicy(native),s=calendar?.status||{},cards=[['calendar','Google Calendar','일정의 날짜·시간·반복을 양방향으로 연결합니다.'],['tasks','Google 할 일','날짜가 있는 할 일의 제목·메모·완료를 연결합니다.']];
 return `<section class="panel stack google-services"><p class="section-title">Google Calendar · 할 일</p>${cards.map(([feature,label,description])=>{const st=s.services?.[feature]||{code:'disconnected',label:'계정 연결 필요'},last=st.lastSuccess?new Date(st.lastSuccess).toLocaleString('ko-KR'):'아직 성공한 동기화가 없습니다.';return `<div class="google-feature"><div class="setting-row"><div><strong>${label}</strong><p class="help">${description}</p></div><span class="connection-state ${esc(st.code)}" role="status">${connecting?'계정 연결 중':connectionError&&['connected','pending','error'].includes(st.code)?'연결 유지 · 재시도 대기':esc(st.label)}</span></div><p class="help">${esc(last)}</p>${st.error?`<p class="notice-box">${esc(st.error)}</p>`:''}<div class="row">${button(st.code==='permission'||st.code==='disconnected'?label+' 연결':'연동 설정',feature+'-manage')}${button('지금 동기화',feature+'-sync')}</div></div>`;}).join('')}<div class="row">${button(`Calendar 수정 충돌 ${s.conflicts?.length||0}개`,'calendar-conflicts')}${button('Google 연결 도움말','google-help')}</div></section>${notificationPanel(notifications,native,policy)}`;
}
function notificationPanel(notifications,native,policy){
 const status=native?.notificationStatus;
 return `<section class="panel stack"><p class="section-title">알림과 Android 위젯</p>
 <p class="help">${policy.native?(policy.ready?'Android 앱이 연결되었습니다. 위젯도 이 앱의 테마를 따릅니다.':'Android 앱 연결을 기다립니다. 앱의 위젯 ⋮ 설정에서 H.PLAN 열기를 눌러 다시 연결해 주세요.'):'Android APK를 설치하면 홈 화면에서 H.PLAN 위젯을 추가할 수 있습니다.'}</p>
 ${policy.native?`<p class="help">${esc(native?.status||'Android 연결 확인 필요')}</p>`:''}
 <p role="status">이 기기 알림: ${policy.native?policy.label:notifications?.enabled?'웹 알림 사용 중':'사용 안 함'}</p>
 <div class="row">${policy.native?button('Android 알림·위젯 설정','native-settings'):button('웹 알림 켜기','notifications-enable')+button('웹 알림 끄기','notifications-disable')}</div>
 ${policy.native?`<p class="help">이 앱의 일정 알림은 Android 앱으로 보냅니다. 설정에서 ‘이 기기에서 알림 사용’과 Android 알림 허용을 확인해 주세요. 10초 테스트 알림의 수신과 일정 알림 사용 설정은 별개입니다.</p><p class="help">${notifications?.webPushCleanup==='complete'?'이 계정 연결의 이전 Chrome 예약을 정리했습니다. 이미 전송된 알림은 남아 있을 수 있습니다.':'이 계정 연결의 이전 Chrome 예약 정리를 기다립니다. 인터넷과 Google 계정 연결을 확인한 뒤 앱을 다시 열어 주세요.'}</p>`:''}
 ${policy.native&&status?`<p class="help" role="status">${status.mode==='exact'?'Android 정확한 알림 예약 사용 중':status.mode==='inexact'?'정확한 알림 권한이 없어 지연될 수 있습니다. Android 알림·위젯 설정에서 정확한 알림을 허용해 주세요.':status.mode==='blocked'?'Android 알림 권한을 확인해 주세요.':'Android 앱 알림 꺼짐'} · 예약 ${Number(status.scheduled)||0}개${status.nextAt?' · 다음 예약 '+esc(new Date(status.nextAt).toLocaleString('ko-KR')):''}</p>`:''}
 <p class="help">${policy.native?'':'iPhone은 홈 화면에 설치한 뒤 알림을 허용해 주세요. '}Google 원본은 Google 알림을 사용합니다. 절전·네트워크 상태에 따라 알림이 늦어질 수 있습니다.</p></section>`;
}