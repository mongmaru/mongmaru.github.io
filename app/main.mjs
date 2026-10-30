import {conflictLabel,conflictValue} from './conflict-value.mjs';
import {entryColor} from './event-colors.mjs';
import {adaptTiming as adaptTimingOnly} from './calendar-form.mjs';
import {draftData,draftSignature} from './drafts.mjs';
import {validateForm,showFormErrors,clearFormErrors} from './form-feedback.mjs';
import {ViewHistory} from './view-history.mjs';
import { Repository, IndexedStore } from "./core/repository.mjs";
import { today, clone, dateOK, expandRecurrences } from "./core/domain.mjs";
import * as model from "./core/sync-model.mjs";
import { DriveClient } from "./core/drive-client.mjs";
import { SyncController } from "./core/sync.mjs";
import { WebAuth } from "./core/auth.mjs";
import { PersistentAuth } from "./core/persistent-auth.mjs";
import { CalendarIntegration } from './calendar-integration.mjs';
import { NativeBridge } from './native-bridge.mjs';
import { AppNotifications } from './notifications.mjs';
import { googlePanel } from './google-ui.mjs';
import {permissionState} from './google-permissions.mjs';
import {AutomaticSync} from './auto-sync.mjs';
import {syncLabel} from './sync-status.mjs';
import {renderDriveConflicts} from './conflict-ui.mjs';
import { expandEntries } from './core/calendar-recurrence.mjs';
import {
  GOOGLE_WEB_CLIENT_ID,
  APP_VERSION,
  AUTH_SERVER_URL,
} from "./config.mjs";
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
  adaptColorPreview,
  projectForm,
  folderForm,
  } from "./forms.mjs";
const $ = (s) => document.querySelector(s),
  main = $("#main"),
  modal = $("#modal"),
  form = $("#modal-form"),
  body = $("#modal-body"),
  footer = $("#modal-footer");
const createAuth = () =>
  AUTH_SERVER_URL
    ? new PersistentAuth(AUTH_SERVER_URL)
    : new WebAuth(GOOGLE_WEB_CLIENT_ID);
const authConnected = () =>
  typeof auth.connected === "boolean"
    ? auth.connected
    : !!auth.tokenValue && Date.now() < auth.expires;
let repo,
  calendar,
  nativeBridge,
  notifications,
  auth = createAuth(),
  sync = null,
  channel,
  busy = false,
  route = "planner",
  navigation,
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
  connectionGeneration = 0,
  restoring = null,
  restoringAuth = null,
  disconnecting = false;
