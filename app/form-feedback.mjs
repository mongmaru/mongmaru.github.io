import {timingValue} from './calendar-form.mjs';
export function clearFormErrors(form) {
 for(const el of form.querySelectorAll('[aria-invalid]')){el.removeAttribute('aria-invalid');el.removeAttribute('aria-describedby');}
 for(const el of form.querySelectorAll('[data-field-error],.form-errors'))el.remove();
}
export function validateForm(form) {
 const errors=[];
 for(const el of form.elements){if(el.disabled||!el.willValidate||el.validity.valid)continue;errors.push({field:el.name,message:el.validity.valueMissing?'필수 항목을 입력해 주세요.':el.validity.rangeUnderflow||el.validity.rangeOverflow?`${el.min}~${el.max} 범위로 입력해 주세요.`:'입력 형식을 확인해 주세요.'});}
 if(form.elements.namedItem('text')&&form.elements.namedItem('startTime')){
  if(!form.elements.namedItem('text').value.trim())errors.push({field:'text',message:'일정 내용을 입력해 주세요.'});
  try{new Intl.DateTimeFormat('ko-KR',{timeZone:form.elements.namedItem('timeZone').value}).format();}catch{errors.push({field:'timeZone',message:'시간대를 확인해 주세요. 예: Asia/Seoul'});}
  try{timingValue(new FormData(form));}catch(e){const field=/기간 종료일/.test(e.message)?'endDate':/종료 시간/.test(e.message)?'endTime':/시작 시간/.test(e.message)?'startTime':/반복 종료일/.test(e.message)?'repeatUntil':/시간대|time zone/i.test(e.message)?'timeZone':'repeatMode';errors.push({field,message:e.message});}
 }
 return errors.filter((e,i,a)=>a.findIndex(x=>x.field===e.field)===i);
}
export function showFormErrors(form,errors) {
 clearFormErrors(form);const body=form.querySelector('#modal-body');
 const summary=document.createElement('div');summary.className='form-errors';summary.setAttribute('role','alert');summary.textContent=errors.length?'표시된 항목을 확인해 주세요. 입력한 내용은 유지됩니다.':'';body.prepend(summary);
 for(const [i,error]of errors.entries()){
  const el=form.elements.namedItem(error.field);if(!el){summary.textContent=error.message;continue;}
  el.closest('details')?.setAttribute('open','');const note=document.createElement('small');note.id='field-error-'+i;note.dataset.fieldError=error.field;note.textContent=error.message;
  (el.closest('.field')||el.parentElement).append(note);el.setAttribute('aria-invalid','true');el.setAttribute('aria-describedby',note.id);
 }
 const first=form.querySelector('[aria-invalid="true"]');first?.scrollIntoView({block:'center'});first?.focus({preventScroll:true});
}
