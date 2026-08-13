import { closestPointOnSegment, pointInPolygon, polygonSignedArea, transformNormalizedPolygon } from "./collision-geometry.js?v=20260813";

const HANDLE_RADIUS = 7;
const HANDLE_HIT_RADIUS = 14;
const EDGE_HIT_DISTANCE = 20;
const CAMERA_PAN_SPEED = 520;

function clonePoints(points) {
  return points.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function rounded(value) {
  return Math.round(value * 10000) / 10000;
}

export function normalizedCollisionPoints(definition) {
  const points = definition?.collision?.points ?? definition?.collisionPolygon;
  if (!Array.isArray(points)) throw new Error(`Asset ${definition?.id || "unknown"} has no editable collision polygon.`);
  return clonePoints(points);
}

export function worldToNormalized(point, definition, instance) {
  const left = instance.x - definition.anchor.x * instance.width;
  const top = instance.y - definition.anchor.y * instance.height;
  return {
    x: rounded((point.x - left) / instance.width),
    y: rounded((point.y - top) / instance.height),
  };
}

export function applyCollisionDraft(assetId, draft, environment) {
  const matching = environment.filter((item) => item.assetId === assetId);
  for (const item of matching) {
    if (item.definition.collision?.points) item.definition.collision.points = clonePoints(draft);
    else item.definition.collisionPolygon = clonePoints(draft);
    const transformed = transformNormalizedPolygon(item.definition, item);
    item.polygon.splice(0, item.polygon.length, ...transformed);
  }
  return matching.length;
}

export function serializeCollisionDefinition(definition, draft) {
  const exported = JSON.parse(JSON.stringify(definition));
  const points = clonePoints(draft).map((point) => ({ x: rounded(point.x), y: rounded(point.y) }));
  if (exported.collision?.points) exported.collision.points = points;
  else exported.collisionPolygon = points;
  return `${JSON.stringify(exported, null, 2)}\n`;
}

export function editorCameraPanVector(keys, delta, speed = CAMERA_PAN_SPEED) {
  const x = Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
  const y = Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
  const length = Math.hypot(x, y) || 1;
  return { x: x / length * speed * delta, y: y / length * speed * delta };
}

function distanceSquared(a, b) {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return x * x + y * y;
}

function closestEdge(point, polygon) {
  let result = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const closest = closestPointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length]);
    const candidate = { index, point: closest, distanceSquared: distanceSquared(point, closest) };
    if (!result || candidate.distanceSquared < result.distanceSquared) result = candidate;
  }
  return result;
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access was denied.");
}

async function saveJsonFile(assetId, definition) {
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    throw new Error("Direct collision saving is available only from localhost debug mode.");
  }
  const response = await fetch(`http://${location.hostname}:8081/__dusty-orbit/save-collision`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ assetId, definition }),
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 404 || response.status === 405) {
      throw new Error("Direct save is unavailable. Start the authoring helper with: node tools/dusty-dev-server.mjs");
    }
    throw new Error(result?.error || `Direct save failed (${response.status}).`);
  }
  return result;
}

