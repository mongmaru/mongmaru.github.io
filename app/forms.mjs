import {eventColors,entryColor} from './event-colors.mjs';
import {
  esc,
  field,
  area,
  select,
  checkbox,
  button,
  statusLabels,
  kindLabels,
  icon,
} from "./ui.mjs";
import { timingForm, timingValue, adaptTiming } from './calendar-form.mjs';
const repeats = [
  ["none", "반복 안 함"],
  ["daily", "매일"],
  ["weekdays", "평일"],
  ["weekly", "매주"],
  ["monthly", "매월"],
];
export function adaptColorPreview(form,state){
 const control=form.elements.namedItem('eventColorId'),swatch=form.querySelector('.event-color-swatch');
 if(!control||!swatch)return;
 const entry=state.entries.find(e=>e.id===form.dataset.entryId)||{};
 const project=state.projects.find(p=>p.id===form.elements.namedItem('projectId')?.value);
 swatch.style.backgroundColor=entryColor({...entry,eventColorId:control.value,color:form.dataset.colorChanged==='true'?null:entry.color},project);
}
export function entryForm(state, date, entry = {}, preset = {}) {
  const e = {
    kind: "task",
    date,
    status: "planned",
    recurrence: "none",
    ...entry,
    ...preset,
  };
  const projects = [
    ["", "공통 업무"],
    ...state.projects.map((p) => [p.id, p.name]),
  ];
  return `<div class="form-grid">${select("유형", "kind", Object.entries(kindLabels), e.kind)}${field("날짜", "date", e.date, "date", "required")}
 <div class="full">${area("내용", "text", e.text || "")}<p class="help">업무를 짧게 적고, 자세한 내용은 메모에 남기세요.</p></div>
 ${select("프로젝트", "projectId", projects, e.projectId || "")}${select("상태", "status", Object.entries(statusLabels), e.status)}
 ${field("마감일", "dueDate", e.dueDate || "", "date")}${field("재확인 날짜", "reviewDate", e.reviewDate || "", "date")}
 ${timingForm(e)}
 ${select("상위 업무", "parentId", [["", "상위 업무 없음"], ...state.entries.filter((x) => !x.deletedAt && !x.parentId && x.id !== e.id && x.date === e.date && x.kind === e.kind && (x.projectId || null) === (e.projectId || null)).map((x) => [x.id, x.text.slice(0, 45)])], e.parentId || "")}

 <label class="field event-color-field">일정 색상<span class="event-color-control"><span class="event-color-swatch" aria-hidden="true" style="background:${entryColor(e,state.projects.find(p=>p.id===e.projectId))}"></span><select name="eventColorId" aria-label="일정 색상">${eventColors.map(([id,name])=>`<option value="${esc(id)}" ${id===(e.eventColorId??e.google?.resource?.colorId??'')?'selected':''}>${esc(name)}</option>`).join('')}</select></span></label><p class="help">일정 앞의 색상 막대에 적용됩니다. Google Calendar와 같은 색상을 사용합니다.</p>
 <div class="full row">${checkbox("중요 표시", "priority", e.priority)}</div>
 ${area("메모", "notes", e.notes || "", "full")}${field("확인 대상", "target", e.target || "")}
 <div class="full">${area("답변", "answer", e.answer || "")}</div></div>`;
}
export function entryValue(form, entry = {}) {
  const f = new FormData(form),
    get = (k) => String(f.get(k) || "");
  return {
    ...entry,
    kind: get("kind"),
    date: get("date"),
    text: get("text"),
    projectId: get("projectId") || null,
    status: get("status"),
    dueDate: get("dueDate") || null,
    reviewDate: get("reviewDate") || null,
    recurrence: get("recurrence"),
    recurrenceUntil: get("recurrenceUntil") || null,
    parentId: get("parentId") || null,
    priority: f.has("priority"),
    color: form.dataset.colorChanged==='true'?null:entry.color||null,
    notes: get("notes"),
    target: get("target"),
    answer: get("answer"),
    ...timingValue(f, entry),
  };
}
export function adaptEntryForm(form, state) {
  adaptTiming(form);
  adaptColorPreview(form,state);
  const f = new FormData(form),
    kind = f.get("kind"),
    current = f.get("status");
  const statuses =
    kind === "question"
      ? ["open", "waiting", "answered", "hold"]
      : ["planned", "progress", "waiting", "done", "canceled", "moved"];
  const s = form.elements.namedItem("status");
  s.innerHTML = statuses
    .map(
      (x) =>
        `<option value="${x}" ${x === current ? "selected" : ""}>${statusLabels[x]}</option>`,
    )
    .join("");
  form.elements.namedItem("projectId").disabled = kind === "personal";
  const parent = form.elements.namedItem("parentId"),
    selected = parent.value,
    id = form.dataset.entryId;
  parent.innerHTML =
    `<option value="">상위 업무 없음</option>` +
    state.entries
      .filter(
        (e) =>
          !e.deletedAt &&
          !e.parentId &&
          e.id !== id &&
          e.date === f.get("date") &&
          e.kind === kind &&
          (e.projectId || "") ===
            (kind === "personal" ? "" : f.get("projectId")),
      )
      .map(
        (e) =>
          `<option value="${esc(e.id)}" ${e.id === selected ? "selected" : ""}>${esc(e.text.slice(0, 50))}</option>`,
      )
      .join("");
}
export function projectForm(state, p = {}) {
  return `<div class="stack">${field("프로젝트 이름", "name", p.name || "", "text", 'required maxlength="180"')}
 <div class="form-grid">${field("대표 색상", "color", p.color || "#C9232C", "color")}${select(
   "상태",
   "status",
   [
     ["active", "진행"],
     ["hold", "보류"],
     ["archived", "보관"],
   ],
   p.status || "active",
 )}
 ${select("소속 폴더", "folderId", [["", "폴더 없음"], ...state.folders.map((f) => [f.id, f.name])], p.folderId || "")}${checkbox("즐겨찾기", "favorite", p.favorite)}</div>
 ${area("별칭 · 한 줄에 하나 또는 쉼표로 구분", "aliases", (p.aliases || []).join("\n"))}${area("프로젝트 메모", "note", p.note || "")}</div>`;
}
export function folderForm(state, f = {}) {
  return `<div class="stack">${field("폴더 이름", "name", f.name || "", "text", 'required maxlength="80"')}<div><p class="section-title">포함할 프로젝트</p>${state.projects.map((p) => checkbox(p.name, "project:" + p.id, p.folderId === f.id)).join("") || '<p class="help">프로젝트를 먼저 만들면 폴더에 정리할 수 있습니다.</p>'}</div></div>`;
}
export function readableVersion(v, key, state={projects:[]}) {
  if (v.value === null) return "<p>항목 영구 삭제</p>";
  const x = v.value;
  return `<strong>${esc(x.text || x.name || key)}</strong>${x.status ? `<p>상태: ${esc(statusLabels[x.status] || x.status)}</p>` : ""}${x.date ? `<p>${esc(x.date)}${x.endDate?' ~ '+esc(x.endDate):''}${x.allDay===false?' · '+esc(x.startTime)+'–'+esc(x.endTime):''}</p>` : ""}${x.projectId?`<p>프로젝트: ${esc(state.projects.find(p=>p.id===x.projectId)?.name||'연결된 프로젝트')}</p>`:''}${x.dueDate?`<p>마감: ${esc(x.dueDate)}</p>`:''}${x.eventColorId?`<p>일정 색상: ${esc(x.eventColorId)}</p>`:''}${x.recurrenceRule?`<p>반복: ${esc(x.recurrenceRule)}</p>`:''}${[
    "notes",
    "answer",
    "target",
    "note",
    "items",
    "aliases",
  ]
    .filter((k) => x[k]?.length)
    .map((k) => `<p>${esc(Array.isArray(x[k]) ? x[k].join(", ") : x[k])}</p>`)
    .join(
      "",
    )}<small>기기 ${esc(v.device.slice(0, 8))} · ${esc(new Date(v.at).toLocaleString("ko-KR"))}</small>`;
}
