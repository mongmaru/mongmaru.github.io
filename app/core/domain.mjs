// Browser port of PC 2.1.0; regenerate with node scripts/prepare-core.mjs
const randomUUID = () => globalThis.crypto.randomUUID();
const clone = (x) => JSON.parse(JSON.stringify(x));
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
const dateOK = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(v + "T12:00:00")) &&
  new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
const text = (v, max = 20000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const color = (v) => (/^#[a-f\d]{6}$/i.test(v || "") ? v : "#C9232C");
const entryStatuses = {
  task: ["planned", "progress", "waiting", "done", "canceled", "moved"],
  personal: ["planned", "progress", "waiting", "done", "canceled", "moved"],
  question: ["open", "waiting", "answered", "hold"],
};
const repeatValues = ["daily", "weekdays", "weekly", "monthly"];
function expandRecurrences(entries, through) {
  const result = clone(entries),
    ids = new Set(result.map((e) => e.id));
  const now = new Date().toISOString();
  for (const src of entries.filter(
    (e) => !e.deletedAt && repeatValues.includes(e.recurrence) && !e.seriesId,
  )) {
    let d = new Date(src.date + "T12:00:00Z"),
      end = new Date(
        (src.recurrenceUntil && src.recurrenceUntil < through
          ? src.recurrenceUntil
          : through) + "T12:00:00Z",
      );
    let n = 1;
    while (n <= 100000) {
      let next = new Date(d);
      if (src.recurrence === "monthly") {
        const anchor = new Date(src.date + "T12:00:00Z");
        next = new Date(
          Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + n, 1, 12),
        );
        const max = new Date(
          Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
        ).getUTCDate();
        next.setUTCDate(Math.min(anchor.getUTCDate(), max));
      } else
        next.setUTCDate(
          next.getUTCDate() + (src.recurrence === "weekly" ? 7 : 1),
        );
      if (next > end) break;
      const date = next.toISOString().slice(0, 10),
        id = src.id + ":" + date;
      if (
        (src.recurrence !== "weekdays" || ![0, 6].includes(next.getUTCDay())) &&
        !ids.has(id)
      ) {
        result.push({
          ...clone(src),
          id,
          date,
          status: entryStatuses[src.kind][0],
          doneAt: null,
          recurrence: "none",
          seriesId: src.id,
          seriesEdited: false,
          movedTo: null,
          destinationId: null,
          sourceId: null,
          createdAt: now,
          updatedAt: now,
        });
        ids.add(id);
      }
      d = next;
      n++;
    }
  }
  return result;
}
const initial = () => ({
  version: 1,
  folders: [],
  projects: [],
  entries: [],
  templates: [],
  settings: {
    theme: "light",
    reduceMotion: false,
    onboarded: false,
    startPage: "month",
    fontSize: 13,
    density: "comfortable",
    hideWeekends: false,
    hideEmpty: false,
    backupRetention: 30,
    widgets: [
      "today",
      "questions",
      "deadlines",
      "unfinished",
      "favorites",
      "recent",
    ],
    columnWidths: [210, 0, 300],
  },
  updatedAt: new Date().toISOString(),
});
function validate(s) {
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.projects) ||
    !Array.isArray(s.entries) ||
    !Array.isArray(s.templates) ||
    !s.settings
  )
    throw Error("올바른 H.PLAN 백업 파일이 아닙니다.");
  if (s.folders === undefined) s.folders = [];
  if (!Array.isArray(s.folders))
    throw Error("폴더 데이터가 올바르지 않습니다.");
  const folderIds = new Set(),
    folderNames = new Set();
  for (const f of s.folders) {
    if (
      typeof f.id !== "string" ||
      !f.id ||
      folderIds.has(f.id) ||
      typeof f.name !== "string" ||
      !text(f.name) ||
      f.name.length > 80 ||
      folderNames.has(f.name.trim().toLocaleLowerCase()) ||
      typeof f.collapsed !== "boolean"
    )
      throw Error("폴더 데이터가 올바르지 않습니다.");
    folderIds.add(f.id);
    folderNames.add(f.name.trim().toLocaleLowerCase());
  }
  const ids = new Set();
  for (const p of s.projects) {
    if (p.folderId === undefined) p.folderId = null;
    if (
      typeof p.id !== "string" ||
      !p.id ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      !text(p.name) ||
      !Array.isArray(p.aliases) ||
      p.aliases.some((x) => typeof x !== "string") ||
      !/^#[a-f\d]{6}$/i.test(p.color || "") ||
      (p.folderId !== null && !folderIds.has(p.folderId))
    )
      throw Error("프로젝트 데이터가 올바르지 않습니다.");
    ids.add(p.id);
  }
  const eids = new Set();
  for (const e of s.entries) {
    if (
      typeof e.id !== "string" ||
      !e.id ||
      eids.has(e.id) ||
      !dateOK(e.date) ||
      typeof e.text !== "string" ||
      !text(e.text) ||
      !entryStatuses[e.kind]?.includes(e.status) ||
      (e.projectId && !ids.has(e.projectId)) ||
      typeof e.createdAt !== "string" ||
      typeof e.updatedAt !== "string" ||
      !Number.isFinite(e.order) ||
      ["notes", "answer", "target"].some(
        (k) => e[k] != null && typeof e[k] !== "string",
      ) ||
      (e.dueDate && !dateOK(e.dueDate)) ||
      (e.reviewDate && !dateOK(e.reviewDate))
    )
      throw Error("일정 데이터가 올바르지 않습니다.");
    eids.add(e.id);
  }
  for (const e of s.entries)
    if (e.parentId) {
      const p = s.entries.find((x) => x.id === e.parentId);
      if (
        !p ||
        p.parentId ||
        p.id === e.id ||
        p.date !== e.date ||
        p.kind !== e.kind ||
        p.projectId !== e.projectId
      )
        throw Error("하위 업무 연결이 올바르지 않습니다.");
    }
  const settings = s.settings;
  if (settings.theme === undefined) settings.theme = "system";
  if (settings.reduceMotion === undefined) settings.reduceMotion = false;
  if (typeof settings.reduceMotion !== "boolean")
    throw Error("모션 설정이 올바르지 않습니다.");
  if (!["system", "light", "dark"].includes(settings.theme))
    throw Error("화면 테마 설정이 올바르지 않습니다.");
  if (
    !Array.isArray(settings.widgets) ||
    settings.widgets.some(
      (w) =>
        ![
          "today",
          "questions",
          "deadlines",
          "unfinished",
          "favorites",
          "recent",
        ].includes(w),
    ) ||
    !Array.isArray(settings.columnWidths) ||
    settings.columnWidths.length !== 3 ||
    settings.columnWidths.some(
      (v) => !Number.isFinite(v) || v < 0 || v > 1000,
    ) ||
    !Number.isFinite(settings.fontSize) ||
    settings.fontSize < 11 ||
    settings.fontSize > 18 ||
    !Number.isFinite(settings.backupRetention) ||
    settings.backupRetention < 3 ||
    settings.backupRetention > 180
  )
    throw Error("설정 데이터가 올바르지 않습니다.");
  for (const e of s.entries)
    if (
      !["none", ...repeatValues].includes(e.recurrence) ||
      (e.recurrenceUntil && !dateOK(e.recurrenceUntil))
    )
      throw Error("반복 일정 설정이 올바르지 않습니다.");
  for (const t of s.templates)
    if (
      typeof t.id !== "string" ||
      typeof t.name !== "string" ||
      !Array.isArray(t.items) ||
      t.items.some((x) => typeof x !== "string") ||
      (t.projectId && !ids.has(t.projectId))
    )
      throw Error("업무 양식이 올바르지 않습니다.");
  return s;
}
function apply(s, a) {
  const now = new Date().toISOString();
  const find = (id) => {
    const e = s.entries.find((e) => e.id === id);
    if (!e) throw Error("항목을 찾을 수 없습니다.");
    return e;
  };
  const chosen = () => {
    if (!Array.isArray(a.ids) || !a.ids.length)
      throw Error("항목을 선택해 주세요.");
    return a.ids.map(find);
  };
  switch (a.type) {
    case "folder.save": {
      const v = a.value || {},
        name = text(v.name, 80);
      if (!name) throw Error("폴더 이름을 입력해 주세요.");
      if (
        s.folders.some(
          (f) =>
            f.id !== v.id &&
            f.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw Error("이미 등록된 폴더 이름입니다.");
      const old = s.folders.find((f) => f.id === v.id);
      if (v.id && !old) throw Error("폴더를 찾을 수 없습니다.");
      if (
        v.projectIds !== undefined &&
        (!Array.isArray(v.projectIds) ||
          v.projectIds.some((id) => !s.projects.some((p) => p.id === id)))
      )
        throw Error("폴더에 넣을 프로젝트를 다시 선택해 주세요.");
      const f = {
        ...old,
        id: old?.id || randomUUID(),
        name,
        collapsed: old?.collapsed || false,
        createdAt: old?.createdAt || now,
        updatedAt: now,
      };
      if (old) s.folders[s.folders.indexOf(old)] = f;
      else s.folders.push(f);
      if (v.projectIds !== undefined) {
        const selected = new Set(v.projectIds);
        for (const p of s.projects) {
          if (selected.has(p.id)) {
            p.folderId = f.id;
            p.updatedAt = now;
          } else if (p.folderId === f.id) {
            p.folderId = null;
            p.updatedAt = now;
          }
        }
      }
      break;
    }
    case "folder.delete": {
      if (!s.folders.some((f) => f.id === a.id))
        throw Error("폴더를 찾을 수 없습니다.");
      for (const p of s.projects)
        if (p.folderId === a.id) {
          p.folderId = null;
          p.updatedAt = now;
        }
      s.folders = s.folders.filter((f) => f.id !== a.id);
      break;
    }
    case "folder.collapse": {
      const f = s.folders.find((f) => f.id === a.id);
      if (!f) throw Error("폴더를 찾을 수 없습니다.");
      f.collapsed = !!a.collapsed;
      f.updatedAt = now;
      break;
    }
    case "project.save": {
      const v = a.value || {};
      const name = text(v.name, 180);
      if (!name) throw Error("프로젝트 이름을 입력해 주세요.");
      if (
        s.projects.some(
          (p) =>
            p.id !== v.id &&
            p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw Error("이미 등록된 프로젝트 이름입니다.");
      const old = s.projects.find((p) => p.id === v.id);
      if (v.id && !old) throw Error("프로젝트를 찾을 수 없습니다.");
      const folderId =
        v.folderId === undefined ? old?.folderId || null : v.folderId || null;
      if (folderId && !s.folders.some((f) => f.id === folderId))
        throw Error("소속 폴더를 다시 선택해 주세요.");
      const p = {
        ...old,
        id: old?.id || randomUUID(),
        name,
        folderId,
        aliases: (Array.isArray(v.aliases)
          ? v.aliases
          : String(v.aliases || "").split(/[,\n]/)
        )
          .map((x) => text(x, 180))
          .filter(Boolean),
        color: color(v.color),
        note: text(v.note),
        status: ["active", "hold", "archived"].includes(v.status)
          ? v.status
          : "active",
        favorite: !!v.favorite,
        createdAt: old?.createdAt || now,
        updatedAt: now,
      };
      if (old) s.projects[s.projects.indexOf(old)] = p;
      else s.projects.push(p);
      break;
    }
    case "project.merge": {
      if (a.from === a.to) throw Error("서로 다른 프로젝트를 선택해 주세요.");
      const src = s.projects.find((p) => p.id === a.from),
        dest = s.projects.find((p) => p.id === a.to);
      if (!src || !dest) throw Error("프로젝트를 찾을 수 없습니다.");
      dest.aliases = [...new Set([...dest.aliases, src.name, ...src.aliases])];
      for (const e of s.entries)
        if (e.projectId === src.id) e.projectId = dest.id;
      for (const t of s.templates)
        if (t.projectId === src.id) t.projectId = dest.id;
      s.projects = s.projects.filter((p) => p.id !== src.id);
      break;
    }
    case "entry.save": {
      const v = a.value || {},
        old = v.id ? find(v.id) : null;
      const kind = v.kind || old?.kind || "task";
      if (!entryStatuses[kind]) throw Error("항목 유형이 올바르지 않습니다.");
      const body = text(v.text);
      if (!body) throw Error("내용을 입력해 주세요.");
      if (!dateOK(v.date)) throw Error("날짜를 확인해 주세요.");
      const pid = kind === "personal" ? null : v.projectId || null;
      if (pid && !s.projects.some((p) => p.id === pid))
        throw Error("프로젝트를 다시 선택해 주세요.");
      if (
        (v.dueDate && !dateOK(v.dueDate)) ||
        (v.reviewDate && !dateOK(v.reviewDate))
      )
        throw Error("기한 날짜를 확인해 주세요.");
      const parent = v.parentId ? find(v.parentId) : null;
      if (
        parent &&
        (parent.id === v.id ||
          parent.parentId ||
          parent.date !== v.date ||
          parent.projectId !== pid ||
          parent.kind !== kind ||
          parent.deletedAt ||
          s.entries.some((c) => c.parentId === v.id))
      )
        throw Error(
          "같은 날짜·프로젝트의 상위 업무를 선택해 주세요. 하위 업무는 2단계까지 지원합니다.",
        );
      const status = entryStatuses[kind].includes(v.status)
        ? v.status
        : entryStatuses[kind][0];
      const e = {
        ...old,
        id: old?.id || randomUUID(),
        kind,
        date: v.date,
        text: body,
        projectId: pid,
        status,
        parentId: parent?.id || null,
        order: Number.isFinite(v.order)
          ? v.order
          : (old?.order ?? s.entries.filter((e) => e.date === v.date).length),
        notes: text(v.notes),
        answer: text(v.answer),
        target: text(v.target, 120),
        dueDate: v.dueDate || null,
        reviewDate: v.reviewDate || null,
        priority: !!v.priority,
        color: v.color ? color(v.color) : null,
        recurrence:
          ["daily", "weekdays", "weekly", "monthly"].includes(v.recurrence) &&
          kind !== "question" &&
          !parent
            ? v.recurrence
            : "none",
        recurrenceUntil: dateOK(v.recurrenceUntil) ? v.recurrenceUntil : null,
        deletedAt: null,
        createdAt: old?.createdAt || now,
        updatedAt: now,
        doneAt: ["done", "answered"].includes(status)
          ? old?.doneAt || now
          : null,
      };
      if (old) {
        e.seriesEdited = !!old.seriesId;
        const repeatEnd = s.entries
          .filter((c) => c.seriesId === old.id)
          .map((c) => c.date)
          .sort()
          .at(-1);
        s.entries[s.entries.indexOf(old)] = e;
        for (const child of s.entries.filter((c) => c.parentId === e.id)) {
          child.date = e.date;
          child.projectId = e.projectId;
          child.kind = e.kind;
        }
        if (
          !old.seriesId &&
          (old.recurrence !== "none" || e.recurrence !== "none")
        ) {
          s.entries = s.entries.filter(
            (c) =>
              c.seriesId !== old.id ||
              c.date < today() ||
              c.deletedAt ||
              c.seriesEdited ||
              ["done", "answered", "canceled", "moved"].includes(c.status),
          );
          if (repeatEnd && e.recurrence !== "none")
            s.entries = expandRecurrences(s.entries, repeatEnd);
        }
      } else s.entries.push(e);
      if (!e.seriesId && e.recurrence !== "none") {
        const end = new Date(e.date + "T12:00:00Z");
        end.setUTCMonth(end.getUTCMonth() + 1, 0);
        apply(s, {
          type: "materialize",
          through: end.toISOString().slice(0, 10),
        });
      }
      break;
    }
    case "entry.status":
      for (const e of chosen()) {
        if (!entryStatuses[e.kind].includes(a.status))
          throw Error("상태가 올바르지 않습니다.");
        e.status = a.status;
        e.doneAt = ["done", "answered"].includes(a.status) ? now : null;
        e.updatedAt = now;
      }
      break;
    case "entry.delete":
    case "entry.restore":
      for (const e of chosen()) {
        for (const item of s.entries.filter(
          (x) =>
            x.id === e.id ||
            x.parentId === e.id ||
            (a.type === "entry.delete"
              ? x.seriesId === e.id &&
                x.date >= today() &&
                !x.seriesEdited &&
                !["done", "canceled", "moved"].includes(x.status)
              : x.deletedBySeries === e.id),
        )) {
          item.deletedAt = a.type === "entry.delete" ? now : null;
          if (item.seriesId === e.id)
            item.deletedBySeries = a.type === "entry.delete" ? e.id : null;
          item.updatedAt = now;
        }
        if (a.type === "entry.restore" && e.parentId)
          find(e.parentId).deletedAt = null;
      }
      break;
    case "entry.purge": {
      const ids = new Set(
        chosen()
          .filter((e) => e.deletedAt)
          .map((e) => e.id),
      );
      s.entries = s.entries.filter(
        (e) => !ids.has(e.id) && !ids.has(e.parentId),
      );
      break;
    }
    case "entry.carry":
    case "entry.copy": {
      if (!dateOK(a.date)) throw Error("이동할 날짜를 확인해 주세요.");
      const chosenEntries = chosen();
      const all = [...chosenEntries];
      for (const e of chosenEntries)
        for (const child of s.entries.filter(
          (x) => x.parentId === e.id && !x.deletedAt,
        ))
          if (!all.includes(child)) all.push(child);
      if (a.type === "entry.carry" && all.some((e) => e.date === a.date))
        throw Error("다른 날짜를 선택해 주세요.");
      if (all.some((e) => e.deletedAt || e.status === "moved"))
        throw Error("삭제되거나 이미 이월한 항목은 선택할 수 없습니다.");
      const map = new Map(all.map((e) => [e.id, randomUUID()]));
      for (const e of all) {
        const copied = {
          ...clone(e),
          id: map.get(e.id),
          date: a.date,
          parentId: map.get(e.parentId) || null,
          sourceId: a.type === "entry.carry" ? e.id : null,
          recurrence: "none",
          seriesId: null,
          status: entryStatuses[e.kind][0],
          doneAt: null,
          createdAt: now,
          updatedAt: now,
        };
        if (a.type === "entry.carry") {
          if (e.kind === "question") {
            e.notes = (e.notes ? e.notes + "\n" : "") + a.date + " 재확인";
            e.reviewDate = a.date;
            continue;
          }
          e.status = "moved";
          e.movedTo = a.date;
          e.destinationId = copied.id;
        }
        s.entries.push(copied);
      }
      break;
    }
    case "entry.reorder": {
      const es = chosen();
      es.forEach((e, i) => (e.order = i));
      break;
    }
    case "template.save": {
      const name = text(a.value?.name, 120),
        items = (a.value?.items || []).map((x) => text(x)).filter(Boolean);
      if (!name || !items.length)
        throw Error("양식 이름과 업무 내용을 입력해 주세요.");
      s.templates.push({
        id: randomUUID(),
        name,
        items,
        projectId: a.value.projectId || null,
      });
      break;
    }
    case "template.delete":
      s.templates = s.templates.filter((t) => t.id !== a.id);
      break;
    case "template.apply": {
      const t = s.templates.find((t) => t.id === a.id);
      if (!t) throw Error("양식을 찾을 수 없습니다.");
      for (const body of t.items)
        apply(s, {
          type: "entry.save",
          value: {
            date: a.date,
            projectId: a.projectId !== undefined ? a.projectId : t.projectId,
            text: body,
            kind: "task",
          },
        });
      break;
    }
    case "settings.save": {
      const v = a.value || {};
      const allowed = [
        "theme",
        "reduceMotion",
        "onboarded",
        "startPage",
        "fontSize",
        "density",
        "hideWeekends",
        "hideEmpty",
        "backupRetention",
        "widgets",
        "columnWidths",
      ];
      for (const k of allowed)
        if (v[k] !== undefined) s.settings[k] = clone(v[k]);
      s.settings.fontSize = Math.max(
        11,
        Math.min(18, Number(s.settings.fontSize) || 13),
      );
      s.settings.backupRetention = Math.max(
        3,
        Math.min(180, Number(s.settings.backupRetention) || 30),
      );
      s.settings.widgets = (
        Array.isArray(s.settings.widgets) ? s.settings.widgets : []
      ).filter((x) =>
        [
          "today",
          "questions",
          "deadlines",
          "unfinished",
          "favorites",
          "recent",
        ].includes(x),
      );
      break;
    }
    case "materialize": {
      if (!dateOK(a.through))
        throw Error("반복 일정 기간이 올바르지 않습니다.");
      s.entries = expandRecurrences(s.entries, a.through);
      break;
    }
    default:
      throw Error("지원하지 않는 작업입니다.");
  }
  s.updatedAt = now;
  validate(s);
  return s;
}
export {
  initial,
  validate,
  apply,
  clone,
  today,
  dateOK,
  expandRecurrences,
};
