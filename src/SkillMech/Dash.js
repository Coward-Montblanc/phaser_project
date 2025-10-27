// 재사용 가능한 대시 스킬 모듈
// 사용법: import { runDash } from '../SkillMech/Dash.js';
//        runDash(player, { ...options });

/**
 * @param {Phaser.Physics.Arcade.Sprite} owner  // 플레이어(또는 유닛)
 * @param {Object} opts
 * @param {number} opts.distance   // 이동거리(px)
 * @param {number} opts.speed      // 속도(px/s)
 * @param {number} [opts.damage=0] // 히트박스에 실릴 데미지
 * @param {number} [opts.staggerTime=0] // 히트박스에 실릴 스턴 시간 (밀리초)
 * @param {number} [opts.width=12] // 이펙트 두께(px)
 * @param {boolean} [opts.attack=true] // 대시 공격 여부 (true: 히트판정 생성, false: 이펙트만)
 * @param {boolean} [opts.invincible=false] // 대시 중 무적 여부 (true: 피해 무시, false: 피해 받음)
 * @param {{layer?:Phaser.Tilemaps.TilemapLayer, mode:'always'|'block_landing'|'block_all', pad?:number}} [opts.wall]
 *   - always: 벽 무시하고 이동
 *   - block_landing: 목적지가 벽이면 마지막 빈칸까지만, 아니면 관통
 *   - block_all: 첫 벽 직전까지만 (관통 없음)
 * @param {{enabled?:boolean, radius?:number, step?:number, group?:Phaser.Physics.Arcade.Group}} [opts.hit]
 *   - enabled: 히트판정 생성 여부 (기본 true)
 *   - radius: 원형 히트 반경(px) (기본 6)
 *   - step: 샘플 간격(px) (기본 radius*1.2)
 *   - group: 히트박스 생성할 그룹(없으면 자동 생성)
 * @param {{color?:number, alpha?:number, spriteKey?:string}} [opts.effect]
 *   - spriteKey 없으면 기본 네모(Graphics)로 그림
 * @param {function(target:any, hitbox:any):void} [opts.onHit] // (선택) 오버랩 시 콜백(외부에서 overlap 연결 시 불필요)
 */

