// Browser port of PC 2.1.0; regenerate with node scripts/prepare-core.mjs
const randomUUID = () => globalThis.crypto.randomUUID();
import { validate, clone, dateOK } from "./domain.mjs";
const COLLECTIONS = ["folders", "projects", "entries", "templates"];
const FORMAT = "H.PLAN SYNC";
const safeId = (x) =>
  typeof x === "string" &&
  /^[A-Za-z0-9_.:-]{1,160}$/.test(x) &&
  !["__proto__", "constructor", "prototype"].includes(x);
const stable = (x) => JSON.stringify(sort(x));
const comparable = (value) => {
  if (value?.seriesId && !value.seriesEdited) {
    const copy = clone(value);
    delete copy.createdAt;
    delete copy.updatedAt;
    return stable(copy);
  }
  return stable(value);
};
function checkValue(collection, v) {
  if (v === null) return;
  const str = (x) => typeof x === "string",
    ref = (x) => x == null || safeId(x),
    named = (x) => str(x) && x.trim().length > 0;
  let valid = true;
  if (collection === "folders")
    valid =
      named(v.name) && v.name.length <= 80 && typeof v.collapsed === "boolean";
  if (collection === "projects")
    valid =
      named(v.name) &&
      Array.isArray(v.aliases) &&
      v.aliases.every(str) &&
      /^#[a-f\d]{6}$/i.test(v.color || "") &&
      ref(v.folderId);
  if (collection === "templates")
    valid =
      str(v.name) &&
      Array.isArray(v.items) &&
      v.items.every(str) &&
      ref(v.projectId);
  if (collection === "entries") {
    const statuses = {
      task: ["planned", "progress", "waiting", "done", "canceled", "moved"],
      personal: ["planned", "progress", "waiting", "done", "canceled", "moved"],
      question: ["open", "waiting", "answered", "hold"],
    };
    valid =
      dateOK(v.date) &&
      named(v.text) &&
      statuses[v.kind]?.includes(v.status) &&
      ref(v.projectId) &&
      ref(v.parentId) &&
      str(v.createdAt) &&
      str(v.updatedAt) &&
      Number.isFinite(v.order) &&
      ["notes", "answer", "target"].every((k) => v[k] == null || str(v[k])) &&
      (!v.dueDate || dateOK(v.dueDate)) &&
      (!v.reviewDate || dateOK(v.reviewDate)) &&
      ["none", "daily", "weekdays", "weekly", "monthly"].includes(
        v.recurrence,
      ) &&
      (!v.recurrenceUntil || dateOK(v.recurrenceUntil));
  }
  if (!valid)
    throw Error(
      "동기화 데이터 항목의 내용이 올바르지 않습니다. 원본은 변경하지 않았습니다.",
    );
}
function sort(x) {
  if (Array.isArray(x)) return x.map(sort);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.keys(x)
        .sort()
        .map((k) => [k, sort(x[k])]),
    );
  return x;
}
function empty(deviceId = randomUUID()) {
  return { format: FORMAT, version: 1, deviceId, sequence: 0, records: {} };
}
function check(g) {
  if (!g || g.format !== FORMAT || g.version !== 1)
    throw Error(
      "지원하지 않는 동기화 데이터 버전입니다. 앱을 업데이트해 주세요.",
    );
  if (
    !safeId(g.deviceId) ||
    !Number.isSafeInteger(g.sequence) ||
    g.sequence < 0 ||
    !g.records ||
    Array.isArray(g.records) ||
    typeof g.records !== "object" ||
    Object.keys(g.records).length > 200000
  )
    throw Error("동기화 데이터가 올바르지 않습니다.");
  for (const [key, versions] of Object.entries(g.records)) {
    const p = key.indexOf("/"),
      collection = key.slice(0, p),
      id = key.slice(p + 1);
    if (
      !COLLECTIONS.includes(collection) ||
      !safeId(id) ||
      !Array.isArray(versions) ||
      !versions.length ||
      versions.length > 100
    )
      throw Error("동기화 데이터 항목이 올바르지 않습니다.");
    for (const v of versions) {
      if (
        !v ||
        !safeId(v.id) ||
        !safeId(v.device) ||
        typeof v.at !== "string" ||
        !Number.isFinite(Date.parse(v.at)) ||
        !v.clock ||
        Array.isArray(v.clock) ||
        typeof v.clock !== "object" ||
        !Object.keys(v.clock).length ||
        Object.keys(v.clock).length > 1000
      )
        throw Error("동기화 데이터 변경 정보가 올바르지 않습니다.");
      for (const [d, n] of Object.entries(v.clock))
        if (!safeId(d) || !Number.isSafeInteger(n) || n <= 0)
          throw Error("동기화 데이터 순서가 올바르지 않습니다.");
      if (
        !v.clock[v.device] ||
        v.value === undefined ||
        (v.value !== null &&
          (typeof v.value !== "object" ||
            Array.isArray(v.value) ||
            v.value.id !== id))
      )
        throw Error("동기화 데이터 값이 올바르지 않습니다.");
      checkValue(collection, v.value);
    }
  }
  return g;
}
const dominates = (a, b) =>
  Object.keys(b).every((k) => (a[k] || 0) >= b[k]) &&
  Object.keys(a).some((k) => a[k] > (b[k] || 0));
