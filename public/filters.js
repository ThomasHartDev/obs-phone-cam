// Real-time camera filter pipeline (color grade + geometry) that runs on the
// phone's GPU. The sender draws each raw camera frame through this instead of a
// plain 2D rotate, so OBS receives an already-corrected feed — no OBS plugin,
// no renegotiation (same captureStream canvas).
//
// Everything happens in ONE fragment shader per pixel: undo rotation to get
// source-space UV, apply mirror/zoom/lens-undistort geometry, sample (with an
// optional soften tap), then grade color. Calibration mode wipes raw|graded so
// Thomas can dial "true to life" against the untouched frame.

// Full parameter set with sane ranges. All UI sliders write into an object of
// this shape; presets are just snapshots of it.
export const DEFAULT_PARAMS = {
  exposure: 0, // -1..1  stops
  temp: 0, // -1..1  cool<->warm (white balance)
  tint: 0, // -1..1  green<->magenta
  contrast: 1, // 0.7..1.4
  saturation: 1, // 0..2
  skin: 0, // 0..0.3  selective warmth on skin tones
  lens: 0, // -0.4..0.4  >0 counters wide-angle barrel bulge
  zoom: 1, // 1..2  crop in (tighter FOV = flatter face)
  soften: 0, // 0..1  undo iOS over-sharpening
  mirror: false, // true = flip L/R (selfie-natural); false = true orientation
  calib: false, // split-screen raw | graded
  split: 0.5, // wipe position when calib on
};

// Named starting points. "True to Life" is the default: a touch of lens
// correction + neutral color, the honest baseline to tune from.
export const PRESETS = {
  "True to Life": { ...DEFAULT_PARAMS, lens: 0.12, contrast: 1.02 },
  Natural: { ...DEFAULT_PARAMS },
  "Warm Studio": {
    ...DEFAULT_PARAMS,
    temp: 0.22,
    skin: 0.1,
    exposure: 0.15,
    contrast: 1.05,
    lens: 0.12,
  },
  Cool: { ...DEFAULT_PARAMS, temp: -0.2, saturation: 0.95, lens: 0.12 },
  "Flat (LUT-ready)": {
    ...DEFAULT_PARAMS,
    contrast: 0.85,
    saturation: 0.9,
    lens: 0.12,
  },
};

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // aPos is a full-screen quad in clip space (-1..1); UV is 0..1.
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform mat2 uInvRot;    // rotate output UV back into source orientation
uniform float uSrcAspect;// source width/height (landscape sensor > 1)
uniform float uMirror;   // +1 keep, -1 flip x
uniform float uZoom;     // >=1 crop in
uniform float uLens;     // barrel-correction strength
uniform vec2  uTexel;    // 1/sourceSize for soften taps
uniform float uSoften;
uniform float uExposure;
uniform vec3  uWb;        // per-channel white-balance gain
uniform float uContrast;
uniform float uSaturation;
uniform float uSkin;
uniform float uCalib;     // 1 = split-screen
uniform float uSplit;

// Map an output UV to a source UV through rotation + geometry.
vec2 sourceUv(vec2 uv) {
  vec2 c = uv - 0.5;
  c = uInvRot * c;          // undo the canvas rotation
  c.x *= uMirror;           // mirror in source space
  c /= uZoom;               // crop toward center
  vec2 ca = c * vec2(uSrcAspect, 1.0);
  float r2 = dot(ca, ca);
  c *= (1.0 + uLens * r2);  // pincushion push counters wide-angle bulge
  return c + 0.5;
}

vec3 sampleSoft(vec2 uv) {
  vec3 col = texture2D(uTex, uv).rgb;
  if (uSoften > 0.001) {
    vec2 o = uTexel * (1.5 + 2.0 * uSoften);
    vec3 blur = texture2D(uTex, uv + vec2(o.x, o.y)).rgb
              + texture2D(uTex, uv + vec2(-o.x, o.y)).rgb
              + texture2D(uTex, uv + vec2(o.x, -o.y)).rgb
              + texture2D(uTex, uv + vec2(-o.x, -o.y)).rgb;
    col = mix(col, blur * 0.25, clamp(uSoften, 0.0, 1.0));
  }
  return col;
}

