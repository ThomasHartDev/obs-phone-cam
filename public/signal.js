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
    ws.onclose = () => {
      this.dispatchEvent(new Event("close"));
      // auto-reconnect with backoff so a laptop/OBS restart heals itself
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
