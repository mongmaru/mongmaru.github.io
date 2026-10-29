import { initial, validate, apply, clone } from "./domain.mjs";
import * as model from "./sync-model.mjs";
const blank = () => ({
  version: 1,
  state: initial(),
  past: [],
  future: [],
  backups: [],
  accounts: {},
  activeAccount: null,
  revision: 0,
});
function validateState(data) {
  validate(data);
  const safe = (id) =>
    typeof id === "string" &&
    /^[A-Za-z0-9_.:-]{1,160}$/.test(id) &&
    !["__proto__", "constructor", "prototype"].includes(id);
  for (const c of model.COLLECTIONS) {
    const ids = new Set();
    for (const value of data[c]) {
      if (!safe(value.id) || ids.has(value.id))
        throw Error("백업의 항목 식별 정보가 올바르지 않습니다.");
      ids.add(value.id);
    }
  }
  return data;
}
export class MemoryStore {
  constructor() {
    this.data = null;
    this.fail = false;
    this.queue = Promise.resolve();
  }
  async read() {
    return clone(this.data);
  }
  transact(fn) {
    const next = this.queue
      .catch(() => {})
      .then(() => {
        if (this.fail) throw Error("저장공간이 부족합니다.");
        const data = fn(clone(this.data));
        this.data = clone(data);
        return clone(data);
      });
    this.queue = next;
    return next;
  }
}
export class IndexedStore {
  static open() {
    return new Promise((resolve, reject) => {
      // Version2 closes version1 writers before the first atomic migration.
      const req = indexedDB.open("hplan-mobile-v1", 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("records"))
          req.result.createObjectStore("records");
      };
      req.onsuccess = () => resolve(new IndexedStore(req.result));
      req.onerror = () =>
        reject(
          Error(
            "기기 저장소를 열지 못했습니다. 브라우저 설정을 확인해 주세요.",
          ),
        );
      req.onblocked = () =>
        reject(Error("다른 H.PLAN 창을 닫고 다시 열어 주세요."));
    });
  }
  constructor(db) {
    this.db = db;
    this.snapshots = new Map();
    this.snapshotKeys = new WeakMap();
    db.onversionchange = () => db.close();
  }
  hydrate(store, raw, ready, fail) {
    if (!raw?.historyRefs) return ready(raw || null, new Set());
    const { historyRefs, ...record } = raw;
    const fields = ["past", "future", "backups"];
    if (historyRefs.version !== 1 || fields.some(key =>
      !Array.isArray(historyRefs[key]) || historyRefs[key].some(id =>
        typeof id !== "string" || !id.startsWith("history:"))))
      throw Error("기기 내 복구 기록의 저장 형식을 확인할 수 없습니다. 기존 데이터는 유지했습니다.");
    const keys = new Set(fields.flatMap(key => historyRefs[key]));
    const finish = () => {
      for (const key of fields) record[key] = historyRefs[key].map(id => this.snapshots.get(id));
      ready(record, keys);
    };
    const missing = [...keys].filter(id => !this.snapshots.has(id));
    if (!missing.length) return finish();
    let pending = missing.length;
    for (const id of missing) {
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          if (!request.result || typeof request.result !== "object")
            throw Error("기기 내 복구 기록을 읽지 못했습니다. 기존 데이터는 유지했습니다.");
          const value = freezeSnapshot(request.result);
          this.snapshots.set(id, value);
          this.snapshotKeys.set(value, id);
          if (!--pending) finish();
        } catch (error) { fail(error); }
      };
    }
  }
  trimSnapshots(keys) {
    for (const id of this.snapshots.keys())
      if (!keys.has(id)) this.snapshots.delete(id);
  }
  read() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("records"), store = tx.objectStore("records"),
        request = store.get("main");
      let data, keys, error;
      const fail = reason => { error ||= reason; try { tx.abort(); } catch {} };
      request.onsuccess = () => {
        try { this.hydrate(store, request.result, (value, ids) => { data = value; keys = ids; }, fail); }
        catch (reason) { fail(reason); }
      };
      tx.oncomplete = () => { this.trimSnapshots(keys); resolve(data); };
      tx.onabort = tx.onerror = () => reject(error || tx.error || Error("기기 내 기록을 읽지 못했습니다."));
    });
  }
  transact(fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("records", "readwrite"),
        store = tx.objectStore("records"),
        req = store.get("main");
      let data, keys, error;
      const added = new Map();
      const fail = reason => { error ||= reason; try { tx.abort(); } catch {} };
      const write = (raw, previousKeys) => {
        try {
          const next = fn(raw), { past = [], future = [], backups = [], ...current } = next;
          // Only current state/account metadata is cloned each commit. Recovery
          // bodies are immutable, independent snapshots; their array containers
          // remain fresh so push/pop/slice and aborted callbacks cannot leak.
          data = clone(current);
          const historyRefs = { version: 1 }, encoded = new Map();
          keys = new Set();
          for (const [field, values] of Object.entries({ past, future, backups })) {
            data[field] = [];
            historyRefs[field] = values.map(value => {
              if (!value || typeof value !== "object")
                throw Error("기기 내 복구 기록의 저장 형식이 올바르지 않습니다.");
              let item = encoded.get(value);
              if (!item) {
                const oldKey = this.snapshotKeys.get(value);
                if (oldKey && previousKeys.has(oldKey)) item = { id: oldKey, value };
                else {
                  const id = "history:" + crypto.randomUUID(), snapshot = freezeSnapshot(clone(value));
                  store.put(snapshot, id);
                  added.set(id, snapshot);
                  item = { id, value: snapshot };
                }
                encoded.set(value, item);
              }
              data[field].push(item.value);
              keys.add(item.id);
              return item.id;
            });
          }
          store.put({ ...current, historyRefs }, "main");
          for (const id of previousKeys) if (!keys.has(id)) store.delete(id);
        } catch (reason) { fail(reason); }
      };
      req.onsuccess = () => {
        try { this.hydrate(store, req.result, write, fail); }
        catch (reason) { fail(reason); }
      };
      tx.oncomplete = () => {
        for (const [id, value] of added) {
          this.snapshots.set(id, value);
          this.snapshotKeys.set(value, id);
        }
        this.trimSnapshots(keys);
        resolve(data);
      };
      tx.onabort = tx.onerror = () =>
        reject(
          error ||
            Error(
              "기기에 저장하지 못했습니다. 저장공간을 확인하고 백업을 내려받아 주세요.",
            ),
        );
    });
  }
}
function freezeSnapshot(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) freezeSnapshot(value[key]);
    Object.freeze(value);
  }
  return value;
}
function addBackup(record, label) {
  record.backups.unshift({
    id: crypto.randomUUID(),
    label,
    at: new Date().toISOString(),
    data: clone(record.state),
  });
  record.backups = record.backups.slice(
    0,
    record.state.settings.backupRetention || 30,
  );
}
function capture(record) {
  for (const meta of Object.values(record.accounts)) {
    meta.baselineGraph.sequence = Math.max(
      meta.baselineGraph.sequence,
      meta.graph.sequence,
    );
    const captured = model.capture(
      meta.baselineGraph,
      meta.baseline,
      record.state,
    );
    meta.graph = model.merge(meta.graph, captured);
    meta.baselineGraph = captured;
    meta.baseline = clone(record.state);
  }
}
export class Repository {
  static async open(store) {
    const repo = new Repository(store);
    await repo.update((r) => {
      validateState(clone(r.state));
      return r;
    });
    return repo;
  }
  constructor(store) {
    this.store = store;
    this.listeners = new Set();
    this.record = null;
  }
  get state() {
    return this.record.state;
  }
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  notify() {
    for (const fn of this.listeners) fn(this);
  }
  async reload() {
    const data = await this.store.read();
    if (data && data.revision !== this.record?.revision) {
      validate(clone(data.state));
      this.record = data;
      this.notify();
    }
    return this.state;
  }
  async update(fn) {
    const record = await this.store.transact((raw) => {
      const next = fn(raw || blank());
      next.revision = (raw?.revision || 0) + 1;
      return next;
    });
    this.record = record;
    this.notify();
    return this.state;
  }
  dispatch(action, base = null) {
    return this.update((r) => {
      if (base?.id && ["entry.save", "project.save"].includes(action.type)) {
        const current = r.state[
          action.type === "entry.save" ? "entries" : "projects"
        ].find((x) => x.id === base.id);
        if (!current || current.deletedAt !== base.deletedAt)
          throw Error(
            "다른 창에서 이 항목이 삭제되거나 변경됐습니다. 작성 내용은 임시 보관하고 다시 확인해 주세요.",
          );
        const merged = clone(current);
        for (const [key, value] of Object.entries(action.value)) {
          if (model.stable(value) === model.stable(base[key])) continue;
          if (
            model.stable(current[key]) !== model.stable(base[key]) &&
            model.stable(current[key]) !== model.stable(value)
          )
            throw Error(
              "다른 창에서 같은 내용을 수정했습니다. 작성 내용은 유지되므로 복사한 뒤 최신 기록을 확인해 주세요.",
            );
          merged[key] = value;
        }
        action = { ...action, value: merged };
      }
      const prev = clone(r.state),
        next = apply(clone(r.state), action);
      if (action.type === "materialize" && model.contentEqual(prev, next))
        return r;
      if (action.type !== "materialize") {
        r.past.push(prev);
        r.past = r.past.slice(-60);
        r.future = [];
      }
      const day = new Date().toISOString().slice(0, 10);
      if (!r.backups.some((x) => x.label === "auto" && x.at.startsWith(day)))
        addBackup(r, "auto");
      r.state = next;
      capture(r);
      return r;
    });
  }
  undo() {
    return this.update((r) => {
      if (r.past.length) {
        r.future.push(clone(r.state));
        r.state = clone(r.past.pop());
        capture(r);
      }
      return r;
    });
  }
  redo() {
    return this.update((r) => {
      if (r.future.length) {
        r.past.push(clone(r.state));
        r.state = clone(r.future.pop());
        capture(r);
      }
      return r;
    });
  }
  backup() {
    return {
      format: "H.PLAN BACKUP",
      version: 1,
      createdAt: new Date().toISOString(),
      data: clone(this.state),
    };
  }
  async restore(envelope) {
    if (envelope?.format !== "H.PLAN BACKUP" || envelope.version !== 1)
      throw Error("올바른 H.PLAN 백업이 아닙니다.");
    const next = validateState(clone(envelope.data));
    return this.update((r) => {
      addBackup(r, "before-restore");
      r.state = next;
      r.past = [];
      r.future = [];
      capture(r);
      return r;
    });
  }
  localBackup() {
    return this.update((r) => {
      addBackup(r, "manual");
      return r;
    });
  }
  async connectAccount(account, allowed = () => true) {
    if (
      !/^[a-zA-Z0-9_.@:-]{1,200}$/.test(account) ||
      ["__proto__", "constructor", "prototype"].includes(account)
    )
      throw Error("Google 계정 정보가 올바르지 않습니다.");
    return this.update((r) => {
      if (!allowed()) return r;
      r.activeAccount = account;
      if (!r.accounts[account]) {
        const graph = model.empty();
        r.accounts[account] = {
          graph,
          baselineGraph: clone(graph),
          baseline: initial(),
          lastSync: null,
          lastBackupDay: null,
          uploaded: null,
        };
      }
      capture(r);
      return r;
    });
  }
  disconnect() {
    return this.update((r) => {
      r.activeAccount = null;
      return r;
    });
  }
  calendarMeta(account = this.record.activeAccount) {
    return clone(this.record.calendarLinks?.[account] || {});
  }
  saveCalendarMeta(account, value) {
    return this.update(r => {
      if(r.activeAccount !== account)throw Error('Google 연결이 변경되었습니다.');
      r.calendarLinks ||= {};
      r.calendarLinks[account] = clone(value);
      return r;
    });
  }
  applyCalendar(account, next, { basis, reason = 'calendar-sync' } = {}) {
    return this.update(r => {
      if(r.activeAccount !== account)throw Error('Google 연결이 변경되었습니다.');
      if(basis && model.stable(r.state) !== model.stable(basis))throw Object.assign(Error('새 수정 사항을 보호하기 위해 Calendar 동기화를 다시 시도합니다.'),{code:'STALE_STATE'});
      validateState(clone(next));
      if(model.stable(r.state) === model.stable(next))return r;
      addBackup(r, 'before-' + reason);
      r.state = clone(next);
      capture(r);
      return r;
    });
  }
  syncMeta(account = this.record.activeAccount) {
    return account ? this.record.accounts[account] : null;
  }
  mergeRemote(account, snapshots, editing) {
    return this.update((r) => {
      if (
        r.activeAccount !== account ||
        (typeof editing === "function" ? editing() : editing)
      )
        return r;
      capture(r);
      const meta = r.accounts[account];
      let merged = meta.graph;
      for (const graph of snapshots) merged = model.merge(merged, graph);
      const unresolved =
        model.conflicts(merged).length || model.repairs(merged, r.state).length;
      const next = unresolved ? null : model.project(merged, r.state);
      meta.graph = merged;
      if (next) {
        if (!model.contentEqual(next, r.state)) {
          addBackup(r, "before-drive-sync");
          r.state = next;
          r.past = [];
          r.future = [];
        }
        meta.baseline = clone(r.state);
        meta.baselineGraph = clone(merged);
      }
      return r;
    });
  }
  resolve(account, key, revision) {
    return this.update((r) => {
      if (r.activeAccount !== account)
        throw Error("Google 계정을 다시 확인해 주세요.");
      capture(r);
      r.accounts[account].graph = model.resolve(
        r.accounts[account].graph,
        key,
        revision,
      );
      return r;
    });
  }
  repair(account) {
    return this.update((r) => {
      if (r.activeAccount !== account)
        throw Error("Google 계정을 다시 확인해 주세요.");
      capture(r);
      addBackup(r, "before-drive-repair");
      r.accounts[account].graph = model.repair(
        r.accounts[account].graph,
        r.state,
      );
      return r;
    });
  }
  markUploaded(account, outgoing, backupDay) {
    return this.update((r) => {
      if (r.activeAccount !== account) return r;
      const meta = r.accounts[account];
      meta.uploaded = outgoing;
      meta.lastSync = new Date().toISOString();
      if (backupDay) meta.lastBackupDay = backupDay;
      return r;
    });
  }
}
