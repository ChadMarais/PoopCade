const PANEL_MARGIN = 8;

export function clampDraggablePanelPosition(left, top, width, height, viewportWidth, viewportHeight, margin = PANEL_MARGIN) {
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top)),
  };
}

export function makePanelDraggable(panel, handle = panel) {
  if (!panel || !handle) return () => {};
  let drag = null;
  let positioned = false;

  const keepVisible = () => {
    if (!positioned || panel.hidden) return;
    const rect = panel.getBoundingClientRect();
    const position = clampDraggablePanelPosition(rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
  };

  const move = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const position = clampDraggablePanelPosition(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
      rect.width,
      rect.height,
      window.innerWidth,
      window.innerHeight,
    );
    panel.style.left = `${position.left}px`;
    panel.style.top = `${position.top}px`;
  };

  const end = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    try { handle.releasePointerCapture(event.pointerId); } catch {}
    keepVisible();
    drag = null;
    panel.classList.remove("dragging");
  };

  const start = (event) => {
    if (event.button !== 0 || event.target.closest("button, input, select, a, label")) return;
    const rect = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    positioned = true;
    panel.classList.add("dragging");
    try { handle.setPointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  };

  handle.addEventListener("pointerdown", start);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", end, true);
  window.addEventListener("resize", keepVisible);
  const resizeObserver = new ResizeObserver(keepVisible);
  resizeObserver.observe(panel);
  return () => {
    handle.removeEventListener("pointerdown", start);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", end, true);
    window.removeEventListener("resize", keepVisible);
    resizeObserver.disconnect();
  };
}
