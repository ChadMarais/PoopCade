import { closestPointOnSegment, depthSortY, pointInPolygon, polygonSignedArea, transformNormalizedPolygon } from "./collision-geometry.js?v=20260813-2";

const HANDLE_RADIUS = 7;
const HANDLE_HIT_RADIUS = 14;
const EDGE_HIT_DISTANCE = 20;
const CAMERA_PAN_SPEED = 520;
const ROTATION_HANDLE_DISTANCE = 46;
const ROTATION_HANDLE_HIT_RADIUS = 18;

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
  const rotation = -(Number(instance.rotation) || 0) * Math.PI / 180;
  const offsetX = point.x - instance.x;
  const offsetY = point.y - instance.y;
  const unrotated = {
    x: instance.x + offsetX * Math.cos(rotation) - offsetY * Math.sin(rotation),
    y: instance.y + offsetX * Math.sin(rotation) + offsetY * Math.cos(rotation),
  };
  const left = instance.x - definition.anchor.x * instance.width;
  const top = instance.y - definition.anchor.y * instance.height;
  return {
    x: rounded((unrotated.x - left) / instance.width),
    y: rounded((unrotated.y - top) / instance.height),
  };
}

function normalizedRotation(value) {
  const normalized = ((value % 360) + 540) % 360 - 180;
  return Object.is(normalized, -0) ? 0 : rounded(normalized);
}

export function placementForInstance(instance) {
  return { id: instance.id, x: rounded(instance.x), y: rounded(instance.y), rotation: normalizedRotation(Number(instance.rotation) || 0) };
}

export function serializeMapPlacement(instance) {
  const placement = placementForInstance(instance);
  return `{ id: ${JSON.stringify(placement.id)}, x: ${placement.x}, y: ${placement.y}, rotation: ${placement.rotation} }`;
}

export function applyPlacementDraft(instance, placement) {
  instance.x = rounded(placement.x);
  instance.y = rounded(placement.y);
  instance.rotation = normalizedRotation(placement.rotation);
  const transformed = transformNormalizedPolygon(instance.definition, instance);
  instance.polygon.splice(0, instance.polygon.length, ...transformed);
  instance.depthY = depthSortY(instance.definition, instance);
  return instance;
}

export function rotationHandlePosition(instance) {
  const rotation = (Number(instance.rotation) || 0) * Math.PI / 180;
  const distance = Math.max(instance.width, instance.height) / 2 + ROTATION_HANDLE_DISTANCE;
  return { x: instance.x + Math.sin(rotation) * distance, y: instance.y - Math.cos(rotation) * distance };
}