const nav = [
  ["planner", "플래너", "calendar"],
  ["projects", "프로젝트", "folder"],
  ["overview", "모아보기", "grid"],
  ["settings", "설정", "settings"],
];
const state = () => repo.state;
const activeEntries = () => state().entries.filter((e) => !e.deletedAt);
const getEntry = (id) => state().entries.find((e) => e.id === id) || expandEntries(activeEntries(),date,date).find(e=>e.id===id);
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
  navigation?.openOverlay();
  if (modal.open) modal.close();
  lastFocus = document.activeElement;
  $("#modal-title").textContent = title;
  body.innerHTML = html;
  form.onchange = null;
  form.noValidate = true;
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
  draftInitial = draftSignature(form);
  setTimeout(() => {
    const target = body.querySelector(
      "input:not([type=checkbox]):not([type=color]),textarea,select",
    );
    if (target && innerWidth >= 700) target.focus();
    else $("#modal-close").focus();
  }, 0);
}
let draftTimer;
function rememberDraft() {
 clearTimeout(draftTimer);
 if(!draftKey||draftSignature(form)===draftInitial)return true;
 try{localStorage.setItem('hplan-draft',JSON.stringify(draftData(form,draftKey)));return true;}catch{return false;}
}
function finishClose() {
 clearTimeout(draftTimer);modal.close();navigation?.closeOverlay();if(sync)sync.editing=false;scheduleSync();draftKey=null;saveHandler=null;render();lastFocus?.isConnected&&lastFocus.focus();
}
function closeModal(force=false) {
 if(!modal.open||document.querySelector('#draft-choice'))return;
 if(!force&&draftKey&&draftSignature(form)!==draftInitial){
  const choice=document.createElement('dialog');choice.id='draft-choice';choice.className='draft-choice';choice.innerHTML='<h2>작성 중인 내용</h2><p>작성 내용을 어떻게 할까요?</p><div class="stack"><button data-choice="continue">계속 작성</button><button data-choice="keep" class="primary">임시 보관하고 닫기</button><button data-choice="discard" class="danger">버리고 닫기</button></div>';document.body.append(choice);
  choice.addEventListener('cancel',event=>{event.preventDefault();choice.close();choice.remove();});
  choice.addEventListener('click',event=>{const action=event.target.closest('[data-choice]')?.dataset.choice;if(!action)return;choice.close();choice.remove();if(action==='continue')return;if(action==='keep'){if(!rememberDraft()){toast('임시 보관에 실패했습니다. 저장공간을 확인해 주세요. 작성 내용은 창에 유지됩니다.');return;}}else clearDraft();finishClose();});choice.showModal();return;
 }
 rememberDraft();finishClose();
}
function clearDraft(){clearTimeout(draftTimer);try{localStorage.removeItem('hplan-draft');}catch{}draftKey=null;}
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
  if (authConnected() || sync && !sync.stopped) syncTimer = setTimeout(() => autoSync('local'), 2000);
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
let lastMainHTML, pendingMainHTML, mainPointer = null;
main.addEventListener('pointerdown', event => { mainPointer = event.pointerId; }, true);
function releaseMainPointer(event) {
  if (event.type !== 'blur' && event.pointerId !== mainPointer) return;
  // Click follows pointerup. Let its original target finish before refreshing.
  setTimeout(() => {
    mainPointer = null;
    if (pendingMainHTML !== undefined && !modal.open) setMainHTML(pendingMainHTML);
  }, 0);
}
window.addEventListener('pointerup', releaseMainPointer, true);
window.addEventListener('pointercancel', releaseMainPointer, true);
window.addEventListener('blur', releaseMainPointer);
function setMainHTML(html) {
  // Cursor, ETag and sync timestamps do not change the displayed planner.
  // Keep live buttons/inputs when the resulting view is unchanged.
  if (mainPointer !== null) { pendingMainHTML = html; return; }
  pendingMainHTML = undefined;
  if (html === lastMainHTML) return;
  main.innerHTML = html;
  lastMainHTML = html;
}
function render() {
  if (!repo) return;
  navigation?.capture();
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
  renderSyncStatus();
}
function entryCard(e, { showDate = false } = {}) {
  const p = getProject(e.projectId),
    complete = ["done", "answered"].includes(e.status),
    sub = e.parentId;
  return `<article style="--event-color:${esc(entryColor(e,p))}" class="entry ${done(e) ? "done" : ""} ${sub ? "child" : ""} ${e.status === "moved" ? "moved" : ""}" data-entry="${esc(e.id)}"><button class="entry-check ${complete ? "checked" : ""}" aria-label="${complete ? "완료 취소" : "완료로 표시"}" data-action="toggle:${esc(e.id)}">${icon(complete ? "check" : "circle")}</button>
 <div class="entry-content" role="button" tabindex="0" data-action="edit:${esc(e.id)}" aria-label="${esc(e.text)} 수정"><div class="entry-title" >${e.priority ? '<span class="priority">★ </span>' : ""}${esc(e.text)}</div><div class="entry-meta">${showDate ? `<span>${esc(e.date)}</span>` : ""}<span class="tag">${esc(p?.name || kindLabels[e.kind])}</span><span>${esc(statusLabels[e.status])}</span>${e.allDay===false?`<span>${esc(e.startTime)}–${esc(e.endTime)}</span>`:""}${e.endDate?`<span>기간 ${esc(e.date.slice(5))}–${esc(e.endDate.slice(5))}</span>`:""}${e.dueDate ? `<span ${e.dueDate < today() && !done(e) ? 'class="priority"' : ""}>마감 ${esc(e.dueDate.slice(5))}</span>` : ""}${e.recurrenceRule || e.recurrence !== "none" || e.seriesId ? "<span>반복</span>" : ""}${e.movedTo ? `<span>→ ${esc(e.movedTo.slice(5))}</span>` : ""}${e.notes ? "<span>메모</span>" : ""}${selected.has(e.id) ? '<span class="priority">선택됨</span>' : ""}</div></div><button class="icon-button entry-menu" aria-label="${esc(e.text.slice(0, 35))} 더보기" data-action="menu:${esc(e.id)}">${icon("more")}</button></article>`;
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
    const counts = new Map(),dayEntries=new Map();
    for (const e of expandEntries(activeEntries(),start,shiftDay(start,count-1)))
      for(let day=e.date>start?e.date:start;day<=(e.endDate||e.date)&&day<=shiftDay(start,count-1);day=shiftDay(day,1)){counts.set(day,(counts.get(day)||0)+1);if(!dayEntries.has(day))dayEntries.set(day,[]);dayEntries.get(day).push(e);}
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
      return `<button class="calendar-day ${day.slice(0, 7) !== date.slice(0, 7) ? "off" : ""} ${day === date ? "selected" : ""} ${day === today() ? "today" : ""}" data-action="date:${day}" aria-label="${day} 일정 ${n}개" ${day === date ? 'aria-pressed="true"' : ""}><span>${num}</span><span class="mobile-day-items">${(dayEntries.get(day)||[]).slice(0,4).map(e=>`<span class="mobile-day-item" style="border-inline-start-color:${esc(entryColor(e,getProject(e.projectId)))}" title="${esc(e.text)}">${esc(e.text)}</span>`).join("")}${n>4?`<small>+${n-4}개 더 보기</small>`:""}</span></button>`;
    }).join("")}</div>`;
  }
  const entries = expandEntries(activeEntries(),date,date).filter(
    (e) =>
      e.date <= date && (e.endDate || e.date) >= date &&
      (kind === "all" || e.kind === kind) &&
      (!projectFilter || e.projectId === projectFilter) &&
      (!statusFilter || e.status === statusFilter),
  );
  setMainHTML(`<div class="heading-row"><div><p class="eyebrow">MY DAY, MY PLAN</p><h1>${year}년 ${month + 1}월</h1><p>기록은 가볍게, 하루는 차분하게.</p></div>${button("추가", "entry-new", "primary", "plus")}</div><div class="planner-layout"><section class="panel calendar-panel" aria-label="달력"><div class="calendar-head"><div class="row"><button class="icon-button ghost" aria-label="이전 기간" data-action="period:-1">${icon("left")}</button><strong>${calendarMode === "year" ? year + "년" : month + 1 + "월"}</strong><button class="icon-button ghost" aria-label="다음 기간" data-action="period:1">${icon("right")}</button></div>${button("오늘", "today", "ghost")}</div><div class="toolbar"><div class="segmented" aria-label="달력 보기">${[
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
    )}</div><input type="date" aria-label="날짜 바로 선택" id="jump-date" value="${date}" style="flex:1;width:120px;padding:7px;font-size:14px"></div>${calendar}</section><section class="day-panel"><div class="day-header"><div class="view-title"><h2>${niceDate(date)}</h2><span class="count">${entries.length}</span></div><button class="icon-button ghost" aria-label="일정 필터" data-action="planner-filter">${icon("filter")}</button></div><div class="chips">${[["all", "전체"], ...Object.entries(kindLabels)].map(([id, label]) => `<button class="${kind === id ? "active" : ""}" data-action="kind:${id}">${label}</button>`).join("")}${button("날짜·복사·양식", "day-tools")}</div>${selectedBar()}<div class="agenda">${agenda(entries)}</div></section></div>`);
}
function projects() {
  if (projectOpen) {
    const p = getProject(projectOpen);
    if (!p) {
      projectOpen = null;
      return projects();
    }
    const entries = activeEntries().filter((e) => e.projectId === p.id);
    setMainHTML(`<div class="heading-row"><div><button class="ghost" data-action="project-back">${icon("left")} 프로젝트</button><h1>${esc(p.name)}</h1><p>${esc(p.aliases.join(" · "))}</p></div><button class="icon-button" aria-label="프로젝트 수정" data-action="project-edit:${esc(p.id)}">${icon("edit")}</button></div>${p.note ? `<div class="panel summary">${esc(p.note)}</div>` : ""}<div class="toolbar" style="margin-top:14px">${button("업무 추가", "project-entry", "primary", "plus")}${button("양식 적용", "templates")}${button("보고서", "report")}</div><div class="agenda">${agenda(entries, { showDate: true })}</div>`);
    return;
  }
  const card = (p) =>
    `<button class="project-card" data-action="project-open:${esc(p.id)}"><i class="project-color" style="background:${esc(p.color)}"></i><span class="info"><strong>${p.favorite ? "★ " : ""}${esc(p.name)}</strong><p>${p.status === "archived" ? "보관 · " : p.status === "hold" ? "보류 · " : ""}${activeEntries().filter((e) => e.projectId === p.id && !done(e)).length}개 남음${p.aliases.length ? " · " + esc(p.aliases[0]) : ""}</p></span>${icon("right")}</button>`;
  setMainHTML(`<div class="project-list"><div class="heading-row"><div><p class="eyebrow">WORKSPACE</p><h1>프로젝트</h1><p>작업을 나누고, 흐름을 정리하세요.</p></div><button class="icon-button primary" aria-label="프로젝트 추가" data-action="project-new">${icon("plus")}</button></div><div class="toolbar">${button("폴더 추가", "folder-new", "ghost", "folder")}${button("프로젝트 합치기", "project-merge", "ghost")}${button("업무 양식", "templates", "ghost")}</div>${state()
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
    )}${!state().projects.length ? empty("첫 프로젝트를 만들어 업무를 모아보세요.", "project-new", "프로젝트 만들기") : ""}</div>`);
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
  setMainHTML(`<div class="heading-row"><div><p class="eyebrow">AT A GLANCE</p><h1>모아보기</h1><p>흩어진 기록을 한눈에.</p></div><button class="icon-button" aria-label="보고서 내보내기" data-action="report">${icon("download")}</button></div><div class="stats"><div class="stat"><strong>${es.filter((e) => e.date === today()).length}</strong><span>오늘의 기록</span></div><div class="stat"><strong>${open.length}</strong><span>남은 일</span></div><div class="stat"><strong>${es.filter((e) => ["done", "answered"].includes(e.status)).length}</strong><span>완료한 기록</span></div></div><input id="search-query" class="search-input" type="search" aria-label="기록 검색" placeholder="내용, 프로젝트, 메모, 답변 검색" value="${esc(query)}"><div class="chips">${[
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
    )}<button data-action="planner-filter">${icon("filter")} 필터</button></div>${selectedBar()}<p class="section-title">${esc(names[overviewFilter] || "기록")} · ${list.length}개</p><div class="agenda">${agenda(list, { showDate: true })}</div>`);
}
function driveCard() {
  const connected = authConnected() && permissionState(auth).drive,
    status = sync?.status() || {lastSync:repo.syncMeta()?.lastSync,conflictCount:repo.syncMeta()?model.conflicts(repo.syncMeta().graph).length:0},
    account = repo.record.activeAccount;
  return `<section class="panel stack drive-compact"><div class="drive-summary">${icon("cloud")}<div><h2>Google 연동 · Drive</h2><p class="account">${authConnected() ? esc(auth.account.email) : account ? "계정 연결 기억됨" : "기기에만 저장 중"}</p></div><span class="status-dot ${connected ? "" : "off"}"></span></div>${authConnected()&&!connected?'<p class="help">Drive 추가 권한이 필요합니다. 다른 Google 기능은 각각의 연결 상태를 따릅니다.</p>':''}<p class="help" role="status">${esc(syncLabel({connected,connecting,authError:authRefreshError,reauth:auth.requiresReauth,offline:!navigator.onLine,drive:status}))}</p>${status?.error ? `<p class="notice-box">${esc(status.error)}</p>` : ""}<p class="help">${status?.lastSync ? "마지막 동기화 " + esc(new Date(status.lastSync).toLocaleString("ko-KR")) : "기록은 먼저 이 기기에 저장합니다."}</p><div class="drive-actions">${connected ? button(status?.busy ? "동기화 중…" : "지금 동기화", "drive-sync", "primary") : button(authConnected()?"Drive 권한 연결":"Google 계정으로 연결", "drive-connect", "primary")}${button("연결 관리", "drive-manage")}${button(`기기 간 수정 충돌 ${status?.conflictCount||0}개`, "drive-conflicts")}</div></section>`;
}
function settings() {
  const s = state().settings,
    status = sync?.status(),
    account = repo.record.activeAccount,
    connected = authConnected();
  setMainHTML(`<div class="heading-row"><div><p class="eyebrow">MAKE IT YOURS</p><h1>설정</h1><p>H.PLAN 모바일 ${APP_VERSION}</p></div></div><div class="settings-layout"><div class="stack">${driveCard()}${googlePanel(calendar,notifications,nativeBridge,auth,{connecting,connectionError:authRefreshError})}<section><p class="section-title">데이터와 복구</p><div class="action-list">${button("백업 파일 내려받기", "backup", "", "download")}${button("백업 파일 가져오기", "restore", "", "upload")}${button("기기 내 자동 백업", "backups", "", "clock")}${button("보고서 · Excel · 인쇄", "report", "", "print")}${button("휴지통", "trash", "", "trash")}${button("저장공간 보호 요청", "persist", "", "check")}</div><p class="help" style="padding:10px">브라우저 데이터를 삭제하면 기기 기록도 지워질 수 있습니다. Drive 동기화나 별도 백업을 함께 사용하세요.</p></section></div><div class="stack"><section><p class="section-title">화면과 사용성</p><div class="settings-group"><div class="setting-row"><div><strong>테마</strong><p>밝게 · 어둡게 · 기기 설정</p></div><select id="setting-theme" aria-label="테마">${[
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
    )}</select></div><div class="setting-row"><div><strong>모션 줄이기</strong></div><input id="setting-reduceMotion" type="checkbox" aria-label="모션 줄이기" ${s.reduceMotion ? "checked" : ""}></div><div class="setting-row"><div><strong>달력에서 주말 숨기기</strong></div><input id="setting-hideWeekends" type="checkbox" aria-label="주말 숨기기" ${s.hideWeekends ? "checked" : ""}></div><div class="setting-row"><div><strong>빈 날짜 안내 간소화</strong></div><input id="setting-hideEmpty" type="checkbox" aria-label="빈 날짜 안내 간소화" ${s.hideEmpty ? "checked" : ""}></div><div class="setting-row"><div><strong>기기 백업 보관 수</strong></div><input id="setting-backupRetention" type="number" min="3" max="180" value="${s.backupRetention}" aria-label="백업 보관 수"></div></div></section><div class="action-list">${button("모아보기 항목 설정", "widgets", "", "grid")}${button("홈 화면에 설치하기", "install", "", "plus")}${button("임시 작성 내용 복구", "draft-restore", "", "note")}${button("임시 작성 내용 삭제", "draft-delete", "", "trash")}${button("사용 안내와 개인정보", "help", "", "help")}</div><p class="help">Windows 자동 시작·창 크기·저장 폴더 선택은 모바일 웹 환경의 설치·기기 저장 기능으로 대체됩니다. Android APK에는 홈 화면 캘린더 위젯이 포함됩니다. 위젯은 Android 홈 화면에서 직접 추가해 주세요.</p></div></div>`);
}
function renderNotice() {
  const n = $("#notice");
  if (!navigator.onLine) {
    n.hidden = false;
    n.textContent = "오프라인 · 기록은 이 기기에 저장합니다.";
  } else if (waitingWorker || pendingReload) {
    n.hidden = false;
    n.innerHTML = "새 버전이 준비되었습니다. " + button("업데이트", "update");
  } else if (sync?.status().conflictCount) {
    n.hidden=false;
    n.innerHTML=`기기 간 수정 충돌 ${sync.status().conflictCount}개 · `+button('내용 확인','drive-conflicts');
  } else {
    n.hidden = true;
    n.textContent = "";
  }
}
function renderSyncStatus(){
 if(!repo)return;
 $('#save-state').textContent=syncLabel({connected:authConnected(),connecting,authError:authRefreshError,reauth:auth.requiresReauth,offline:!navigator.onLine,drive:sync&&!sync.stopped?sync.status():null,services:calendar?.status.services});
}
async function editEntry(id = null, preset = {}) {
  const e = id ? getEntry(id) : {},
    savedDate = date;
  modalOpen(
    id ? "일정 수정" : "새 일정",
    entryForm(state(), date, e, preset),
    async () => {
      const value = entryValue(form, e);
      const scope=String(new FormData(form).get('recurrenceScope')||'all');
      await action({ type: "entry.save", value, scope, recurrenceChanged:form.dataset.recurrenceChanged==='true', occurrenceDate:e?.originalDate||e?.date||date }, "기기에 저장했습니다.", e?.seriesId?null:e);
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
  form.dataset.recurrenceChanged = 'false';form.dataset.colorChanged='false';
  if(e?.seriesId||e?.recurrenceRule||e?.recurrence!=='none'&&e?.recurrence)body.insertAdjacentHTML('afterbegin',select('수정 범위','recurrenceScope',[['this','이 일정만'],['following','이 일정과 이후 일정'],['all','전체 반복 일정']],e?.seriesId?'this':'all','full'));
  adaptEntryForm(form, state());
  draftInitial = draftSignature(form);
  form.onchange = event => {if(event.target.name==='eventColorId'){form.dataset.colorChanged='true';adaptColorPreview(form,state());}if(['kind','status','projectId','date'].includes(event.target.name))adaptEntryForm(form,state());else adaptTimingOnly(form);if(['repeatMode','frequency','interval','weekdays','monthMode','monthPosition','monthWeekday','repeatEnd','repeatUntil','repeatCount'].includes(event.target.name)||event.target.name?.startsWith('repeatDay:'))form.dataset.recurrenceChanged='true';};
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
      const status=new FormData(form).get('status');
      for(const e of es)if(e.seriesId||e.recurrenceRule||e.recurrence!=='none'&&e.recurrence)await action({type:'entry.save',value:{...e,status},scope:'this',occurrenceDate:e.originalDate||e.date});
      const ordinary=es.filter(e=>!e.seriesId&&!e.recurrenceRule&&(!e.recurrence||e.recurrence==='none')).map(e=>e.id);
      if(ordinary.length)await action({type:'entry.status',ids:ordinary,status});
      toast('상태를 변경했습니다.');
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
let notifiedConflictSignature='',authRefreshError=false;
async function runSync(backup = false, quiet = false) {
  if (!sync || sync.stopped) {
    if (!quiet) toast("Google 계정을 먼저 연결해 주세요.");
    return;
  }
  if (!navigator.onLine) {
    if (!quiet) toast("인터넷 연결 후 동기화할 수 있습니다.");
    return;
  }
  if (quiet && auth.requiresReauth) return;
  const controller = sync,
    sessionAuth = auth;
  try {
    let result;
    try {
      result = await controller.sync(backup);
    } catch (error) {
      // Retry a rejected short-lived token once through the remembered grant.
      if (error.code !== "AUTH" || !sessionAuth.restore || sync !== controller)
        throw error;
      await sessionAuth.token(true);
      result = await controller.sync(backup);
    }
    if (sync !== controller) return;
    if (controller.status().conflictCount) {
      const signature=model.conflicts(repo.syncMeta().graph).map(c=>c.key+':'+c.versions.map(v=>v.id).join(',')).join('|');
      if(signature!==notifiedConflictSignature){notifiedConflictSignature=signature;toast('기기 간 수정 충돌이 있습니다. 상단 ‘내용 확인’에서 비교해 주세요.');}
    }
    else if (result.completed && !controller.editing)
      {notifiedConflictSignature='';renderSyncStatus();}
    renderNotice();
    return result;
  } catch (e) {
    if (sync === controller) {
      $("#save-state").textContent = sessionAuth.requiresReauth
        ? "연결 확인 필요"
        : "동기화 대기";
      if (!modal.open && route === "settings") settings();
    }
    if (!quiet) toast(e.message);
    throw e;
  }
}
async function attachDrive(nextAuth, account, attempt) {
  if (attempt !== connectionGeneration) return;
  sync?.stop();
  await repo.connectAccount(
    account.sub,
    () => attempt === connectionGeneration,
  );
  if (
    attempt !== connectionGeneration ||
    repo.record.activeAccount !== account.sub
  )
    return;
  if (!nextAuth.requiresReauth) await nextAuth.commit?.();
  if (attempt !== connectionGeneration) return;
  auth = nextAuth;
  nativeBridge?.update();
  refreshNotifications();
  if(!permissionState(nextAuth).drive){sync=null;render();return;}
  const controller = new SyncController({
    repo,
    account: account.sub,
    client: new DriveClient({
      token: (force=false) => {
        if (
          controller.stopped ||
          auth !== nextAuth ||
          repo.record.activeAccount !== account.sub
        )
          throw Error("Google 연결이 변경되어 이전 요청을 중지했습니다.");
        return nextAuth.token(force);
      },
    }),
    onStatus: () => {
      renderSyncStatus();
      if (route === "settings" && !modal.open) settings();
    },
  });
  sync = controller;
  sync.editing = modal.open;
  render();
}
async function restoreDrive() {
  if (
    !AUTH_SERVER_URL ||
    connecting ||
    disconnecting ||
    authConnected() ||
    (sync && !sync.stopped)
  )
    return;
  if (restoring) return restoring;
  const attempt = connectionGeneration;
  restoring = (async () => {
    const candidate = createAuth();
    restoringAuth = candidate;
    await candidate.prepare();
    const account = await candidate.restore();
    if (!account || attempt !== connectionGeneration || connecting) return;
    // An automatic restore must never switch the account behind the user's back.
    if (repo.record.activeAccount && repo.record.activeAccount !== account.sub)
      return;
    await attachDrive(candidate, account, attempt);
  })().finally(() => {
    restoring = null;
    restoringAuth = null;
  });
  return restoring;
}
let lastDriveAttempt=0;
const automaticSync=new AutomaticSync(performAutoSync);
function autoSync(reason='foreground'){return automaticSync.request(reason);}
function refreshNotifications(force=false){if(!notifications)return;notifications.upload(force).finally(()=>{if(route==='settings'&&!modal.open)settings();}).catch(()=>{});}
async function performAutoSync(reason='foreground') {
  let checkedAuth,checkedGeneration;
  try {
    if (!authConnected() && (!sync || sync.stopped)) {
      await restoreDrive();
    }
    if(authConnected()){
      // Refresh remembered grants before deciding which service can run. Older
      // device sessions may not contain a cached scope list; never infer consent.
      const session=auth,generation=connectionGeneration;
      checkedAuth=session;checkedGeneration=generation;
      await session.token();
      if(session!==auth||generation!==connectionGeneration)return;
      authRefreshError=false;
      // Reserve imminent reminders independently of slow Drive/Calendar RPCs.
      // The notification queue guards account changes and native handover itself.
      refreshNotifications();
      if(permissionState(session).drive&&(!sync||sync.stopped))await attachDrive(session,session.account,generation);
      if(sync&&!sync.stopped&&(reason!=='idle'||Date.now()-lastDriveAttempt>=60000)){lastDriveAttempt=Date.now();try{await runSync(false, true);}catch{}}
      if(!modal.open)try{await calendar?.run({reason});}catch{}
      // Remote completions/edits may cancel or change a reminder during that run.
      refreshNotifications();
      renderSyncStatus();
    }
  } catch {
    // Preserve the grant and records, while making a failed preflight visible.
    if(!checkedAuth||checkedAuth===auth&&checkedGeneration===connectionGeneration)authRefreshError=true;
  } finally {renderSyncStatus();if(route==='settings'&&!modal.open)settings();}
}
async function connectDrive(features = {}) {
  if (connecting || disconnecting) return;
  if (!GOOGLE_WEB_CLIENT_ID && !AUTH_SERVER_URL) {
    toast(
      "Google 웹앱 등록을 준비하고 있습니다. 기기 저장은 정상 사용할 수 있습니다.",
    );
    return;
  }
  connecting = true;
  if(!modal.open)render();
  const attempt = ++connectionGeneration,
    nextAuth = createAuth();
  pendingAuth = nextAuth;
  try {
    // PersistentAuth opens the consent window synchronously during the original tap.
    if (!nextAuth.restore) await nextAuth.prepare();
    if (attempt !== connectionGeneration) return;
    const account = await nextAuth.connect(features);
    if (attempt !== connectionGeneration) return;
    if (
      repo.record.activeAccount &&
      repo.record.activeAccount !== account.sub &&
      !confirm(
        "다른 Google 계정입니다. 이 기기의 현재 기록을 선택한 계정으로 동기화할까요?",
      )
    ) {
      await nextAuth.disconnect();
      return;
    }
    await attachDrive(nextAuth, account, attempt);
    channel?.postMessage({ type: "auth-change" });
    const permissions=permissionState(nextAuth),changes={};
    if(features.calendar&&permissions.calendar)changes.enabled=true;
    if(features.tasks&&permissions.tasks)changes.tasks=true;
    if(Object.keys(changes).length)await calendar.configure(changes);
    if(features.calendar&&!permissions.calendar||features.tasks&&!permissions.tasks)toast('계정은 연결했습니다. 허용하지 않은 추가 기능은 켜지 않습니다.');
    await autoSync('online');
    render();
  } finally {
    if (pendingAuth === nextAuth) pendingAuth = null;
    if (attempt === connectionGeneration) {connecting = false;if(!modal.open)render();}
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
    "기기 간 수정 충돌 · Drive",
    renderDriveConflicts(list,repairs,state()),
  );
}
function googlePermissionPrompt(feature){
 const label=feature==='tasks'?'Google 할 일':'Google Calendar';
 modalOpen(label+' 연결',`<div class="stack"><p>${label}에 필요한 추가 권한만 요청합니다. 기존 Drive와 이 기기의 기록은 유지합니다.</p><div class="notice-box"><strong>Google 검증 안내</strong><p>Google의 앱 검증이 끝나기 전에는 별도의 경고가 표시될 수 있습니다. Google이 관리하는 화면이며 H.PLAN에서 숨기거나 자동 승인하지 않습니다.</p></div><p class="help">승인을 취소하면 이 기능은 켜지지 않습니다. 기기에서 작성한 기록은 계속 사용할 수 있습니다.</p>${button('Google에서 권한 확인',`google-authorize:${feature}`,'primary')}${button('연결 도움말','google-help')}</div>`);
}
async function manageGoogleFeature(feature){
 const requestedRoute=route,requestedAuth=auth,requestedDialog=modal.open?body.innerHTML:null;const currentRequest=()=>route===requestedRoute&&auth===requestedAuth&&(!modal.open||body.innerHTML===requestedDialog);

 const label=feature==='tasks'?'Google 할 일':'Google Calendar',permissions=permissionState(auth),options=calendar.options();
 if(!authConnected()||!permissions[feature])return googlePermissionPrompt(feature);
 if(feature==='tasks')return modalOpen(label+' 설정',`<div class="stack">${checkbox('Google 할 일 동기화 사용','tasksEnabled',options.tasks)}<p class="help">날짜가 있는 할 일의 제목·메모·완료 상태를 연결합니다. Calendar 연결과 별도로 켜거나 끌 수 있습니다.</p>${button('권한 다시 연결','google-permission:tasks')}</div>`,async()=>{const value=new FormData(form).has('tasksEnabled');await calendar.configure({tasks:value});closeModal(true);if(value)syncGoogleFeature('tasks').catch(e=>toast(e.message));});
 let list;try{list=await calendar.calendars();}catch(e){if(!currentRequest())return;return modalOpen(label+' 연결 확인',`<div class="stack"><p class="notice-box">${esc(e.message)}</p><p class="help">목록을 읽지 못했습니다. 기존 연결 설정과 기록은 유지합니다.</p>${button('다시 시도','calendar-manage','primary')}${button('권한 다시 연결','google-permission:calendar')}${button('연결 도움말','google-help')}</div>`);}
 if(!currentRequest())return;
 return modalOpen(label+' 설정',`<div class="stack">${checkbox('Calendar 양방향 동기화 사용','calendarEnabled',options.enabled)}<p class="help">처음 연결한 달 1일부터 가져옵니다. H.PLAN에서 만든 일정은 첫 번째로 선택한 캘린더에 보냅니다.</p>${list.length?list.map(c=>checkbox(c.summary||c.id,'calendar:'+c.id,(options.calendarIds||['primary']).includes(c.id)||c.primary&&(options.calendarIds||[]).includes('primary'))).join(''):'<p class="notice-box">수정 가능한 캘린더가 없습니다.</p>'}<p class="help">Google 원본은 양쪽에서 바로 삭제하며 H.PLAN 원본은 H.PLAN 휴지통으로 보냅니다.</p>${button('권한 다시 연결','google-permission:calendar')}</div>`,async()=>{const f=new FormData(form),enabled=f.has('calendarEnabled'),ids=list.filter(c=>f.has('calendar:'+c.id)).map(c=>c.id);if(enabled&&!ids.length)throw Error('캘린더를 하나 이상 선택해 주세요.');await calendar.configure({enabled,calendarIds:ids});closeModal(true);if(enabled)syncGoogleFeature('calendar').catch(e=>toast(e.message));});
}
async function syncGoogleFeature(feature){
 if(!permissionState(auth)[feature]||!(feature==='calendar'?calendar.options().enabled:calendar.options().tasks))return manageGoogleFeature(feature);
 const result=await calendar.run();scheduleSync();const service=calendar.status.services[feature];
 if(service.code==='error')return toast(service.error||'동기화가 끝나지 않았습니다. 연결 상태를 확인해 주세요.');
 if(result&&service.code==='connected')toast('동기화를 완료했습니다.');
}
async function handle(a) {
  const pos = a.indexOf(":"),
    op = pos < 0 ? a : a.slice(0, pos),
    arg = pos < 0 ? "" : a.slice(pos + 1);
  switch (op) {
    case 'native-settings':
      if(!nativeBridge?.openSettings())toast('Android 연결을 기다리고 있습니다. 홈 화면 H.PLAN 위젯의 ⋮에서 알림 설정을 열어 주세요.');
      return;
    case 'calendar-manage':return manageGoogleFeature('calendar');
    case 'tasks-manage':return manageGoogleFeature('tasks');
    case 'google-permission':return googlePermissionPrompt(arg==='tasks'?'tasks':'calendar');
    case 'calendar-authorize':return googlePermissionPrompt('calendar');
    case 'google-authorize':closeModal(true);return connectDrive(arg==='tasks'?{tasks:true}:{calendar:true});
    case 'calendar-sync':closeModal(true);return syncGoogleFeature('calendar');
    case 'tasks-sync':closeModal(true);return syncGoogleFeature('tasks');
    case 'google-help':return modalOpen('Google 연결 도움말','<div class="stack"><p>Drive·Calendar·Google 할 일은 필요한 기능만 따로 연결합니다. 연결을 취소하거나 권한을 허용하지 않아도 기기 기록은 지워지지 않습니다.</p><p>“Google에서 확인하지 않은 앱”은 Google의 브랜드·데이터 접근 검증 상태를 알리는 화면입니다. 앱에서 이 경고를 제거하거나 자동으로 통과시킬 수 없습니다. 개발자가 Google 검증을 완료해야 합니다.</p><p>계속 경고가 나오면 Google 창을 닫고 이 화면으로 돌아와 주세요. 기존 계정의 Drive 동기화와 로컬 기록은 유지합니다.</p><p>앱을 업데이트하려면 현재 입력을 저장한 뒤 업데이트 안내를 눌러 주세요. 브라우저 저장 데이터를 지울 필요는 없습니다.</p><p class="help">연결 오류는 해당 기능 카드에 표시하며 마지막 성공 시각을 별도로 보존합니다.</p></div>');
    case 'calendar-conflicts': {
      const entries=calendar.status.conflicts;
      return modalOpen('Calendar 수정 충돌',entries.length?`<div class="stack">${entries.map(e=>`<section class="panel"><h3>${esc(e.text)}</h3>${Object.entries(e.google.conflicts).map(([key,v])=>`<div class="summary"><strong>${esc(conflictLabel(key))}</strong><p>H.PLAN: ${esc(conflictValue(key,v.local))}</p><p>Google: ${esc(conflictValue(key,v.google??v.remote))}</p><div class="row">${button('H.PLAN 내용 유지',`calendar-resolve:${encodeURIComponent(JSON.stringify([e.id,key,'local']))}`)}${button('Google 내용 유지',`calendar-resolve:${encodeURIComponent(JSON.stringify([e.id,key,'google']))}`)}</div></div>`).join('')}</section>`).join('')}</div>`:'<p>확인할 수정 충돌이 없습니다.</p>');
    }
    case 'calendar-resolve':closeModal(true);await calendar.resolve(...JSON.parse(decodeURIComponent(arg)));scheduleSync();return handle('calendar-conflicts');
    case 'notifications-enable':await notifications.enable();render();return toast('이 기기의 알림을 켰습니다.');
    case 'notifications-disable':await notifications.disable();render();return toast('이 기기의 웹 알림을 껐습니다.');
    case 'trash-empty': {
      const ids=state().entries.filter(e=>e.deletedAt).map(e=>e.id);if(ids.length&&confirm(`휴지통의 기록 ${ids.length}개를 모두 영구 삭제할까요? 별도 백업은 지우지 않습니다.`)){await action({type:'entry.purge',ids});return handle('trash');}return;
    }
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
      if(e.seriesId||e.recurrenceRule||e.recurrence!=='none'&&e.recurrence){const status=['done','answered'].includes(e.status)?(e.kind==='question'?'open':'planned'):(e.kind==='question'?'answered':'done');await action({type:'entry.save',value:{...e,status},scope:'this',occurrenceDate:e.originalDate||e.date});return;}
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
    case "delete": {
      const e=getEntry(arg),message=e.origin==='google'?'Google 원본 일정입니다. H.PLAN과 Google에서 이 기록을 삭제할까요?':'이 기록을 H.PLAN 휴지통으로 옮기고 연결한 Google 일정을 삭제할까요?';
      if(e.seriesId||e.recurrenceRule||e.recurrence!=='none'&&e.recurrence)return modalOpen('반복 일정 삭제',`<p>${esc(message)}</p>${select('삭제 범위','deleteScope',[['this','이 일정만'],['following','이 일정과 이후 일정'],['all','전체 반복 일정']],'this')}`,async()=>{await action({type:'entry.delete',ids:[arg],scope:new FormData(form).get('deleteScope'),occurrenceDate:e.originalDate||e.date});clearDraft();closeModal(true);},{label:'삭제'});
      if (confirm(message)) {
        await action(
          { type: "entry.delete", ids: [arg] },
          e.origin==='google'?"일정을 삭제했습니다.":"휴지통으로 옮겼습니다.",
        );
        clearDraft();
        closeModal(true);
      }
      return;
    }
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
        `${button("휴지통 모두 비우기","trash-empty","danger")}<div class="stack">${
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
        "Google 연동 관리",
        `<div class="stack"><p>저장 위치: 내 드라이브 / H.PLAN</p><p class="help">자동 백업은 하루 1회, 기기별 최근 30개입니다. ${AUTH_SERVER_URL ? "한 번 연결하면 다음 실행에도 연결을 기억하고 자동 동기화합니다. Google 권한을 철회하거나 기기 데이터를 삭제하면 다시 연결해야 합니다." : "웹앱을 열었을 때 동기화하며 Google 연결이 만료되면 갱신이 필요합니다."}</p><div class="action-list">${button("계정 연결 또는 변경", "drive-connect", "", "cloud")}${button("Drive 백업 만들기", "drive-backup", "", "download")}${button("Drive 폴더 열기", "drive-folder", "", "folder")}${button("충돌 내용 확인", "drive-conflicts", "", "note")}${button("연결 해제", "drive-disconnect", "danger")}</div></div>`,
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
        disconnecting = true;
        connectionGeneration++;
        pendingAuth?.disconnect()?.catch?.(() => {});
        restoringAuth?.disconnect()?.catch?.(() => {});
        pendingAuth = null;
        connecting = false;
        sync?.stop();
        sync = null;
        try {
          if (auth.disconnectAll) await auth.disconnectAll();
          else await auth.disconnect();
          await repo.disconnect();
          channel?.postMessage({ type: "auth-change" });
          closeModal(true);
          render();
        } finally {
          disconnecting = false;
        }
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
    case 'draft-delete': {
     if(!localStorage.getItem('hplan-draft'))return toast('보관된 임시 작성 내용이 없습니다.');
     return modalOpen('임시 작성 내용 삭제','<p>보관한 임시 작성본을 삭제할까요? 저장한 일정은 유지됩니다.</p>',()=>{clearDraft();closeModal(true);toast('임시 작성본을 삭제했습니다.');},{label:'삭제'});
    }
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
      if(type==='entry'){form.dataset.recurrenceChanged=String(!!d.recurrenceChanged);form.dataset.colorChanged=String(!!d.colorChanged);adaptEntryForm(form,state());}
      return;
    }
    case "help":
      return modalOpen(
        "H.PLAN 사용 안내",
        `<div class="stack"><p>업무·개인 일정·질문을 기록하고 프로젝트로 묶어 관리합니다. 일정의 점 세 개 메뉴에서 이월·복사·하위 업무·정렬을 사용할 수 있습니다.</p><p>기록은 기기 저장소에 먼저 보관됩니다. Google 연결 시 PC와 같은 계정의 H.PLAN 폴더를 사용합니다. 인터넷이나 로그인이 만료돼도 로컬 작성은 계속할 수 있습니다.</p><p>앱이 닫힌 동안의 전체 플래너 동기화는 보장하지 않습니다. 웹 알림을 켜면 최소 예약 정보는 암호화된 알림 서버가 처리합니다. Google 원본 일정은 Google 알림을 사용하고, H.PLAN 원본은 직접 설정한 H.PLAN 알림을 사용합니다. 기간 종료일과 업무 마감일은 별개이며, 기간 일정은 종료일 다음 날 완료로 표시됩니다. Android 위젯은 앱의 테마를 따르며 마지막 갱신 시각을 표시합니다. 브라우저 데이터를 지우기 전에 백업을 내려받으세요. 개인 기록은 GitHub에 업로드하지 않습니다.</p><p><a href="../privacy.html" target="_blank" rel="noopener">개인정보처리방침</a> · <a href="../terms.html" target="_blank" rel="noopener">이용약관</a></p><p class="help">H.PLAN 모바일 ${APP_VERSION} · PC 2.2 동기화 형식 호환</p></div>`,
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
const pendingActions = new Set();
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
  const pendingKey = connectionGeneration + ':' + target?.dataset.action;
  if (!target || target.disabled || busy || target.dataset.waiting || pendingActions.has(pendingKey)) return;
  event.preventDefault();
  const actionName = target.dataset.action;
  const background = ["drive-connect", "drive-sync", "drive-backup", "calendar-sync", "tasks-sync", "google-authorize", "notifications-enable", "notifications-disable", "calendar-manage", "tasks-manage"].includes(
    actionName.split(':')[0],
  );
  if (!background) busy = true;
  pendingActions.add(pendingKey);
  target.dataset.waiting = "true";
  try {
    await handle(actionName);
  } catch (e) {
    toast(e.message);
  } finally {
    if (!background) busy = false;
    pendingActions.delete(pendingKey);
    delete target.dataset.waiting;
  }
});
form.onsubmit = async (event) => {
  event.preventDefault();
  if (busy || !saveHandler) return;
  const errors=validateForm(form);if(errors.length){showFormErrors(form,errors);return;}
  busy = true;
  const submit = footer.querySelector("[type=submit]");
  if (submit) submit.disabled = true;
  try {
    clearFormErrors(form);
    await saveHandler();
  } catch (e) {
    showFormErrors(form,[{message:e.message}]);
  } finally {
    busy = false;
    if (submit) submit.disabled = false;
  }
};
form.addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(rememberDraft,350);clearFormErrors(form);});
form.addEventListener('change',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(rememberDraft,350);});
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
  autoSync('online');
});
window.addEventListener("offline",()=>{renderNotice();renderSyncStatus();if(route==='settings'&&!modal.open)settings();});
window.addEventListener("beforeunload", rememberDraft);
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
});
document.addEventListener("visibilitychange", async () => {
  if (!document.hidden && repo) {
    await repo.reload();
    if (!modal.open) autoSync();
  } else if (document.hidden && sync?.status().pending && !modal.open) {
    runSync(false, true).catch(() => {});
  }
});
window.addEventListener("pageshow", () => {
  if (repo && !modal.open) autoSync();
});
setInterval(() => {
  if (!document.hidden && !modal.open) autoSync('idle');
}, 60000);
try {
  repo = await Repository.open(await IndexedStore.open());
  calendar=new CalendarIntegration({repo,getAuth:()=>auth,isEditing:()=>modal.open,onStatus:()=>{renderSyncStatus();if(route==='settings'&&!modal.open)settings();}});
  notifications=new AppNotifications({getState:state,getAuth:()=>auth,getNative:()=>nativeBridge,onError:e=>toast(e.message)});
  nativeBridge=new NativeBridge({onState:()=>{if(route==='settings'&&!modal.open)settings();},getState:state,getCacheKey:()=>repo.record.activeAccount||'local',onAck:(id,entryId,startAt)=>notifications.acknowledge(id,startAt),onReady:()=>{notifications.uploaded=null;refreshNotifications(true);if(route==='settings')settings();}});
  const launch=new URLSearchParams(location.search);
  if(dateOK(launch.get('date')))date=launch.get('date');
  navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='hplan.notification.ack')notifications.acknowledge(e.data.entryId,e.data.startAt,e.data.sessionId).catch(()=>{});});
  repo.subscribe(() => {
    nativeBridge?.update();
    if (!modal.open) render();
  });
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("hplan-mobile");
    channel.onmessage = async (event) => {
      await repo.reload();
      if (event.data?.type === "auth-change") {
        connectionGeneration++;
        pendingAuth?.disconnect()?.catch?.(() => {});
        restoringAuth?.disconnect()?.catch?.(() => {});
        pendingAuth = null;
        connecting = false;
        sync?.stop();
        sync = null;
        auth = createAuth();
        autoSync();
      } else scheduleSync();
      if (modal.open)
        toast("다른 창의 기록이 변경됐습니다. 작성 내용은 유지됩니다.");
    };
  }
  route = dateOK(launch.get('date'))?'planner':["projects", "overview"].includes(state().settings.startPage)
    ? state().settings.startPage
    : "planner";
  navigation=new ViewHistory({read:()=>({route,date,calendarMode,kind,projectFilter,projectOpen,query,overviewFilter,statusFilter,dateFrom,dateTo}),hasModal:()=>modal.open,closeModal:()=>closeModal(),apply:v=>{
    route=['planner','projects','overview','settings'].includes(v.route)?v.route:'planner';
    date=dateOK(v.date)?v.date:today();calendarMode=['month','week','year'].includes(v.calendarMode)?v.calendarMode:'month';
    kind=typeof v.kind==='string'?v.kind:'all';projectFilter=typeof v.projectFilter==='string'?v.projectFilter:'';projectOpen=typeof v.projectOpen==='string'&&getProject(v.projectOpen)?v.projectOpen:null;
    query=typeof v.query==='string'?v.query:'';overviewFilter=typeof v.overviewFilter==='string'?v.overviewFilter:'today';statusFilter=typeof v.statusFilter==='string'?v.statusFilter:'';dateFrom=dateOK(v.dateFrom)?v.dateFrom:'';dateTo=dateOK(v.dateTo)?v.dateTo:'';
    selected.clear();render();main.scrollTop=0;
  }});
  await action({ type: "materialize", through: monthEnd(date) });
  render();
  $("#save-state").textContent = "기기에 저장됨";
  if (AUTH_SERVER_URL) autoSync();
  else if (GOOGLE_WEB_CLIENT_ID) auth.prepare().catch(() => {});
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
    const registration = await navigator.serviceWorker.register("./sw.js").catch(()=>null);
    if (registration?.waiting) {
      waitingWorker = registration.waiting;
      renderNotice();
    }
    registration?.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
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
  setMainHTML(`<div class="panel stack"><h1>기기 저장소를 확인해 주세요</h1><p>${esc(e.message)}</p><p>비공개 모드나 저장 차단 설정을 확인한 뒤 다시 열어 주세요. 기존 데이터를 초기화하지 않았습니다.</p><button onclick="location.reload()">다시 시도</button></div>`);
  $("#save-state").textContent = "저장소 오류";
}




