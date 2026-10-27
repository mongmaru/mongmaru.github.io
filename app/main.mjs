import { Repository, IndexedStore } from "./core/repository.mjs";
import { today, clone, dateOK, expandRecurrences } from "./core/domain.mjs";
import * as model from "./core/sync-model.mjs";
import { DriveClient } from "./core/drive-client.mjs";
import { SyncController } from "./core/sync.mjs";
import { WebAuth } from "./core/auth.mjs";
import { GOOGLE_WEB_CLIENT_ID, APP_VERSION } from "./config.mjs";
import {
  esc,
  icon,
  button,
  field,
  area,
  select,
  checkbox,
  statusLabels,
  kindLabels,
  done,
  download,
  toast,
  empty,
  parseDraftKey,
} from "./ui.mjs";
import {
  entryForm,
  entryValue,
  adaptEntryForm,
  projectForm,
  folderForm,
  readableVersion,
} from "./forms.mjs";
const $ = (s) => document.querySelector(s),
  main = $("#main"),
  modal = $("#modal"),
  form = $("#modal-form"),
  body = $("#modal-body"),
  footer = $("#modal-footer");
let repo,
  auth = new WebAuth(GOOGLE_WEB_CLIENT_ID),
  sync = null,
  channel,
  busy = false,
  route = "planner",
  date = today(),
  calendarMode = innerWidth < 700 ? "week" : "month",
  kind = "all",
  projectFilter = "",
  projectOpen = null,
  query = "",
  selected = new Set(),
  draftKey = null,
  draftInitial = "",
  lastFocus = null,
  saveHandler = null,
  syncTimer,
  installPrompt = null,
  waitingWorker = null,
  pendingReload = false;
let overviewFilter = "today",
  statusFilter = "",
  dateFrom = "",
  dateTo = "",
  connecting = false,
  pendingAuth = null,
  connectionGeneration = 0;
