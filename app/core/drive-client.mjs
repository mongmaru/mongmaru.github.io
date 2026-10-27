// Browser port of PC 2.1.0; regenerate with node scripts/prepare-core.mjs
const randomUUID = () => globalThis.crypto.randomUUID();
const API = "https://www.googleapis.com/drive/v3";
const MAX_BYTES = 32 * 1024 * 1024;
const escapeQuery = (s) =>
  String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const fileId = (id) => {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id))
    throw Error("Drive 파일 주소가 올바르지 않습니다.");
  return id;
};
class DriveClient {
  constructor({
    token,
    fetch = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }) {
    this.token = token;
    this.fetch = fetch;
    this.sleep = sleep;
  }
  async request(url, options = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await this.fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${await this.token()}`,
          },
          signal: AbortSignal.timeout(45000),
          redirect: options.redirect || "error",
        });
      } catch (e) {
        if (e.message?.includes("연결") || e.message?.includes("로그인"))
          throw e;
        throw Error(
          "Google Drive에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요. 변경 내용은 이 기기에 보관됩니다.",
        );
      }
      if (res.ok) return res;
      const body = await res.json().catch(() => ({}));
      const reason = body.error?.errors?.[0]?.reason;
      if (
        (res.status === 429 ||
          res.status >= 500 ||
          reason === "rateLimitExceeded" ||
          reason === "userRateLimitExceeded") &&
        attempt < 2
      ) {
        await this.sleep(500 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) {
        const e = Error(
          "Google 로그인이 만료되었습니다. Google Drive를 다시 연결해 주세요.",
        );
        e.code = "AUTH";
        throw e;
      }
      if (reason === "storageQuotaExceeded")
        throw Error(
          "Google Drive 저장공간이 부족합니다. 공간을 확보한 후 다시 동기화해 주세요.",
        );
      if (res.status === 403)
        throw Error(
          "Google Drive 접근이 허용되지 않았습니다. 앱 권한과 Google Drive API 사용 설정을 확인해 주세요.",
        );
      if (res.status === 404) {
        const e = Error("Google Drive에서 파일을 찾을 수 없습니다.");
        e.code = "NOT_FOUND";
        throw e;
      }
      throw Error(
        `Google Drive 요청을 완료하지 못했습니다 (${res.status}). 잠시 후 다시 시도해 주세요.`,
      );
    }
  }
  async list(query) {
    const files = [];
    let pageToken;
    const seen = new Set();
    do {
      const params = new URLSearchParams({
        q: `trashed = false and (${query})`,
        fields:
          "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size,appProperties,parents)",
        pageSize: "1000",
        spaces: "drive",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const body = await (await this.request(`${API}/files?${params}`)).json();
      if (!Array.isArray(body.files))
        throw Error("Drive 파일 목록이 올바르지 않습니다.");
      files.push(...body.files);
      pageToken = body.nextPageToken;
      if (pageToken && seen.has(pageToken))
        throw Error("Drive 파일 목록을 끝까지 확인하지 못했습니다.");
      seen.add(pageToken);
      if (files.length > 100000)
        throw Error("Drive 동기화 파일이 너무 많습니다.");
    } while (pageToken);
    return files;
  }
  async folder(name, parent, role) {
    const q = `'${escapeQuery(parent)}' in parents and name = '${escapeQuery(name)}' and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='hplan' and value='${escapeQuery(role)}' }`;
    const existing = (await this.list(q)).sort(
      (a, b) =>
        String(a.createdTime || "").localeCompare(
          String(b.createdTime || ""),
        ) || a.id.localeCompare(b.id),
    );
    if (existing.length) return existing.map((f) => f.id);
    const created = await (
      await this.request(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: "application/vnd.google-apps.folder",
          parents: [parent],
          appProperties: { hplan: role },
        }),
      })
    ).json();
    return [fileId(created.id)];
  }
  async layout() {
    const roots = await this.folder("H.PLAN", "root", "root-v1");
    const syncs = [];
    let backups;
    for (const root of roots) {
      syncs.push(...(await this.folder("sync", root, "sync-v1")));
      if (root === roots[0])
        backups = (await this.folder("backups", root, "backups-v1"))[0];
    }
    return { root: roots[0], sync: syncs[0], syncs, backups };
  }
  async download(id) {
    const res = await this.request(`${API}/files/${fileId(id)}?alt=media`, {redirect: "follow"});
    if (Number(res.headers.get("content-length")) > MAX_BYTES)
      throw Error("동기화 데이터가 너무 큽니다.");
    const chunks = [];
    let size = 0;
    const reader = res.body.getReader();
    while (true) {
      const {value: chunk, done} = await reader.read();
      if (done) break;
      size += chunk.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw Error("동기화 데이터가 너무 큽니다."); }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(new TextDecoder().decode(chunks.reduce((all,chunk) => { all.bytes.set(chunk,all.offset); all.offset += chunk.length; return all; }, {bytes: new Uint8Array(size), offset: 0}).bytes));
    } catch {
      throw Error(
        "Google Drive의 동기화 데이터가 손상되었습니다. 원본 파일은 변경하지 않았습니다.",
      );
    }
  }
  async upload(parent, name, data, role, id) {
    const json = JSON.stringify(data);
    if (new TextEncoder().encode(json).length > MAX_BYTES)
      throw Error("동기화 데이터가 너무 큽니다.");
    const metadata = {
      name,
      mimeType: "application/json",
      appProperties: { hplan: role },
    };
    if (!id) metadata.parents = [fileId(parent)];
    const boundary = "hplan_" + randomUUID();
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--`;
    const url = `https://www.googleapis.com/upload/drive/v3/files${id ? "/" + fileId(id) : ""}?uploadType=multipart&fields=id`;
    return (
      await (
        await this.request(url, {
          method: id ? "PATCH" : "POST",
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        })
      ).json()
    ).id;
  }
  async readSnapshots(layout) {
    const files = [];
    for (const folder of layout.syncs)
      files.push(
        ...(await this.list(
          `'${escapeQuery(folder)}' in parents and appProperties has { key='hplan' and value='snapshot-v1' }`,
        )),
      );
    const snapshots = [];
    for (const f of files) {
      if (Number(f.size) > MAX_BYTES)
        throw Error("동기화 데이터가 너무 큽니다.");
      snapshots.push({
        id: f.id,
        name: f.name,
        data: await this.download(f.id),
      });
    }
    return snapshots;
  }
  async writeSnapshot(layout, graph, files) {
    const own = files.find((f) => f.data.deviceId === graph.deviceId);
    return this.upload(
      layout.sync,
      `${graph.deviceId}.json`,
      graph,
      "snapshot-v1",
      own?.id,
    );
  }
  async backup(layout, deviceId, envelope) {
    const folder = (
      await this.folder(deviceId, layout.backups, "device-backups-v1")
    )[0];
    await this.upload(
      folder,
      `${new Date().toISOString().replace(/[:.]/g, "-")}.hplan-backup`,
      envelope,
      "backup-v1",
    );
    await this.pruneBackups(folder, 30);
  }
  async pruneBackups(folder, retain) {
    const files = (
      await this.list(
        `'${escapeQuery(folder)}' in parents and appProperties has { key='hplan' and value='backup-v1' }`,
      )
    ).sort(
      (a, b) =>
        String(b.createdTime).localeCompare(String(a.createdTime)) ||
        b.id.localeCompare(a.id),
    );
    for (const file of files.slice(retain))
      await this.request(`${API}/files/${fileId(file.id)}`, {
        method: "DELETE",
      });
  }
}
export { DriveClient };