function heads(versions) {
  const unique = new Map();
  for (const v of versions) {
    const old = unique.get(v.id);
    if (old && stable(old) !== stable(v))
      throw Error("서로 다른 동기화 변경에 같은 ID가 있습니다.");
    unique.set(v.id, v);
  }
  const list = [...unique.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      if (
        stable(list[i].clock) === stable(list[j].clock) &&
        stable(list[i].value) !== stable(list[j].value)
      )
        throw Error("동기화 순서 정보가 충돌합니다.");
  return list
    .filter((v) => !list.some((o) => o !== v && dominates(o.clock, v.clock)))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function merge(a, b) {
  check(a);
  check(b);
  const result = clone(a);
  for (const key of Object.keys(b.records))
    result.records[key] = heads([
      ...(result.records[key] || []),
      ...b.records[key],
    ]);
  for (const versions of Object.values(result.records))
    for (const v of versions)
      result.sequence = Math.max(
        result.sequence,
        v.clock[result.deviceId] || 0,
      );
  return result;
}
function recordMap(state) {
  return Object.fromEntries(
    COLLECTIONS.flatMap((c) =>
      (state[c] || []).map((value) => [`${c}/${value.id}`, value]),
    ),
  );
}
function put(g, key, value, basis = g.records[key] || []) {
  const clock = {};
  for (const v of basis)
    for (const [d, n] of Object.entries(v.clock))
      clock[d] = Math.max(clock[d] || 0, n);
  g.sequence = Math.max(g.sequence, clock[g.deviceId] || 0) + 1;
  if (!Number.isSafeInteger(g.sequence))
    throw Error("동기화 변경 한도를 초과했습니다.");
  clock[g.deviceId] = g.sequence;
  g.records[key] = [
    {
      id: randomUUID(),
      device: g.deviceId,
      clock,
      at: new Date().toISOString(),
      value: clone(value),
    },
  ];
}
function capture(graph, before, after) {
  check(graph);
  validate(clone(after));
  const g = clone(graph),
    old = recordMap(before),
    next = recordMap(after);
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)]))
    if (stable(old[key]) !== stable(next[key])) {
      const previous = g.records[key] || [],
        conflicted = new Set(previous.map((v) => comparable(v.value))).size > 1;
      const basis = conflicted
        ? previous.filter((v) => stable(v.value) === stable(old[key] ?? null))
        : previous;
      put(g, key, next[key] ?? null, basis);
      if (conflicted) g.records[key] = heads([...previous, ...g.records[key]]);
    }
  return g;
}
function conflicts(g) {
  check(g);
  return Object.entries(g.records)
    .filter(([, vs]) => new Set(vs.map((v) => comparable(v.value))).size > 1)
    .map(([key, versions]) => ({ key, versions: clone(versions) }));
}
function rawProject(g, local) {
  check(g);
  if (conflicts(g).length)
    throw Error(
      "서로 다른 수정 내용이 있습니다. 설정에서 동기화 충돌을 확인해 주세요.",
    );
  const state = clone(local);
  for (const c of COLLECTIONS) state[c] = [];
  for (const key of Object.keys(g.records).sort()) {
    const value = g.records[key][0].value;
    if (value !== null)
      state[key.slice(0, key.indexOf("/"))].push(clone(value));
  }
  state.updatedAt = new Date().toISOString();
  return state;
}
function project(g, local) {
  return validate(rawProject(g, local));
}
function repairedState(g, local) {
  const s = rawProject(g, local),
    names = new Set(),
    folderIds = new Set(s.folders.map((f) => f.id)),
    projectIds = new Set(s.projects.map((p) => p.id));
  for (const f of s.folders) {
    let name = f.name;
    if (typeof name !== "string")
      throw Error("폴더 데이터가 올바르지 않습니다.");
    if (names.has(name.trim().toLocaleLowerCase())) {
      const base = name.slice(0, 55);
      let n = 1;
      do {
        name = `${base} (${f.id.slice(0, 8)}${n === 1 ? "" : "-" + n})`;
        n++;
      } while (names.has(name.trim().toLocaleLowerCase()));
      f.name = name;
    }
    names.add(name.trim().toLocaleLowerCase());
  }
  for (const p of s.projects)
    if (p.folderId && !folderIds.has(p.folderId)) p.folderId = null;
  for (const t of s.templates)
    if (t.projectId && !projectIds.has(t.projectId)) t.projectId = null;
  for (const e of s.entries)
    if (e.projectId && !projectIds.has(e.projectId)) e.projectId = null;
  const entries = new Map(s.entries.map((e) => [e.id, e]));
  for (const e of s.entries)
    if (e.parentId) {
      const p = entries.get(e.parentId);
      if (
        !p ||
        p.id === e.id ||
        p.parentId ||
        p.kind !== e.kind ||
        p.projectId !== e.projectId ||
        p.date !== e.date
      )
        e.parentId = null;
    }
  return validate(s);
}
function repairs(g, local) {
  if (conflicts(g).length) return [];
  const before = recordMap(rawProject(g, local)),
    after = recordMap(repairedState(g, local));
  return Object.keys(after)
    .filter((k) => stable(before[k]) !== stable(after[k]))
    .map((key) => ({ key, before: before[key], after: after[key] }));
}
function repair(g, local) {
  const result = clone(g);
  for (const change of repairs(g, local)) put(result, change.key, change.after);
  return result;
}
function resolve(graph, key, revision) {
  check(graph);
  const versions = graph.records[key],
    selected = versions?.find((v) => v.id === revision);
  if (!selected)
    throw Error("선택한 변경 내용이 없습니다. 목록을 새로 확인해 주세요.");
  const g = clone(graph);
  put(g, key, selected.value);
  return g;
}
function contentEqual(a, b) {
  return COLLECTIONS.every(
    (c) =>
      stable([...(a[c] || [])].sort((x, y) => x.id.localeCompare(y.id))) ===
      stable([...(b[c] || [])].sort((x, y) => x.id.localeCompare(y.id))),
  );
}
export {
  empty,
  check,
  merge,
  capture,
  project,
  conflicts,
  resolve,
  repairs,
  repair,
  contentEqual,
  stable,
  COLLECTIONS,
};
