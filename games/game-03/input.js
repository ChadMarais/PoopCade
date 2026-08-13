const DEADZONE = 0.18;
const FIRE_DEADZONE = 0.28;
const ACCELERATION_TAU = 0.03;
const DECELERATION_TAU = 0.022;
const MOUSE_FIRE_BUFFER_MS = 800;
const TOUCH_FIRE_AIM_GRACE_MS = 90;
const TOUCH_DRAG_RADIUS = 52;

const GAME_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "KeyI", "KeyJ", "KeyK", "KeyL",
]);
const WASD_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const IJKL_KEYS = new Set(["KeyI", "KeyJ", "KeyK", "KeyL"]);

export function normalizedVector(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0, length: 0 };
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 0.0001) return { x: 0, y: 0, length: 0 };
  if (length <= 1) return { x, y, length };
  return { x: x / length, y: y / length, length: 1 };
}

export function virtualDragVector(originX, originY, pointerX, pointerY, radius = TOUCH_DRAG_RADIUS, deadzone = DEADZONE) {
  const safeRadius = Math.max(1, Number.isFinite(radius) ? radius : TOUCH_DRAG_RADIUS);
  const value = normalizedVector((pointerX - originX) / safeRadius, (pointerY - originY) / safeRadius);
  return value.length < deadzone ? { x: 0, y: 0, length: 0 } : value;
}

function axes(keys, left, right, up, down) {
  return normalizedVector(Number(keys.has(right)) - Number(keys.has(left)), Number(keys.has(down)) - Number(keys.has(up)));
}

export function resolveKeyboardInput(keys, layout = "primary") {
  let movement;
  let aim;
  if (layout === "alternate") {
    movement = axes(keys, "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown");
    aim = axes(keys, "KeyJ", "KeyL", "KeyI", "KeyK");
  } else {
    movement = axes(keys, "KeyA", "KeyD", "KeyW", "KeyS");
    aim = axes(keys, "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown");
  }
  return { movement, aim, fire: aim.length > 0 };
}

export function smoothMovementVector(current, target, delta) {
  const currentMagnitude = Math.hypot(current.x, current.y);
  const targetMagnitude = Math.hypot(target.x, target.y);
  const sameDirection = currentMagnitude < .001 || targetMagnitude < .001 ||
    (current.x * target.x + current.y * target.y) / Math.max(.0001, currentMagnitude * targetMagnitude) > .75;
  const accelerating = targetMagnitude > currentMagnitude || !sameDirection;
  const tau = accelerating ? ACCELERATION_TAU : DECELERATION_TAU;
  const blend = 1 - Math.exp(-Math.max(0, Math.min(.05, delta)) / tau);
  const next = normalizedVector(
    current.x + (target.x - current.x) * blend,
    current.y + (target.y - current.y) * blend,
  );
  if (targetMagnitude === 0 && next.length < .015) return { x: 0, y: 0 };
  return { x: next.x, y: next.y };
}

function finiteAxis(value, fallback = 0) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : fallback;
}

