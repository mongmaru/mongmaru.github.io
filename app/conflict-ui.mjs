import {esc,button} from './ui.mjs';
import {readableVersion} from './forms.mjs';
const labels={entries:'일정',projects:'프로젝트',folders:'폴더',templates:'업무 양식'};
export function renderDriveConflicts(list,repairs,state) {
 if(list.length)return `<p class="help">기기에서 서로 다르게 수정한 항목입니다. 날짜·시간·프로젝트·메모를 비교해 유지할 내용을 선택해 주세요. 적용 전에 기기 백업을 보관합니다.</p><div class="stack">${list.map(c=>`<section class="panel conflict-group"><h3>${esc(labels[c.key.split('/')[0]]||'기록')}</h3>${c.versions.map(v=>`<div class="summary conflict-version">${readableVersion(v,c.key,state)}<div class="conflict-actions">${button('이 내용 유지',`resolve:${c.key}:${v.id}`)}</div></div>`).join('')}</section>`).join('')}</div>`;
 if(repairs.length)return `<div class="stack"><p>삭제된 프로젝트·상위 업무 연결 ${repairs.length}개를 정리해야 합니다. 일정 내용은 보존합니다.</p>${repairs.map(r=>`<div class="summary">${esc(r.before.text||r.before.name||r.key)}</div>`).join('')}${button('연결 정리 승인','drive-repair','primary')}</div>`;
 return '<p class="empty">확인할 기기 간 수정 충돌이 없습니다.</p>';
}