vec3 grade(vec3 col) {
  col *= exp2(uExposure);
  col *= uWb;
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSaturation);
  // selective skin warmth: skin reads R>G>B, so weight by that gap
  float mask = clamp((col.r - col.b) * 2.0, 0.0, 1.0)
             * clamp((col.r - col.g) * 4.0 + 0.5, 0.0, 1.0);
  col.r += uSkin * mask;
  col.b -= uSkin * mask * 0.5;
  return col;
}

void main() {
  vec2 sUv = sourceUv(vUv);
  // outside the source frame after a crop-out? clamp to edge, no wrap
  sUv = clamp(sUv, 0.0, 1.0);

  if (uCalib > 0.5 && vUv.x < uSplit) {
    // left of the wipe = untouched frame (rotation only), for before/after
    vec2 raw = uInvRot * (vUv - 0.5);
    raw.x *= uMirror;
    gl_FragColor = vec4(texture2D(uTex, clamp(raw + 0.5, 0.0, 1.0)).rgb, 1.0);
    return;
  }

  vec3 col = grade(sampleSoft(sUv));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("shader compile: " + gl.getShaderInfoLog(s));
  }
  return s;
}

export class CameraFilter {
  constructor(canvas) {
    // preserveDrawingBuffer so captureStream reliably grabs the WebGL frame.
    const gl = canvas.getContext("webgl", {
      preserveDrawingBuffer: true,
      alpha: false,
      antialias: false,
      desynchronized: true,
    });
    if (!gl) throw new Error("WebGL unavailable");
    this.canvas = canvas;
    this.gl = gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("link: " + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);
    this.prog = prog;

    // full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // video is top-down

    this.u = {};
    for (const name of [
      "uInvRot",
      "uSrcAspect",
      "uMirror",
      "uZoom",
      "uLens",
      "uTexel",
      "uSoften",
      "uExposure",
      "uWb",
      "uContrast",
      "uSaturation",
      "uSkin",
      "uCalib",
      "uSplit",
    ]) {
      this.u[name] = gl.getUniformLocation(prog, name);
    }
  }

  setSize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  // rotationDeg: how the canvas is rotated vs the source (0/90/180/270).
  render(video, rotationDeg, p, vw, vh) {
    const gl = this.gl;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      video,
    );

    // inverse rotation: output UV -> source UV
    const a = (-rotationDeg * Math.PI) / 180;
    const cos = Math.cos(a),
      sin = Math.sin(a);
    gl.uniformMatrix2fv(this.u.uInvRot, false, [cos, sin, -sin, cos]);

    gl.uniform1f(this.u.uSrcAspect, vw / vh);
    gl.uniform1f(this.u.uMirror, p.mirror ? -1 : 1);
    gl.uniform1f(this.u.uZoom, p.zoom);
    gl.uniform1f(this.u.uLens, p.lens);
    gl.uniform2f(this.u.uTexel, 1 / vw, 1 / vh);
    gl.uniform1f(this.u.uSoften, p.soften);
    gl.uniform1f(this.u.uExposure, p.exposure);

    // white balance from temp/tint -> per-channel gain
    const wbR = 1 + 0.3 * p.temp;
    const wbB = 1 - 0.3 * p.temp;
    const wbG = 1 - 0.18 * p.tint;
    gl.uniform3f(this.u.uWb, wbR, wbG, wbB);

    gl.uniform1f(this.u.uContrast, p.contrast);
    gl.uniform1f(this.u.uSaturation, p.saturation);
    gl.uniform1f(this.u.uSkin, p.skin);
    gl.uniform1f(this.u.uCalib, p.calib ? 1 : 0);
    gl.uniform1f(this.u.uSplit, p.split);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