export class InputController {
  constructor(canvas, moveStick, aimStick, mobileControls = null) {
    this.canvas = canvas;
    this.moveStick = moveStick;
    this.aimStick = aimStick;
    this.mobileControls = mobileControls;
    this.keys = new Set();
    this.keyboardLayout = "primary";
    this.mouseCanvasX = canvas.clientWidth / 2 || 1;
    this.mouseCanvasY = canvas.clientHeight / 2 || 0;
    this.aimOrigin = { x: canvas.clientWidth / 2 || 0, y: canvas.clientHeight / 2 || 0 };
    this.mouseX = 1;
    this.mouseY = 0;
    this.mouseFiring = false;
    this.mousePointerId = null;
    this.mouseFireQueuedUntil = 0;
    this.touchFireQueuedUntil = 0;
    this.touchFireAimReady = false;
    this.touchFireAimGraceUntil = 0;
    this.mouseMovedAt = 0;
    this.moveTouch = { x: 0, y: 0 };
    this.aimTouch = { x: 1, y: 0, firing: false };
    this.touchAimManual = false;
    this.freeMovePointerId = null;
    this.firePointerId = null;
    this.touchModeUntil = 0;
    this.moveOutput = { x: 0, y: 0 };
    this.lastSampleAt = performance.now();
    this.visualState = { mode: "mouse", aimX: 1, aimY: 0, fire: false, moveX: 0, moveY: 0, mouseCanvasX: this.mouseCanvasX, mouseCanvasY: this.mouseCanvasY };
    this.enabled = false;
    this.editorBlocked = false;
    this.pointerCoarse = matchMedia("(pointer: coarse)").matches;
    this.bindDesktop();
    this.bindStick(moveStick, "move");
    this.bindStick(aimStick, "aim");
    if (mobileControls) this.bindMobileControls(mobileControls);
  }

