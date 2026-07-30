// Thin WebSocket signaling client shared by the sender, receiver, and laptop
// controller pages.
export class Signal extends EventTarget {
  constructor(role) {
    super();
    this.role = role;
    this.ws = null;
    this.reconnectMs = 500;
    // Buffer messages that arrive before the page attaches `msg` listeners.
    // Without this, the server's immediate presence push can be lost and the
    // laptop panel stays stuck on "Waiting for phone" forever.
    this._earlyMsgs = [];
    this._msgListeners = 0;
    this.connect();
  }

  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options);
    if (type === "msg") {
      this._msgListeners++;
      if (this._earlyMsgs.length) {
        const queued = this._earlyMsgs.splice(0);
        for (const msg of queued) {
          super.dispatchEvent(new CustomEvent("msg", { detail: msg }));
        }
      }
    }
  }

  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, options);
    if (type === "msg") this._msgListeners = Math.max(0, this._msgListeners - 1);
  }

  connect() {
    // ws:// when the page is served over http (OBS receiver), wss:// over https (phone).
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws?role=${this.role}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectMs = 500;
      this.dispatchEvent(new Event("open"));
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (this._msgListeners === 0) {
        this._earlyMsgs.push(msg);
        return;
      }
      this.dispatchEvent(new CustomEvent("msg", { detail: msg }));
    };
    ws.onclose = (e) => {
      this.dispatchEvent(new Event("close"));
      // The server closes us with 1000 when a newer client of the same role takes
      // over (e.g. a second sender tab). Do NOT reconnect then — reconnecting starts
      // a connect/disconnect war between two tabs. Only auto-heal on abnormal drops
      // (server/OBS restart, network blip) so those still recover.
      if (e && e.code === 1000) {
        this.dispatchEvent(new CustomEvent("superseded"));
        return;
      }
      setTimeout(() => this.connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, 5000);
    };
    ws.onerror = () => ws.close();
  }
  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify(obj));
  }
}

export const RTC_CONFIG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};
