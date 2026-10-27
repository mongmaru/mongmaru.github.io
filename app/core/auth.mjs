const SCOPES = "openid email https://www.googleapis.com/auth/drive.file";
export class WebAuth {
  constructor(clientId) {
    this.clientId = clientId;
    this.tokenValue = null;
    this.expires = 0;
    this.account = null;
    this.generation = 0;
  }
  async library() {
    if (globalThis.google?.accounts?.oauth2) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () =>
        reject(
          Error(
            "Google 로그인 화면을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.",
          ),
        );
      document.head.append(script);
    });
  }
  async prepare() {
    if (!this.clientId)
      throw Error(
        "Google 웹앱 등록을 준비하고 있습니다. 기기 저장은 사용할 수 있습니다.",
      );
    await this.library();
  }
  connect() {
    if (!globalThis.google?.accounts?.oauth2)
      return Promise.reject(Error("로그인 준비 후 다시 눌러 주세요."));
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        include_granted_scopes: true,
        error_callback: () =>
          reject(
            Error(
              "Google 로그인 창을 닫았거나 브라우저에서 차단했습니다. 다시 연결해 주세요.",
            ),
          ),
        callback: async (response) => {
          if (generation !== this.generation)
            return reject(Error("로그인이 취소되었습니다."));
          try {
            if (response.error)
              throw Error("Google 연결이 허용되지 않았습니다.");
            if (
              !google.accounts.oauth2.hasGrantedAllScopes(
                response,
                ...SCOPES.split(" "),
              )
            )
              throw Error("동기화에 필요한 권한을 모두 허용해 주세요.");
            const user = await fetch(
              "https://openidconnect.googleapis.com/v1/userinfo",
              {
                headers: { Authorization: `Bearer ${response.access_token}` },
                cache: "no-store",
              },
            ).then((r) => {
              if (!r.ok) throw Error("계정 정보를 확인하지 못했습니다.");
              return r.json();
            });
            if (generation !== this.generation)
              throw Error("로그인이 취소되었습니다.");
            if (!user.sub) throw Error("계정 식별 정보가 없습니다.");
            this.tokenValue = response.access_token;
            this.expires =
              Date.now() +
              Math.max(0, (Number(response.expires_in) || 0) - 60) * 1000;
            this.account = { sub: user.sub, email: user.email };
            resolve(this.account);
          } catch (e) {
            reject(e);
          }
        },
      });
      client.requestAccessToken({ prompt: "select_account" });
    });
  }
  token() {
    if (!this.tokenValue || Date.now() >= this.expires)
      throw Error(
        "Google 연결을 갱신해 주세요. 기록은 기기에 저장되어 있습니다.",
      );
    return this.tokenValue;
  }
  disconnect() {
    this.generation++;
    this.tokenValue = null;
    this.expires = 0;
    this.account = null;
  }
}