function pointInInstanceBounds(point, instance) {
  const rotation = -(Number(instance.rotation) || 0) * Math.PI / 180;
  const offsetX = point.x - instance.x;
  const offsetY = point.y - instance.y;
  const localX = offsetX * Math.cos(rotation) - offsetY * Math.sin(rotation);
  const localY = offsetX * Math.sin(rotation) + offsetY * Math.cos(rotation);
  return Math.abs(localX) <= instance.width / 2 && Math.abs(localY) <= instance.height / 2;
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

async function savePlacementFile(placement) {
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    throw new Error("Direct map saving is available only from localhost debug mode.");
  }
  const response = await fetch(`http://${location.hostname}:8081/__dusty-orbit/save-placement`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ placement }),
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
  constructor({ canvas, assets, renderer, input, panel, select, mode, toggle, copy, save, reset, remove, status, persistence, onActivate = () => {} }) {
    this.canvas = canvas;
    this.assets = assets;
    this.renderer = renderer;
    this.input = input;
    this.panel = panel;
    this.select = select;
    this.modeSelect = mode;
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
    this.dragMode = null;
    this.dragStart = null;
    this.selectedPoint = null;
    this.panKeys = new Set();
    this.cameraFocus = null;
    this.dirtyAssetIds = new Set();
    this.dirtyInstanceIds = new Set();
    this.saving = false;
    this.lastCameraKey = "";
    this.originalDebugFocus = renderer.debugFocus;
    this.originalByAssetId = new Map();
    this.draftByAssetId = new Map();
    this.originalByInstanceId = new Map();
    this.mode = mode?.value === "collision" ? "collision" : "transform";

    for (const item of assets.environment) {
      this.originalByInstanceId.set(item.id, placementForInstance(item));
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
    mode?.addEventListener("change", () => this.setMode(mode.value));
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
    this.updateModeControls();
    this.refreshStatus("Editor ready. Turn editing on to move and rotate map assets.");
    this.checkPersistence();
  }

  get selected() {
    return this.assets.environment.find((item) => item.id === this.selectedId) || null;
  }

  get draft() {
    return this.selected ? this.draftByAssetId.get(this.selected.assetId) : null;
  }

  setMode(mode) {
    this.mode = mode === "collision" ? "collision" : "transform";
    if (this.modeSelect) this.modeSelect.value = this.mode;
    this.selectedPoint = null;
    this.dragMode = null;
    this.dragStart = null;
    this.updateModeControls();
    this.refreshStatus(this.mode === "transform"
      ? "Transform mode: drag an asset to move it; drag the yellow handle to rotate it."
      : "Collision mode: drag a point; Shift-click an edge to add one.");
  }

  updateModeControls() {
    const transform = this.mode === "transform";
    this.saveButton.textContent = transform ? "SAVE PLACEMENT" : "SAVE COLLISION";
    this.copyButton.textContent = transform ? "COPY PLACEMENT" : "COPY JSON";
    this.resetButton.textContent = transform ? "RESET PLACEMENT" : "RESET COLLISION";
    this.removeButton.disabled = transform;
    this.removeButton.title = transform ? "Available in Collision Shape mode" : "Delete selected collision point";
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
      ? this.mode === "transform"
        ? "Drag an asset to move it. Drag the yellow handle to rotate. Q/E rotates by 5 degrees."
        : "Drag a point. Shift-click an edge to add one. Delete removes it. Arrow keys pan the camera."
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
    let selected = this.selected;
    if (!selected) return;

    if (this.mode === "transform") {
      const handle = rotationHandlePosition(selected);
      if (distanceSquared(handle, world) <= ROTATION_HANDLE_HIT_RADIUS * ROTATION_HANDLE_HIT_RADIUS) {
        this.dragMode = "rotate";
        this.dragStart = { pointerAngle: Math.atan2(world.y - selected.y, world.x - selected.x), rotation: Number(selected.rotation) || 0 };
      } else {
        const hit = [...this.assets.environment].reverse().find((item) => pointInInstanceBounds(world, item));
        if (!hit) return;
        if (hit.id !== selected.id) {
          this.selectInstance(hit.id);
          selected = hit;
        }
        this.dragMode = "move";
        this.dragStart = { pointerX: world.x, pointerY: world.y, x: selected.x, y: selected.y };
      }
      this.dragPointerId = event.pointerId;
      try { this.canvas.setPointerCapture(event.pointerId); } catch {}
      this.refreshStatus();
      return;
    }

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
    this.dragMode = "point";
    this.dragPointerId = event.pointerId;
    try { this.canvas.setPointerCapture(event.pointerId); } catch {}
    this.refreshStatus();
  }

  pointerMove(event) {
    if (!this.active || event.pointerId !== this.dragPointerId || !this.dragMode) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const world = this.screenToWorld(event);
    if (this.dragMode === "move") {
      this.applyPlacement({
        x: Math.max(0, Math.min(this.assets.world.width, this.dragStart.x + world.x - this.dragStart.pointerX)),
        y: Math.max(0, Math.min(this.assets.world.height, this.dragStart.y + world.y - this.dragStart.pointerY)),
        rotation: Number(this.selected.rotation) || 0,
      });
      return;
    }
    if (this.dragMode === "rotate") {
      const pointerAngle = Math.atan2(world.y - this.selected.y, world.x - this.selected.x);
      let rotation = this.dragStart.rotation + (pointerAngle - this.dragStart.pointerAngle) * 180 / Math.PI;
      if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
      this.applyPlacement({ x: this.selected.x, y: this.selected.y, rotation });
      return;
    }
    if (this.selectedPoint === null) return;
    this.draft[this.selectedPoint] = worldToNormalized(world, this.selected.definition, this.selected);
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
    this.dragMode = null;
    this.dragStart = null;
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
    if (this.mode === "transform" && (event.code === "KeyQ" || event.code === "KeyE")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const amount = (event.shiftKey ? 15 : 5) * (event.code === "KeyQ" ? -1 : 1);
      this.applyPlacement({ x: this.selected.x, y: this.selected.y, rotation: (Number(this.selected.rotation) || 0) + amount });
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

  applyPlacement(placement) {
    const selected = this.selected;
    if (!selected) return;
    applyPlacementDraft(selected, placement);
    this.dirtyInstanceIds.add(selected.id);
    this.renderer.minimapSurfaces.clear();
    this.refreshStatus();
  }

  removeSelectedPoint() {
    if (this.mode !== "collision" || !this.active || this.selectedPoint === null) {
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
    if (this.mode === "transform") {
      applyPlacementDraft(selected, this.originalByInstanceId.get(selected.id));
      this.dirtyInstanceIds.delete(selected.id);
      this.renderer.minimapSurfaces.clear();
      this.refreshStatus("Restored the placement loaded from map.js.");
      return;
    }
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
      if (this.mode === "transform") {
        await writeClipboard(serializeMapPlacement(selected));
        this.refreshStatus(`Copied ${selected.id} placement from map.js.`);
      } else {
        await writeClipboard(serializeCollisionDefinition(selected.definition, this.draft));
        this.refreshStatus(`Copied ${selected.assetId}.json. Save it over the matching asset JSON, then reload the Worker.`);
      }
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
      let saved;
      if (this.mode === "transform") {
        const placement = placementForInstance(selected);
        saved = await savePlacementFile(placement);
        this.originalByInstanceId.set(selected.id, placement);
        this.dirtyInstanceIds.delete(selected.id);
      } else {
        const definition = JSON.parse(serializeCollisionDefinition(selected.definition, this.draft));
        saved = await saveJsonFile(selected.assetId, definition);
        this.originalByAssetId.set(selected.assetId, clonePoints(this.draft));
        this.dirtyAssetIds.delete(selected.assetId);
      }
      this.setPersistenceState(true);
      this.refreshStatus(this.mode === "transform"
        ? `Saved ${selected.id} to ${saved.path}. Its position and orientation are now canonical; reload the local Worker.`
        : `Saved ${saved.path}. This file is now the canonical collision definition; reload the local Worker.`);
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
    if (this.mode === "transform") {
      const dirty = this.dirtyInstanceIds.has(selected.id) ? " · UNSAVED" : "";
      this.status.textContent = `${message ? `${message}\n` : ""}${selected.id}${dirty}\nX ${rounded(selected.x)} · Y ${rounded(selected.y)} · ROT ${normalizedRotation(Number(selected.rotation) || 0)}°\nDrag to move · yellow handle/Q/E to rotate · arrows pan camera. Save Placement writes map.js.`;
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
    if (this.mode === "transform") {
      const rotation = (Number(this.selected.rotation) || 0) * Math.PI / 180;
      const halfWidth = this.selected.width / 2;
      const halfHeight = this.selected.height / 2;
      const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([localX, localY]) => ({
        x: this.selected.x + localX * Math.cos(rotation) - localY * Math.sin(rotation) - camera.x,
        y: this.selected.y + localX * Math.sin(rotation) + localY * Math.cos(rotation) - camera.y,
      }));
      ctx.strokeStyle = "rgba(255,232,102,.86)";
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      corners.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      const handle = rotationHandlePosition(this.selected);
      const centerX = this.selected.x - camera.x;
      const centerY = this.selected.y - camera.y;
      const handleX = handle.x - camera.x;
      const handleY = handle.y - camera.y;
      ctx.beginPath(); ctx.moveTo(centerX, centerY); ctx.lineTo(handleX, handleY); ctx.stroke();
      ctx.fillStyle = "#ffe866"; ctx.strokeStyle = "#16051f"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(handleX, handleY, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(centerX, centerY, 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
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
