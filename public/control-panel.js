// Shared control-panel markup + helpers for the phone HUD and the laptop remote.
// The laptop drives the phone via { type: "control", op, ... } messages over WS.

import { DEFAULT_PARAMS, PRESETS } from "/filters.js";

/** Slider defs used by both UIs. Keep in lockstep with sender panel. */
export const SLIDERS = [
  { p: "exposure", label: "Exposure", min: -1, max: 1, step: 0.01 },
  { p: "temp", label: "Temp", min: -1, max: 1, step: 0.01 },
  { p: "tint", label: "Tint", min: -1, max: 1, step: 0.01 },
  { p: "contrast", label: "Contrast", min: 0.7, max: 1.4, step: 0.01 },
  { p: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01 },
  { p: "skin", label: "Skin warmth", min: 0, max: 0.3, step: 0.005 },
  { p: "lens", label: "Lens fix", min: -0.4, max: 0.4, step: 0.01 },
  { p: "zoom", label: "Zoom", min: 1, max: 2, step: 0.01 },
  { p: "soften", label: "Soften", min: 0, max: 1, step: 0.01 },
  { p: "blur", label: "Background blur", min: 0, max: 1, step: 0.01 },
];

export const RES_OPTIONS = [
  { value: "1280x720", label: "720p" },
  { value: "1920x1080", label: "1080p" },
  { value: "3840x2160", label: "4K" },
];

export const PARAM_KEYS = Object.keys(DEFAULT_PARAMS);

/** Keep only known filter keys so remote payloads can't inject junk. */
export function sanitizeParams(partial) {
  if (!partial || typeof partial !== "object") return {};
  const out = {};
  for (const k of PARAM_KEYS) {
    if (!(k in partial)) continue;
    const v = partial[k];
    if (typeof DEFAULT_PARAMS[k] === "boolean") out[k] = !!v;
    else if (typeof DEFAULT_PARAMS[k] === "number") {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

/**
 * Build the filter panel DOM (presets + sliders + toggles) into `root`.
 * Returns element refs used by callers to sync / wire events.
 */
export function mountFilterPanel(root, { includeCalib = true } = {}) {
  root.innerHTML = "";
  root.classList.add("panel");

  const presets = document.createElement("div");
  presets.className = "presets";
  presets.id = root.id ? root.id + "-presets" : "presets";
  root.appendChild(presets);

  const sliders = document.createElement("div");
  sliders.className = "sliders";
  for (const s of SLIDERS) {
    const label = document.createElement("label");
    label.appendChild(document.createTextNode(s.label));
    const input = document.createElement("input");
    input.type = "range";
    input.dataset.p = s.p;
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    label.appendChild(input);
    sliders.appendChild(label);
  }
  root.appendChild(sliders);

  const toggles = document.createElement("div");
  toggles.className = "toggles";

  const mirrorLabel = document.createElement("label");
  const mirror = document.createElement("input");
  mirror.type = "checkbox";
  mirror.id = root.id ? root.id + "-mirror" : "mirror";
  mirrorLabel.appendChild(mirror);
  mirrorLabel.appendChild(document.createTextNode(" Mirror (H)"));
  toggles.appendChild(mirrorLabel);

  const flipVLabel = document.createElement("label");
  const flipV = document.createElement("input");
  flipV.type = "checkbox";
  flipV.id = root.id ? root.id + "-flipV" : "flipV";
  flipVLabel.appendChild(flipV);
  flipVLabel.appendChild(document.createTextNode(" Flip V"));
  toggles.appendChild(flipVLabel);

  let calib = null;
  if (includeCalib) {
    const calibLabel = document.createElement("label");
    calib = document.createElement("input");
    calib.type = "checkbox";
    calib.id = root.id ? root.id + "-calib" : "calib";
    calibLabel.appendChild(calib);
    calibLabel.appendChild(document.createTextNode(" Calibrate (raw | you)"));
    toggles.appendChild(calibLabel);
  }

  const reset = document.createElement("button");
  reset.type = "button";
  reset.id = root.id ? root.id + "-reset" : "reset";
  reset.textContent = "Reset";
  toggles.appendChild(reset);

  root.appendChild(toggles);

  // Preset chips
  for (const name of Object.keys(PRESETS)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = name;
    chip.dataset.preset = name;
    presets.appendChild(chip);
  }

  return {
    root,
    presets,
    sliders: [...sliders.querySelectorAll("input[data-p]")],
    mirror,
    flipV,
    calib,
    reset,
  };
}

/** Reflect a params object onto the panel controls. */
export function syncPanel(ui, params) {
  for (const el of ui.sliders) {
    if (params[el.dataset.p] != null) el.value = String(params[el.dataset.p]);
  }
  if (ui.mirror) ui.mirror.checked = !!params.mirror;
  if (ui.flipV) ui.flipV.checked = !!params.flipV;
  if (ui.calib) ui.calib.checked = !!params.calib;
}

export function markActivePreset(presetsEl, name) {
  for (const chip of presetsEl.children) {
    chip.classList.toggle("on", chip.textContent === name);
  }
}