export class CollisionEditor {
  constructor({ canvas, assets, renderer, input, panel, select, toggle, copy, save, reset, remove, status, persistence, onActivate = () => {} }) {
    this.canvas = canvas;
    this.assets = assets;
    this.renderer = renderer;
    this.input = input;
    this.panel = panel;
    this.select = select;
    this.toggle = toggle;
    this.copyButton = copy;
    this.saveButton = save;
    this.resetButton = reset;
    this.removeButton = remove;
    this.status = status;
    this.persistence = persistence;
    this.onActivate = onActivate;
    this.visible = false;
    this.active = false;
    this.dragPointerId = null;
    this.selectedPoint = null;
    this.panKeys = new Set();
    this.cameraFocus = null;
    this.dirtyAssetIds = new Set();
    this.saving = false;
    this.lastCameraKey = "";
    this.originalDebugFocus = renderer.debugFocus;
    this.originalByAssetId = new Map();
    this.draftByAssetId = new Map();

    for (const item of assets.environment) {
      if (this.originalByAssetId.has(item.assetId)) continue;
      const points = normalizedCollisionPoints(item.definition);
      this.originalByAssetId.set(item.assetId, clonePoints(points));
      this.draftByAssetId.set(item.assetId, clonePoints(points));
    }

    for (const item of assets.environment) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.id} · ${item.assetId}`;
      select.append(option);
    }
    this.selectedId = assets.environment[0]?.id || "";
    select.value = this.selectedId;

    toggle.addEventListener("click", () => this.setActive(!this.active));
    select.addEventListener("change", () => this.selectInstance(select.value));
    copy.addEventListener("click", () => this.copyJson());
    save.addEventListener("click", () => this.saveJson());
    reset.addEventListener("click", () => this.resetSelected());
    remove.addEventListener("click", () => this.removeSelectedPoint());

    canvas.addEventListener("pointerdown", (event) => this.pointerDown(event), true);
    window.addEventListener("pointermove", (event) => this.pointerMove(event), true);
    window.addEventListener("pointerup", (event) => this.pointerUp(event), true);
    window.addEventListener("pointercancel", (event) => this.pointerUp(event), true);
    window.addEventListener("keydown", (event) => this.keyDown(event), true);
    window.addEventListener("keyup", (event) => this.keyUp(event), true);
    this.refreshStatus("Editor ready. Turn editing on to move collision points.");
    this.checkPersistence();
  }

  get selected() {
    return this.assets.environment.find((item) => item.id === this.selectedId) || null;
  }

  get draft() {
    return this.selected ? this.draftByAssetId.get(this.selected.assetId) : null;
  }

  setVisible(visible) {
    this.visible = Boolean(visible);
    this.panel.hidden = !this.visible;
    if (!this.visible) this.setActive(false);
  }

  setActive(active) {
    const next = Boolean(active) && this.visible;
    if (next) this.onActivate();
    this.active = next;
    this.input.setEditorBlocked(this.active);
    this.canvas.classList.toggle("collision-editing", this.active);
    this.toggle.textContent = this.active ? "EDIT: ON" : "EDIT: OFF";
    this.toggle.classList.toggle("active", this.active);
    if (this.active && this.selected) {
      this.cameraFocus = { x: this.selected.x, y: this.selected.y };
      this.renderer.debugFocus = this.cameraFocus;
    } else {
      this.panKeys.clear();
      this.cameraFocus = null;
      this.renderer.debugFocus = this.originalDebugFocus;
    }
    this.refreshStatus(this.active
      ? "Drag a point. Shift-click an edge to add one. Delete removes it. Arrow keys pan the camera."
      : "Editing is off; game controls are active.");
  }

  selectInstance(id) {
    if (!this.assets.environment.some((item) => item.id === id)) return;
    this.selectedId = id;
    this.select.value = id;
    this.selectedPoint = null;
    if (this.active) {
      this.cameraFocus = { x: this.selected.x, y: this.selected.y };
      this.renderer.debugFocus = this.cameraFocus;
    }
    this.refreshStatus();
  }

  screenToWorld(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + this.renderer.camera.x,
      y: event.clientY - rect.top + this.renderer.camera.y,
    };
  }

  pointerDown(event) {
    if (!this.active || event.button > 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const world = this.screenToWorld(event);
    const selected = this.selected;
    if (!selected) return;

    let pointIndex = selected.polygon.findIndex((point) => distanceSquared(point, world) <= HANDLE_HIT_RADIUS * HANDLE_HIT_RADIUS);
    if (pointIndex < 0 && event.shiftKey) {
      const edge = closestEdge(world, selected.polygon);
      if (!edge || edge.distanceSquared > EDGE_HIT_DISTANCE * EDGE_HIT_DISTANCE) {
        this.refreshStatus("Shift-click closer to a collision edge to add a point.");
        return;
      }
      pointIndex = edge.index + 1;
      this.draft.splice(pointIndex, 0, worldToNormalized(edge.point, selected.definition, selected));
      this.applyDraft();
    } else if (pointIndex < 0) {
      const hit = [...this.assets.environment].reverse().find((item) => pointInPolygon(world, item.polygon));
      if (hit && hit.id !== selected.id) this.selectInstance(hit.id);
      return;
    }

    this.selectedPoint = pointIndex;
    this.dragPointerId = event.pointerId;
    try { this.canvas.setPointerCapture(event.pointerId); } catch {}
    this.refreshStatus();
  }

  pointerMove(event) {
    if (!this.active || event.pointerId !== this.dragPointerId || this.selectedPoint === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.draft[this.selectedPoint] = worldToNormalized(this.screenToWorld(event), this.selected.definition, this.selected);
    this.applyDraft();
  }

  pointerUp(event) {
    if (event.pointerId !== this.dragPointerId) return;
    if (this.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    try { this.canvas.releasePointerCapture(event.pointerId); } catch {}
    this.dragPointerId = null;
  }

  keyDown(event) {
    if (!this.active) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.panKeys.add(event.code);
      return;
    }
    if (event.code === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setActive(false);
      return;
    }
    if (event.code !== "Delete" && event.code !== "Backspace") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.removeSelectedPoint();
  }

  keyUp(event) {
    if (!this.active || !this.panKeys.has(event.code)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.panKeys.delete(event.code);
  }

  update(delta) {
    if (!this.active || !this.cameraFocus || !this.panKeys.size) return;
    const pan = editorCameraPanVector(this.panKeys, Math.max(0, Math.min(.05, delta)));
    this.cameraFocus.x = Math.max(0, Math.min(this.assets.world.width, this.cameraFocus.x + pan.x));
    this.cameraFocus.y = Math.max(0, Math.min(this.assets.world.height, this.cameraFocus.y + pan.y));
  }

  applyDraft() {
    const selected = this.selected;
    if (!selected) return;
    applyCollisionDraft(selected.assetId, this.draft, this.assets.environment);
    this.dirtyAssetIds.add(selected.assetId);
    this.renderer.minimapSurfaces.clear();
    this.refreshStatus();
  }

  removeSelectedPoint() {
    if (!this.active || this.selectedPoint === null) {
      this.refreshStatus("Select a collision point before deleting it.");
      return;
    }
    if (this.draft.length <= 3) {
      this.refreshStatus("A collision polygon must keep at least three points.");
      return;
    }
    this.draft.splice(this.selectedPoint, 1);
    this.selectedPoint = Math.min(this.selectedPoint, this.draft.length - 1);
    this.applyDraft();
  }

  resetSelected() {
    const selected = this.selected;
    if (!selected) return;
    const original = clonePoints(this.originalByAssetId.get(selected.assetId));
    this.draftByAssetId.set(selected.assetId, original);
    applyCollisionDraft(selected.assetId, original, this.assets.environment);
    this.dirtyAssetIds.delete(selected.assetId);
    this.selectedPoint = null;
    this.renderer.minimapSurfaces.clear();
    this.refreshStatus("Restored the collision points loaded from JSON.");
  }

  async copyJson() {
    const selected = this.selected;
    if (!selected) return;
    try {
      await writeClipboard(serializeCollisionDefinition(selected.definition, this.draft));
      this.refreshStatus(`Copied ${selected.assetId}.json. Save it over the matching asset JSON, then reload the Worker.`);
    } catch (error) {
      this.refreshStatus(`Copy failed: ${error.message}`);
    }
  }

  async saveJson() {
    if (this.saving) return;
    const selected = this.selected;
    if (!selected) return;
    this.saving = true;
    this.saveButton.disabled = true;
    try {
      const definition = JSON.parse(serializeCollisionDefinition(selected.definition, this.draft));
      const saved = await saveJsonFile(selected.assetId, definition);
      this.originalByAssetId.set(selected.assetId, clonePoints(this.draft));
      this.dirtyAssetIds.delete(selected.assetId);
      this.setPersistenceState(true);
      this.refreshStatus(`Saved ${saved.path}. This file is now the canonical collision definition; the local Worker reloads it in dev mode.`);
    } catch (error) {
      this.setPersistenceState(false);
      this.refreshStatus(`Save failed: ${error.message}`);
    } finally {
      this.saving = false;
      this.saveButton.disabled = false;
    }
  }

  async checkPersistence() {
    if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      this.setPersistenceState(false);
      return false;
    }
    try {
      const response = await fetch(`http://${location.hostname}:8081/__dusty-orbit/authoring-health`, { cache: "no-store" });
      const result = response.ok ? await response.json() : null;
      const online = result?.ok === true && result.service === "dusty-collision-authoring";
      this.setPersistenceState(online);
      return online;
    } catch {
      this.setPersistenceState(false);
      return false;
    }
  }

  setPersistenceState(online) {
    this.persistence.textContent = online ? "SAVE ONLINE" : "SAVE OFFLINE";
    this.persistence.classList.toggle("online", online);
    this.persistence.classList.toggle("offline", !online);
  }

  refreshStatus(message = "") {
    const selected = this.selected;
    if (!selected) {
      this.status.textContent = message || "No static objects are available.";
      return;
    }
    const sharedCount = this.assets.environment.filter((item) => item.assetId === selected.assetId).length;
    const shared = sharedCount > 1 ? ` · updates ${sharedCount} instances` : "";
    const dirty = this.dirtyAssetIds.has(selected.assetId) ? " · UNSAVED" : "";
    const winding = polygonSignedArea(this.draft) >= 0 ? "CW" : "CCW";
    const point = this.selectedPoint === null ? "" : ` · point ${this.selectedPoint + 1} selected`;
    this.status.textContent = `${message ? `${message}\n` : ""}${selected.assetId}.json · ${this.draft.length} points · ${winding}${point}${shared}${dirty}\nArrow keys pan the camera while editing. Save JSON writes the canonical repository file.`;
  }

  draw(ctx, camera) {
    if (!this.active || !this.selected) return;
    const cameraKey = `${Math.round(camera.x)},${Math.round(camera.y)}`;
    if (cameraKey !== this.lastCameraKey) {
      this.panel.dataset.camera = cameraKey;
      this.lastCameraKey = cameraKey;
    }
    const polygon = this.selected.polygon;
    ctx.save();
    ctx.strokeStyle = "#ff6ee7";
    ctx.fillStyle = "rgba(255,62,210,.12)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    polygon.forEach((point, index) => index
      ? ctx.lineTo(point.x - camera.x, point.y - camera.y)
      : ctx.moveTo(point.x - camera.x, point.y - camera.y));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    polygon.forEach((point, index) => {
      const x = point.x - camera.x;
      const y = point.y - camera.y;
      ctx.fillStyle = index === this.selectedPoint ? "#ffe866" : "#66f7ff";
      ctx.strokeStyle = "#16051f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, index === this.selectedPoint ? HANDLE_RADIUS + 2 : HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#12051a";
      ctx.font = "900 8px ui-monospace,monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), x, y + .5);
    });
    ctx.restore();
  }
}
