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
const repeats = [
  ["none", "반복 안 함"],
  ["daily", "매일"],
  ["weekdays", "평일"],
  ["weekly", "매주"],
  ["monthly", "매월"],
];
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
 ${select("반복", "recurrence", repeats, e.recurrence)}${field("반복 종료일", "recurrenceUntil", e.recurrenceUntil || "", "date")}
 ${select("상위 업무", "parentId", [["", "상위 업무 없음"], ...state.entries.filter((x) => !x.deletedAt && !x.parentId && x.id !== e.id && x.date === e.date && x.kind === e.kind && (x.projectId || null) === (e.projectId || null)).map((x) => [x.id, x.text.slice(0, 45)])], e.parentId || "")}
 ${field("글자 강조 색상", "color", e.color || "#C9232C", "color")}
 <div class="full row">${checkbox("중요 표시", "priority", e.priority)}${checkbox("강조 색상 사용", "useColor", !!e.color)}</div>
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
    color: f.has("useColor") ? get("color") : null,
    notes: get("notes"),
    target: get("target"),
    answer: get("answer"),
  };
}
export function adaptEntryForm(form, state) {
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
export function readableVersion(v, key) {
  if (v.value === null) return "<p>항목 영구 삭제</p>";
  const x = v.value;
  return `<strong>${esc(x.text || x.name || key)}</strong>${x.status ? `<p>상태: ${esc(statusLabels[x.status] || x.status)}</p>` : ""}${x.date ? `<p>${esc(x.date)}</p>` : ""}${[
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
