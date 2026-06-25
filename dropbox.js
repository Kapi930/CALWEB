/* ==================================================
   Cliente de Dropbox para la PWA
   Implementa el flujo OAuth PKCE y descarga/subida de archivos.
   No requiere librería externa - usa fetch directamente.
   ================================================== */

const DBX = {
  // Almacenamiento local de tokens
  STORAGE_KEY: 'calendario_dropbox',
  DB_PATH: '/calendario_tareas/tasks.db',

  state: {
    appKey: null,
    accessToken: null,
    refreshToken: null,
    codeVerifier: null,
    accountName: null,
    lastDownloadedRev: null
  },

  /* ------------ Persistencia ------------ */
  load() {
    try {
      const data = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
      Object.assign(this.state, data);
    } catch (e) { /* ignore */ }
  },

  save() {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.state));
  },

  isConfigured() {
    return Boolean(this.state.refreshToken || this.state.accessToken);
  },

  disconnect() {
    this.state = {
      appKey: null, accessToken: null, refreshToken: null,
      codeVerifier: null, accountName: null, lastDownloadedRev: null
    };
    localStorage.removeItem(this.STORAGE_KEY);
  },

  /* ------------ PKCE helpers ------------ */
  async generateCodeVerifier() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return this._base64url(bytes);
  },

  async generateCodeChallenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this._base64url(new Uint8Array(hash));
  },

  _base64url(bytes) {
    let s = btoa(String.fromCharCode(...bytes));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  /* ------------ Auth flow ------------ */
  async startAuth(appKey) {
    this.state.appKey = appKey;
    this.state.codeVerifier = await this.generateCodeVerifier();
    const challenge = await this.generateCodeChallenge(this.state.codeVerifier);
    this.save();
    const url = new URL('https://www.dropbox.com/oauth2/authorize');
    url.searchParams.set('client_id', appKey);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('token_access_type', 'offline');
    return url.toString();
  },

  async finishAuth(code) {
    if (!this.state.appKey || !this.state.codeVerifier) {
      throw new Error('Falta App Key o code verifier. Reinicia el proceso.');
    }
    const params = new URLSearchParams({
      code: code.trim(),
      grant_type: 'authorization_code',
      client_id: this.state.appKey,
      code_verifier: this.state.codeVerifier
    });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Error de autenticación: ${t}`);
    }
    const data = await r.json();
    this.state.accessToken = data.access_token;
    this.state.refreshToken = data.refresh_token;
    this.state.codeVerifier = null;
    this.save();
    // Verificar
    await this.getAccount();
    return true;
  },

  async refreshAccessToken() {
    if (!this.state.refreshToken || !this.state.appKey) {
      throw new Error('No hay refresh token');
    }
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.state.refreshToken,
      client_id: this.state.appKey
    });
    const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if (!r.ok) throw new Error('No se pudo refrescar el token');
    const data = await r.json();
    this.state.accessToken = data.access_token;
    this.save();
    return data.access_token;
  },

  /* ------------ API helpers ------------ */
  async _apiCall(url, opts = {}, isRetry = false) {
    if (!this.state.accessToken) {
      await this.refreshAccessToken();
    }
    const headers = opts.headers || {};
    headers['Authorization'] = `Bearer ${this.state.accessToken}`;
    const r = await fetch(url, { ...opts, headers });
    if (r.status === 401 && !isRetry) {
      // Token caducado, refrescar y reintentar
      await this.refreshAccessToken();
      return this._apiCall(url, opts, true);
    }
    return r;
  },

  async getAccount() {
    const r = await this._apiCall('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    });
    if (!r.ok) throw new Error(`Error: ${await r.text()}`);
    const data = await r.json();
    this.state.accountName = data.name.display_name;
    this.save();
    return data.name.display_name;
  },

  async getMetadata(path = this.DB_PATH) {
    const r = await this._apiCall('https://api.dropboxapi.com/2/files/get_metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    if (r.status === 409) return null; // No existe
    if (!r.ok) throw new Error(`Error: ${await r.text()}`);
    return r.json();
  },

  async download(path = this.DB_PATH) {
    let r;
    try {
      r = await this._apiCall('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          'Dropbox-API-Arg': JSON.stringify({ path })
        }
      });
    } catch (fetchErr) {
      throw new Error(`fetch falló: ${fetchErr.message} (${fetchErr.name})`);
    }
    if (!r.ok) {
      if (r.status === 409) return null;
      const txt = await r.text();
      throw new Error(`HTTP ${r.status}: ${txt}`);
    }
    const meta = JSON.parse(r.headers.get('dropbox-api-result') || '{}');
    const buffer = await r.arrayBuffer();
    this.state.lastDownloadedRev = meta.rev;
    this.save();
    return { buffer: new Uint8Array(buffer), meta };
  },

  async upload(data, path = this.DB_PATH) {
    // data: Uint8Array
    const args = {
      path,
      mode: 'overwrite',
      autorename: false,
      mute: true
    };
    const r = await this._apiCall('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify(args)
      },
      body: data
    });
    if (!r.ok) throw new Error(`Error subida: ${await r.text()}`);
    const meta = await r.json();
    this.state.lastDownloadedRev = meta.rev;
    this.save();
    return meta;
  }
};

DBX.load();
