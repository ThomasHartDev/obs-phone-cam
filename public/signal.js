// Thin WebSocket signaling client shared by the sender and receiver pages.
export class Signal extends EventTarget {
  constructor(role) {
    super();
    this.role = role;
    this.ws = null;
    this.reconnectMs = 500;
    this.connect();
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