export function runDash(owner, opts) {
  const scene = owner.scene;
  const cfg = {
    distance: opts.distance ?? 200,
    speed: opts.speed ?? 900,
    width: opts.width ?? 12,
    damage: opts.damage ?? 0,
    staggerTime: opts.staggerTime ?? 0, // 스턴 시간
    attack: opts.attack ?? true, // 대시 공격 여부
    invincible: opts.invincible ?? false, // 대시 중 무적 여부
    wall: {
      layer: opts.wall?.layer ?? owner.wallLayer ?? scene?.wallLayer ?? null,
      mode: opts.wall?.mode ?? "block_landing",
      pad: opts.wall?.pad ?? (opts.hit?.radius ?? 6) + 1,
    },
    hit: {
      enabled: opts.hit?.enabled ?? true,
      radius: opts.hit?.radius ?? 6,
      step: opts.hit?.step ?? (opts.hit?.radius ?? 6) * 1.2,
      group: opts.hit?.group ?? null,
    },
    effect: {
      color: opts.effect?.color ?? 0xc50058,
      alpha: opts.effect?.alpha ?? 0.35,
      spriteKey: opts.effect?.spriteKey ?? null,
    },
    onHit: opts.onHit,
    onComplete: opts.onComplete,
    skillKey: opts.skillKey || "X",
  };

  // 시작점/방향
  const sx = owner.x,
    sy = owner.y;
  const useAngle =
    typeof opts.angleRad === "number"
      ? opts.angleRad
      : owner._facingAngleRad
      ? owner._facingAngleRad()
      : {
          right: 0,
          "down-right": Math.PI / 4,
          down: Math.PI / 2,
          "down-left": (3 * Math.PI) / 4,
          left: Math.PI,
          "up-left": (-3 * Math.PI) / 4,
          up: -Math.PI / 2,
          "up-right": -Math.PI / 4,
        }[owner.facing] ?? 0;
  const dirX = Math.cos(useAngle),
    dirY = Math.sin(useAngle);
  const stepPx = (scene?.map?.tileWidth || 16) / 3;
  const layer = cfg.wall.layer;

  // 도달 거리와 관통 여부 결정
  let targetDist = cfg.distance;
  let needPass = false;
  if (cfg.wall.mode === "block_all") {
    const scan = _scanCenterLastFree(
      layer,
      sx,
      sy,
      dirX,
      dirY,
      cfg.distance,
      stepPx
    );
    targetDist = scan.lastFree; // 센터가 빈칸인 마지막 지점
    needPass = false;
  } else if (cfg.wall.mode === "block_landing") {
    const scan = _scanCenterLastFree(
      layer,
      sx,
      sy,
      dirX,
      dirY,
      cfg.distance,
      stepPx
    );
    if (!scan.destBlocked) {
      targetDist = cfg.distance; // 목적지 센터가 안전 → 끝까지
      needPass = scan.passMid; // 중간에 벽이 있었는지에 따라 관통 필요
    } else {
      targetDist = scan.lastFree; // 목적지 막힘 → 마지막 빈칸까지
      needPass = true; // 중간에 벽이 있으니 관통 필요
    }
  } else {
    // 'always'
    targetDist = cfg.distance;
    needPass = true; // 항상 관통
  }

  // collider 토글 (관통 필요하면 끔)
  const collider = owner.wallCollider ?? owner.scene?.wallCollider ?? null;
  if (collider) collider.active = !needPass ? true : false;

  // 상태 플래그
  owner.isDashing = true;
  owner.isSkillLock = true;

  // 무적 상태 설정
  if (cfg.invincible) {
    owner.isInvincible = true;
  }

  // 이펙트 준비
  const g = !cfg.effect.spriteKey ? scene.add.graphics().setDepth(9) : null;
  const width = cfg.width;
  const color = cfg.effect.color,
    alpha = cfg.effect.alpha;

  // 히트 그룹 준비 (공격 옵션이 true일 때만)
  let hitGroup = cfg.hit.group;
  if (!hitGroup && cfg.hit.enabled && cfg.attack) {
    hitGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });
  }
  // 오버랩 연결은 게임씬에서 targets와 맺어주는 것을 권장 (모듈은 생성만)

  // 한 번의 대시 전체를 하나의 세션 ID로 고정 → 타겟당 1회만 히트
  const dashSkillId = owner.getAttackSegmentId
    ? owner.getAttackSegmentId(cfg.skillKey, 0)
    : `${cfg.skillKey}-${scene.time.now}`;
  const spawnHit = (x, y) => {
    const dot = hitGroup.create(x, y, owner.HIT_TEX);
    dot.setOrigin(0.5).setVisible(false);
    dot.owner = owner;
    dot.damage = cfg.damage; // ⬅️ 대미지 실어보내기
    dot.staggerTime = cfg.staggerTime || 0; // ⬅️ 스턴 시간 실어보내기
    dot.skillId = dashSkillId;
    dot.body.setAllowGravity(false);
    dot.body.setImmovable(true);
    dot.body.setCircle(cfg.hit.radius, 0, 0);
    return dot;
  };

  const samples = [];
  let lastSpawn = 0;
  let traveled = 0;

  // 루프 시작
  const growEvt = scene.time.addEvent({
    loop: true,
    delay: 16, // 60fps
    callback: () => {
      const dt = scene.game.loop.delta;
      const step = cfg.speed * (dt / 1000);
      traveled = Math.min(targetDist, traveled + step);

      const nx = sx + dirX * traveled;
      const ny = sy + dirY * traveled;
      owner.setPosition(nx, ny);

      // 이펙트: 기본 네모
      if (g) {
        g.clear();
        g.fillStyle(color, alpha);
        const hw = width / 2,
          npx = -dirY,
          npy = dirX;
        g.beginPath();
        g.moveTo(sx + npx * hw, sy + npy * hw);
        g.lineTo(nx + npx * hw, ny + npy * hw);
        g.lineTo(nx - npx * hw, ny - npy * hw);
        g.lineTo(sx - npx * hw, sy - npy * hw);
        g.closePath();
        g.fillPath();
      }
      // TODO: spriteKey 이펙트가 필요해지면 여기서 스케일/회전으로 늘려 붙이면 됨.

      // 히트 샘플 (공격 옵션이 true일 때만)
      if (cfg.hit.enabled && cfg.attack && hitGroup) {
        const res = _lineSpawnAlong(
          sx,
          sy,
          nx,
          ny,
          cfg.hit.step,
          (px, py) => samples.push(spawnHit(px, py)),
          lastSpawn
        );
        lastSpawn = res.last;
      }

      if (traveled >= targetDist) endDash();
    },
  });

  const endDash = () => {
    if (!owner.isDashing) return;
    owner.isDashing = false;
    growEvt.remove(false);
    owner.isSkillLock = false;

    // 무적 상태 해제
    if (cfg.invincible) {
      owner.isInvincible = false;
    }

    if (collider) collider.active = true;

    if (layer) {
      const pushed = _pushOutFromWalls(
        layer,
        owner.x,
        owner.y,
        cfg.hit.radius ?? 6,
        14,
        1.0
      );
      owner.setPosition(pushed.x, pushed.y);
    }

    // 대시 종료 시 기존 이동 경로 취소(대시 중 입력된 대기 경로는 유지)
    // 로컬 플레이어일 때만 적용 (더미/타 유닛은 로컬 입력에 간섭하지 않음)
    if (owner?.scene?.player === owner) {
      const mv = owner?.scene?.movement;
      if (mv && Array.isArray(mv.currentPath)) {
        mv.currentPath = [];
      }
    }

    // 이펙트 줄이며 제거 + 샘플 정리
    scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: 200,
      ease: "Sine.easeIn",
      onUpdate: (tw) => {
        const p = tw.getValue();
        if (g) {
          g.clear();
          if (p > 0) {
            g.fillStyle(color, alpha * p);
            const curLen = targetDist * p;
            const nx = sx + dirX * curLen,
              ny = sy + dirY * curLen;
            const hw = width / 2,
              npx = -dirY,
              npy = dirX;
            g.beginPath();
            g.moveTo(sx + npx * hw, sy + npy * hw);
            g.lineTo(nx + npx * hw, ny + npy * hw);
            g.lineTo(nx - npx * hw, ny - npy * hw);
            g.lineTo(sx - npx * hw, sy - npy * hw);
            g.closePath();
            g.fillPath();
          }
        }
        while (samples.length) {
          const s = samples[0];
          const d = Phaser.Math.Distance.Between(sx, sy, s.x, s.y);
          if (d <= targetDist * (1 - p)) {
            s.destroy();
            samples.shift();
          } else break;
        }
      },
      onComplete: () => {
        g && g.destroy();
        samples.forEach((s) => s.destroy());
        samples.length = 0;
        // 사용자 콜백 호출
        if (cfg.onComplete) {
          cfg.onComplete();
        }
        // 공격 세션 종료(세션 프리픽스 메모리 청소)
        if (owner.endAttackSession) owner.endAttackSession(cfg.skillKey);
      },
    });
  };

  // 선 위 점 찍기(내부 복사)
  function _lineSpawnAlong(fromX, fromY, toX, toY, step, cb, startDist = 0) {
    const dx = toX - fromX,
      dy = toY - fromY;
    const len = Math.hypot(dx, dy);
    if (len <= 0) return { last: startDist };
    const ux = dx / len,
      uy = dy / len;
    let d = startDist;
    while (d <= len) {
      cb(fromX + ux * d, fromY + uy * d, d);
      d += step;
    }
    return { last: d - step };
  }

  // 중앙만 충돌 체크 (패딩 없음)
  function _isBlockedAtCenter(layer, x, y) {
    if (!layer) return false;
    const t = layer.getTileAtWorldXY(x, y, true);
    return !!(t && t.collides);
  }

  // 선형 스캔(센터 기준) — 목적지 정책 판단/중간 관통 판단에 사용
  function _scanCenterLastFree(layer, sx, sy, dirX, dirY, maxDist, stepPx) {
    let lastFree = 0;
    const steps = Math.max(1, Math.ceil(maxDist / Math.max(1, stepPx)));
    for (let i = 0, d = 0; i <= steps; i++, d = Math.min(maxDist, d + stepPx)) {
      const x = sx + dirX * d,
        y = sy + dirY * d;
      if (!_isBlockedAtCenter(layer, x, y)) lastFree = d;
      if (d >= maxDist) break;
    }
    const destX = sx + dirX * maxDist,
      destY = sy + dirY * maxDist;
    const destBlocked = _isBlockedAtCenter(layer, destX, destY);

    // 중간에 벽이 있었는지(센터 기준) — 관통 필요 여부
    let passMid = false;
    if (lastFree < maxDist) {
      const steps2 = Math.max(1, Math.ceil(maxDist / Math.max(1, stepPx)));
      for (
        let i = 0, d = 0;
        i <= steps2;
        i++, d = Math.min(maxDist, d + stepPx)
      ) {
        const x = sx + dirX * d,
          y = sy + dirY * d;
        if (_isBlockedAtCenter(layer, x, y)) {
          passMid = true;
          break;
        }
        if (d >= maxDist) break;
      }
    }
    return { lastFree, destBlocked, passMid };
  }

  // 착지 후 푸시아웃 — 몸이 벽에 겹치면 바깥쪽으로 천천히 밀어낸다
  function _pushOutFromWalls(layer, x, y, pad, maxIter = 12, step = 1.0) {
    if (!layer) return { x, y };
    let cx = x,
      cy = y;

    for (let k = 0; k < maxIter; k++) {
      // 네 방향/대각선 접촉 여부
      const hitR = _isBlockedAtCenter(layer, cx + pad, cy);
      const hitL = _isBlockedAtCenter(layer, cx - pad, cy);
      const hitD = _isBlockedAtCenter(layer, cx, cy + pad);
      const hitU = _isBlockedAtCenter(layer, cx, cy - pad);

      const hitRU = _isBlockedAtCenter(
        layer,
        cx + pad * 0.707,
        cy - pad * 0.707
      );
      const hitRD = _isBlockedAtCenter(
        layer,
        cx + pad * 0.707,
        cy + pad * 0.707
      );
      const hitLU = _isBlockedAtCenter(
        layer,
        cx - pad * 0.707,
        cy - pad * 0.707
      );
      const hitLD = _isBlockedAtCenter(
        layer,
        cx - pad * 0.707,
        cy + pad * 0.707
      );

      const any =
        hitR || hitL || hitD || hitU || hitRU || hitRD || hitLU || hitLD;
      if (!any) break;

      // 밀어낼 방향 벡터(벽 반대 방향)
      let nx = 0,
        ny = 0;
      if (hitR) nx -= 1;
      if (hitL) nx += 1;
      if (hitD) ny -= 1;
      if (hitU) ny += 1;
      if (hitRD) {
        nx -= 0.707;
        ny -= 0.707;
      }
      if (hitRU) {
        nx -= 0.707;
        ny += 0.707;
      }
      if (hitLD) {
        nx += 0.707;
        ny -= 0.707;
      }
      if (hitLU) {
        nx += 0.707;
        ny += 0.707;
      }

      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;

      // 조금씩 바깥쪽으로 이동
      cx += nx * step;
      cy += ny * step;

      // 안정성: 너무 많이 옮겨졌다면 중단
      if (Math.hypot(cx - x, cy - y) > pad * 2 + 4) break;
    }
    return { x: cx, y: cy };
  }
  return {
    stop: () => {
      try {
        growEvt.remove(false);
      } catch (_) {}
      owner.isDashing = false;
    },
  };
}
