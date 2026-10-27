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
      const req = indexedDB.open("hplan-mobile-v1", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("records");
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
    db.onversionchange = () => db.close();
  }
  read() {
    return new Promise((resolve, reject) => {
      const req = this.db
        .transaction("records")
        .objectStore("records")
        .get("main");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  transact(fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction("records", "readwrite"),
        store = tx.objectStore("records"),
        req = store.get("main");
      let data, error;
      req.onsuccess = () => {
        try {
          data = fn(req.result || null);
          store.put(data, "main");
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(clone(data));
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
        r.state = r.past.pop();
        capture(r);
      }
      return r;
    });
  }
  redo() {
    return this.update((r) => {
      if (r.future.length) {
        r.past.push(clone(r.state));
        r.state = r.future.pop();
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
