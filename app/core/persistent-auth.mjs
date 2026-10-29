import { IndexedAuthVault } from "./auth-vault.mjs";

const cancelled = () =>
  Object.assign(Error("Google 연결이 변경되어 이전 요청을 중지했습니다."), {
    code: "CANCELLED",
  });
const randomSecret = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export class PersistentAuth {
  constructor(
    server,
    {
      vault = new IndexedAuthVault(),
      fetch = globalThis.fetch,
      now = Date.now,
      openPopup = () => window.open("about:blank", "_blank"),
      navigate = (url) => location.assign(url),
      sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = {},
  ) {
    this.server = server.replace(/\/$/, "");
    this.vault = vault;
    this.fetch = fetch.bind(globalThis);
    Object.assign(this, { now, openPopup, navigate, sleep });
    this.account = null;
    this.credential = null;
    this.tokenValue = null;
    this.expires = 0;
    this.generation = 0;
    this.requiresReauth = false;
  }
  get connected() {
    return !!this.credential && !!this.account && !this.requiresReauth;
  }
  async prepare() {
    const url = new URL(this.server);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      )
    )
      throw Error("자동 연결 서버 주소가 올바르지 않습니다.");
    await this.vault.read();
    this.flushRevocations().catch(() => {});
  }
  async request(path, credential, { method = "GET", body: requestBody } = {}, retried=false) {
    const generation=this.generation,safeRead=method==='GET'||path==='/v1/google'&&(requestBody?.method||'GET')==='GET';
    const retry=async()=>{await this.sleep(250);if(generation!==this.generation)throw cancelled();return this.request(path,credential,{method,body:requestBody},true);};
    let res,body;
    try {
      res = await this.fetch(credential.server + path, {
        method,
        ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
        headers: {
          Authorization: `Bearer ${credential.secret}`,
          "X-HPlan-Client": "mobile-v1",
        },
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(25000),
      });
      try{body=await res.json();}catch(failure){if(/Timeout|Abort|TypeError/.test(failure.name||''))throw failure;body={};}
    } catch (failure) {
      if(!retried&&safeRead)return retry();
      const stage=path.startsWith('/v1/session')?'계정 확인':path==='/v1/google'?'Google 대체 통신':'알림 연결',reason=/Timeout|Abort/.test(failure.name||'')?'시간 초과':'네트워크';
      throw Object.assign(
        Error(
          `자동 연결을 잠시 확인하지 못했습니다. 기록은 기기에 보관됩니다. [${stage} · ${reason}]`,
        ),
        { code: "TEMPORARY" },
      );
    }
    if(!res.ok&&!retried&&safeRead&&(body.code||'TEMPORARY')==='TEMPORARY'&&[408,429,500,502,503,504].includes(res.status))return retry();
    if (!res.ok)
      throw Object.assign(
        Error(body.message || "자동 연결 서버에 잠시 연결하지 못했습니다."),
        { code: body.code || "TEMPORARY",status:res.status },
      );
    return body;
  }
  async restore() {
    const generation = this.generation,
      data = await this.vault.read();
    if (generation !== this.generation) throw cancelled();
    const pending = data.pending;
    // The OAuth attempt expires after 10 minutes, but completed consent creates
    // a long-lived session. Always ask the broker before abandoning a pending key.
    if (pending?.server === this.server) {
      this.credential = pending;
      try {
        const result = await this.request("/v1/session", pending);
        if (!result.pending) {
          await this.accept(result, generation);
          return this.account;
        }
        // Consent may be open in a separate browser process. Keep it for the next foreground event.
      } catch (e) {
        if (e.code === "CANCELLED") throw e;
        if (e.code !== "TEMPORARY") await this.discard(pending);
      }
      this.credential = null;
    }
    if (data.active?.server !== this.server) return null;
    if (generation !== this.generation) throw cancelled();
    this.credential = data.active;
    this.scopes = data.active.scopes || [];
    this.account = data.active.account;
    this.requiresReauth = !!data.active.reauth;
    return this.account;
  }
  async accept(body, generation) {
    if (generation !== this.generation) throw cancelled();
    if (!body.account?.sub || !body.accessToken || !(body.expiresIn > 0))
      throw Error("Google 연결 응답을 확인하지 못했습니다.");
    if (this.account && this.account.sub !== body.account.sub)
      throw Object.assign(
        Error(
          "연결 계정이 달라 동기화를 중지했습니다. Google 계정을 다시 확인해 주세요.",
        ),
        { code: "REAUTH" },
      );
    this.account = { sub: body.account.sub, email: body.account.email };
    this.credential = { ...this.credential, account: this.account };
    this.scopes = body.scopes || this.credential.scopes || [];
    this.credential.scopes = this.scopes;
    this.tokenValue = body.accessToken;
    this.expires = this.now() + Math.max(0, body.expiresIn - 90) * 1000;
    this.requiresReauth = false;
    const credential = this.credential;
    await this.vault.transact((data) => {
      if (generation !== this.generation) throw cancelled();
      if (data.pending?.secret === credential.secret)
        data.pending = { ...credential };
      if (data.active?.secret === credential.secret)
        data.active = {...data.active,account:credential.account,scopes:credential.scopes,reauth:false};
      return data;
    });
    if (generation !== this.generation) throw cancelled();
  }
  async connect({calendar = false, tasks = false} = {}) {
    const generation = this.generation;
    // Open during the original tap, before IndexedDB/network work (mobile popup policies).
    const popup = this.openPopup();
    this.popup = popup;
    this.credential = {
      server: this.server,
      secret: randomSecret(),
      created: this.now(),
    };
    const credential = this.credential;
    try {
      await this.vault.transact((data) => {
        if (generation !== this.generation) throw cancelled();
        data.pending = credential;
        return data;
      });
      const features = new URLSearchParams({...(calendar ? {calendar:'1'} : {}),...(tasks ? {tasks:'1'} : {})});
      const start = await this.request("/v1/start" + (features.size ? '?' + features : ''), credential, {
        method: "POST",
      });
      if (generation !== this.generation) throw cancelled();
      const url = new URL(start.authorizeUrl);
      if (url.origin !== "https://accounts.google.com")
        throw Error("Google 연결 주소를 확인하지 못했습니다.");
      if (popup) popup.location.href = url.href;
      else {
        this.navigate(url.href);
        return new Promise(() => {});
      }
      const until = this.now() + 600000;
      while (this.now() < until) {
        if (generation !== this.generation) throw cancelled();
        let result;
        try {
          result = await this.request("/v1/session", credential);
        } catch (e) {
          if (e.code !== "TEMPORARY") throw e;
          await this.sleep(2000);
          continue;
        }
        if (!result.pending) {
          await this.accept(result, generation);
          try {
            popup.close();
          } catch {}
          return this.account;
        }
        // A successful callback explicitly asks the user to close its window.
        // Poll the broker once after close before considering it a cancellation.
        if (popup.closed)
          throw Error("Google 연결 창을 닫았습니다. 다시 연결해 주세요.");
        await this.sleep(2000);
      }
      throw Error("연결 시간이 지났습니다. 다시 연결해 주세요.");
    } catch (e) {
      try {
        popup?.close();
      } catch {}
      await this.discard(credential);
      throw e;
    }
  }
  async commit() {
    const generation = this.generation,
      credential = this.credential;
    if (!credential?.account) throw Error("Google 연결을 먼저 완료해 주세요.");
    await this.vault.transact((data) => {
      if (generation !== this.generation) throw cancelled();
      if (data.active?.secret === credential.secret) return data;
      if (data.pending?.secret !== credential.secret) throw cancelled();
      if (data.active)
        data.revocations = [...(data.revocations || []), data.active];
      data.active = { ...credential, reauth: false };
      delete data.pending;
      return data;
    });
    if (generation !== this.generation) throw cancelled();
    this.flushRevocations().catch(() => {});
  }
  token(force = false) {
    if (!this.connected)
      return Promise.reject(
        Object.assign(
          Error("Google 계정을 다시 연결해 주세요. 기록은 기기에 보관됩니다."),
          { code: "REAUTH" },
        ),
      );
    if (!force && this.tokenValue && this.now() < this.expires)
      return Promise.resolve(this.tokenValue);
    if (this.refreshing) return this.refreshing;
    const generation = this.generation,
      credential = this.credential;
    this.refreshing = (async () => {
      try {
        const result = await this.request(
          "/v1/session" + (force ? "?refresh=1" : ""),
          credential,
        );
        await this.accept(result, generation);
        return this.tokenValue;
      } catch (e) {
        if (generation !== this.generation) throw cancelled();
        if (e.code === "REAUTH") {
          this.requiresReauth = true;
          this.tokenValue = null;
          this.expires = 0;
          await this.vault.transact((data) => {
            if (data.active?.secret === credential.secret)
              data.active.reauth = true;
            return data;
          });
        }
        throw e;
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  async discard(credential) {
    if (!credential) return;
    await this.vault.transact((data) => {
      if (data.active?.secret === credential.secret) delete data.active;
      if (data.pending?.secret === credential.secret) delete data.pending;
      if (!(data.revocations || []).some((c) => c.secret === credential.secret))
        data.revocations = [...(data.revocations || []), credential];
      return data;
    });
    this.flushRevocations().catch(() => {});
  }
  async flushRevocations() {
    if (this.revoking) return this.revoking;
    this.revoking = (async () => {
      const data = await this.vault.read();
      for (const credential of data.revocations || []) {
        try {
          await this.request("/v1/session", credential, { method: "DELETE" });
          await this.vault.transact((value) => {
            value.revocations = (value.revocations || []).filter(
              (c) => c.secret !== credential.secret,
            );
            return value;
          });
        } catch {} // Offline unlink is local immediately; server cleanup retries on next open.
      }
    })().finally(() => {
      this.revoking = null;
    });
    return this.revoking;
  }
  disconnect() {
    const credential = this.credential;
    this.generation++;
    this.tokenValue = null;
    this.expires = 0;
    this.account = null;
    this.credential = null;
    this.requiresReauth = false;
    try {
      this.popup?.close();
    } catch {}
    return this.discard(credential);
  }
  async disconnectAll() {
    this.generation++;
    this.tokenValue = null;
    this.expires = 0;
    this.account = null;
    this.credential = null;
    this.requiresReauth = false;
    try {
      this.popup?.close();
    } catch {}
    // An explicit device unlink also covers a credential whose asynchronous
    // hydration has not reached this particular auth instance yet.
    await this.vault.transact((data) => {
      const remembered = [data.active, data.pending].filter(
        (c) => c?.server === this.server,
      );
      const revocations = data.revocations || [];
      for (const credential of remembered)
        if (!revocations.some((c) => c.secret === credential.secret))
          revocations.push(credential);
      if (data.active?.server === this.server) delete data.active;
      if (data.pending?.server === this.server) delete data.pending;
      data.revocations = revocations;
      return data;
    });
    this.flushRevocations().catch(() => {});
  }
}
