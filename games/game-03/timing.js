export function consumeFixedStep(accumulator, delta, step) {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1 / 30;
  const safeAccumulator = Number.isFinite(accumulator) ? Math.max(0, accumulator) : 0;
  const safeDelta = Number.isFinite(delta) ? Math.max(0, delta) : 0;
  const total = safeAccumulator + safeDelta;
  if (total + 1e-9 < safeStep) return { consumed: false, remainder: total };
  return { consumed: true, remainder: Math.max(0, total - safeStep) };
}

export function convergeVisualPosition(integrated, target, delta, rate = 8, snapDistance = 80) {
  if (!integrated || !Number.isFinite(integrated.x) || !Number.isFinite(integrated.y)) return target;
  if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return integrated;
  const errorX = target.x - integrated.x;
  const errorY = target.y - integrated.y;
  if (Math.hypot(errorX, errorY) > snapDistance) return { x: target.x, y: target.y };
  const safeDelta = Number.isFinite(delta) ? Math.max(0, Math.min(.05, delta)) : 0;
  const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 8;
  const blend = 1 - Math.exp(-safeDelta * safeRate);
  return { x: integrated.x + errorX * blend, y: integrated.y + errorY * blend };
}
