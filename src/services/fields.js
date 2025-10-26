import { applySlow } from "./debuffs.js";

/** 회전 정사각형 필드(원형 판정) 생성 */
export function spawnVortexField(
  scene,
  owner,
  {
    cx,
    cy,
    side,
    durationMs = 3000,
    pullPxPerTick = 4,
    tickDamage = 1,
    tickIntervalMs = 500,
    slowPercent = 0.3,
    slowDurationMs = 500,
  } = {}
) {
  const g = scene.add.graphics().setDepth(12);
  const half = side / 2;
  const radius = Math.sqrt(2) * half * 0.9; // 원형 판정 반지름(조금 작게)

  // 비주얼 회전 애니
  const drawSquare = (angle) => {
    g.clear();
    g.save();
    g.translateCanvas(cx, cy);
    g.rotateCanvas(angle);
    g.fillStyle(0x7f00ff, 0.25);
    g.fillRect(-half, -half, side, side);
    g.restore();
  };
  drawSquare(0);
  const tween = scene.tweens.addCounter({
    from: 0,
    to: Math.PI * 2,
    duration: durationMs,
    onUpdate: (tw) => drawSquare(tw.getValue() * 0.2), // 천천히 회전
  });

  // 끌어당김 및 주기 피해/슬로우
  const pullTimer = scene.time.addEvent({
    delay: 60,
    loop: true,
    callback: () => {
      const targets = scene.targets?.getChildren?.() || [];
      for (const t of targets) {
        if (!t || !t.active || t === owner) continue;
        const dx = cx - t.x,
          dy = cy - t.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius) {
          const nx = dx / (dist || 1), ny = dy / (dist || 1);
          const wantX = t.x + nx * pullPxPerTick;
          const wantY = t.y + ny * pullPxPerTick;
          // 벽 차단: 단계적으로 가장 가까운 안전 지점까지만 이동
          const layer = t.wallLayer || scene.wallLayer;
          const r = Math.max(
            t.HIT_R ?? 0,
            Math.max(t.body?.width || 0, t.body?.height || 0) / 2
          );
          const isFree = (x, y) => {
            if (!layer) return true;
            const pts = [
              { x: x - r, y },
              { x: x + r, y },
              { x, y: y - r },
              { x, y: y + r },
              { x: x - r * 0.7071, y: y - r * 0.7071 },
              { x: x + r * 0.7071, y: y - r * 0.7071 },
              { x: x - r * 0.7071, y: y + r * 0.7071 },
              { x: x + r * 0.7071, y: y + r * 0.7071 },
            ];
            for (const p of pts) {
              const tx = layer.worldToTileX(p.x);
              const ty = layer.worldToTileY(p.y);
              if (layer.hasTileAt(tx, ty)) return false;
            }
            return true;
          };
          const step = 2;
          const ddx = wantX - t.x;
          const ddy = wantY - t.y;
          const dlen = Math.hypot(ddx, ddy);
          const steps = Math.max(1, Math.ceil(dlen / step));
          let nxPos = t.x, nyPos = t.y;
          for (let i = 1; i <= steps; i++) {
            const cx2 = t.x + (ddx * i) / steps;
            const cy2 = t.y + (ddy * i) / steps;
            if (isFree(cx2, cy2)) {
              nxPos = cx2;
              nyPos = cy2;
            } else {
              break;
            }
          }
          t.setPosition(nxPos, nyPos);
        }
      }
    },
  });

  let tickIndex = 0;
  const dmgTimer = scene.time.addEvent({
    delay: tickIntervalMs,
    loop: true,
    callback: () => {
      tickIndex++;
      const targets = scene.targets?.getChildren?.() || [];
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t || !t.active || t === owner) continue;
        const dx = cx - t.x,
          dy = cy - t.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= radius) {
          if (typeof t.receiveDamage === "function") {
            const baseId = owner?.getAttackSegmentId
              ? owner.getAttackSegmentId("C", tickIndex)
              : `C-field-${scene.time.now | 0}`;
            const skillId = `${baseId}-i${i}`; // 타겟마다 고유화하여 중복 히트 방지 충돌 회피
            t.receiveDamage(tickDamage, owner, skillId, 0);
          }
          applySlow(scene, t, {
            percent: slowPercent,
            durationMs: slowDurationMs,
          });
        }
      }
    },
  });

  scene.time.delayedCall(durationMs, () => {
    tween?.stop();
    pullTimer?.remove();
    dmgTimer?.remove();
    g.destroy();
  });
}
