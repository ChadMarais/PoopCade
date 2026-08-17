const EPSILON = 1e-8;

export function transformNormalizedPolygon(definition, instance) {
  const { width, height, x, y } = instance;
  const left = x - definition.anchor.x * width;
  const top = y - definition.anchor.y * height;
  const rotation = (Number(instance.rotation) || 0) * Math.PI / 180;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const normalizedPoints = definition.collision?.points ?? definition.collisionPolygon;
  if (!Array.isArray(normalizedPoints)) throw new Error(`Asset ${definition.id || "unknown"} has no normalized collision polygon.`);
  return normalizedPoints.map((point) => {
    const unrotatedX = left + point.x * width;
    const unrotatedY = top + point.y * height;
    const offsetX = unrotatedX - x;
    const offsetY = unrotatedY - y;
    return {
      x: x + offsetX * cosine - offsetY * sine,
      y: y + offsetX * sine + offsetY * cosine,
    };
  });
}

export function collisionBlocksMovement(definition) {
  return definition.blocksMovement === true || definition.collision?.blocksMovement === true;
}

export function collisionBlocksProjectiles(definition) {
  const explicit = definition.blocksProjectiles ?? definition.collision?.blocksProjectiles;
  // A solid object blocks shots by default. Below-ground objects such as lava
  // ditches opt out explicitly while retaining movement collision.
  return explicit === undefined ? collisionBlocksMovement(definition) : explicit === true;
}

export function depthSortY(definition, instance) {
  const normalizedY = definition.depthSortAnchor?.y ?? definition.depth?.sortAnchorY ?? definition.anchor.y;
  const rotation = (Number(instance.rotation) || 0) * Math.PI / 180;
  return instance.y + (normalizedY - definition.anchor.y) * instance.height * Math.cos(rotation);
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

export function createPolygonBroadphase(polygons, cellSize = 384) {
  const safeCellSize = Math.max(64, Number(cellSize) || 384);
  let cells = null;
  let polygonCount = -1;
  const seen = [];
  let stamp = 0;

  const rebuild = () => {
    cells = new Map();
    polygonCount = polygons.length;
    seen.length = polygonCount;
    for (let index = 0; index < polygons.length; index += 1) {
      const polygon = polygons[index];
      if (!polygon?.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of polygon) {
        minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
      }
      const firstColumn = Math.floor(minX / safeCellSize);
      const lastColumn = Math.floor(maxX / safeCellSize);
      const firstRow = Math.floor(minY / safeCellSize);
      const lastRow = Math.floor(maxY / safeCellSize);
      for (let row = firstRow; row <= lastRow; row += 1) for (let column = firstColumn; column <= lastColumn; column += 1) {
        const key = `${column},${row}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(index); else cells.set(key, [index]);
      }
    }
  };

  return {
    invalidate() { cells = null; polygonCount = -1; },
    queryBounds(minX, minY, maxX, maxY) {
      if (!cells || polygonCount !== polygons.length) rebuild();
      stamp += 1;
      if (stamp >= 2_000_000_000) { seen.fill(0); stamp = 1; }
      const indices = [];
      const firstColumn = Math.floor(minX / safeCellSize);
      const lastColumn = Math.floor(maxX / safeCellSize);
      const firstRow = Math.floor(minY / safeCellSize);
      const lastRow = Math.floor(maxY / safeCellSize);
      for (let row = firstRow; row <= lastRow; row += 1) for (let column = firstColumn; column <= lastColumn; column += 1) {
        for (const index of cells.get(`${column},${row}`) || []) {
          if (seen[index] === stamp) continue;
          seen[index] = stamp;
          indices.push(index);
        }
      }
      indices.sort((a, b) => a - b);
      return indices.map((index) => polygons[index]);
    },
    queryCircle(center, radius) {
      return this.queryBounds(center.x - radius, center.y - radius, center.x + radius, center.y + radius);
    },
    querySegment(start, end, radius = 0) {
      return this.queryBounds(
        Math.min(start.x, end.x) - radius,
        Math.min(start.y, end.y) - radius,
        Math.max(start.x, end.x) + radius,
        Math.max(start.y, end.y) + radius,
      );
    },
  };
}

export function resolveCircleAgainstPolygons(position, radius, polygons, iterations = 4, broadphase = null) {
  const resolved = { x: position.x, y: position.y };
  for (let pass = 0; pass < iterations; pass += 1) {
    let moved = false;
    const candidates = broadphase?.queryCircle(resolved, radius) || polygons;
    for (const polygon of candidates) {
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

export function moveCircleWithSliding(position, displacement, radius, polygons, broadphase = null) {
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
      4,
      broadphase,
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
