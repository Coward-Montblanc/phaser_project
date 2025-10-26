import Player, { FACING_TO_RAD } from "./Player.js";
import { runDash } from "../SkillMech/Dash.js";
import { fireProjectiles } from "../services/projectiles.js";
import { spawnVortexField } from "../services/fields.js";
import {
  ensureSpriteAnimations,
  getIdleFrame,
  preloadUnifiedSprite,
} from "../services/spriteSet.js";

export default class Player1 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, "player1");

    // 통합 시트 사용: player1은 인덱스 0 사용
    preloadUnifiedSprite(scene);
    ensureSpriteAnimations(scene, "player1", 0);
    // 초기 텍스처/프레임 설정(애니 프리픽스는 'player1' 유지)
    this.setTexture("sprite", getIdleFrame(0, "down"));

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
    this.bindSkill("Z", () => this._skillConeProjectiles(), {
      mouseAim: true,
      aimLock: false,
    });
    this.bindSkill("X", () => this._skillDashHit(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 150,
      requireTargetInRange: 90,
    });
    this.bindSkill("C", () => this._skillVortexField(), {
      mouseAim: true,
      aimLock: false,
    });
    // C는 미구현: 바인딩만 가능하도록 비워둠

    // === 캐릭터 고유 스탯 ===
    this.maxHp = 30;
    this.hp = this.maxHp;
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    this.speed = 150; // 캐릭터별 이동속도

    // === 캐릭터 고유 스킬 수치 ===
    this.SLASH_DAMAGE = 3;
    this.DASH_DAMAGE = 3.6;
    this.DASH_COOLDOWN_MS = 4000;
    this.DANMAKU_DAMAGE = 6.6;
    this.FIELD_DAMAGE = 1;

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 100; // U스킬: 0.5초 기절 (player2보다 짧음)
    this.DASH_STAGGER_TIME = 1000; // I스킬: 0.8초 기절 (player2보다 짧음)
    this.PROJ_STAGGER_TIME = 0; // C스킬(투사체) 스턴 시간 (0이면 스턴 없음)
  }

  /** 전방 90도 콘으로 5발 투사체 발사 */
  _skillConeProjectiles() {
    // 쿨다운 설정
    const COOLDOWN = 1500;
    this.setCooldownCurrent(COOLDOWN);

    // 파라미터
    const config = {
      spreadDeg: 30,
      count: 5,
      radius: Math.floor(Math.max(this.width, this.height) * 0.35),
      speed: 500,
      lifeMs: 1200,
      damage: this.DANMAKU_DAMAGE,
      staggerTime: this.PROJ_STAGGER_TIME,
      ricochet: false,
      bounceCount: 0,
      skillKey: "Z",
      baseAngleRad: this._mouseAngleRad(),
      // 초근접 다탄 히트 보장을 위해 총구를 거의 몸 앞(0px)에 두기
      startOffset: 0,
    };
    fireProjectiles(this, config);
  }

  _ensureHitTexture(scene, r) {
    const key = `hit_${r}`;
    if (scene.textures.exists(key)) return key;
    const g = scene.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xff00ff, 1);
    g.fillCircle(r, r, r); // 중심이 (r, r)인 원
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
    return key;
  }

  /** C 스킬: 벽 관통 소형 탄 → 1.5n 이후 히트 시 소용돌이 필드 생성, 3n 이동 시 강제 생성 */
  _skillVortexField() {
    const liveAfter = 120;
    const maxDist = 160;
    const angle = this.getSkillAimAngle();
    const speed = 600;
    const startOffset = Math.max(this.width, this.height) * 0.4;

    // 쿨다운
    const COOLDOWN = 2500;
    this.setCooldownCurrent(COOLDOWN);

    // 투사체 생성(간단 원 텍스처 사용)
    const px = this.x + Math.cos(angle) * startOffset;
    const py = this.y + Math.sin(angle) * startOffset;
    const proj = this.projectileGroup.create(px, py, this.HIT_TEX);
    proj.setVisible(false); // 히트텍스쳐는 보이지 않게, 필요하면 별도 비주얼 추가 가능
    proj.owner = this;
    proj.damage = 0;
    proj.wallPierce = true;
    proj.body.setAllowGravity(false);
    proj.body.setImmovable(true);
    // 작은 원형 충돌로 오버랩 안정성 향상
    if (proj.body?.setCircle) {
      proj.body.setCircle(this.HIT_R, 0, 0);
    }
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    proj.body.setVelocity(vx, vy);

    proj._sx = px;
    proj._sy = py;
    proj._enableHit = false;

    const scene = this.scene;
    const onUpdate = (time, delta) => {
      if (!proj.active) return;
      const dx = proj.x - proj._sx;
      const dy = proj.y - proj._sy;
      const dist = Math.hypot(dx, dy);
      if (!proj._enableHit && dist >= liveAfter) {
        proj._enableHit = true;
      }
      if (dist >= maxDist) {
        // 강제 필드 생성 후 종료
        spawnVortexField(scene, this, {
          cx: proj.x,
          cy: proj.y,
          side: 80,
          durationMs: 3000,
          tickDamage: this.FIELD_DAMAGE * 0.25,
          tickIntervalMs: 50,
          slowPercent: 0.2,
          slowDurationMs: 50,
        });
        proj.destroy();
      }
    };
    scene.events.on("update", onUpdate);
    proj.on("destroy", () => scene.events.off("update", onUpdate));

    // 시간 기반 히트 활성화: 각도/프레임 순서와 무관하게 liveAfter 이후에 유효히트
    const enableDelayMs = (liveAfter / Math.max(1, speed)) * 950;
    scene.time.delayedCall(enableDelayMs, () => {
      if (proj && proj.active) proj._enableHit = true;
    });

    // 히트 처리: 1.5n 이전엔 스킵, 이후엔 필드 생성하고 종료
    proj.onHit = (target, gameScene) => {
      if (!proj._enableHit) return "skip"; // 자동 파괴/피해 처리 막기
      spawnVortexField(scene, this, {
        cx: proj.x,
        cy: proj.y,
        side: 80,
        durationMs: 3000,
        tickDamage: this.FIELD_DAMAGE * 0.25,
        tickIntervalMs: 50,
        slowPercent: 0.2,
        slowDurationMs: 50,
      });
      if (proj && proj.active) proj.destroy();
      return "handled";
    };
  }

  /** 전방 대시 */
  _skillDashHit() {
    // 새 X 스킬: 근접 포착 → 은신(0.3s) → 적 뒤 재등장 + 피해/스턴
    const DETECT_RADIUS = 90; // 탐지 반경(px)
    const REAPPEAR_DELAY = 300; // ms

    const enemies = (this.scene?.targets?.getChildren?.() || []).filter(
      (t) => t !== this && t.active
    );
    let nearest = null;
    let bestD2 = Infinity;
    for (const e of enemies) {
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= DETECT_RADIUS * DETECT_RADIUS && d2 < bestD2) {
        bestD2 = d2;
        nearest = e;
      }
    }

    if (!nearest) {
      // 포착 실패: 쿨타임만 소모
      this.setCooldown("X", this.DASH_COOLDOWN_MS);
      return;
    }

    // 포착 성공: 쿨다운 시작 및 이동/입력 잠금
    this.setCooldown("X", this.DASH_COOLDOWN_MS);
    this.lockMovement(REAPPEAR_DELAY + 50);

    // 원 위치/벡터 스냅샷
    const startX = this.x;
    const startY = this.y;
    const tx = nearest.x;
    const ty = nearest.y;
    const vx = tx - startX;
    const vy = ty - startY;
    const vlen = Math.hypot(vx, vy) || 1;
    const nx = vx / vlen;
    const ny = vy / vlen;

    // 잠시 은신(피격 및 충돌 방지)
    this.setVelocity(0, 0);
    const prevVisible = this.visible;
    const prevBodyEnable = this.body?.enable ?? true;
    this.setVisible(false);
    if (this.body) this.body.enable = false;

    // 카메라: 사라지는 타이밍에 타겟 위치로 이동
    const cam = this.scene?.cameras?.main;
    const hadFollow = !!cam?._follow; // 내부 플래그(팔로우 여부 추정)
    if (cam) {
      try {
        cam.stopFollow();
      } catch (_) {}
      cam.pan(tx, ty, REAPPEAR_DELAY, "Sine.easeInOut", true);
    }

    // 재등장 위치: 적의 뒤(타겟 반경 + 내 반경 + 여유)
    const targetR = Math.max(
      nearest.HIT_R ?? 0,
      Math.max(nearest.body?.width || 0, nearest.body?.height || 0) / 2
    );
    const selfR =
      this.HIT_R ?? Math.max(this.body?.width || 0, this.body?.height || 0) / 2;
    const offset = Math.max(8, targetR + selfR + 2);

    // 벽 충돌을 피해서 뒤쪽 방향으로 가능한 위치를 탐색(2px 스텝 역추적)
    const layer = this.wallLayer;
    const isFree = (x, y, r) => {
      if (!layer) return true;
      // 8방 샘플
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

    let appearX = tx + nx * offset;
    let appearY = ty + ny * offset;
    for (let back = 0; back <= offset; back += 2) {
      const ax = tx + nx * (offset - back);
      const ay = ty + ny * (offset - back);
      if (isFree(ax, ay, selfR)) {
        appearX = ax;
        appearY = ay;
        break;
      }
    }

    // 재등장 예약: 피해/스턴 적용 포함
    this.scene.time.delayedCall(REAPPEAR_DELAY, () => {
      // 위치 이동 및 재등장
      this.setPosition(appearX, appearY);
      this.setVisible(prevVisible);
      if (this.body) this.body.enable = prevBodyEnable;

      // 바라보는 방향을 타겟을 향하게
      const fx = tx - this.x;
      const fy = ty - this.y;
      const a = Math.atan2(fy, fx);
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
      let idx = Math.round(a / (Math.PI / 4));
      idx = ((idx % 8) + 8) % 8;
      this.facing = dirs[idx];
      this.playIdle();

      // 카메라: 플레이어 재등장 후 다시 팔로우 시작
      if (cam) {
        try {
          cam.startFollow(this, true, 0.15, 0.15);
        } catch (_) {}
      }

      // 피해/스턴 적용
      if (
        nearest &&
        nearest.active &&
        typeof nearest.receiveDamage === "function"
      ) {
        const dmg = this.DASH_DAMAGE ?? 5;
        const staggerMs = this.DASH_STAGGER_TIME ?? 0;
        const skillId = this.getAttackSegmentId("X", 0);
        nearest.receiveDamage(dmg, this, skillId, staggerMs);
      }
    });
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

    const SWEEP = Math.PI; // 180도
    const startAngle = baseAngle - SWEEP / 2; // 왼쪽 경계에서 시작
    const endAngle = baseAngle + SWEEP / 2; // 오른쪽 경계가 최종

    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: durationMs,
      ease: "Sine.easeOut",
      onUpdate: (tw) => {
        const p = tw.getValue(); // 0..1
        const curr = startAngle + (endAngle - startAngle) * p;

        g.clear();
        g.fillStyle(color, alpha);
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, radius, startAngle, curr, false); // 0→180°로 확장, 마지막 부분이 시계/반시계
        g.closePath();
        g.fillPath();
      },
      onComplete: () => {
        // 필요하면 유지 후 제거
        this.scene.time.delayedCall(60, () => g.destroy());
      },
    });

    return g;
  }
}
