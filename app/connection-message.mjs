// Present both old saved errors and new failures in the same user-facing terms.
// Provider diagnostics stay in the underlying error, never interpolated as UI.
export function connectionMessage(error){
 const message=String(error?.message??error??'');
 if(/시간 초과|TimeoutError|timed?\s*out/i.test(message))return 'Google 응답이 늦어 동기화를 마치지 못했습니다. 연결을 유지하며 자동으로 다시 시도합니다. 기록은 기기에 보관됩니다.';
 if(/failed to fetch|networkerror|load failed|\[(?:Google 대체 통신|계정 확인|알림 연결) · 네트워크\]/i.test(message))return 'Google에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. 연결을 유지하며 자동으로 다시 시도하고, 기록은 기기에 보관됩니다.';
 return message||'Google 연결을 확인해 주세요.';
}
