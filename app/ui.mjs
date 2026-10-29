export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function parseDraftKey(key) {
  const index = key.indexOf(":");
  return { type: key.slice(0, index), id: key.slice(index + 1) };
}
const paths = {
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  folder: "M3 6h7l2 3h9v11H3Zm0 0V4h7l2 2",
  grid: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  settings:
    "m9 3-1 3-3 1-2 4 2 3 1 3 4 3 3-1 3 1 4-3 1-3 2-3-2-4-3-1-1-3Zm3 6a3 3 0 1 1 0 6 3 3 0 0 1 0-6",
  search: "m16 16 5 5M10 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14",
  undo: "M9 4 3 10l6 6M3 10h10a7 7 0 0 1 7 7v3",
  redo: "m15 4 6 6-6 6m6-6H11a7 7 0 0 0-7 7v3",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  circle: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18",
  more: "M5 11v2m7-2v2m7-2v2",
  download: "M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4",
  upload: "M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4",
  trash: "M3 6h18M9 6V3h6v3m-10 0 1 15h12l1-15M10 10v7m4-7v7",
  cloud:
    "M7 18a5 5 0 1 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1-1 11Zm5-10v8m-3-3 3 3 3-3",
  star: "m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z",
  note: "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5",
  copy: "M8 8h13v13H8ZM4 16H3V3h13v1",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  clock: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18m0 4v6l4 2",
  filter: "M3 5h18l-7 8v6l-4 2v-8Z",
  edit: "m15 4 5 5M4 16 16 4a2 2 0 0 1 4 4L8 20l-5 1Z",
  up: "m5 15 7-7 7 7",
  down: "m5 9 7 7 7-7",
  print: "M7 8V3h10v5M7 17H3V8h18v9h-4M7 13h10v8H7Z",
  help: "M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3v1M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20",
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.note}"/></svg>`;
export const button = (label, action, cls = "", symbol = "") =>
  `<button type="button" class="${esc(cls)}" data-action="${esc(action)}">${symbol ? icon(symbol) : ""}${esc(label)}</button>`;
export const field = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field">${esc(label)}<input name="${name}" aria-label="${esc(label)}" type="${type}" value="${esc(value)}" ${extra}></label>`;
export const area = (label, name, value = "", extra = "") =>
  `<label class="field ${extra}">${esc(label)}<textarea name="${name}" aria-label="${esc(label)}">${esc(value)}</textarea></label>`;
export const select = (label, name, items, value = "", extra = "") =>
  `<label class="field ${extra}">${esc(label)}<select name="${name}" aria-label="${esc(label)}">${items.map(([id, text]) => `<option value="${esc(id)}" ${String(id) === String(value) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
export const checkbox = (label, name, checked = false) =>
  `<label class="check"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}>${esc(label)}</label>`;
export const statusLabels = {
  planned: "예정",
  progress: "진행 중",
  waiting: "대기",
  done: "완료",
  canceled: "취소",
  moved: "이월",
  open: "확인 전",
  answered: "해결",
  hold: "보류",
};
export const kindLabels = {
  task: "업무",
  personal: "개인",
  question: "확인·질문",
};
export const done = (e) =>
  ["done", "answered", "canceled", "moved"].includes(e.status);
export function download(name, blob) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let toastTimer;
export function toast(text) {
  const node = document.querySelector("#toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), 4200);
}
export function empty(message, action = "entry-new", label = "일정 추가") {
  return `<div class="empty">${icon("note")}<p>${esc(message)}</p>${action ? button(label, action, "primary", "plus") : ""}</div>`;
}
