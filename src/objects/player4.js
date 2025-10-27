import Player, { FACING_TO_RAD } from "./Player.js";
import { fireProjectiles } from "../services/projectiles.js";
import { shakeCamera, getDarkOverlayManager } from "../services/cameraFx.js";
import { targetKnockback, selfKnockback } from "../services/knockback.js";
import {
  ensureSpriteAnimations,
  getIdleFrame,
  preloadUnifiedSprite,
} from "../services/spriteSet.js";

export default class Player4 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, "player4");

    // 통합 시트 사용: player4는 인덱스 36 사용
    preloadUnifiedSprite(scene);
    ensureSpriteAnimations(scene, "player4", 36);
    // 초기 텍스처/프레임 설정
    this.setTexture("sprite", getIdleFrame(36, "down"));

    // 히트박스 전용 그룹(겹침 판정용, 보이진 않음)
    this.slashGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });
    // 히트박스용 원 텍스처(지름=2R) 1회 생성
    this.HIT_R = 6;
    this.HIT_TEX = this._ensureHitTexture(scene, this.HIT_R);
    // 메인 충돌 바디를 피격판정(원형) 기준으로 설정
    if (this.body) {
      this.body.setCircle(this.HIT_R, 0, 0);
      this._centerBodyOffsets();
    }
    // 히트박스 전용 그룹(겹침 판정용, 보이진 않음)
    this.dashGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });

    // 투사체 전용 그룹(겹침/충돌용)
    this.projectileGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });

    // 스킬 구현 바인딩
    this.bindSkill("Z", () => this._skillDarkAdvance(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 80,
    });
    // X: 홀드/떼기 스킬 (길이 충전 후 돌진)
    this.bindSkill("X", () => this._skillXHoldStart(), {
      mouseAim: true,
      aimLock: false,
      autoHold: false, // 한 번만 시작, 홀드 중 재호출 방지
    });
    this.bindSkill("C", () => this._skillStealthC(), {
      mouseAim: false,
      aimLock: false,
      autoHold: false,
    });

    // === 캐릭터 고유 스탯 ===
    this.maxHp = 30;
    this.hp = this.maxHp;
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    this.speed = 150;

    // === 캐릭터 고유 스킬 수치 ===
    this.SLASH_DAMAGE = 3;
    this.DASH_DAMAGE = 5;
    this.DASH_COOLDOWN_MS = 4000;
    // X(홀드 돌진) 수치
    this.X_HOLD_MAX_MS = 3000; // 최대 홀드 3초
    this.X_HOLD_GROW_MS = 2000; // 2초 동안 최대 길이 도달
    this.X_MIN_DIST = 10; // 최소 길이
    this.X_MAX_DIST = 200; // 최대 길이
    this.X_DASH_SPEED = 900; // px/s
    this.X_HIT_DAMAGE = 4; // 1틱 피해
    this.X_HIT_TICKS = 3; // 총 횟수
    this.X_STUN_MS = 900; // 적 기절 시간
    this.X_HIT_INTERVAL_MS = 200; // 피해 간격
    // 암흑전진 수치
    this.DARK_COOLDOWN_MS = 6000; // 완전 종료 후 쿨다운 시작
    this.DARK_START_BASE = 0.7; // 70%
    this.DARK_START_STEP = 0.7; // 연속 재사용 시 +70% (최대 3회 시 2.1)
    this.DARK_ACCEL_STEP = 0.1; // 10%
    this.DARK_ACCEL_INTERVAL = 250; // ms
    this.DARK_MAX_MUL = 5.0; // 500%
    this.DARK_FOV_RADIUS = 30; // 어둠 버프 자신의 시야 반경
    this.DARK_TURN_LIMIT_RAD = (15 * Math.PI) / 180; // 좌/우 15도 제한
    this.DARK_TURN_INTERVAL_MS = 200; // 방향 변경 간격 제한
    this.DARK_WALL_AOE_R = 42; // 벽 충돌 시 하얀 원 반경
    this.DARK_WALL_AOE_TIME = 400; // ms 유지
    this.DARK_WALL_KB = 70; // 넉백 거리
    this.DARK_WALL_STUN = 900; // 기절 ms
    this.DARK_HIT_DMG_MIN = 3; // 플레이어 충돌 최소 피해(이속 70%일 때)
    this.DARK_HIT_DMG_MAX = 50; // 플레이어 충돌 최대 피해(이속 500%일 때)
    this.DARK_HIT_STUN = 1200; // 플레이어 충돌 시 스턴 ms
    this.DARK_SELF_BUMP_WALL = 14; // 벽 충돌 시 자기 넉백
    this.DARK_SELF_BUMP_HIT = 20; // 플레이어 충돌 시 자기 넉백

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 100;
    this.DASH_STAGGER_TIME = 100;
    this.PROJ_STAGGER_TIME = 0;

    // === C: 은신/가속(시야 제한) ===
    this.C_STEALTH_MS = 1500; // 지속 시간
    this.C_COOLDOWN_MS = 6000; // 가정: 6초 쿨다운
    this.C_SPEED_MULT = 1.5; // 이동 속도 50% 증가
    this.C_FOV_RADIUS = this.DARK_FOV_RADIUS; // 시야 구멍 반경 재사용
  }

  /** 전방 90도 콘으로 5발 투사체 발사 */
  _skillConeProjectiles() {
    const COOLDOWN = 1500;
    this.setCooldown("C", COOLDOWN);
    const config = {
      spreadDeg: 30,
      count: 5,
      radius: Math.floor(Math.max(this.width, this.height) * 0.35),
      speed: 500,
      lifeMs: 1200,
      damage: 6,
      staggerTime: this.PROJ_STAGGER_TIME,
      ricochet: false,
      bounceCount: 0,
      skillKey: "C",
      baseAngleRad: this._mouseAngleRad(),
      startOffset: 0,
    };
    fireProjectiles(this, config);
  }

  // ===== 어둠 버프(시야 마스킹) - 공통 카메라 모듈 사용 =====
  _startDarknessBuff() {
    if (this._darkBuffActive) return;
    const scene = this.scene;
    this._darkBuffActive = true;
    const mgr = getDarkOverlayManager(scene);
    if (scene.player === this) mgr?.enableSelf(this, this.DARK_FOV_RADIUS);
    else mgr?.enableFor(this, this.DARK_FOV_RADIUS);
  }

  _stopDarknessBuff() {
    const scene = this.scene;
    this._darkBuffActive = false;
    const mgr = getDarkOverlayManager(scene);
    if (scene.player === this) mgr?.disableSelf();
    else mgr?.disableFor(this);
  }

  // ===== 암흑전진 본체 =====
  _skillDarkAdvance() {
    // 이미 진행 중이면 무시
    if (this._darkAdvActive) return;

    // 버프 부여
    this._startDarknessBuff();

    // 상태 초기화
    this._darkAdvActive = true;
    this._darkAdvBounces = 0; // 벽 재사용 횟수
    this._darkAdvAngle = this.getSkillAimAngle();
    this._darkAdvStart();
  }

  _darkAdvStart() {
    const scene = this.scene;
    // 이동/스킬 입력 잠금(스킬 중에는 다른 스킬 사용 불가, 경로 이동 무시)
    this.isSkillLock = true;
    // 우클릭 이동 금지(로컬 플레이어일 때만 적용)
    if (scene.player === this) this._rcMoveDisabled = true;

    // 시작 속도: 0.7, 1.4, 2.1...
    const startMul = Math.min(
      this.DARK_MAX_MUL,
      this.DARK_START_BASE + this.DARK_START_STEP * (this._darkAdvBounces | 0)
    );
    this._darkAdvMul = startMul;

    // 가속 타이머: 0.25s마다 +0.1, 최대 5.0 (중복 생성 방지)
    if (!this._darkAccelEvt) {
      this._darkAccelEvt = scene.time.addEvent({
        loop: true,
        delay: this.DARK_ACCEL_INTERVAL,
        callback: () => {
          if (!this._darkAdvActive || this._darkAdvWaiting) return;
          this._darkAdvMul = Math.min(this.DARK_MAX_MUL, this._darkAdvMul + this.DARK_ACCEL_STEP);
        },
      });
    }

    // 프레임 업데이트 등록(중복 on 방지)
    this._darkAdvWaiting = false;
    if (!this._darkAdvUpdate) this._darkAdvUpdate = (time, delta) => this._darkAdvTick(delta);
    if (!this._darkAdvUpdateAttached) {
      scene.events.on("update", this._darkAdvUpdate);
      this._darkAdvUpdateAttached = true;
    }
    // 방향 변경 쿨다운 초기화
    this._darkTurnNextAt = scene.time.now; // 즉시 1회 허용
  }

  _clampAngleTowards(curr, target, limitRad) {
    let d = Phaser.Math.Angle.Normalize(target - curr);
    // -PI..PI 범위로 정규화
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    if (d > limitRad) d = limitRad;
    if (d < -limitRad) d = -limitRad;
    return Phaser.Math.Angle.Wrap(curr + d);
  }

  _entityRadius(ent) {
    const bw = ent?.body?.width || 0;
    const bh = ent?.body?.height || 0;
    const rHit = ent?.HIT_R || 0;
    return Math.max(rHit, bw / 2, bh / 2, 6);
  }

  _isCircleFree(x, y, r) {
    const layer = this.wallLayer;
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
  }

  _wallNormalAtPoint(wx, wy) {
    const layer = this.wallLayer;
    const map = layer?.tilemap;
    if (!layer || !map) return { x: 0, y: 0 };
    const tx = layer.worldToTileX(wx), ty = layer.worldToTileY(wy);
    // 충돌 타일 기준 주변 벽 분포의 그래디언트 근사
    let nx = 0, ny = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ntx = tx + dx, nty = ty + dy;
        if (layer.hasTileAt(ntx, nty)) {
          const cx = map.tileToWorldX(tx) + map.tileWidth / 2;
          const cy = map.tileToWorldY(ty) + map.tileHeight / 2;
          const wx2 = map.tileToWorldX(ntx) + map.tileWidth / 2;
          const wy2 = map.tileToWorldY(nty) + map.tileHeight / 2;
          nx += cx - wx2;
          ny += cy - wy2;
        }
      }
    }
    const len = Math.hypot(nx, ny) || 0;
    if (len === 0) return { x: 0, y: 0 };
    return { x: nx / len, y: ny / len };
  }

  _anyTargetHit(nextX, nextY, angle) {
    const targets = this.scene?.targets?.getChildren?.() || [];
    const selfR = this._entityRadius(this);
    const selfRExpanded = selfR * 1.5;
    for (const t of targets) {
      if (!t || !t.active || t === this) continue;
      const r = this._entityRadius(t);
      const dx = t.x - nextX;
      const dy = t.y - nextY;
      if (dx * dx + dy * dy <= (selfRExpanded + r) * (selfRExpanded + r)) {
        // 피해 + 기절 적용, 즉시 종료
        const skillId = this.getAttackSegmentId("Z", 0);
        // 이동속도(배율) 기반 피해 계산: 0.7 -> 3, 5.0 -> 50 선형
        const minMul = this.DARK_START_BASE;
        const maxMul = this.DARK_MAX_MUL;
        const mul = Math.max(minMul, Math.min(maxMul, this._darkAdvMul || minMul));
        const ratio = (mul - minMul) / Math.max(0.0001, maxMul - minMul);
        const dmg = Math.round(
          this.DARK_HIT_DMG_MIN + ratio * (this.DARK_HIT_DMG_MAX - this.DARK_HIT_DMG_MIN)
        );
        if (typeof t.receiveDamage === "function") {
          t.receiveDamage(dmg, this, skillId, this.DARK_HIT_STUN);
        }
        // 약간 뒤로 밀기(공격 방향 기준)
        if (!t.wallLayer) t.wallLayer = this.wallLayer;
        targetKnockback(this, t, {
          direction: "skill",
          distancePx: 50,
          angleRad: angle,
        });
        // 자기 자신도 소폭 반대 방향 넉백
        selfKnockback(this, { direction: "opposite", distancePx: this.DARK_SELF_BUMP_HIT, angleRad: angle });
        // 3회째 벽 충돌과 동일 강도의 화면 흔들림
        shakeCamera(this.scene, { durationMs: 200, intensity: 0.04 });
        this._darkAdvFinish(true /* withCooldown */);
        return true;
      }
    }
    return false;
  }

  _spawnWallImpact(x, y, angle) {
    const scene = this.scene;
    // 화면 진동(재사용 횟수에 비례해 강하게)
    const b = Math.max(0, (this._darkAdvBounces | 0));
    const level = Math.min(b, 2); // 0,1,2 단계
    const intensity = 0.02 + 0.01 * level; // 0.02 -> 0.03 -> 0.04
    const durationMs = 100 + 50 * level; // 100 -> 150 -> 200
    shakeCamera(scene, { durationMs, intensity });
    // 하얀 원 이펙트
    const g = scene.add.graphics().setDepth(996);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(x, y, this.DARK_WALL_AOE_R);
    scene.tweens.add({ targets: g, alpha: 0, duration: this.DARK_WALL_AOE_TIME, onComplete: () => g.destroy() });

    // 반경 내 적에게 넉백+기절 적용(짧은 기간 동안 주기 확인)
    const check = () => {
      const targets = scene?.targets?.getChildren?.() || [];
      for (const t of targets) {
        if (!t || !t.active || t === this) continue;
        const dx = t.x - x;
        const dy = t.y - y;
        if (dx * dx + dy * dy <= this.DARK_WALL_AOE_R * this.DARK_WALL_AOE_R) {
          // 기절만 부여(피해 0)
          if (typeof t.receiveDamage === "function") {
            t.receiveDamage(0, this, this.getAttackSegmentId("Z", 1), this.DARK_WALL_STUN);
          }
          if (!t.wallLayer) t.wallLayer = this.wallLayer;
          targetKnockback(this, t, { direction: "skill", distancePx: this.DARK_WALL_KB, angleRad: angle });
        }
      }
    };
    check();
    scene.time.delayedCall(120, check);
  }

  _darkAdvTick(delta) {
    if (!this._darkAdvActive) return;
    if (this._darkAdvWaiting) return;
    const dt = Math.max(1, delta | 0) / 1000; // sec

    // 마우스 좌/우에 따라 각도 보정(±10°), 0.5초 간격으로만 변경
    const now = this.scene.time.now;
    if (!this._darkTurnNextAt || now >= this._darkTurnNextAt) {
      const mouse = this._mouseAngleRad();
      this._darkAdvAngle = this._clampAngleTowards(
        this._darkAdvAngle,
        mouse,
        this.DARK_TURN_LIMIT_RAD
      );
      this._darkTurnNextAt = now + (this.DARK_TURN_INTERVAL_MS || 500);
    }

    // 진행: 작은 스텝으로 충돌 검사
    const baseSpeed = this.speed ?? 150;
    const speed = baseSpeed * this._darkAdvMul;
    const step = 2; // px
    const total = Math.max(0.001, speed * dt);
    const steps = Math.max(1, Math.ceil(total / step));
    const steplen = total / steps;
    const nx = Math.cos(this._darkAdvAngle);
    const ny = Math.sin(this._darkAdvAngle);
    const r = this._entityRadius(this);
    for (let i = 0; i < steps; i++) {
      const cx = this.x + nx * steplen;
      const cy = this.y + ny * steplen;
      // 플레이어 충돌 먼저 처리
      if (this._anyTargetHit(cx, cy, this._darkAdvAngle)) return;
      // 벽 충돌 검사
      if (!this._isCircleFree(cx, cy, r)) {
        // 벽 평행 슬라이드 검사(±20°)
        const n = this._wallNormalAtPoint(cx, cy);
        const slideThresh = (25 * Math.PI) / 180;
        if (n && (n.x !== 0 || n.y !== 0)) {
          const t1 = { x: -n.y, y: n.x };
          const t2 = { x: n.y, y: -n.x };
          const ang = this._darkAdvAngle;
          const a1 = Math.atan2(t1.y, t1.x);
          const a2 = Math.atan2(t2.y, t2.x);
          const d1 = Phaser.Math.Angle.Wrap(a1 - ang);
          const d2 = Phaser.Math.Angle.Wrap(a2 - ang);
          let best = a1, d = Math.abs(d1);
          if (Math.abs(d2) < d) { best = a2; d = Math.abs(d2); }
          if (d <= slideThresh) {
            // 접선 방향으로 전진 재시도
            const sx = this.x + Math.cos(best) * steplen;
            const sy = this.y + Math.sin(best) * steplen;
            if (this._isCircleFree(sx, sy, r)) {
              this._darkAdvAngle = best;
              this.setPosition(sx, sy);
              continue;
            }
          }
        }
        // 3회째 충돌이면 즉시 종료, 아니면 대기 상태로 전환
        if ((this._darkAdvBounces | 0) >= 2) {
          this._spawnWallImpact(this.x, this.y, this._darkAdvAngle);
          // 벽에서 살짝 반대 방향으로 튕김
          selfKnockback(this, { direction: "opposite", distancePx: this.DARK_SELF_BUMP_WALL, angleRad: this._darkAdvAngle });
          this.applyStagger(2000);
          this._darkAdvFinish(true /* withCooldown */);
          return;
        }
        this._spawnWallImpact(this.x, this.y, this._darkAdvAngle);
        // 벽에서 살짝 반대 방향으로 튕김
        selfKnockback(this, { direction: "opposite", distancePx: this.DARK_SELF_BUMP_WALL, angleRad: this._darkAdvAngle });
        this._darkAdvWaitForCommand();
        return;
      }
      this.setPosition(cx, cy);
    }
    // 이동 중 애니/방향
    this.playWalk();
    const dirs = [
      "right",
      "down-right",
      "down",
      "down-left",
      "left",
      "up-left",
      "up",
      "up-right",
    ];
    let idx = Math.round(this._darkAdvAngle / (Math.PI / 4));
    idx = ((idx % 8) + 8) % 8;
    this.facing = dirs[idx];
  }

  _darkAdvWaitForCommand() {
    if (!this._darkAdvActive) return;
    this._darkAdvWaiting = true;
    // 정지
    this.setVelocity(0, 0);

    // 다음 우클릭으로 재시작
    const scene = this.scene;
    const handler = (pointer) => {
      if (!pointer.rightButtonDown()) return; // 이동명령(우클릭)만 허용
      // 재시작 각도 = 현재 위치에서 클릭 위치 각도
      const cam = scene.cameras.main;
      pointer.updateWorldPoint(cam);
      const dx = pointer.worldX - this.x;
      const dy = pointer.worldY - this.y;
      this._darkAdvAngle = Math.atan2(dy, dx);

      scene.input.off("pointerdown", handler);
      this._darkAdvBounces = (this._darkAdvBounces | 0) + 1;
      if (this._darkAdvBounces >= 3) {
        // 3번째 벽 충돌이면 완전 종료 + 자기 2초 기절
        this.applyStagger(2000);
        this._darkAdvFinish(true /* withCooldown */);
      } else {
        // 다시 시작(시작 속도 상승 규칙 적용)
        this._darkAdvStart();
      }
    };
    this._darkPointerOnce = handler;
    scene.input.on("pointerdown", this._darkPointerOnce);
  }

  _darkAdvFinish(withCooldown) {
    const scene = this.scene;
    // 업데이트/타이머 해제
    if (this._darkAccelEvt) {
      try { this._darkAccelEvt.remove(false); } catch (_) {}
      this._darkAccelEvt = null;
    }
    if (this._darkAdvUpdateAttached && this._darkAdvUpdate) {
      scene.events.off("update", this._darkAdvUpdate);
    }
    this._darkAdvUpdateAttached = false;
    this._darkAdvUpdate = null;
    this._darkAdvActive = false;
    this._darkAdvWaiting = false;
    if (this._darkPointerOnce) {
      try { scene.input.off("pointerdown", this._darkPointerOnce); } catch (_) {}
      this._darkPointerOnce = null;
    }
    this.setVelocity(0, 0);
    this.isSkillLock = false;
    // 우클릭 이동 재허용(로컬 플레이어일 때만)
    if (scene.player === this) this._rcMoveDisabled = false;
    // 상태 초기화(속도/스택)
    this._darkAdvMul = 1;
    this._darkAdvBounces = 0;

    // 버프 해제 및 쿨다운 시작
    this._stopDarknessBuff();
    if (withCooldown) this.setCooldown("Z", this.DARK_COOLDOWN_MS);

    // 이전 이동 명령(경로) 제거 — 로컬 플레이어일 때만
    if (scene.player === this) {
      try {
        this.scene?.movement?.clear?.();
      } catch (_) {}
    }
  }

  _ensureHitTexture(scene, r) {
    const key = `hit_${r}`;
    if (scene.textures.exists(key)) return key;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xff00ff, 1);
    g.fillCircle(r, r, r);
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
    return key;
  }

  // 기존 Z 임시 스킬 제거됨

  // ===== X: 홀드/떼기 돌진 스킬 =====
  _skillXHoldStart() {
    if (this._xHoldActive || this._xDashActive) return;
    this._xHoldActive = true;
    this._xHoldStartAt = this.scene.time.now;
    this._xHoldAngle = this._mouseAngleRad();
    // 홀드 중 이동 금지 및 우클릭 이동 비활성화
    this.isSkillLock = true;
    if (this.scene.player === this) this._rcMoveDisabled = true;
    // 진행 중인 경로 이동 즉시 취소(로컬 플레이어일 때만)
    if (this.scene.player === this) {
      try {
        this.scene?.movement?.clear?.();
      } catch (_) {}
    }
    // 바 시각화(로컬 플레이어만)
    if (this.scene.player === this) {
      this._xHoldGfx = this.scene.add.graphics().setDepth(995);
    }
    // 업데이트 훅 등록
    if (!this._xUpdate) this._xUpdate = (time, delta) => this._xTick(delta);
    if (!this._xUpdateAttached) {
      this.scene.events.on("update", this._xUpdate);
      this._xUpdateAttached = true;
    }
  }

  _xCurrentLength(nowMs) {
    const age = Math.max(0, (nowMs - (this._xHoldStartAt || nowMs)) / 1000);
    const t = Math.min(1, age / (this.X_HOLD_GROW_MS / 1000));
    const len = this.X_MIN_DIST + (this.X_MAX_DIST - this.X_MIN_DIST) * t;
    return Math.max(this.X_MIN_DIST, Math.min(this.X_MAX_DIST, len));
  }

  _xTick(delta) {
    const now = this.scene.time.now;
    // 홀드 단계: 각도/길이 갱신 + 그리기
    if (this._xHoldActive) {
      this._xHoldAngle = this._mouseAngleRad();
      const len = this._xCurrentLength(now);
      // 자동 릴리즈(최대 홀드 시간 초과)
      const ageMs = now - (this._xHoldStartAt || now);
      const shouldRelease = ageMs >= this.X_HOLD_MAX_MS || !this.skillKeys.X.isDown;
      // 바 렌더링(로컬 전용)
      if (this._xHoldGfx) {
        const g = this._xHoldGfx;
        g.clear();
        g.fillStyle(0x4fa3ff, 0.35);
        const width = (this.body?.width || 12);
        const hw = width / 2;
        const ang = this._xHoldAngle;
        const nx = Math.cos(ang), ny = Math.sin(ang);
        const npx = -ny, npy = nx; // 법선
        const sx = this.x, sy = this.y;
        const ex = sx + nx * len, ey = sy + ny * len;
        g.beginPath();
        g.moveTo(sx + npx * hw, sy + npy * hw);
        g.lineTo(ex + npx * hw, ey + npy * hw);
        g.lineTo(ex - npx * hw, ey - npy * hw);
        g.lineTo(sx - npx * hw, sy - npy * hw);
        g.closePath();
        g.fillPath();
      }
      if (shouldRelease) {
        // 릴리즈: 쿨다운은 여기서 시작
        const dist = this._xCurrentLength(now);
    this.setCooldown("X", this.DASH_COOLDOWN_MS);
        this._xStartDash(dist, this._xHoldAngle);
      }
    }

    // 돌진 단계: 스텝 전진 + 충돌 처리
    if (this._xDashActive) {
      const dt = Math.max(1, delta | 0) / 1000;
      const step = Math.min(this._xDashRemain, Math.max(1, this.X_DASH_SPEED * dt));
      const ang = this._xDashAngle;
      const nx = Math.cos(ang), ny = Math.sin(ang);
      const r = this._entityRadius(this);

      // 작은 스텝으로 이동하며 충돌 검사
      const subStep = 2;
      const steps = Math.max(1, Math.ceil(step / subStep));
      const steplen = step / steps;
      for (let i = 0; i < steps; i++) {
        const cx = this.x + nx * steplen;
        const cy = this.y + ny * steplen;
        // 적 충돌 우선
        const t = this._xCheckAttachHit(cx, cy);
        if (t) {
          this._xAttachAndHit(t, ang);
          this._xFinishDash();
          return;
        }
        // 벽 충돌: 마지막 빈칸까지로 종료
        if (!this._isCircleFree(cx, cy, r)) {
          this._xFinishDash();
          return;
        }
        this.setPosition(cx, cy);
        this.playWalk();
      }
      this._xDashRemain = Math.max(0, this._xDashRemain - step);
      if (this._xDashRemain <= 0) {
        this._xFinishDash();
      }
    }
  }

  _xStartDash(distance, angleRad) {
    // 홀드 클린업
    this._xHoldActive = false;
    if (this._xHoldGfx) {
      try { this._xHoldGfx.destroy(); } catch (_) {}
      this._xHoldGfx = null;
    }

    // 이동/입력 잠금(돌진 중)
    this.isSkillLock = true;
    if (this.scene.player === this) this._rcMoveDisabled = true;

    this._xDashActive = true;
    this._xDashAngle = angleRad;
    this._xDashRemain = Math.max(this.X_MIN_DIST, Math.min(this.X_MAX_DIST, distance));
  }

  _xFinishDash() {
    this._xDashActive = false;
    this.isSkillLock = false;
    if (this.scene.player === this) this._rcMoveDisabled = false;
    // 업데이트 훅 해제
    if (this._xUpdateAttached && this._xUpdate) {
      this.scene.events.off("update", this._xUpdate);
    }
    this._xUpdateAttached = false;
    this._xUpdate = null;
    // 세션 종료(클린업)
    if (this.endAttackSession) this.endAttackSession("X");
  }

  _xCheckAttachHit(nextX, nextY) {
    const targets = this.scene?.targets?.getChildren?.() || [];
    const selfR = this._entityRadius(this) * 1.2;
    for (const t of targets) {
      if (!t || !t.active || t === this) continue;
      const r = this._entityRadius(t);
      const dx = t.x - nextX;
      const dy = t.y - nextY;
      if (dx * dx + dy * dy <= (selfR + r) * (selfR + r)) {
        return t;
      }
    }
    return null;
  }

  _xAttachAndHit(target, angle) {
    // 접촉 지점에서 멈추고, 대상 기절 + 3회 피해 적용
    const skillId = this.getAttackSegmentId("X", 0);
    if (typeof target.receiveDamage === "function") {
      // 기절(한 번만)
      target.receiveDamage(0, this, skillId, this.X_STUN_MS);
      // 3틱 피해 스케줄
      const applyTick = () => {
        if (!target || !target.active) return;
        target.receiveDamage(this.X_HIT_DAMAGE, this, skillId, 0);
      };
      for (let i = 0; i < (this.X_HIT_TICKS | 0); i++) {
        const delay = i * (this.X_HIT_INTERVAL_MS | 0);
        this.scene.time.delayedCall(delay, applyTick);
      }
    }
  }

  _facingAngleRad() {
    return FACING_TO_RAD[this.facing] ?? 0;
  }

  _sweepFanVfx(
    cx,
    cy,
    baseAngle,
    radius,
    durationMs,
    color = 0xffffff,
    alpha = 0.15
  ) {
    const g = this.scene.add.graphics().setDepth(10);
    const SWEEP = Math.PI;
    const startAngle = baseAngle - SWEEP / 2;
    const endAngle = baseAngle + SWEEP / 2;
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: durationMs,
      ease: "Sine.easeOut",
      onUpdate: (tw) => {
        const p = tw.getValue();
        const curr = startAngle + (endAngle - startAngle) * p;
        g.clear();
        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, radius, startAngle, curr, false);
        g.closePath();
        g.fillPath();
      },
      onComplete: () => {
        this.scene.time.delayedCall(60, () => g.destroy());
      },
    });
    return g;
  }

  // ===== C: 은신/무적/가속 + 시야 제한 =====
  _skillStealthC() {
    // 이미 활성 상태면 무시
    if (this._cStealthActive) return;
    this.setCooldown("C", this.C_COOLDOWN_MS);

    this._cStealthActive = true;
    // 상태 백업
    this._cPrevAlpha = this.alpha ?? 1;
    this._cPrevVisible = this.visible;
    this._cPrevInv = !!this.isInvincible;
    this._cPrevSpeedMul = this.speedMultiplier ?? 1;

    // 적용: 무적 + 이속 + 시야 제한(본인에게만 어둠 마스크 표시)
    this.isInvincible = true;
    this.speedMultiplier = (this._cPrevSpeedMul || 1) * this.C_SPEED_MULT;
    if (this.scene.player === this) {
      const mgr = getDarkOverlayManager(this.scene);
      mgr?.enableSelf(this, this.C_FOV_RADIUS);
    }

    // 시전 순간 검은 원 플래시(0.1s) — 모두에게 보임
    {
      const flash = this.scene.add.graphics().setDepth(996);
      flash.fillStyle(0x000000, 0.9);
      flash.fillCircle(this.x, this.y, this.C_FOV_RADIUS);
      this.scene.tweens.add({ targets: flash, alpha: 0, duration: 100, onComplete: () => flash.destroy() });
    }

    if (this.scene.player === this) {
      // 본인 화면: 반투명 + 오라
      this.setAlpha(0.6);
      const aura = this.scene.add.graphics().setDepth(996);
      aura.fillStyle(0x000000, 0.25);
      aura.fillCircle(0, 0, this.C_FOV_RADIUS);
      aura.setPosition(this.x, this.y);
      const auraUpd = () => { if (aura && aura.active) aura.setPosition(this.x, this.y); };
      this.scene.events.on("postupdate", auraUpd);
      this._cAura = { g: aura, upd: auraUpd };
    } else {
      // 타 시점: 완전 비가시화
      this.setVisible(false);
    }

    // 종료 스케줄
    this.scene.time.delayedCall(this.C_STEALTH_MS, () => this._finishStealthC());
  }

  _finishStealthC() {
    if (!this._cStealthActive) return;
    this._cStealthActive = false;
    // 상태 복구
    this.isInvincible = this._cPrevInv;
    this.speedMultiplier = this._cPrevSpeedMul;
    this.setAlpha(this._cPrevAlpha);
    this.setVisible(this._cPrevVisible);
    if (this.scene.player === this) {
      const mgr = getDarkOverlayManager(this.scene);
      mgr?.disableSelf();
    }
    // 오라 정리
    if (this._cAura) {
      try { this.scene.events.off("postupdate", this._cAura.upd); } catch (_) {}
      try { this._cAura.g?.destroy?.(); } catch (_) {}
      this._cAura = null;
    }
  }
}
