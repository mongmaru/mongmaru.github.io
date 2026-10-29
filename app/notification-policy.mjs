// APK ownership is independent of permission and the user's native toggle.
// Losing either must never turn an APK reminder into a Chrome notification.
const NATIVE_SESSION='hplan-native-session-v1';
export function rememberedNativeIntent(){
 if(new URLSearchParams(globalThis.location?.search||'').get('native')==='1'){rememberNativeIntent();return true;}
 try{return sessionStorage.getItem(NATIVE_SESSION)==='true';}catch{return false;}
}
export function rememberNativeIntent(){try{sessionStorage.setItem(NATIVE_SESSION,'true');}catch{}}
export function usesNativeNotifications(native){return Boolean(native?.expected||native?.port||native?.nativeNotificationsEnabled);}
export function notificationPolicy(native){
 const owned=usesNativeNotifications(native),ready=Boolean(native?.port&&native?.nonce),enabled=Boolean(native?.nativeNotificationsEnabled);
 return {native:owned,ready,enabled,label:!ready?'Android 앱 연결 확인 필요':enabled?'Android 앱 알림 사용 중':native?.notificationPermission==='denied'||native?.notificationStatus?.mode==='blocked'?'Android 알림 허용 필요':'Android 앱 알림 꺼짐'};
}