const nav = [
  ["planner", "플래너", "calendar"],
  ["projects", "프로젝트", "folder"],
  ["overview", "모아보기", "grid"],
  ["settings", "설정", "settings"],
];
const state = () => repo.state;
const activeEntries = () => state().entries.filter((e) => !e.deletedAt);
const getEntry = (id) => state().entries.find((e) => e.id === id);
const getProject = (id) => state().projects.find((p) => p.id === id);
const projectOptions = () => [
  ["", "공통 업무"],
  ...state().projects.map((p) => [p.id, p.name]),
];
function monthEnd(day) {
  const d = new Date(day + "T12:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))
    .toISOString()
    .slice(0, 10);
}
function shiftDay(day, n) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function niceDate(day, full = false) {
  return new Date(day + "T12:00:00").toLocaleDateString("ko-KR", {
    ...(full ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}
function modalOpen(
  title,
  html,
  onSave = null,
  { label = "저장", danger = "", draft = null } = {},
) {
  if (modal.open) modal.close();
  lastFocus = document.activeElement;
  $("#modal-title").textContent = title;
  body.innerHTML = html;
  form.onchange = null;
  footer.innerHTML =
    (danger ? danger : "") +
    (onSave
      ? `<button type="button" data-action="modal-close">취소</button><button type="submit" class="primary">${esc(label)}</button>`
      : '<button type="button" class="primary" data-action="modal-close">닫기</button>');
  saveHandler = onSave;
  draftKey = draft;
  form.dataset.entryId = "";
  modal.showModal();
  if (sync) sync.editing = true;
  body.scrollTop = 0;
  draftInitial = new URLSearchParams(new FormData(form)).toString();
  setTimeout(() => {
    const target = body.querySelector(
      "input:not([type=checkbox]):not([type=color]),textarea,select",
    );
    if (target && innerWidth >= 700) target.focus();
    else $("#modal-close").focus();
  }, 0);
}
function rememberDraft() {
  if (!draftKey) return;
  try {
    const data = {
      at: new Date().toISOString(),
      values: Object.fromEntries(new FormData(form)),
      checked: Object.fromEntries(
        [...form.querySelectorAll("input[type=checkbox]")].map((x) => [
          x.name,
          x.checked,
        ]),
      ),
    };
    localStorage.setItem(
      "hplan-draft",
      JSON.stringify({ key: draftKey, ...data }),
    );
  } catch {}
}
function closeModal(force = false) {
  if (!modal.open) return;
  if (
    !force &&
    draftKey &&
    new URLSearchParams(new FormData(form)).toString() !== draftInitial &&
    !confirm("작성 중인 내용을 임시 보관하고 닫을까요?")
  )
    return;
  rememberDraft();
  modal.close();
  if (sync) sync.editing = false;
  draftKey = null;
  saveHandler = null;
  render();
  lastFocus?.isConnected && lastFocus.focus();
}
function clearDraft() {
  try {
    localStorage.removeItem("hplan-draft");
  } catch {}
  draftKey = null;
}
async function action(a, message, baseline = null) {
  $("#save-state").textContent = "저장 중…";
  try {
    await repo.dispatch(a, baseline);
    channel?.postMessage({ revision: repo.record.revision });
    $("#save-state").textContent = "기기에 저장됨";
    if (message) toast(message);
    scheduleSync();
    return true;
  } catch (e) {
    $("#save-state").textContent = "저장 실패";
    toast(e.message);
    throw e;
  }
}
function scheduleSync() {
  clearTimeout(syncTimer);
  if (sync && !sync.stopped)
    syncTimer = setTimeout(() => runSync().catch(() => {}), 8000);
}
function applySettings() {
  const s = state().settings,
    system = matchMedia("(prefers-color-scheme:dark)").matches;
  document.body.classList.toggle(
    "dark",
    s.theme === "dark" || (s.theme === "system" && system),
  );
  document.body.classList.toggle("reduce-motion", s.reduceMotion);
  document.body.classList.toggle("dense", s.density === "compact");
  document.documentElement.style.setProperty("--text", `${s.fontSize + 2}px`);
}
function render() {
  if (!repo) return;
  applySettings();
  $("#undo").disabled = !repo.record.past.length;
  $("#redo").disabled = !repo.record.future.length;
  for (const [id, label, symbol] of nav) {
    const b = document.querySelector(`[data-route="${id}"]`);
    b.innerHTML = icon(symbol) + `<span>${label}</span>`;
    if (route === id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (route === "planner") planner();
  else if (route === "projects") projects();
  else if (route === "overview") overview();
  else settings();
  renderNotice();
}
function entryCard(e, { showDate = false } = {}) {
  const p = getProject(e.projectId),
    complete = ["done", "answered"].includes(e.status),
    sub = e.parentId;
  return `<article class="entry ${done(e) ? "done" : ""} ${sub ? "child" : ""} ${e.status === "moved" ? "moved" : ""}" data-entry="${esc(e.id)}"><button class="entry-check ${complete ? "checked" : ""}" aria-label="${complete ? "완료 취소" : "완료로 표시"}" data-action="toggle:${esc(e.id)}">${icon(complete ? "check" : "circle")}</button>
 <div class="entry-content" role="button" tabindex="0" data-action="edit:${esc(e.id)}" aria-label="${esc(e.text)} 수정"><div class="entry-title" ${/^#[a-f\d]{6}$/i.test(e.color || "") ? `style="color:${esc(e.color)}"` : ""}>${e.priority ? '<span class="priority">★ </span>' : ""}${esc(e.text)}</div><div class="entry-meta">${showDate ? `<span>${esc(e.date)}</span>` : ""}<span class="tag">${esc(p?.name || kindLabels[e.kind])}</span><span>${esc(statusLabels[e.status])}</span>${e.dueDate ? `<span ${e.dueDate < today() && !done(e) ? 'class="priority"' : ""}>마감 ${esc(e.dueDate.slice(5))}</span>` : ""}${e.recurrence !== "none" || e.seriesId ? "<span>반복</span>" : ""}${e.movedTo ? `<span>→ ${esc(e.movedTo.slice(5))}</span>` : ""}${e.notes ? "<span>메모</span>" : ""}${selected.has(e.id) ? '<span class="priority">선택됨</span>' : ""}</div></div><button class="icon-button entry-menu" aria-label="${esc(e.text.slice(0, 35))} 더보기" data-action="menu:${esc(e.id)}">${icon("more")}</button></article>`;
}
function ordered(entries) {
  const result = [];
  for (const e of entries
    .filter((x) => !x.parentId || !entries.some((p) => p.id === x.parentId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)) {
    result.push(e);
    result.push(
      ...entries
        .filter((x) => x.parentId === e.id)
        .sort((a, b) => a.order - b.order),
    );
  }
  return result;
}
function agenda(entries, options = {}) {
  return entries.length
    ? ordered(entries)
        .map((e) => entryCard(e, options))
        .join("")
    : state().settings.hideEmpty
      ? '<p class="help" style="padding:12px">이 날짜의 기록이 없습니다.</p>'
      : empty("아직 기록이 없습니다. 작은 할 일부터 남겨보세요.");
}
function selectedBar() {
  return selected.size
    ? `<div class="selected-bar"><span>${selected.size}개 선택</span>${button("상태", "batch-status")}${button("이월", "batch-carry")}${button("삭제", "batch-delete")}${button("해제", "selection-clear")}</div>`
    : "";
}
function planner() {
  const d = new Date(date + "T12:00:00Z"),
    year = d.getUTCFullYear(),
    month = d.getUTCMonth();
  let calendar = "";
  if (calendarMode === "year") {
    calendar = `<div class="month-grid">${Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, "0")}`;
      return `<button class="month-button" data-action="month:${m}">${i + 1}월<small>${activeEntries().filter((e) => e.date.startsWith(m)).length}개 기록</small></button>`;
    }).join("")}</div>`;
  } else {
    const first =
        calendarMode === "week"
          ? shiftDay(date, -d.getUTCDay())
          : `${year}-${String(month + 1).padStart(2, "0")}-01`,
      start =
        calendarMode === "week"
          ? first
          : shiftDay(first, -new Date(first + "T12:00:00Z").getUTCDay()),
      count = calendarMode === "week" ? 7 : 42;
    const counts = new Map();
    for (const e of activeEntries())
      counts.set(e.date, (counts.get(e.date) || 0) + 1);
    calendar = `<div class="calendar" ${state().settings.hideWeekends ? 'style="grid-template-columns:repeat(5,minmax(0,1fr))"' : ""}>${[
      "일",
      "월",
      "화",
      "수",
      "목",
      "금",
      "토",
    ]
      .filter((_, i) => !state().settings.hideWeekends || (i !== 0 && i !== 6))
      .map((x) => `<div class="weekday">${x}</div>`)
      .join("")}${Array.from({ length: count }, (_, i) => {
      const day = shiftDay(start, i),
        num = Number(day.slice(8)),
        n = counts.get(day) || 0;
      if (
        state().settings.hideWeekends &&
        [0, 6].includes(new Date(day + "T12:00:00Z").getUTCDay())
      )
        return "";
      return `<button class="calendar-day ${day.slice(0, 7) !== date.slice(0, 7) ? "off" : ""} ${day === date ? "selected" : ""} ${day === today() ? "today" : ""}" data-action="date:${day}" aria-label="${day} 일정 ${n}개" ${day === date ? 'aria-pressed="true"' : ""}><span>${num}</span><span class="day-dots">${Array.from({ length: Math.min(n, 3) }, () => '<i class="dot"></i>').join("")}</span></button>`;
    }).join("")}</div>`;
  }
  const entries = activeEntries().filter(
    (e) =>
      e.date === date &&
      (kind === "all" || e.kind === kind) &&
      (!projectFilter || e.projectId === projectFilter) &&
      (!statusFilter || e.status === statusFilter),
  );
  main.innerHTML = `<div class="heading-row"><div><p class="eyebrow">MY DAY, MY PLAN</p><h1>${year}년 ${month + 1}월</h1><p>기록은 가볍게, 하루는 차분하게.</p></div>${button("추가", "entry-new", "primary", "plus")}</div><div class="planner-layout"><section class="panel calendar-panel" aria-label="달력"><div class="calendar-head"><div class="row"><button class="icon-button ghost" aria-label="이전 기간" data-action="period:-1">${icon("left")}</button><strong>${calendarMode === "year" ? year + "년" : month + 1 + "월"}</strong><button class="icon-button ghost" aria-label="다음 기간" data-action="period:1">${icon("right")}</button></div>${button("오늘", "today", "ghost")}</div><div class="toolbar"><div class="segmented" aria-label="달력 보기">${[
    ["month", "월"],
    ["week", "주"],
    ["year", "년"],
  ]
    .map(
      ([id, label]) =>
        `<button aria-pressed="${calendarMode === id}" data-action="calendar:${id}">${label}</button>`,
    )
    .join(
      "",
    )}</div><input type="date" aria-label="날짜 바로 선택" id="jump-date" value="${date}" style="flex:1;width:120px;padding:7px;font-size:14px"></div>${calendar}</section><section class="day-panel"><div class="day-header"><div class="view-title"><h2>${niceDate(date)}</h2><span class="count">${entries.length}</span></div><button class="icon-button ghost" aria-label="일정 필터" data-action="planner-filter">${icon("filter")}</button></div><div class="chips">${[["all", "전체"], ...Object.entries(kindLabels)].map(([id, label]) => `<button class="${kind === id ? "active" : ""}" data-action="kind:${id}">${label}</button>`).join("")}${button("날짜·복사·양식", "day-tools")}</div>${selectedBar()}<div class="agenda">${agenda(entries)}</div></section></div>`;
}
function projects() {
  if (projectOpen) {
    const p = getProject(projectOpen);
    if (!p) {
      projectOpen = null;
      return projects();
    }
    const entries = activeEntries().filter((e) => e.projectId === p.id);
    main.innerHTML = `<div class="heading-row"><div><button class="ghost" data-action="project-back">${icon("left")} 프로젝트</button><h1>${esc(p.name)}</h1><p>${esc(p.aliases.join(" · "))}</p></div><button class="icon-button" aria-label="프로젝트 수정" data-action="project-edit:${esc(p.id)}">${icon("edit")}</button></div>${p.note ? `<div class="panel summary">${esc(p.note)}</div>` : ""}<div class="toolbar" style="margin-top:14px">${button("업무 추가", "project-entry", "primary", "plus")}${button("양식 적용", "templates")}${button("보고서", "report")}</div><div class="agenda">${agenda(entries, { showDate: true })}</div>`;
    return;
  }
  const card = (p) =>
    `<button class="project-card" data-action="project-open:${esc(p.id)}"><i class="project-color" style="background:${esc(p.color)}"></i><span class="info"><strong>${p.favorite ? "★ " : ""}${esc(p.name)}</strong><p>${p.status === "archived" ? "보관 · " : p.status === "hold" ? "보류 · " : ""}${activeEntries().filter((e) => e.projectId === p.id && !done(e)).length}개 남음${p.aliases.length ? " · " + esc(p.aliases[0]) : ""}</p></span>${icon("right")}</button>`;
  main.innerHTML = `<div class="project-list"><div class="heading-row"><div><p class="eyebrow">WORKSPACE</p><h1>프로젝트</h1><p>작업을 나누고, 흐름을 정리하세요.</p></div><button class="icon-button primary" aria-label="프로젝트 추가" data-action="project-new">${icon("plus")}</button></div><div class="toolbar">${button("폴더 추가", "folder-new", "ghost", "folder")}${button("프로젝트 합치기", "project-merge", "ghost")}${button("업무 양식", "templates", "ghost")}</div>${state()
    .projects.filter((p) => !p.folderId)
    .map(card)
    .join("")}${state()
    .folders.map(
      (f) =>
        `<section><div class="folder-head"><button class="folder-name" data-action="folder-toggle:${esc(f.id)}">${icon(f.collapsed ? "right" : "down")}${icon("folder")} ${esc(f.name)}</button><button class="icon-button ghost" aria-label="${esc(f.name)} 폴더 수정" data-action="folder-edit:${esc(f.id)}">${icon("more")}</button></div>${
          f.collapsed
            ? ""
            : state()
                .projects.filter((p) => p.folderId === f.id)
                .map(card)
                .join("") ||
              '<p class="help" style="padding:10px">아직 프로젝트가 없습니다.</p>'
        }</section>`,
    )
    .join(
      "",
    )}${!state().projects.length ? empty("첫 프로젝트를 만들어 업무를 모아보세요.", "project-new", "프로젝트 만들기") : ""}</div>`;
}
function overview() {
  const es = activeEntries(),
    open = es.filter((e) => !done(e)),
    filters = {
      today: es.filter((e) => e.date === today()),
      questions: open.filter((e) => e.kind === "question"),
      deadlines: open.filter((e) => e.dueDate),
      unfinished: open.filter((e) => e.date <= today()),
      favorites: es.filter((e) => getProject(e.projectId)?.favorite),
      recent: [...es]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 50),
      search: es,
    };
  const names = {
    today: "오늘",
    questions: "확인·질문",
    deadlines: "마감 일정",
    unfinished: "미완료",
    favorites: "즐겨찾기",
    recent: "최근 기록",
    search: "전체 검색",
  };
  let list = filters[overviewFilter] || es;
  if (query) {
    const q = query.toLocaleLowerCase();
    list = list.filter((e) =>
      [
        e.text,
        e.notes,
        e.answer,
        e.target,
        getProject(e.projectId)?.name,
        ...(getProject(e.projectId)?.aliases || []),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
    );
  }
  list = list.filter(
    (e) =>
      (!dateFrom || e.date >= dateFrom) &&
      (!dateTo || e.date <= dateTo) &&
      (!statusFilter || e.status === statusFilter) &&
      (!projectFilter || e.projectId === projectFilter) &&
      (kind === "all" || e.kind === kind),
  );
  if (overviewFilter === "deadlines")
    list.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
  main.innerHTML = `<div class="heading-row"><div><p class="eyebrow">AT A GLANCE</p><h1>모아보기</h1><p>흩어진 기록을 한눈에.</p></div><button class="icon-button" aria-label="보고서 내보내기" data-action="report">${icon("download")}</button></div><div class="stats"><div class="stat"><strong>${es.filter((e) => e.date === today()).length}</strong><span>오늘의 기록</span></div><div class="stat"><strong>${open.length}</strong><span>남은 일</span></div><div class="stat"><strong>${es.filter((e) => ["done", "answered"].includes(e.status)).length}</strong><span>완료한 기록</span></div></div><input id="search-query" class="search-input" type="search" aria-label="기록 검색" placeholder="내용, 프로젝트, 메모, 답변 검색" value="${esc(query)}"><div class="chips">${[
    ...state().settings.widgets,
    "search",
  ]
    .filter((x, i, a) => a.indexOf(x) === i)
    .map(
      (id) =>
        `<button class="${overviewFilter === id ? "active" : ""}" data-action="overview:${id}">${names[id]}</button>`,
    )
    .join(
      "",
    )}<button data-action="planner-filter">${icon("filter")} 필터</button></div>${selectedBar()}<p class="section-title">${esc(names[overviewFilter] || "기록")} · ${list.length}개</p><div class="agenda">${agenda(list, { showDate: true })}</div>`;
}
function driveCard() {
  const connected = !!auth.tokenValue && Date.now() < auth.expires,
    status = sync?.status(),
    account = repo.record.activeAccount;
  return `<section class="panel stack drive-compact"><div class="drive-summary">${icon("cloud")}<div><h2>Google Drive</h2><p class="account">${connected ? esc(auth.account.email) : account ? "연결 갱신 필요" : "기기에만 저장 중"}</p></div><span class="status-dot ${connected ? "" : "off"}"></span></div>${status?.error ? `<p class="notice-box">${esc(status.error)}</p>` : ""}<p class="help">${status?.lastSync ? "마지막 동기화 " + esc(new Date(status.lastSync).toLocaleString("ko-KR")) : "기록은 먼저 이 기기에 저장합니다."}</p><div class="drive-actions">${connected ? button(status?.busy ? "동기화 중…" : "지금 동기화", "drive-sync", "primary") : button("Google 계정으로 연결", "drive-connect", "primary")}${button("연동 관리", "drive-manage")}</div></section>`;
}
function settings() {
  const s = state().settings,
    status = sync?.status(),
    account = repo.record.activeAccount,
    connected = !!auth.tokenValue && Date.now() < auth.expires;
  main.innerHTML = `<div class="heading-row"><div><p class="eyebrow">MAKE IT YOURS</p><h1>설정</h1><p>H.PLAN 모바일 ${APP_VERSION}</p></div></div><div class="settings-layout"><div class="stack">${driveCard()}<section><p class="section-title">데이터와 복구</p><div class="action-list">${button("백업 파일 내려받기", "backup", "", "download")}${button("백업 파일 가져오기", "restore", "", "upload")}${button("기기 내 자동 백업", "backups", "", "clock")}${button("보고서 · Excel · 인쇄", "report", "", "print")}${button("휴지통", "trash", "", "trash")}${button("저장공간 보호 요청", "persist", "", "check")}</div><p class="help" style="padding:10px">브라우저 데이터를 삭제하면 기기 기록도 지워질 수 있습니다. Drive 동기화나 별도 백업을 함께 사용하세요.</p></section></div><div class="stack"><section><p class="section-title">화면과 사용성</p><div class="settings-group"><div class="setting-row"><div><strong>테마</strong><p>밝게 · 어둡게 · 기기 설정</p></div><select id="setting-theme" aria-label="테마">${[
    ["light", "밝게"],
    ["dark", "어둡게"],
    ["system", "기기 설정"],
  ]
    .map(
      ([k, l]) =>
        `<option value="${k}" ${s.theme === k ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></div><div class="setting-row"><div><strong>글자 크기</strong><p>입력란은 읽기 편한 크기를 유지합니다.</p></div><select id="setting-fontSize" aria-label="글자 크기">${[13, 14, 15, 16, 17, 18].map((v) => `<option value="${v}" ${s.fontSize === v ? "selected" : ""}>${v + 2}px</option>`).join("")}</select></div><div class="setting-row"><div><strong>카드 간격</strong></div><select id="setting-density" aria-label="카드 간격"><option value="comfortable" ${s.density !== "compact" ? "selected" : ""}>편안하게</option><option value="compact" ${s.density === "compact" ? "selected" : ""}>촘촘하게</option></select></div><div class="setting-row"><div><strong>시작 화면</strong></div><select id="setting-startPage" aria-label="시작 화면">${[
    ["month", "플래너"],
    ["projects", "프로젝트"],
    ["overview", "모아보기"],
  ]
    .map(
      ([k, l]) =>
        `<option value="${k}" ${s.startPage === k ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></div><div class="setting-row"><div><strong>모션 줄이기</strong></div><input id="setting-reduceMotion" type="checkbox" aria-label="모션 줄이기" ${s.reduceMotion ? "checked" : ""}></div><div class="setting-row"><div><strong>달력에서 주말 숨기기</strong></div><input id="setting-hideWeekends" type="checkbox" aria-label="주말 숨기기" ${s.hideWeekends ? "checked" : ""}></div><div class="setting-row"><div><strong>빈 날짜 안내 간소화</strong></div><input id="setting-hideEmpty" type="checkbox" aria-label="빈 날짜 안내 간소화" ${s.hideEmpty ? "checked" : ""}></div><div class="setting-row"><div><strong>기기 백업 보관 수</strong></div><input id="setting-backupRetention" type="number" min="3" max="180" value="${s.backupRetention}" aria-label="백업 보관 수"></div></div></section><div class="action-list">${button("모아보기 항목 설정", "widgets", "", "grid")}${button("홈 화면에 설치하기", "install", "", "plus")}${button("임시 작성 내용 복구", "draft-restore", "", "note")}${button("사용 안내와 개인정보", "help", "", "help")}</div><p class="help">Windows 자동 시작·창 크기·저장 폴더 선택은 모바일 웹 환경의 설치·기기 저장 기능으로 대체됩니다. 휴대폰 홈 화면 위젯은 제공하지 않습니다.</p></div></div>`;
}
function renderNotice() {
  const n = $("#notice");
  if (!navigator.onLine) {
    n.hidden = false;
    n.textContent = "오프라인 · 기록은 이 기기에 저장합니다.";
  } else if (waitingWorker || pendingReload) {
    n.hidden = false;
    n.innerHTML = "새 버전이 준비되었습니다. " + button("업데이트", "update");
  } else {
    n.hidden = true;
    n.textContent = "";
  }
}
async function editEntry(id = null, preset = {}) {
  const e = id ? getEntry(id) : {},
    savedDate = date;
  modalOpen(
    id ? "일정 수정" : "새 일정",
    entryForm(state(), date, e, preset),
    async () => {
      const value = entryValue(form, e);
      await action({ type: "entry.save", value }, "기기에 저장했습니다.", e);
      date = value.date;
      clearDraft();
      closeModal(true);
      render();
    },
    {
      danger: id ? button("삭제", `delete:${id}`, "danger") : null,
      draft: id ? `entry:${id}` : "entry:new",
    },
  );
  form.dataset.entryId = id || "";
  adaptEntryForm(form, state());
  draftInitial = new URLSearchParams(new FormData(form)).toString();
  form.onchange = () => adaptEntryForm(form, state());
}
function editProject(id = null) {
  const p = id ? getProject(id) : {};
  modalOpen(
    id ? "프로젝트 수정" : "프로젝트 추가",
    projectForm(state(), p),
    async () => {
      const f = new FormData(form);
      await action(
        {
          type: "project.save",
          value: {
            ...p,
            name: f.get("name"),
            color: f.get("color"),
            status: f.get("status"),
            folderId: f.get("folderId") || null,
            note: f.get("note"),
            favorite: f.has("favorite"),
            aliases: String(f.get("aliases"))
              .split(/[,\n]/)
              .map((x) => x.trim())
              .filter(Boolean),
          },
        },
        "프로젝트를 저장했습니다.",
        p,
      );
      clearDraft();
      closeModal(true);
      render();
    },
    { draft: "project:" + (id || "new") },
  );
  form.onchange = null;
}
function editFolder(id = null) {
  const folder = id ? state().folders.find((x) => x.id === id) : {};
  const originalProjects = state()
    .projects.filter((p) => p.folderId === id)
    .map((p) => p.id)
    .sort();
  modalOpen(
    id ? "폴더 수정" : "폴더 추가",
    folderForm(state(), folder),
    async () => {
      const f = new FormData(form);
      const projectIds = [...f.keys()]
        .filter((k) => k.startsWith("project:"))
        .map((k) => k.slice(8))
        .sort();
      await action(
        {
          type: "folder.save",
          value: {
            ...folder,
            name: f.get("name"),
            ...(model.stable(projectIds) !== model.stable(originalProjects)
              ? { projectIds }
              : {}),
          },
        },
        "폴더를 저장했습니다.",
      );
      clearDraft();
      closeModal(true);
    },
    {
      draft: "folder:" + (id || "new"),
      danger: id ? button("폴더 해제", `folder-delete:${id}`, "danger") : "",
    },
  );
  form.onchange = null;
}
function entryMenu(id) {
  const e = getEntry(id);
  modalOpen(
    "일정 메뉴",
    `<p class="summary">${esc(e.text)}</p><div class="action-list" style="margin-top:14px">${button("수정", `edit:${id}`, "", "edit")}${button("상태 변경", `status:${id}`, "", "check")}${button("다른 날짜로 이월", `carry:${id}`, "", "arrow")}${button("다른 날짜에 복사", `copy:${id}`, "", "copy")}${!e.parentId ? button("하위 업무 추가", `child:${id}`, "", "plus") : ""}${button(selected.has(id) ? "선택 해제" : "여러 항목 선택", `select:${id}`, "", "circle")}${button("위로 정렬", `reorder-up:${id}`, "", "up")}${button("아래로 정렬", `reorder-down:${id}`, "", "down")}${button("삭제", `delete:${id}`, "danger", "trash")}</div>`,
  );
}
function chooseStatus(ids) {
  const es = ids.map(getEntry),
    allowed = es.every((e) => e.kind === "question")
      ? ["open", "waiting", "answered", "hold"]
      : es.every((e) => e.kind !== "question")
        ? ["planned", "progress", "waiting", "done", "canceled", "moved"]
        : ["waiting"];
  modalOpen(
    "상태 변경",
    select(
      "변경할 상태",
      "status",
      allowed.map((x) => [x, statusLabels[x]]),
    ),
    async () => {
      await action(
        { type: "entry.status", ids, status: new FormData(form).get("status") },
        "상태를 변경했습니다.",
      );
      closeModal(true);
    },
  );
}
function moveEntries(ids, copy = false) {
  modalOpen(
    copy ? "일정 복사" : "다른 날짜로 이월",
    `<div class="stack">${field("대상 날짜", "date", shiftDay(date, 1), "date", "required")}<p class="help">하위 업무도 함께 처리됩니다. 질문의 이월은 재확인 날짜로 기록합니다.</p></div>`,
    async () => {
      await action(
        {
          type: copy ? "entry.copy" : "entry.carry",
          ids,
          date: new FormData(form).get("date"),
        },
        copy ? "일정을 복사했습니다." : "일정을 이월했습니다.",
      );
      selected.clear();
      closeModal(true);
    },
  );
}
function templates() {
  modalOpen(
    "업무 양식",
    `<div class="stack">${
      state()
        .templates.map(
          (t) =>
            `<div class="panel"><strong>${esc(t.name)}</strong><p class="help">${t.items.length}개 업무 · ${esc(getProject(t.projectId)?.name || "공통 업무")}</p><div class="row">${button("적용", `template-apply:${t.id}`)}${button("삭제", `template-delete:${t.id}`, "danger")}</div></div>`,
        )
        .join("") ||
      '<p class="help">반복해서 사용하는 업무 목록을 양식으로 저장하세요.</p>'
    }${button("새 양식 만들기", "template-new", "primary", "plus")}</div>`,
  );
}
function filterForm() {
  modalOpen(
    "기록 필터",
    `<div class="form-grid">${select("유형", "kind", [["all", "전체"], ...Object.entries(kindLabels)], kind)}${select("상태", "status", [["", "전체"], ...Object.entries(statusLabels)], statusFilter)}${select("프로젝트", "project", [["", "전체 프로젝트"], ...state().projects.map((p) => [p.id, p.name])], projectFilter, "full")}${field("시작일", "from", dateFrom, "date")}${field("종료일", "to", dateTo, "date")}<p class="help full">날짜 범위는 모아보기에서 적용됩니다.</p></div>`,
    async () => {
      const f = new FormData(form);
      if (f.get("from") && f.get("to") && f.get("from") > f.get("to"))
        throw Error("종료일을 시작일 이후로 선택해 주세요.");
      kind = f.get("kind");
      statusFilter = f.get("status");
      projectFilter = f.get("project");
      dateFrom = f.get("from");
      dateTo = f.get("to");
      closeModal(true);
      render();
    },
    { label: "적용", danger: button("초기화", "filter-reset", "ghost") },
  );
}
async function runSync(backup = false) {
  if (!sync || sync.stopped) {
    toast("Google 계정을 먼저 연결해 주세요.");
    return;
  }
  if (!navigator.onLine) {
    toast("인터넷 연결 후 동기화할 수 있습니다.");
    return;
  }
  try {
    const result = await sync.sync(backup);
    if (sync.status().conflictCount)
      toast("서로 다른 수정 내용이 있습니다. 설정에서 확인해 주세요.");
    else if (!sync.editing)
      $("#save-state").textContent = sync.status().pending
        ? "동기화 대기"
        : "동기화됨";
    return result;
  } catch (e) {
    toast(e.message);
    throw e;
  }
}
async function connectDrive() {
  if (connecting) return;
  if (!GOOGLE_WEB_CLIENT_ID) {
    toast(
      "Google 웹앱 등록을 준비하고 있습니다. 기기 저장은 정상 사용할 수 있습니다.",
    );
    return;
  }
  connecting = true;
  const attempt = ++connectionGeneration,
    nextAuth = new WebAuth(GOOGLE_WEB_CLIENT_ID);
  pendingAuth = nextAuth;
  try {
    await nextAuth.prepare();
    if (attempt !== connectionGeneration) return;
    const account = await nextAuth.connect();
    if (attempt !== connectionGeneration) return;
    if (
      repo.record.activeAccount &&
      repo.record.activeAccount !== account.sub &&
      !confirm(
        "다른 Google 계정입니다. 이 기기의 현재 기록을 선택한 계정으로 동기화할까요?",
      )
    ) {
      nextAuth.disconnect();
      return;
    }
    sync?.stop();
    auth = nextAuth;
    await repo.connectAccount(
      account.sub,
      () => attempt === connectionGeneration,
    );
    if (
      attempt !== connectionGeneration ||
      repo.record.activeAccount !== account.sub
    )
      return;
    const controller = new SyncController({
      repo,
      account: account.sub,
      client: new DriveClient({
        token: () => {
          if (
            controller.stopped ||
            auth !== nextAuth ||
            repo.record.activeAccount !== account.sub
          )
            throw Error("Google 연결이 변경되어 이전 요청을 중지했습니다.");
          return nextAuth.token();
        },
      }),
      onStatus: () => {
        if (route === "settings" && !modal.open) settings();
      },
    });
    sync = controller;
    sync.editing = modal.open;
    await runSync();
    render();
  } finally {
    if (pendingAuth === nextAuth) pendingAuth = null;
    if (attempt === connectionGeneration) connecting = false;
  }
}
function conflicts() {
  const meta = repo.syncMeta();
  if (!meta) {
    toast("Google 계정을 연결해 주세요.");
    return;
  }
  const list = model.conflicts(meta.graph),
    repairs = model.repairs(meta.graph, state());
  modalOpen(
    "동기화 내용 확인",
    list.length
      ? `<p class="help">각 항목에서 유지할 내용을 선택하세요. 원본 내용은 덮어쓰기 전에 기기 백업으로 보관합니다.</p><div class="stack">${list.map((c) => `<section class="panel"><h3>${esc(c.key.split("/")[0])}</h3>${c.versions.map((v) => `<div class="summary" style="margin-top:10px">${readableVersion(v, c.key)}<button type="button" data-action="resolve:${esc(c.key)}:${esc(v.id)}" style="margin-top:10px">이 내용 유지</button></div>`).join("")}</section>`).join("")}</div>`
      : repairs.length
        ? `<div class="stack"><p>삭제된 프로젝트·상위 업무 연결 ${repairs.length}개를 정리해야 합니다. 일정 내용은 보존합니다.</p>${repairs.map((r) => `<div class="summary">${esc(r.before.text || r.before.name || r.key)}</div>`).join("")}${button("연결 정리 승인", "drive-repair", "primary")}</div>`
        : '<p class="empty">확인할 충돌이 없습니다.</p>',
  );
}
async function handle(a) {
  const pos = a.indexOf(":"),
    op = pos < 0 ? a : a.slice(0, pos),
    arg = pos < 0 ? "" : a.slice(pos + 1);
  switch (op) {
    case "entry-new":
      return editEntry();
    case "edit":
      return editEntry(arg);
    case "child": {
      const p = getEntry(arg);
      return editEntry(null, {
        date: p.date,
        kind: p.kind,
        projectId: p.projectId,
        parentId: p.id,
      });
    }
    case "modal-close":
      return closeModal();
    case "menu":
      return entryMenu(arg);
    case "toggle": {
      const e = getEntry(arg);
      return action({
        type: "entry.status",
        ids: [arg],
        status: ["done", "answered"].includes(e.status)
          ? e.kind === "question"
            ? "open"
            : "planned"
          : e.kind === "question"
            ? "answered"
            : "done",
      });
    }
    case "delete":
      if (confirm("선택한 기록과 연결된 하위 업무를 휴지통으로 옮길까요?")) {
        await action(
          { type: "entry.delete", ids: [arg] },
          "휴지통으로 옮겼습니다.",
        );
        clearDraft();
        closeModal(true);
      }
      return;
    case "status":
      return chooseStatus([arg]);
    case "carry":
      return moveEntries([arg]);
    case "copy":
      return moveEntries([arg], true);
    case "select":
      selected.has(arg) ? selected.delete(arg) : selected.add(arg);
      closeModal(true);
      return render();
    case "selection-clear":
      selected.clear();
      return render();
    case "batch-status":
      return chooseStatus([...selected]);
    case "batch-carry":
      return moveEntries([...selected]);
    case "batch-delete":
      if (confirm("선택한 기록을 휴지통으로 옮길까요?")) {
        await action({ type: "entry.delete", ids: [...selected] });
        selected.clear();
        render();
      }
      return;
    case "reorder-up":
    case "reorder-down": {
      const e = getEntry(arg),
        same = state()
          .entries.filter(
            (x) =>
              !x.deletedAt &&
              x.date === e.date &&
              (x.parentId || null) === (e.parentId || null),
          )
          .sort((a, b) => a.order - b.order),
        index = same.indexOf(e),
        target = index + (op === "reorder-up" ? -1 : 1);
      if (target >= 0 && target < same.length) {
        [same[index], same[target]] = [same[target], same[index]];
        await action({ type: "entry.reorder", ids: same.map((x) => x.id) });
      }
      closeModal(true);
      return;
    }
    case "date":
      date = arg;
      selected.clear();
      await action({ type: "materialize", through: monthEnd(date) });
      return render();
    case "today":
      date = today();
      return render();
    case "period": {
      const d = new Date(date + "T12:00:00Z");
      if (calendarMode === "week") date = shiftDay(date, Number(arg) * 7);
      else {
        d.setUTCDate(1);
        calendarMode === "year"
          ? d.setUTCFullYear(d.getUTCFullYear() + Number(arg))
          : d.setUTCMonth(d.getUTCMonth() + Number(arg));
        date = d.toISOString().slice(0, 10);
      }
      await action({ type: "materialize", through: monthEnd(date) });
      return render();
    }
    case "month":
      date = arg + "-01";
      calendarMode = "month";
      await action({ type: "materialize", through: monthEnd(date) });
      return render();
    case "calendar":
      calendarMode = arg;
      return render();
    case "kind":
      kind = arg;
      return render();
    case "project-new":
      return editProject();
    case "project-edit":
      return editProject(arg);
    case "project-open":
      projectOpen = arg;
      return render();
    case "project-back":
      projectOpen = null;
      return render();
    case "project-entry":
      return editEntry(null, { projectId: projectOpen });
    case "folder-new":
      return editFolder();
    case "folder-edit":
      return editFolder(arg);
    case "folder-toggle": {
      const f = state().folders.find((x) => x.id === arg);
      return action({
        type: "folder.collapse",
        id: arg,
        collapsed: !f.collapsed,
      });
    }
    case "folder-delete":
      if (confirm("폴더를 해제할까요? 안의 프로젝트와 기록은 유지합니다.")) {
        await action({ type: "folder.delete", id: arg });
        closeModal(true);
      }
      return;
    case "project-merge":
      return modalOpen(
        "프로젝트 합치기",
        `<div class="stack">${select(
          "옮겨올 프로젝트",
          "from",
          state().projects.map((p) => [p.id, p.name]),
        )}${select(
          "유지할 프로젝트",
          "to",
          state().projects.map((p) => [p.id, p.name]),
        )}<p class="help">업무와 양식, 별칭을 유지할 프로젝트로 합칩니다.</p></div>`,
        async () => {
          const f = new FormData(form);
          if (!confirm("두 프로젝트를 합칠까요?")) return;
          await action({
            type: "project.merge",
            from: f.get("from"),
            to: f.get("to"),
          });
          closeModal(true);
        },
      );
    case "day-tools":
      return modalOpen(
        "날짜 도구",
        `<div class="action-list">${button("업무 양식 적용", "templates", "", "note")}${button("이 날짜의 남은 일 모두 이월", "day-carry", "", "arrow")}${button("이 날짜의 기록 모두 복사", "day-copy", "", "copy")}${button("보고서 내보내기", "report", "", "download")}</div>`,
      );
    case "day-carry":
      return moveEntries(
        activeEntries()
          .filter((e) => e.date === date && !done(e) && !e.parentId)
          .map((e) => e.id),
      );
    case "day-copy":
      return moveEntries(
        activeEntries()
          .filter((e) => e.date === date && e.status !== "moved" && !e.parentId)
          .map((e) => e.id),
        true,
      );
    case "templates":
      return templates();
    case "template-new":
      return modalOpen(
        "업무 양식 만들기",
        `<div class="stack">${field("양식 이름", "name", "", "text", "required")}${select("기본 프로젝트", "projectId", projectOptions(), projectOpen || "")}${area("업무 목록 · 한 줄에 하나", "items")}<p class="help">자주 쓰는 업무를 한 번에 추가할 수 있습니다.</p></div>`,
        async () => {
          const f = new FormData(form);
          await action({
            type: "template.save",
            value: {
              name: f.get("name"),
              projectId: f.get("projectId") || null,
              items: String(f.get("items")).split("\n"),
            },
          });
          clearDraft();
          templates();
        },
        { draft: "template:new" },
      );
    case "template-apply":
      return modalOpen(
        "양식 적용",
        `<div class="stack">${field("적용할 날짜", "date", date, "date", "required")}${select("프로젝트", "projectId", projectOptions(), projectOpen || state().templates.find((t) => t.id === arg)?.projectId || "")}</div>`,
        async () => {
          const f = new FormData(form);
          await action({
            type: "template.apply",
            id: arg,
            date: f.get("date"),
            projectId: f.get("projectId") || null,
          });
          closeModal(true);
        },
      );
    case "template-delete":
      if (confirm("이 업무 양식을 삭제할까요? 기존 일정은 유지합니다.")) {
        await action({ type: "template.delete", id: arg });
        templates();
      }
      return;
    case "planner-filter":
      return filterForm();
    case "filter-reset":
      kind = "all";
      statusFilter = "";
      projectFilter = "";
      dateFrom = "";
      dateTo = "";
      closeModal(true);
      return render();
    case "overview":
      overviewFilter = arg;
      return render();
    case "backup":
      download(
        `H.PLAN-${today()}.hplan-backup`,
        new Blob([JSON.stringify(repo.backup(), null, 2)], {
          type: "application/json",
        }),
      );
      repo.localBackup().catch(() => {});
      return toast("백업 파일을 준비했습니다.");
    case "restore": {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".hplan-backup,.json,application/json";
      input.onchange = async () => {
        try {
          const file = input.files[0];
          if (!file) return;
          if (file.size > 100 * 1024 * 1024)
            throw Error("백업 파일이 너무 큽니다.");
          const parsed = JSON.parse(await file.text());
          if (
            !confirm(
              "현재 기기 기록을 백업 내용으로 복원할까요? 복원 전 내용은 기기 백업에 보관합니다.",
            )
          )
            return;
          await repo.restore(parsed);
          scheduleSync();
          toast("기록을 복원했습니다.");
          render();
        } catch (e) {
          toast(e.message);
        }
      };
      input.click();
      return;
    }
    case "backups":
      return modalOpen(
        "기기 내 백업",
        `<div class="stack"><p class="help">이 백업도 브라우저 데이터와 함께 지워질 수 있습니다. 중요한 백업은 파일로 내려받아 주세요.</p>${button("현재 기록 백업 만들기", "local-backup", "primary")}${repo.record.backups.map((b) => `<div class="panel"><strong>${esc(new Date(b.at).toLocaleString("ko-KR"))}</strong><p class="help">${esc(b.label)} · ${b.data.entries.length}개 기록</p><div class="row">${button("복원", `backup-restore:${b.id}`)}${button("내려받기", `backup-download:${b.id}`)}</div></div>`).join("")}</div>`,
      );
    case "local-backup":
      await repo.localBackup();
      return handle("backups");
    case "backup-download": {
      const b = repo.record.backups.find((x) => x.id === arg);
      download(
        `H.PLAN-${b.at.slice(0, 10)}.hplan-backup`,
        new Blob(
          [
            JSON.stringify({
              format: "H.PLAN BACKUP",
              version: 1,
              createdAt: b.at,
              data: b.data,
            }),
          ],
          { type: "application/json" },
        ),
      );
      return;
    }
    case "backup-restore": {
      const b = repo.record.backups.find((x) => x.id === arg);
      if (confirm("이 백업으로 복원할까요? 현재 기록도 백업으로 보관합니다.")) {
        await repo.restore({
          format: "H.PLAN BACKUP",
          version: 1,
          data: b.data,
        });
        closeModal(true);
        scheduleSync();
      }
      return;
    }
    case "trash":
      return modalOpen(
        "휴지통",
        `<div class="stack">${
          state()
            .entries.filter((e) => e.deletedAt)
            .map(
              (e) =>
                `<div class="panel"><strong>${esc(e.text)}</strong><p class="help">${esc(e.date)}</p><div class="row">${button("복원", `restore-entry:${e.id}`)}${button("영구 삭제", `purge:${e.id}`, "danger")}</div></div>`,
            )
            .join("") || '<p class="empty">휴지통이 비어 있습니다.</p>'
        }</div>`,
      );
    case "restore-entry":
      await action({ type: "entry.restore", ids: [arg] });
      return handle("trash");
    case "purge":
      if (
        confirm(
          "이 기록을 영구 삭제할까요? 다른 백업에는 기록이 남아 있을 수 있습니다.",
        )
      ) {
        await action({ type: "entry.purge", ids: [arg] });
        handle("trash");
      }
      return;
    case "persist": {
      const granted = await navigator.storage?.persist?.();
      return toast(
        granted
          ? "기기 저장공간 보호가 허용됐습니다."
          : "브라우저가 보호 여부를 결정합니다. 홈 화면 설치와 별도 백업을 권장합니다.",
      );
    }
    case "widgets":
      return modalOpen(
        "모아보기 항목",
        `<div class="stack">${[
          ["today", "오늘"],
          ["questions", "확인·질문"],
          ["deadlines", "마감 일정"],
          ["unfinished", "미완료"],
          ["favorites", "즐겨찾기"],
          ["recent", "최근 기록"],
        ]
          .map(([id, label]) =>
            checkbox(label, id, state().settings.widgets.includes(id)),
          )
          .join("")}</div>`,
        async () => {
          await action({
            type: "settings.save",
            value: { widgets: [...new FormData(form).keys()] },
          });
          closeModal(true);
        },
      );
    case "drive-manage":
      return modalOpen(
        "Google Drive 관리",
        `<div class="stack"><p>저장 위치: 내 드라이브 / H.PLAN</p><p class="help">자동 백업은 하루 1회, 기기별 최근 30개입니다. 웹앱을 열었을 때 동기화하며 Google 연결이 만료되면 갱신이 필요합니다.</p><div class="action-list">${button("계정 연결 또는 변경", "drive-connect", "", "cloud")}${button("Drive 백업 만들기", "drive-backup", "", "download")}${button("Drive 폴더 열기", "drive-folder", "", "folder")}${button("충돌 내용 확인", "drive-conflicts", "", "note")}${button("연결 해제", "drive-disconnect", "danger")}</div></div>`,
      );
    case "drive-connect":
      closeModal(true);
      return connectDrive();
    case "drive-sync": {
      const result = await runSync();
      if (result?.completed) toast("동기화가 끝났습니다.");
      return;
    }
    case "drive-backup": {
      closeModal(true);
      const result = await runSync(true);
      if (result?.backupCompleted) toast("Drive 백업을 만들었습니다.");
      return;
    }
    case "drive-disconnect":
      if (
        confirm(
          "이 기기의 Google 연결을 해제할까요? 로컬 기록과 Drive 파일은 유지합니다.",
        )
      ) {
        connectionGeneration++;
        pendingAuth?.disconnect();
        pendingAuth = null;
        connecting = false;
        sync?.stop();
        sync = null;
        auth.disconnect();
        await repo.disconnect();
        closeModal(true);
        render();
      }
      return;
    case "drive-folder":
      if (sync?.root)
        window.open(
          `https://drive.google.com/drive/folders/${encodeURIComponent(sync.root)}`,
          "_blank",
          "noopener",
        );
      return;
    case "drive-conflicts":
      return conflicts();
    case "resolve": {
      const i = arg.lastIndexOf(":"),
        key = arg.slice(0, i),
        revision = arg.slice(i + 1);
      if (sync?.busy) throw Error("동기화가 끝난 후 다시 선택해 주세요.");
      await repo.resolve(repo.record.activeAccount, key, revision);
      return conflicts();
    }
    case "drive-repair":
      if (confirm("표시된 연결을 정리할까요? 일정 내용은 보존합니다.")) {
        await repo.repair(repo.record.activeAccount);
        closeModal(true);
        await runSync();
      }
      return;
    case "install":
      if (installPrompt) {
        await installPrompt.prompt();
        installPrompt = null;
        return;
      }
      return modalOpen(
        "홈 화면에 H.PLAN 추가",
        `<div class="stack"><h3>아이폰 · iPad</h3><p>Safari에서 이 주소를 연 뒤 <strong>공유 → 홈 화면에 추가</strong>를 누르고, 표시된다면 ‘웹 앱으로 열기’를 켜세요.</p><h3>안드로이드</h3><p>Chrome 메뉴에서 <strong>앱 설치</strong> 또는 <strong>홈 화면에 추가</strong>를 선택하세요.</p><p class="help">홈 화면의 H.PLAN 로고로 실행하면 일반 주소창 없이 열립니다. 처음 한 번은 인터넷에 연결해 앱을 불러와야 오프라인에서도 사용할 수 있습니다.</p></div>`,
      );
    case "draft-restore": {
      let d;
      try {
        d = JSON.parse(localStorage.getItem("hplan-draft"));
      } catch {}
      if (!d) return toast("보관된 임시 작성 내용이 없습니다.");
      const { type, id } = parseDraftKey(d.key);
      if (type === "project")
        editProject(id !== "new" && getProject(id) ? id : null);
      else if (type === "folder")
        editFolder(
          id !== "new" && state().folders.some((x) => x.id === id) ? id : null,
        );
      else if (type === "template") await handle("template-new");
      else
        await editEntry(
          type === "entry" && id !== "new" && getEntry(id) ? id : null,
        );
      for (const [k, v] of Object.entries(d.values)) {
        const input = form.elements.namedItem(k);
        if (!input) continue;
        if (input.type === "checkbox") input.checked = true;
        else input.value = v;
      }
      if (d.checked)
        for (const [key, value] of Object.entries(d.checked)) {
          const input = form.elements.namedItem(key);
          if (input) input.checked = value;
        }
      if (type === "entry") adaptEntryForm(form, state());
      return;
    }
    case "help":
      return modalOpen(
        "H.PLAN 사용 안내",
        `<div class="stack"><p>업무·개인 일정·질문을 기록하고 프로젝트로 묶어 관리합니다. 일정의 점 세 개 메뉴에서 이월·복사·하위 업무·정렬을 사용할 수 있습니다.</p><p>기록은 기기 저장소에 먼저 보관됩니다. Google 연결 시 PC와 같은 계정의 H.PLAN 폴더를 사용합니다. 인터넷이나 로그인이 만료돼도 로컬 작성은 계속할 수 있습니다.</p><p>휴대폰 앱을 닫은 동안의 동기화는 보장하지 않습니다. 브라우저 데이터를 지우기 전에 백업을 내려받으세요. 개인 기록은 GitHub에 업로드하지 않습니다.</p><p><a href="../privacy.html" target="_blank" rel="noopener">개인정보처리방침</a> · <a href="../terms.html" target="_blank" rel="noopener">이용약관</a></p><p class="help">H.PLAN 모바일 ${APP_VERSION} · PC 2.1 동기화 형식 호환</p></div>`,
      );
    case "report": {
      const { reportDialog } = await import("./reports-ui.mjs");
      return reportDialog({
        repo,
        date,
        projectOpen,
        modalOpen,
        closeModal,
        toast,
      });
    }
    case "update":
      if (modal.open) return toast("작성 창을 닫은 뒤 업데이트해 주세요.");
      if (pendingReload) {
        location.reload();
      } else if (waitingWorker) {
        waitingWorker.postMessage("SKIP_WAITING");
      }
      return;
  }
}
document.addEventListener("click", async (event) => {
  const navButton = event.target.closest("[data-route]");
  if (navButton) {
    route = navButton.dataset.route;
    selected.clear();
    render();
    main.scrollTop = 0;
    return;
  }
  const target = event.target.closest("[data-action]");
  if (!target || target.disabled || busy || target.dataset.waiting) return;
  event.preventDefault();
  const background = ["drive-connect", "drive-sync", "drive-backup"].includes(
    target.dataset.action,
  );
  if (!background) busy = true;
  target.dataset.waiting = "true";
  try {
    await handle(target.dataset.action);
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    delete target.dataset.waiting;
  }
});
form.onsubmit = async (event) => {
  event.preventDefault();
  if (busy || !saveHandler) return;
  busy = true;
  const submit = footer.querySelector("[type=submit]");
  if (submit) submit.disabled = true;
  try {
    await saveHandler();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
  }
};
form.addEventListener("input", rememberDraft);
modal.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeModal();
});
$("#modal-close").onclick = () => closeModal();
document.addEventListener("keydown", (e) => {
  if (
    (e.key === "Enter" || e.key === " ") &&
    e.target.matches("[role=button][data-action]")
  ) {
    e.preventDefault();
    e.target.click();
  }
});
document.addEventListener("change", async (e) => {
  const el = e.target;
  try {
    if (el.id === "jump-date" && dateOK(el.value))
      await handle("date:" + el.value);
    if (el.id.startsWith("setting-")) {
      const name = el.id.slice(8),
        value =
          el.type === "checkbox"
            ? el.checked
            : ["fontSize", "backupRetention"].includes(name)
              ? Number(el.value)
              : el.value;
      await action({ type: "settings.save", value: { [name]: value } });
    }
  } catch (error) {
    toast(error.message);
  }
});
let searchTimer;
document.addEventListener("input", (e) => {
  if (e.target.id !== "search-query") return;
  query = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const start = e.target.selectionStart;
    overview();
    const input = $("#search-query");
    input.focus();
    input.setSelectionRange(start, start);
  }, 220);
});
$("#search-open").innerHTML = icon("search");
$("#undo").innerHTML = icon("undo");
$("#redo").innerHTML = icon("redo");
$("#modal-close").innerHTML = icon("close");
$("#search-open").onclick = () => {
  route = "overview";
  overviewFilter = "search";
  render();
  $("#search-query").focus();
};
$("#undo").onclick = async () => {
  try {
    await repo.undo();
    scheduleSync();
  } catch (e) {
    toast(e.message);
  }
};
$("#redo").onclick = async () => {
  try {
    await repo.redo();
    scheduleSync();
  } catch (e) {
    toast(e.message);
  }
};
function viewport() {
  const v = window.visualViewport;
  document.documentElement.style.setProperty(
    "--vh",
    `${v?.height || innerHeight}px`,
  );
  document.documentElement.style.setProperty(
    "--dialog-offset",
    `${v ? v.height + v.offsetTop - innerHeight : 0}px`,
  );
}
viewport();
window.visualViewport?.addEventListener("resize", viewport);
window.visualViewport?.addEventListener("scroll", viewport);
window.addEventListener("resize", viewport);
window.addEventListener("online", () => {
  renderNotice();
  runSync().catch(() => {});
});
window.addEventListener("offline", renderNotice);
window.addEventListener("beforeunload", rememberDraft);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && repo) {
    await repo.reload();
    if (!modal.open) runSync().catch(() => {});
  }
});
setInterval(() => {
  if (!document.hidden && !modal.open) runSync().catch(() => {});
}, 300000);
try {
  repo = await Repository.open(await IndexedStore.open());
  repo.subscribe(() => {
    if (!modal.open) render();
  });
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("hplan-mobile");
    channel.onmessage = async () => {
      await repo.reload();
      if (modal.open)
        toast("다른 창의 기록이 변경됐습니다. 작성 내용은 유지됩니다.");
    };
  }
  route = ["projects", "overview"].includes(state().settings.startPage)
    ? state().settings.startPage
    : "planner";
  await action({ type: "materialize", through: monthEnd(date) });
  render();
  $("#save-state").textContent = "기기에 저장됨";
  if (GOOGLE_WEB_CLIENT_ID) auth.prepare().catch(() => {});
  if ("serviceWorker" in navigator) {
    let reloading = false,
      hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (modal.open || busy) {
        pendingReload = true;
        renderNotice();
        return;
      }
      if (!reloading) {
        reloading = true;
        location.reload();
      }
    });
    const registration = await navigator.serviceWorker.register("./sw.js");
    if (registration.waiting) {
      waitingWorker = registration.waiting;
      renderNotice();
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker.addEventListener("statechange", () => {
        if (
          worker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          waitingWorker = worker;
          renderNotice();
        }
      });
    });
  }
} catch (e) {
  main.innerHTML = `<div class="panel stack"><h1>기기 저장소를 확인해 주세요</h1><p>${esc(e.message)}</p><p>비공개 모드나 저장 차단 설정을 확인한 뒤 다시 열어 주세요. 기존 데이터를 초기화하지 않았습니다.</p><button onclick="location.reload()">다시 시도</button></div>`;
  $("#save-state").textContent = "저장소 오류";
}
