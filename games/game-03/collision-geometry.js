const EPSILON = 1e-8;

export function transformNormalizedPolygon(definition, instance) {
  const { width, height, x, y } = instance;
  const left = x - definition.anchor.x * width;
  const top = y - definition.anchor.y * height;
  const normalizedPoints = definition.collision?.points ?? definition.collisionPolygon;
  if (!Array.isArray(normalizedPoints)) throw new Error(`Asset ${definition.id || "unknown"} has no normalized collision polygon.`);
  return normalizedPoints.map((point) => ({
    x: left + point.x * width,
    y: top + point.y * height,
  }));
}

export function collisionBlocksMovement(definition) {
  return definition.blocksMovement === true || definition.collision?.blocksMovement === true;
}

export function collisionBlocksProjectiles(definition) {
  return definition.blocksProjectiles === true || definition.collision?.blocksProjectiles === true;
}

export function depthSortY(definition, instance) {
  const normalizedY = definition.depthSortAnchor?.y ?? definition.depth?.sortAnchorY ?? definition.anchor.y;
  return instance.y + (normalizedY - definition.anchor.y) * instance.height;
}

export function polygonSignedArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

export function isConvexPolygon(points) {
  let direction = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= EPSILON) continue;
    const sign = Math.sign(cross);
    if (direction && sign !== direction) return false;
    direction = sign;
  }
  return true;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(point, start, end) {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  const amount = lengthSquared <= EPSILON
    ? 0
    : Math.max(0, Math.min(1, ((point.x - start.x) * edgeX + (point.y - start.y) * edgeY) / lengthSquared));
  return { x: start.x + edgeX * amount, y: start.y + edgeY * amount };
}

export function circlePolygonPenetration(center, radius, polygon) {
  const inside = pointInPolygon(center, polygon);
  let closest = null;
  let closestDistanceSquared = Infinity;
  let closestEdge = null;

  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const point = closestPointOnSegment(center, start, end);
    const deltaX = center.x - point.x;
    const deltaY = center.y - point.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closest = point;
      closestEdge = { start, end };
    }
  }

  if (!inside && closestDistanceSquared >= radius * radius) return null;

  const distance = Math.sqrt(closestDistanceSquared);
  if (distance > EPSILON) {
    const direction = inside ? -1 : 1;
    const depth = inside ? radius + distance : radius - distance;
    return {
      x: ((center.x - closest.x) / distance) * depth * direction,
      y: ((center.y - closest.y) / distance) * depth * direction,
      depth,
    };
  }

  const edgeX = closestEdge.end.x - closestEdge.start.x;
  const edgeY = closestEdge.end.y - closestEdge.start.y;
  const edgeLength = Math.hypot(edgeX, edgeY) || 1;
  const clockwise = polygonSignedArea(polygon) > 0;
  const normalX = clockwise ? edgeY / edgeLength : -edgeY / edgeLength;
  const normalY = clockwise ? -edgeX / edgeLength : edgeX / edgeLength;
  return { x: normalX * radius, y: normalY * radius, depth: radius };
}

export function resolveCircleAgainstPolygons(position, radius, polygons, iterations = 4) {
  const resolved = { x: position.x, y: position.y };
  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    for (const polygon of polygons) {
      const penetration = circlePolygonPenetration(resolved, radius, polygon);
      if (!penetration) continue;
      resolved.x += penetration.x;
      resolved.y += penetration.y;
      moved = true;
    }
    if (!moved) break;
  }
  return resolved;
}

export function moveCircleWithSliding(position, displacement, radius, polygons) {
  const distance = Math.hypot(displacement.x, displacement.y);
  const maximumStep = Math.max(1, radius * 0.45);
  const steps = Math.max(1, Math.ceil(distance / maximumStep));
  const stepX = displacement.x / steps;
  const stepY = displacement.y / steps;
  let resolved = { x: position.x, y: position.y };

  for (let step = 0; step < steps; step += 1) {
    resolved = resolveCircleAgainstPolygons(
      { x: resolved.x + stepX, y: resolved.y + stepY },
      radius,
      polygons,
    );
  }
  return resolved;
}

function orientation(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0));
}

function pointSegmentDistanceSquared(point, start, end) {
  const closest = closestPointOnSegment(point, start, end);
  const x = point.x - closest.x;
  const y = point.y - closest.y;
  return x * x + y * y;
}

function segmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b),
  );
}

export function sweptCircleIntersectsPolygon(start, end, radius, polygon) {
  if (pointInPolygon(start, polygon) || pointInPolygon(end, polygon)) return true;
  const radiusSquared = radius * radius;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    if (segmentDistanceSquared(start, end, edgeStart, edgeEnd) <= radiusSquared) return true;
  }
  return false;
}

export function distanceToPolygon(point, polygon) {
  if (pointInPolygon(point, polygon)) return 0;
  let distanceSquared = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    distanceSquared = Math.min(
      distanceSquared,
      pointSegmentDistanceSquared(point, polygon[index], polygon[(index + 1) % polygon.length]),
    );
  }
  return Math.sqrt(distanceSquared);
}
