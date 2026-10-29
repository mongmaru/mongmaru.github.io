// Capture the first transferred Chrome port before IndexedDB/app hydration.
(()=>{window.addEventListener('message',event=>{
 if(window.hplanNativeBridgeActive||location.origin!=='https://mongmaru.github.io'||!['https://mongmaru.github.io','android-app://mongmaru.github.io/com.hplan.app','android-app://mongmaru.github.io'].includes(event.origin)||!event.ports?.[0])return;
 if(event.data===''){window.hplanPendingNativeEvent?.ports?.[0]?.close();window.hplanPendingNativeEvent=event;return;}
 let value=event.data;try{if(typeof value==='string')value=JSON.parse(value);}catch{return;}
 if(value?.type!=='hplan.native.ready'||value.version!==1||typeof value.nonce!=='string'||value.nonce.length<16||value.nonce.length>200)return;
 window.hplanPendingNativeEvent=event;
});window.hplanNativeBootstrapReady=true;})();
