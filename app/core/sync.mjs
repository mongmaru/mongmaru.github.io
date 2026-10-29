import * as model from "./sync-model.mjs";
import { clone } from "./domain.mjs";
export class SyncController {
  constructor({ repo, account, client, onStatus = () => {} }) {
    Object.assign(this, { repo, account, client, onStatus });
    this.busy = false;
    this.editing = false;
    this.stopped = false;
    this.error = "";
    this.root = null;
  }
  status() {
    const m = this.repo.syncMeta(this.account);
    return {
      busy: this.busy,
      editing: this.editing,
      error: this.error,
      root: this.root,
      lastSync: m?.lastSync,
      lastBackupDay: m?.lastBackupDay,
      pending: !!m && m.uploaded !== model.fingerprint(m.graph),
      conflictCount: m ? model.conflicts(m.graph).length : 0,
      repairCount: m ? model.repairs(m.graph, this.repo.state).length : 0,
    };
  }
  emit() {
    this.onStatus(this.status());
  }
  stop() {
    this.stopped = true;
  }
  active() {
    return !this.stopped && this.repo.record.activeAccount === this.account;
  }
  sync(backup = false) {
    if (this.running)
      return backup ? this.running.then(() => this.sync(true)) : this.running;
    this.running = this.run(backup).finally(() => {
      this.running = null;
    });
    return this.running;
  }
  async run(forceBackup) {
    if (!this.active() || this.editing)
      return { ...this.status(), completed: false };
    this.busy = true;
    this.error = "";
    this.emit();
    try {
      const layout = await this.client.layout();
      if (!this.active()) return this.status();
      this.root = layout.root;
      const files = await this.client.readSnapshots(layout);
      if (!this.active() || this.editing) return this.status();
      await this.repo.mergeRemote(
        this.account,
        files.map((f) => f.data),
        () => this.editing || !this.active(),
      );
      if (!this.active() || this.editing) return this.status();
      const meta = this.repo.syncMeta(this.account),
        outgoing = clone(meta.graph),
        serialized = model.fingerprint(outgoing);
      const own = files.find((f) => f.data.deviceId === outgoing.deviceId);
      if (!own || model.fingerprint(own.data) !== serialized)
        await this.client.writeSnapshot(layout, outgoing, files);
      if (!this.active()) return this.status();
      const day = new Date().toISOString().slice(0, 10);
      let backed = null;
      if (
        !model.conflicts(outgoing).length &&
        !model.repairs(outgoing, this.repo.state).length &&
        (forceBackup || meta.lastBackupDay !== day)
      ) {
        await this.client.backup(layout, outgoing.deviceId, this.repo.backup());
        if (!this.active()) return this.status();
        backed = day;
      }
      await this.repo.markUploaded(this.account, serialized, backed);
      return { ...this.status(), completed: true, backupCompleted: !!backed };
    } catch (e) {
      if (this.active()) {
        this.error = e.message || "동기화하지 못했습니다.";
        this.emit();
      }
      throw e;
    } finally {
      this.busy = false;
      if (this.active()) this.emit();
    }
  }
}
