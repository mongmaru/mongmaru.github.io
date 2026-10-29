// Include disabled controls: switching all-day/alerts off must not erase their
// entered values when the draft is restored and those options are enabled again.
export function draftData(form,key){return {key,recurrenceChanged:form.dataset.recurrenceChanged==='true',colorChanged:form.dataset.colorChanged==='true',at:new Date().toISOString(),values:Object.fromEntries([...form.elements].filter(e=>e.name&&e.type!=='checkbox'&&e.type!=='submit'&&e.type!=='button').map(e=>[e.name,e.value])),checked:Object.fromEntries([...form.elements].filter(e=>e.name&&e.type==='checkbox').map(e=>[e.name,e.checked]))};}
export function draftSignature(form){const {values,checked}=draftData(form,'');return JSON.stringify([values,checked]);}