  bindDesktop() {
    window.addEventListener("keydown", (event) => {
      if (!this.enabled || this.editorBlocked || !GAME_KEYS.has(event.code)) return;
      event.preventDefault();
      if (event.repeat) return;
      this.keys.add(event.code);
      if (IJKL_KEYS.has(event.code)) this.keyboardLayout = "alternate";
      else if (WASD_KEYS.has(event.code)) this.keyboardLayout = "primary";
    });
    window.addEventListener("keyup", (event) => {
      if (GAME_KEYS.has(event.code) && this.enabled) event.preventDefault();
      this.keys.delete(event.code);
    });
    window.addEventListener("blur", () => this.reset());
    window.addEventListener("pointermove", (event) => {
      if (!this.enabled || this.editorBlocked || event.pointerType === "touch") return;
      const rect = this.canvas.getBoundingClientRect();
      this.mouseCanvasX = event.clientX - rect.left;
      this.mouseCanvasY = event.clientY - rect.top;
      this.mouseMovedAt = performance.now();
      this.updateMouseAim();
    }, { passive: true });
    this.canvas.addEventListener("pointerdown", (event) => {
      if (!this.enabled || this.editorBlocked || event.pointerType === "touch" || event.button !== 0) return;
      event.preventDefault();
      // Pointer movement is not guaranteed to fire after focus/visibility
      // changes. Resolve the click position before the first fire sample so a
      // click behind the blob can never inherit its previous facing.
      const rect = this.canvas.getBoundingClientRect();
      this.mouseCanvasX = event.clientX - rect.left;
      this.mouseCanvasY = event.clientY - rect.top;
      this.updateMouseAim();
      this.mousePointerId = event.pointerId;
      try { this.canvas.setPointerCapture(event.pointerId); } catch {}
      this.mouseFiring = true;
      const now = performance.now();
      this.mouseMovedAt = now;
      this.mouseFireQueuedUntil = now + MOUSE_FIRE_BUFFER_MS;
    });
    const releaseMouse = (event) => {
      if (event.pointerType === "touch") return;
      if (this.mousePointerId !== null && event.pointerId !== this.mousePointerId) return;
      try { if (this.mousePointerId !== null) this.canvas.releasePointerCapture(this.mousePointerId); } catch {}
      this.mousePointerId = null;
      this.mouseFiring = false;
    };
    window.addEventListener("pointerup", releaseMouse);
    window.addEventListener("pointercancel", releaseMouse);
    this.canvas.addEventListener("lostpointercapture", (event) => {
      if (event.pointerId !== this.mousePointerId) return;
      this.mousePointerId = null;
      this.mouseFiring = false;
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  bindStick(element, kind) {
    if (!element) return;
    const knob = element.querySelector(".knob");
    let pointerId = null;
    const update = (event) => {
      const rect = element.getBoundingClientRect();
      const radius = rect.width * 0.34;
      if (!Number.isFinite(radius) || radius < 1) {
        if (kind === "move") this.moveTouch = { x: 0, y: 0 };
        else this.aimTouch = { ...this.aimTouch, firing: false };
        return;
      }
      const value = normalizedVector(
        (event.clientX - (rect.left + rect.width / 2)) / radius,
        (event.clientY - (rect.top + rect.height / 2)) / radius,
      );
      knob.style.transform = `translate(calc(-50% + ${value.x * radius}px),calc(-50% + ${value.y * radius}px))`;
      if (kind === "move") this.moveTouch = value.length < DEADZONE ? { x: 0, y: 0 } : { x: value.x, y: value.y };
      else if (value.length >= DEADZONE) this.aimTouch = { x: value.x, y: value.y, firing: value.length >= FIRE_DEADZONE };
      else this.aimTouch = { ...this.aimTouch, firing: false };
    };
    const release = (event) => {
      if (event.pointerId !== pointerId) return;
      try { element.releasePointerCapture(pointerId); } catch {}
      pointerId = null;
      element.classList.remove("active");
      knob.style.transform = "translate(-50%,-50%)";
      if (kind === "move") this.moveTouch = { x: 0, y: 0 };
      else this.aimTouch = { ...this.aimTouch, firing: false };
    };
    element.addEventListener("pointerdown", (event) => {
      if (!this.enabled || this.editorBlocked || pointerId !== null) return;
      event.preventDefault();
      pointerId = event.pointerId;
      element.setPointerCapture(pointerId);
      element.classList.add("active");
      update(event);
    });
    element.addEventListener("pointermove", (event) => { if (event.pointerId === pointerId) update(event); });
    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
  }

  bindMobileControls({ movementSurface = this.canvas, movementGuide, fireButton }) {
    const guideKnob = movementGuide?.querySelector(".mobile-move-knob");
    let moveOrigin = { x: 0, y: 0 };
    let fireOrigin = { x: 0, y: 0 };

    const updateMovement = (event) => {
      if (event.pointerId !== this.freeMovePointerId) return;
      const value = virtualDragVector(moveOrigin.x, moveOrigin.y, event.clientX, event.clientY);
      this.moveTouch = { x: value.x, y: value.y };
      if (!this.touchAimManual && value.length) this.aimTouch = { ...this.aimTouch, x: value.x, y: value.y };
      if (guideKnob) guideKnob.style.transform = `translate(calc(-50% + ${value.x * 31}px),calc(-50% + ${value.y * 31}px))`;
    };
    const releaseMovement = (event) => {
      if (event.pointerId !== this.freeMovePointerId) return;
      this.freeMovePointerId = null;
      this.touchModeUntil = performance.now() + 300;
      try { movementSurface.releasePointerCapture(event.pointerId); } catch {}
      this.moveTouch = { x: 0, y: 0 };
      if (movementGuide) movementGuide.hidden = true;
      if (guideKnob) guideKnob.style.transform = "translate(-50%,-50%)";
    };
    movementSurface.addEventListener("pointerdown", (event) => {
      if (!this.enabled || this.editorBlocked || event.pointerType !== "touch" || this.freeMovePointerId !== null) return;
      event.preventDefault();
      this.freeMovePointerId = event.pointerId;
      this.touchModeUntil = performance.now() + 1500;
      moveOrigin = { x: event.clientX, y: event.clientY };
      try { movementSurface.setPointerCapture(event.pointerId); } catch {}
      if (movementGuide) {
        movementGuide.hidden = false;
        movementGuide.style.left = `${moveOrigin.x}px`;
        movementGuide.style.top = `${moveOrigin.y}px`;
      }
      updateMovement(event);
    });
    movementSurface.addEventListener("pointermove", updateMovement);
    movementSurface.addEventListener("pointerup", releaseMovement);
    movementSurface.addEventListener("pointercancel", releaseMovement);
    movementSurface.addEventListener("lostpointercapture", releaseMovement);

    if (!fireButton) return;
    const updateFireAim = (event) => {
      if (event.pointerId !== this.firePointerId) return;
      const value = virtualDragVector(fireOrigin.x, fireOrigin.y, event.clientX, event.clientY, 46, .22);
      if (!value.length) return;
      this.touchAimManual = true;
      this.touchFireAimReady = true;
      this.aimTouch = { x: value.x, y: value.y, firing: true };
      fireButton.style.setProperty("--aim-x", `${value.x * 13}px`);
      fireButton.style.setProperty("--aim-y", `${value.y * 13}px`);
    };
    const releaseFire = (event) => {
      if (event.pointerId !== this.firePointerId) return;
      this.firePointerId = null;
      this.touchModeUntil = performance.now() + 900;
      try { fireButton.releasePointerCapture(event.pointerId); } catch {}
      this.aimTouch = { ...this.aimTouch, firing: false };
      // A quick centre tap means "fire facing". A drag sets this sooner and
      // therefore authorizes its direction as the first shot.
      this.touchFireAimReady = true;
      this.touchAimManual = false;
      const movement = normalizedVector(this.moveTouch.x, this.moveTouch.y);
      if (movement.length && this.touchFireQueuedUntil <= performance.now()) this.aimTouch = { ...this.aimTouch, x: movement.x, y: movement.y };
      fireButton.classList.remove("active");
      fireButton.style.removeProperty("--aim-x");
      fireButton.style.removeProperty("--aim-y");
    };
    fireButton.addEventListener("pointerdown", (event) => {
      if (!this.enabled || this.editorBlocked || this.firePointerId !== null) return;
      event.preventDefault();
      event.stopPropagation();
      this.firePointerId = event.pointerId;
      this.touchModeUntil = performance.now() + 1500;
      this.touchFireAimReady = false;
      this.touchFireAimGraceUntil = performance.now() + TOUCH_FIRE_AIM_GRACE_MS;
      const rect = fireButton.getBoundingClientRect();
      fireOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      // Resolve a directional tap before the first fire input is sampled. A
      // pointer near the centre deliberately keeps the player's current aim.
      updateFireAim(event);
      this.aimTouch = { ...this.aimTouch, firing: true };
      this.touchFireQueuedUntil = performance.now() + MOUSE_FIRE_BUFFER_MS;
      try { fireButton.setPointerCapture(event.pointerId); } catch {}
      fireButton.classList.add("active");
    });
    fireButton.addEventListener("pointermove", updateFireAim);
    fireButton.addEventListener("pointerup", releaseFire);
    fireButton.addEventListener("pointercancel", releaseFire);
    fireButton.addEventListener("lostpointercapture", releaseFire);
  }

  setAimOrigin(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.aimOrigin = { x: point.x, y: point.y };
    this.updateMouseAim();
  }

  updateMouseAim() {
    const aim = normalizedVector(this.mouseCanvasX - this.aimOrigin.x, this.mouseCanvasY - this.aimOrigin.y);
    if (!aim.length) return;
    this.mouseX = aim.x;
    this.mouseY = aim.y;
  }

  smoothMovement(target, delta) {
    this.moveOutput = smoothMovementVector(this.moveOutput, target, delta);
    return this.moveOutput;
  }

  sample(now = performance.now()) {
    const delta = Math.max(0, Math.min(.05, (now - this.lastSampleAt) / 1000));
    this.lastSampleAt = now;
    const keyboard = resolveKeyboardInput(this.keys, this.keyboardLayout);
    const keyboardUsed = keyboard.movement.length > 0 || keyboard.aim.length > 0;
    const touchUsed = (this.pointerCoarse || this.freeMovePointerId !== null || this.firePointerId !== null || now < this.touchModeUntil) && !keyboardUsed;
    const targetMove = touchUsed ? normalizedVector(this.moveTouch.x, this.moveTouch.y) : keyboard.movement;
    const move = this.smoothMovement(targetMove, delta);

    let aimX = this.mouseX;
    let aimY = this.mouseY;
    let fire = this.mouseFiring || now < this.mouseFireQueuedUntil;
    let mode = "mouse";
    if (keyboard.aim.length) {
      aimX = keyboard.aim.x;
      aimY = keyboard.aim.y;
      fire = keyboard.fire;
      mode = this.keyboardLayout === "alternate" ? "ijkl" : "arrows";
    } else if (touchUsed) {
      aimX = this.aimTouch.x;
      aimY = this.aimTouch.y;
      const wantsFire = Boolean(this.aimTouch.firing) || now < this.touchFireQueuedUntil;
      fire = wantsFire && (this.touchFireAimReady || now >= this.touchFireAimGraceUntil);
      mode = "touch";
    }

    if (!this.enabled || this.editorBlocked) {
      fire = false;
      this.moveOutput = { x: 0, y: 0 };
    }
    this.visualState = {
      mode,
      aimX: finiteAxis(aimX, 1),
      aimY: finiteAxis(aimY),
      fire,
      moveX: finiteAxis(!this.enabled || this.editorBlocked ? 0 : move.x),
      moveY: finiteAxis(!this.enabled || this.editorBlocked ? 0 : move.y),
      mouseCanvasX: this.mouseCanvasX,
      mouseCanvasY: this.mouseCanvasY,
      mouseRecent: now - this.mouseMovedAt < 1800,
    };
    return {
      moveX: this.visualState.moveX,
      moveY: this.visualState.moveY,
      aimX: this.visualState.aimX,
      aimY: this.visualState.aimY,
      fire: this.visualState.fire,
    };
  }

  getVisualState() { return { ...this.visualState }; }

  setEditorBlocked(blocked) {
    const next = Boolean(blocked);
    if (next && !this.editorBlocked) this.reset();
    this.editorBlocked = next;
  }

  acknowledgeFire() {
    this.mouseFireQueuedUntil = 0;
    this.touchFireQueuedUntil = 0;
    this.touchFireAimReady = false;
    this.touchFireAimGraceUntil = 0;
    if (this.firePointerId === null) {
      const movement = normalizedVector(this.moveTouch.x, this.moveTouch.y);
      if (movement.length) this.aimTouch = { ...this.aimTouch, x: movement.x, y: movement.y };
    }
  }

  hasIntent() {
    return Math.hypot(this.visualState.moveX, this.visualState.moveY) > .12 || this.visualState.fire;
  }

  reset() {
    this.keys.clear();
    this.mouseFiring = false;
    try { if (this.mousePointerId !== null) this.canvas.releasePointerCapture(this.mousePointerId); } catch {}
    this.mousePointerId = null;
    this.mouseFireQueuedUntil = 0;
    this.touchFireQueuedUntil = 0;
    this.touchFireAimReady = false;
    this.touchFireAimGraceUntil = 0;
    this.moveTouch = { x: 0, y: 0 };
    this.aimTouch = { ...this.aimTouch, firing: false };
    this.touchAimManual = false;
    this.touchModeUntil = 0;
    const movementSurface = this.mobileControls?.movementSurface || this.canvas;
    const movementGuide = this.mobileControls?.movementGuide;
    const fireButton = this.mobileControls?.fireButton;
    try { if (this.freeMovePointerId !== null) movementSurface.releasePointerCapture(this.freeMovePointerId); } catch {}
    try { if (this.firePointerId !== null) fireButton?.releasePointerCapture(this.firePointerId); } catch {}
    this.freeMovePointerId = null;
    this.firePointerId = null;
    if (movementGuide) movementGuide.hidden = true;
    fireButton?.classList.remove("active");
    fireButton?.style.removeProperty("--aim-x");
    fireButton?.style.removeProperty("--aim-y");
    this.moveOutput = { x: 0, y: 0 };
    this.lastSampleAt = performance.now();
  }
}
