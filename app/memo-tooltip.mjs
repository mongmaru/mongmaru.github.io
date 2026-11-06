// Shared with the desktop supplemental renderer. Plain text only; no data writes.
(()=>{
 const doc=globalThis.document;if(!doc)return;
 const fine=matchMedia('(hover: hover) and (pointer: fine)');
 let tooltip,content,owner,previousDescription;
 function hide(){
  if(owner){if(previousDescription===null)owner.removeAttribute('aria-describedby');else owner.setAttribute('aria-describedby',previousDescription);}
  owner=null;if(tooltip){tooltip.hidden=true;content.textContent='';}
 }
 function show(target){
  const notes=target?.dataset.memo;
  if(!fine.matches||!notes?.trim()){hide();return;}
  if(owner===target)return;hide();
  if(!tooltip){
   tooltip=doc.createElement('aside');tooltip.id='hplan-memo-tooltip';tooltip.className='memo-tooltip';tooltip.setAttribute('role','tooltip');tooltip.hidden=true;
   const heading=doc.createElement('strong');heading.className='memo-tooltip-heading';heading.textContent='메모';
   content=doc.createElement('div');content.className='memo-tooltip-content';
   const hint=doc.createElement('small');hint.className='memo-tooltip-hint';hint.textContent='전체 메모는 항목을 눌러 확인해 주세요.';
   tooltip.append(heading,content,hint);doc.body.append(tooltip);
  }
  owner=target;previousDescription=owner.getAttribute('aria-describedby');owner.setAttribute('aria-describedby',[previousDescription,tooltip.id].filter(Boolean).join(' '));
  content.textContent=notes.length>6000?notes.slice(0,6000)+'…':notes;tooltip.hidden=false;
  const anchor=owner.getBoundingClientRect(),box=tooltip.getBoundingClientRect(),gap=12,edge=8;
  let x=anchor.right+gap;if(x+box.width>innerWidth-edge)x=anchor.left-box.width-gap;
  x=Math.max(edge,Math.min(x,innerWidth-box.width-edge));
  let y=anchor.top;if(y+box.height>innerHeight-edge)y=innerHeight-box.height-edge;
  tooltip.style.left=x+'px';tooltip.style.top=Math.max(edge,y)+'px';
 }
 doc.addEventListener('pointerover',event=>{if(event.pointerType!=='mouse')return;const target=event.target.closest?.('[data-memo]');if(target&&!target.contains(event.relatedTarget))show(target);});
 doc.addEventListener('pointerout',event=>{if(owner&&owner.contains(event.target)&&!owner.contains(event.relatedTarget))hide();});
 doc.addEventListener('focusin',event=>{const target=event.target.closest?.('[data-memo]');if(target?.matches(':focus-visible'))show(target);});
 doc.addEventListener('focusout',()=>hide());
 doc.addEventListener('pointerdown',hide,true);doc.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
 doc.addEventListener('scroll',hide,true);globalThis.addEventListener('resize',hide);globalThis.addEventListener('blur',hide);fine.addEventListener('change',hide);
 // Refreshes, route changes and edits cannot leave old content floating on screen.
 new MutationObserver(records=>{if(owner&&(!owner.isConnected||records.some(record=>record.target===owner&&record.attributeName==='data-memo')))hide();}).observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-memo']});
})();
