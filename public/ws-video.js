// Video over the signaling WebSocket, for when WebRTC can't find a direct path.
// A VPN on the phone (Cloudflare WARP, iCloud Private Relay) leaves WebRTC only the
// tunnel, but the page's own connection to the laptop still runs over the Wi-Fi.

const CODECS = ["avc1.42E028", "avc1.640028", "vp8"];
const FPS = 30;
// Past this much unsent data the Wi-Fi is behind; skip frames instead of queueing lag.
const MAX_BUFFERED = 512 * 1024;

function toBase64(buf) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export class WsVideoSender {
  constructor(canvas, sig, bitrate) {
    this.canvas = canvas;
    this.sig = sig;
    this.bitrate = bitrate;
    this.encoder = null;
    this.size = "";
    this.needKey = true;
    this.running = false;
    this.lastFrameAt = 0;
  }

  start() {
    if (this.running || typeof VideoEncoder === "undefined") return false;
    this.running = true;
    return true;
  }

  stop() {
    this.running = false;
    if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    this.encoder = null;
    this.size = "";
  }

  // The receiver lists what it can decode; OBS's browser may lack H.264.
  requestKey(codecs) {
    if (Array.isArray(codecs) && codecs.length) this.codecs = codecs;
    this.needKey = true;
    if (this.codecs && !this.codecs.includes(this.codec)) this.size = "";
  }

  // Two silent reports in a row mean the receiver can't use this codec; try the next.
  onStats(frames) {
    this.silentReports = frames > 0 ? 0 : (this.silentReports || 0) + 1;
    if (this.silentReports < 2 || !this.codec) return;
    this.silentReports = 0;
    const rest = CODECS.slice(CODECS.indexOf(this.codec) + 1);
    this.codecs = (this.codecs || CODECS).filter((c) => rest.includes(c));
    this.requestKey();
  }

  async configure(width, height) {
    this.size = `${width}x${height}`;
    if (this.encoder && this.encoder.state !== "closed") this.encoder.close();
    this.encoder = null;
    for (const codec of CODECS.filter((c) => !this.codecs || this.codecs.includes(c))) {
      const config = {
        codec,
        width,
        height,
        bitrate: this.bitrate,
        framerate: FPS,
        latencyMode: "realtime",
      };
      const { supported } = await VideoEncoder.isConfigSupported(config).catch(() => ({}));
      if (!supported) continue;
      this.encoder = new VideoEncoder({
        output: (chunk, meta) => this.send(codec, chunk, meta),
        error: () => {
          this.size = "";
        },
      });
      this.encoder.configure(config);
      this.codec = codec;
      this.needKey = true;
      return;
    }
  }

  send(codec, chunk, meta) {
    if (meta && meta.decoderConfig) {
      const d = meta.decoderConfig;
      this.config = {
        type: "wsConfig",
        codec: d.codec || codec,
        description: d.description ? toBase64(d.description) : null,
      };
    }
    // Every keyframe carries the config, so a receiver that just (re)joined can start there.
    if (chunk.type === "key" && this.config) this.sig.send(this.config);
    const out = new Uint8Array(9 + chunk.byteLength);
    out[0] = chunk.type === "key" ? 1 : 0;
    new DataView(out.buffer).setFloat64(1, chunk.timestamp);
    chunk.copyTo(out.subarray(9));
    this.sig.sendBinary(out);
  }

  // Call right after drawing: a WebGL canvas is blank again once the frame is composited.
  tick() {
    if (!this.running) return;
    const now = performance.now();
    if (now - this.lastFrameAt < 1000 / FPS - 2) return;
    this.lastFrameAt = now;
    const { width, height } = this.canvas;
    if (!width || !height) return;
    if (`${width}x${height}` !== this.size) {
      this.configure(width, height);
      return;
    }
    const ws = this.sig.ws;
    if (!this.encoder || this.encoder.encodeQueueSize > 2) return;
    if (!ws || ws.bufferedAmount > MAX_BUFFERED) return;
    if (!this.copy) this.copy = document.createElement("canvas");
    if (this.copy.width !== width || this.copy.height !== height) {
      this.copy.width = width;
      this.copy.height = height;
    }
    try {
      this.copy.getContext("2d").drawImage(this.canvas, 0, 0);
      const frame = new VideoFrame(this.copy, { timestamp: now * 1000 });
      this.encoder.encode(frame, { keyFrame: this.needKey });
      this.needKey = false;
      frame.close();
    } catch {
      // A dropped frame is fine; a throw here would stop the preview's draw loop.
    }
  }
}

export class WsVideoPlayer {
  constructor(canvas, sig) {
    this.canvas = canvas;
    this.sig = sig;
    this.decoder = null;
    this.waitingForKey = true;
    this.codecs = Promise.all(
      CODECS.map((codec) =>
        VideoDecoder.isConfigSupported({ codec })
          .then((r) => r.supported && codec)
          .catch(() => false),
      ),
    ).then((list) => (this.decodable = list.filter(Boolean)));
    this.frames = 0;
    setInterval(() => {
      if (!this.canvas.hidden) this.sig.send({ type: "wsStats", frames: this.frames });
      this.frames = 0;
    }, 2000);
  }

  configure({ codec, description }) {
    const key = `${codec}:${description}`;
    if (key === this.configKey && this.decoder && this.decoder.state === "configured") return;
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    if (this.decodable && !this.decodable.includes(codec)) return this.reset(`can't decode ${codec}`);
    this.configKey = key;
    const ctx = this.canvas.getContext("2d");
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.canvas.width !== frame.displayWidth) this.canvas.width = frame.displayWidth;
        if (this.canvas.height !== frame.displayHeight) this.canvas.height = frame.displayHeight;
        ctx.drawImage(frame, 0, 0);
        frame.close();
        this.frames++;
      },
      error: (e) => this.reset(e.message),
    });
    const config = { codec, optimizeForLatency: true };
    if (description) config.description = fromBase64(description);
    this.decoder.configure(config);
    this.waitingForKey = true;
  }

  async reset(reason = "no decoder yet") {
    this.decoder = null;
    const now = Date.now();
    if (now - (this.askedAt || 0) < 1000) return;
    this.askedAt = now;
    this.sig.send({ type: "wsKey", codecs: await this.codecs, reason });
  }

  push(buf) {
    const bytes = new Uint8Array(buf);
    const key = bytes[0] === 1;
    if (!this.decoder || this.decoder.state !== "configured") {
      this.reset();
      return;
    }
    if (this.waitingForKey && !key) return;
    this.waitingForKey = false;
    this.decoder.decode(
      new EncodedVideoChunk({
        type: key ? "key" : "delta",
        timestamp: new DataView(bytes.buffer).getFloat64(1),
        data: bytes.subarray(9),
      }),
    );
  }
}
