/** 넉백 유틸 (간단 즉시 이동 방식)
 * selfKnockback(entity, { direction: 'facing' | 'opposite', distancePx, angleRad?, durationMs? })
 * targetKnockback(attacker, target, { direction: 'skill' | 'away', distancePx, angleRad?, durationMs? })
 */

function _normalize(vx, vy) {
  const len = Math.hypot(vx, vy) || 0;
  if (len === 0) return { x: 0, y: 0 };
  return { x: vx / len, y: vy / len };
}

function _entityRadius(entity) {
  if (typeof entity.HIT_R === "number") return Math.max(0, entity.HIT_R);
  const bw = entity?.body?.width || 0;
  const bh = entity?.body?.height || 0;
  return Math.max(bw, bh) / 2;
}

function _isFree(wallLayer, x, y, r) {
  if (!wallLayer) return true;
  const points = [
    { x: x - r, y },
    { x: x + r, y },
    { x, y: y - r },
    { x, y: y + r },
    { x: x - r * 0.7071, y: y - r * 0.7071 },
    { x: x + r * 0.7071, y: y - r * 0.7071 },
    { x: x - r * 0.7071, y: y + r * 0.7071 },
    { x: x + r * 0.7071, y: y + r * 0.7071 },
  ];
  for (const p of points) {
    const tx = wallLayer.worldToTileX(p.x);
    const ty = wallLayer.worldToTileY(p.y);
    if (wallLayer.hasTileAt(tx, ty)) return false;
  }
  return true;
}

function _moveWithBlocking(entity, dx, dy) {
  const layer = entity?.wallLayer;
  const r = _entityRadius(entity);
  const dist = Math.hypot(dx, dy);
  if (dist <= 0) return;
  const step = 2; // px per step
  const steps = Math.max(1, Math.ceil(dist / step));
  const stepx = dx / steps;
  const stepy = dy / steps;
  let nx = entity.x;
  let ny = entity.y;
  for (let i = 1; i <= steps; i++) {
    const cx = entity.x + stepx * i;
    const cy = entity.y + stepy * i;
    if (_isFree(layer, cx, cy, r)) {
      nx = cx;
      ny = cy;
    } else {
      break; // stop before collision
    }
  }
  entity.setPosition(nx, ny);
}

export function selfKnockback(entity, opts = {}) {
  const direction = opts.direction === "facing" ? "facing" : "opposite";
  const distancePx = Math.max(0, opts.distancePx ?? 0);
  if (!entity || distancePx <= 0) return;

  // 기준 각도: 인자로 오면 우선, 없으면 현재 스킬 각 또는 바라보는 각
  let angle =
    typeof opts.angleRad === "number"
      ? opts.angleRad
      : typeof entity.getSkillAimAngle === "function"
      ? entity.getSkillAimAngle()
      : typeof entity._facingAngleRad === "function"
      ? entity._facingAngleRad()
      : 0;

  if (direction === "opposite") angle += Math.PI; // 반대 방향

  const nx = Math.cos(angle),
    ny = Math.sin(angle);
  const dx = nx * distancePx,
    dy = ny * distancePx;
  _moveWithBlocking(entity, dx, dy);
}

export function targetKnockback(attacker, target, opts = {}) {
  const direction = opts.direction === "skill" ? "skill" : "away";
  const distancePx = Math.max(0, opts.distancePx ?? 0);
  if (!attacker || !target || distancePx <= 0) return;

  let nx = 0,
    ny = 0;
  if (direction === "skill") {
    const angle =
      typeof opts.angleRad === "number"
        ? opts.angleRad
        : typeof attacker.getSkillAimAngle === "function"
        ? attacker.getSkillAimAngle()
        : typeof attacker._facingAngleRad === "function"
        ? attacker._facingAngleRad()
        : 0;
    nx = Math.cos(angle);
    ny = Math.sin(angle);
  } else {
    // away: 타겟 → 공격자 반대 방향(타겟에서 공격자까지의 벡터 반대 = 타겟이 공격자로부터 멀어지게)
    const vx = target.x - attacker.x;
    const vy = target.y - attacker.y;
    const n = _normalize(vx, vy);
    nx = n.x;
    ny = n.y;
  }

  const dx = nx * distancePx,
    dy = ny * distancePx;
  // 대상 쪽도 벽을 넘지 않도록 이동
  _moveWithBlocking(target, dx, dy);
}
