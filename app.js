"use strict";

// Every setting lives here: label, stepper behaviour and default value.
// Field keys double as phase kinds (see buildPhases and the CSS data-kind rules).
const FIELDS = [
  { key: "warmup", label: "Warm-up", step: 60, min: 0, max: 1800, value: 0, time: true },
  { key: "relaxed", label: "Relaxed", step: 15, min: 15, max: 1800, value: 240, time: true },
  { key: "intense", label: "Intense", step: 15, min: 15, max: 1800, value: 60, time: true },
  { key: "rounds", label: "Rounds", step: 1, min: 1, max: 50, value: 4 },
  { key: "cooldown", label: "Cool-down", step: 60, min: 0, max: 1800, value: 0, time: true },
];
const LABELS = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
const STORAGE_KEY = "quick-cycle:settings";

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const settings = {
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.value])),
  ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"),
};

function buildPhases(s) {
  const phases = [];
  const add = (kind, duration, round) => duration > 0 && phases.push({ kind, duration, round });
  add("warmup", s.warmup);
  for (let r = 1; r <= s.rounds; r++) {
    add("relaxed", s.relaxed, r);
    add("intense", s.intense, r);
  }
  add("cooldown", s.cooldown);
  let start = 0;
  for (const p of phases) {
    p.start = start;
    start += p.duration;
  }
  return phases;
}

const totalOf = (phases) => phases.at(-1).start + phases.at(-1).duration;

/* ---------- Setup screen ---------- */

function holdRepeat(button, action) {
  let timer;
  const stop = () => clearTimeout(timer);
  const loop = (delay) => (timer = setTimeout(() => (action(), loop(70)), delay));
  button.addEventListener("pointerdown", () => (action(), loop(400)));
  ["pointerup", "pointerleave", "pointercancel"].forEach((e) => button.addEventListener(e, stop));
  button.addEventListener("click", (e) => e.detail === 0 && action()); // keyboard
}

function renderSetup() {
  const list = $("fields");
  for (const f of FIELDS) {
    const li = document.createElement("li");
    li.className = "field";
    if (f.time) li.style.setProperty("--kind", `var(--${f.key})`);
    li.innerHTML = `
      <span class="label">${f.label}</span>
      <div class="stepper">
        <button aria-label="Less ${f.label}">−</button>
        <output></output>
        <button aria-label="More ${f.label}">+</button>
      </div>`;
    const [minus, plus] = li.querySelectorAll("button");
    const output = li.querySelector("output");
    const show = () => {
      const v = settings[f.key];
      output.textContent = !f.time ? v : v === 0 ? "Off" : fmt(v);
      $("setup-total").textContent = fmt(totalOf(buildPhases(settings)));
    };
    const change = (dir) => {
      settings[f.key] = Math.min(f.max, Math.max(f.min, settings[f.key] + dir * f.step));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      show();
    };
    holdRepeat(minus, () => change(-1));
    holdRepeat(plus, () => change(1));
    show();
    list.append(li);
  }
}

function showScreen(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
}

/* ---------- Device: full screen, wake lock, sound, vibration ---------- */

function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) return;
  if (el.requestFullscreen) el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  else el.webkitRequestFullscreen?.();
}

let wakeLock = null;

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", renderWake);
  } catch {
    wakeLock = null; // unsupported or refused; the indicator tells the rider
  }
  renderWake();
}

function releaseWakeLock() {
  wakeLock?.release();
  wakeLock = null;
}

function renderWake() {
  $("w-wake").textContent =
    wakeLock && !wakeLock.released ? "Screen stays on" : "Screen may sleep: check auto-lock";
}

// The browser drops the wake lock whenever the page is hidden.
document.addEventListener("visibilitychange", () => {
  if (workout && document.visibilityState === "visible") requestWakeLock();
});

let audio;

function tone(freq, duration, delay = 0) {
  const t = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.6, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + duration + 0.05);
}

