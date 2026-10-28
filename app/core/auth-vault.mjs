// Device credentials only. Google refresh/access tokens never enter this database.
export class IndexedAuthVault {
  constructor() {
    this.opening = null;
  }
  open() {
    if (!this.opening)
      this.opening = new Promise((resolve, reject) => {
        const request = indexedDB.open("hplan-auth-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("credentials");
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => db.close();
          resolve(db);
        };
        request.onerror = () =>
          reject(
            Error(
              "Google 연결을 기기에 보관하지 못했습니다. 브라우저 저장소를 확인해 주세요.",
            ),
          );
        request.onblocked = () =>
          reject(Error("다른 H.PLAN 창을 닫고 다시 시도해 주세요."));
      }).catch((e) => {
        this.opening = null;
        throw e;
      });
    return this.opening;
  }
  async read() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction("credentials")
        .objectStore("credentials")
        .get("device");
      req.onsuccess = () => resolve(req.result || {});
      req.onerror = () => reject(req.error);
    });
  }
  async transact(fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("credentials", "readwrite"),
        store = tx.objectStore("credentials"),
        req = store.get("device");
      let data, error;
      req.onsuccess = () => {
        try {
          data = fn(req.result || {});
          store.put(data, "device");
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(structuredClone(data));
      tx.onerror = tx.onabort = () =>
        reject(error || Error("Google 연결 정보를 저장하지 못했습니다."));
    });
  }
}
