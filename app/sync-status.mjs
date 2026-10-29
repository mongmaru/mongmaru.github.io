export function syncLabel({connected=false,connecting=false,reauth=false,offline=false,authError=false,drive,services={}}={}) {
 if(connecting)return '계정 연결 중';
 if(reauth)return '계정 재연결 필요';
 if(offline)return '오프라인 · 기기에 저장';
 if(!connected)return '기기에 저장됨';
 if(authError)return '연결 유지 · 재시도 대기';
 const list=Object.values(services);
 if(drive?.busy||list.some(s=>s.code==='syncing'))return '동기화 중';
 if(drive?.conflictCount||list.some(s=>s.conflicts>0))return '수정 내용 확인 필요';
 if(drive?.error||list.some(s=>s.code==='error'))return '일부 동기화 확인 필요';
 if(drive?.pending)return '동기화 대기';
 if(list.some(s=>s.code==='permission'&&s.enabled))return '추가 권한 필요';
 if(drive?.lastSync||list.some(s=>s.code==='connected'))return '동기화 완료';
 return 'Google 연결됨';
}