const CUES = {
  countdown: { tones: [[660, 0.12, 0]], vibrate: 80 },
  intense: { tones: [[880, 0.15, 0], [1175, 0.15, 0.18], [1568, 0.45, 0.36]], vibrate: [200, 100, 200, 100, 400] },
  easy: { tones: [[784, 0.2, 0], [523, 0.5, 0.22]], vibrate: 400 },
  finish: { tones: [[523, 0.2, 0], [659, 0.2, 0.2], [784, 0.2, 0.4], [1047, 0.7, 0.6]], vibrate: [300, 100, 300, 100, 600] },
};

function cue(name) {
  const { tones, vibrate } = CUES[name];
  tones.forEach(([f, d, delay]) => tone(f, d, delay));
  navigator.vibrate?.(vibrate);
}

/* ---------- Workout ---------- */

// All state derives from elapsed time, so the clock never drifts and
// survives the tab being throttled or briefly backgrounded.
let workout = null;

const elapsedMs = () => workout.offset + (workout.resumedAt ? Date.now() - workout.resumedAt : 0);

function start() {
  audio ??= new AudioContext();
  audio.resume();
  enterFullscreen();
  requestWakeLock();

  const phases = buildPhases(settings);
  workout = {
    phases,
    total: totalOf(phases),
    offset: 0,
    resumedAt: Date.now(),
    index: -1,
    left: null,
    timer: setInterval(tick, 100),
  };
  renderPaused();
  showScreen("workout");
  tick();
}

function tick() {
  const t = elapsedMs() / 1000;
  if (t >= workout.total) return finish();

  const i = workout.phases.findLastIndex((p) => p.start <= t);
  const phase = workout.phases[i];
  const left = Math.ceil(phase.start + phase.duration - t);

  if (i !== workout.index) {
    workout.index = i;
    renderPhase(phase, workout.phases[i + 1]);
    cue(phase.kind === "intense" ? "intense" : "easy");
  }
  if (left !== workout.left) {
    workout.left = left;
    $("w-time").textContent = fmt(left);
    $("w-remaining").textContent = `${fmt(Math.ceil(workout.total - t))} left`;
    if (left <= 3 && workout.resumedAt) cue("countdown");
  }
  $("w-phase-bar").style.width = `${((t - phase.start) / phase.duration) * 100}%`;
  $("w-total-bar").style.width = `${(t / workout.total) * 100}%`;
}

function renderPhase(phase, next) {
  $("workout").dataset.kind = phase.kind;
  $("w-phase").textContent = LABELS[phase.kind];
  $("w-round").textContent = phase.round ? `Round ${phase.round}/${settings.rounds}` : "";
  $("w-next").textContent = next ? `Next: ${LABELS[next.kind]} ${fmt(next.duration)}` : "Last one!";
}

function renderPaused() {
  const paused = !workout.resumedAt;
  $("workout").classList.toggle("paused", paused);
  $("pause").textContent = paused ? "Resume" : "Pause";
  $("end").hidden = !paused;
}

function togglePause() {
  if (workout.resumedAt) {
    workout.offset = elapsedMs();
    workout.resumedAt = null;
  } else {
    workout.resumedAt = Date.now();
  }
  renderPaused();
}

function skip() {
  const phase = workout.phases[workout.index];
  workout.offset += (phase.start + phase.duration) * 1000 - elapsedMs();
  tick();
}

function stop() {
  clearInterval(workout.timer);
  releaseWakeLock();
  workout = null;
}

function finish() {
  $("done-summary").textContent = `${fmt(workout.total)} · ${settings.rounds} rounds`;
  stop();
  cue("finish");
  showScreen("done");
}

function end() {
  stop();
  showScreen("setup");
}

renderSetup();
$("start").addEventListener("click", start);
$("pause").addEventListener("click", togglePause);
$("skip").addEventListener("click", skip);
$("end").addEventListener("click", end);
$("back").addEventListener("click", () => showScreen("setup"));
