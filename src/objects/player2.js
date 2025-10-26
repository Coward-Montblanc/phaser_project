import Player, { FACING_TO_RAD } from "./Player.js";
import { runDash } from "../SkillMech/Dash.js";
import { fireBeam } from "../services/beam.js";
import { shakeCamera } from "../services/cameraFx.js";
import { selfKnockback, targetKnockback } from "../services/knockback.js";
import {
  ensureSpriteAnimations,
  getIdleFrame,
  preloadUnifiedSprite,
} from "../services/spriteSet.js";

export default class Player2 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, "player2");

    // 통합 시트 사용: player2는 인덱스 1 사용
    preloadUnifiedSprite(scene);
    ensureSpriteAnimations(scene, "player2", 1);
    // 초기 텍스처/프레임 설정
    this.setTexture("sprite", getIdleFrame(1, "down"));

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
    // 빔용 그룹
    this.beamGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });

    // 스킬 구현 바인딩 (I는 충전식)
    this.bindSkill("Z", () => this._skillArcBurst(), {
      mouseAim: true,
      aimLock: false,
    });
    this.bindSkill("X", () => this._skillDashHit(), {
      charged: true,
      maxCharges: 3,
      rechargeMs: 3000, // 충전시간 3초
      useCooldownMs: 500, // 재사용대기시간 1초
      mouseAim: true,
      aimLock: true,
      aimLockMs: 120,
    });
    // C: 광선형 스킬
    this.bindSkill("C", () => this._skillBeam(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 60,
    });

    // === 캐릭터 고유 스탯 ===
    this.maxHp = 25;
    this.hp = this.maxHp;
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    this.speed = 180; // 캐릭터별 이동속도 (player1보다 빠름)

    // === 캐릭터 고유 스킬 수치 ===
    this.SLASH_DAMAGE = 1; // player1보다 낮은 데미지
    this.DASH_DAMAGE = 0; // player1보다 낮은 데미지
    this.DASH_COOLDOWN_MS = 1500; // player1보다 짧은 쿨다운
    this.BEAM_COOLDOWN_MS = 2000; // C 스킬(광선) 쿨타임
    this.BEAM_STAGGER_TIME = 0; // C 스킬(광선) 스턴 시간 (0이면 스턴 없음)

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 700; // U스킬: 1초 기절
    this.DASH_STAGGER_TIME = 0; // I스킬: 1초 기절
  }
  /** 광선 스킬: 마우스 방향, 0.3초 유지 */
  _skillBeam() {
    const angle = this.getSkillAimAngle();
    // 쿨타임 적용
    this.setCooldownCurrent(this.BEAM_COOLDOWN_MS);

    // 선딜 동안 이동/입력 잠금
    const PRE_CAST_MS = 130;
    this.lockMovement(PRE_CAST_MS);

    // 0.13초 텔레그래프: 빨간 중앙선 표시
    const scene = this.scene;
    const wl = this.wallLayer;
    const step = 4;
    const maxLength = 600;
    let len = 0;
    let rx = this.x,
      ry = this.y;
    const maxW = wl?.tilemap?.widthInPixels ?? scene.scale.width;
    const maxH = wl?.tilemap?.heightInPixels ?? scene.scale.height;
    while (len < 2000 && rx >= 0 && ry >= 0 && rx < maxW && ry < maxH) {
      const tx = wl.worldToTileX(rx);
      const ty = wl.worldToTileY(ry);
      if (wl.hasTileAt(tx, ty)) break;
      len += step;
      rx += Math.cos(angle) * step;
      ry += Math.sin(angle) * step;
      if (len >= maxLength) break;
    }
    const tele = scene.add.graphics().setDepth(9);
    tele.lineStyle(2, 0xff3333, 1);
    tele.beginPath();
    tele.moveTo(this.x, this.y);
    tele.lineTo(this.x + Math.cos(angle) * len, this.y + Math.sin(angle) * len);
    tele.strokePath();

    // 130ms 후 실제 발사
    scene.time.delayedCall(PRE_CAST_MS, () => {
      tele.destroy();
      // 연출: 카메라 살짝 흔들기
      shakeCamera(this.scene, { durationMs: 90, intensity: 0.024 });
      // 자기 넉백
      selfKnockback(this, {
        direction: "opposite",
        distancePx: 20,
        angleRad: angle,
      });
      fireBeam(this, {
        thickness: 30,
        durationMs: 300,
        color: 0xffffff,
        wallPierce: false,
        maxLength: 600,
        damage: 29,
        staggerTime: this.BEAM_STAGGER_TIME,
        skillKey: "C",
        baseAngleRad: angle,
      });
    });
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

  /** Z 스킬: 상대위치(최대 90)로 0.5초 간격 4연발 곡선 투사체 → 도착시 폭발 */
  _skillArcBurst() {
    const scene = this.scene;
    // 스킬 시전 시점의 상대 오프셋(클램프 90)
    const pointer = scene.input.activePointer;
    pointer.updateWorldPoint(scene.cameras.main);
    let dx = pointer.worldX - this.x;
    let dy = pointer.worldY - this.y;
    const len = Math.hypot(dx, dy) || 1;
    const maxR = 90;
    if (len > maxR) {
      dx = (dx / len) * maxR;
      dy = (dy / len) * maxR;
    }
    const rel = { x: dx, y: dy };

    // 사용 중 이동 가능: 이동 잠금 없음. 쿨타임만 적용
    this.setCooldownCurrent(3000);

    const fireOnce = (shotIndex) => {
      // 발사 시점의 목표 지점은 현재 위치 + 초기 rel (상대좌표 유지)
      const sx = this.x;
      const sy = this.y;
      const ex = this.x + rel.x;
      const ey = this.y + rel.y;

      // 곡선 경로: 시작→끝, 좌상 반원 느낌의 베지어 제어점
      const dirx = (ex - sx) / (Math.hypot(ex - sx, ey - sy) || 1);
      const diry = (ey - sy) / (Math.hypot(ex - sx, ey - sy) || 1);
      // 왼쪽/위 방향의 수직 벡터(좌측 법선)
      const nx = -diry;
      const ny = dirx;
      const baseLen = Math.hypot(ex - sx, ey - sy);
      const theta = Math.atan2(diry, dirx);
      const curvature = (1 - Math.abs(Math.sin(theta))) * (baseLen * 0.5);
      const mx = (sx + ex) * 0.5;
      const my = (sy + ey) * 0.5;
      const cx = mx + nx * curvature;
      const cy = my + ny * curvature;

      // 비주얼 투사체(히트 없음, 벽 관통)
      const p = scene.add.image(sx, sy, this.HIT_TEX).setVisible(true);
      p.setDepth(8);

      // t:0→1 베지어 이동
      const travelMs = 350;
      const tw = scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: travelMs,
        ease: "Sine.easeInOut",
        onUpdate: (tween) => {
          const t = tween.getValue();
          const it = 1 - t;
          const bx = it * it * sx + 2 * it * t * cx + t * t * ex;
          const by = it * it * sy + 2 * it * t * cy + t * t * ey;
          p.setPosition(bx, by);
        },
        onComplete: () => {
          // 폭발 이펙트 + 피해/스턴 + 넉백(밖으로)
          p.destroy();
          this._zExplode(ex, ey, 30);
        },
      });
    };

    // 0.5초 간격 4발
    for (let i = 0; i < 4; i++) {
      scene.time.delayedCall(i * 500, () => fireOnce(i));
    }
  }

  _zExplode(cx, cy, radius) {
    const scene = this.scene;
    // 시각효과(하얀 원 확산)
    const g = scene.add.graphics().setDepth(10);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(cx, cy, 4);
    scene.tweens.add({
      targets: g,
      duration: 240,
      alpha: 0,
      onUpdate: (tw) => {
        const v = 1 - tw.getValue();
        g.clear();
        g.fillStyle(0xffffff, 0.6 + 0.3 * v);
        g.fillCircle(cx, cy, radius * (1 + 0.3 * v));
      },
      onComplete: () => g.destroy(),
    });

    // 피해/기절/넉백 적용
    const targets = scene.targets?.getChildren?.() || [];
    for (const t of targets) {
      if (!t || !t.active || t === this) continue;
      const dx = t.x - cx;
      const dy = t.y - cy;
      const d = Math.hypot(dx, dy);
      if (d <= radius) {
        // 개별 투사체마다 피해 부여(중복 허용) → 고유 ID 사용
        const skillId = this.getAttackSegmentId("Z", scene.time.now | 0);
        if (typeof t.receiveDamage === "function") {
          t.receiveDamage(8, this, skillId, 300);
        }
        // 넉백: 중심에서 바깥 방향 10px (벽 차단 고려)
        if (!t.wallLayer) t.wallLayer = this.wallLayer;
        targetKnockback({ x: cx, y: cy }, t, {
          direction: "away",
          distancePx: 20,
        });
      }
    }
  }

  /** 5번 연속 베기 스킬 */
  _skillSlash180() {
    const scene = this.scene;

    // 스킬 파라미터
    const COOLDOWN = 5000; // 전체 스킬 쿨다운
    const SLASH_COUNT = 5; // 베기 횟수
    const SLASH_INTERVAL = 100; // 베기 간격 (0.5초)
    const SLASH_DAMAGE = this.SLASH_DAMAGE; // 각 베기 데미지
    const LIFETIME = 50; // 각 베기 지속시간
    const RADIUS = 35; // 베기 반경
    const SWEEP = Math.PI; // 180도
    const baseAngle = this.getSkillAimAngle();

    this.setCooldown("Z", COOLDOWN);
    this.lockMovement(SLASH_COUNT * SLASH_INTERVAL + 200); // 전체 스킬 지속시간 동안 이동 잠금
    // 전체 U 세션 종료 예약(모든 베기 끝난 뒤 약간의 여유)
    this.scene.time.delayedCall(SLASH_COUNT * SLASH_INTERVAL + 220, () =>
      this.endAttackSession("Z")
    );

    // 5번 연속 베기 실행
    for (let slashIndex = 0; slashIndex < SLASH_COUNT; slashIndex++) {
      const delay = slashIndex * SLASH_INTERVAL;

      scene.time.delayedCall(delay, () => {
        // 각 베기마다 시각효과
        this._sweepFanVfx(
          this.x,
          this.y,
          baseAngle,
          RADIUS,
          LIFETIME,
          0x00c5ff,
          0.4
        );

        // 각 베기마다 히트박스 생성
        this._createSlashHitbox(
          scene,
          baseAngle,
          RADIUS,
          LIFETIME,
          SLASH_DAMAGE,
          slashIndex
        );
      });
    }
  }

  /** 개별 베기 히트박스 생성 */
  _createSlashHitbox(scene, baseAngle, radius, lifetime, damage, slashIndex) {
    const HIT_R = this.HIT_R;
    const INNER = HIT_R;
    const OUTER = Math.max(INNER, radius - HIT_R);
    const RINGS = 2;
    const DOTS_PER_RING = 6;

    for (let ring = 1; ring <= RINGS; ring++) {
      const rad = INNER + (OUTER - INNER) * (ring / RINGS);
      const margin = Math.asin(Math.min(1, HIT_R / Math.max(rad, 0.0001)));
      const start = baseAngle - Math.PI / 2 + margin;
      const end = baseAngle + Math.PI / 2 - margin;

      if (end <= start) continue;

      for (let i = 0; i < DOTS_PER_RING; i++) {
        const t = DOTS_PER_RING === 1 ? 0.5 : i / (DOTS_PER_RING - 1);
        const ang = start + t * (end - start);
        const px = this.x + Math.cos(ang) * rad;
        const py = this.y + Math.sin(ang) * rad;

        const dot = this.slashGroup.create(px, py, this.HIT_TEX);
        dot.setOrigin(0.5, 0.5);
        dot.setVisible(false);
        dot.owner = this;
        dot.damage = damage;
        dot.skillId = this.getAttackSegmentId("Z", slashIndex); // 각 베기 세그먼트 ID
        dot.staggerTime = this.SLASH_STAGGER_TIME; // 스턴 시간 포함
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0);

        scene.time.delayedCall(lifetime, () => dot.destroy());
      }
    }
  }

  /** 전방 대시 */
  _skillDashHit() {
    runDash(this, {
      distance: 80, // player1보다 짧은 거리
      speed: 1000, // player1보다 빠른 속도
      width: 10, // player1보다 좁은 폭
      damage: this.DASH_DAMAGE, // ⬅️ 대시 피해량
      staggerTime: this.DASH_STAGGER_TIME, // ⬅️ 대시 스턴 시간
      attack: false, // ⬅️ 대시 공격 여부 (true: 히트판정 생성)
      invincible: true, // ⬅️ 대시 중 무적 여부 (true: 피해 무시)
      wall: {
        layer: this.wallLayer, // GameScene에서 this.player.wallLayer = this.wallLayer; 해둔 값
        mode: "block_landing", // 'always' | 'block_landing' | 'block_all'
        pad: this.HIT_R + 1,
      },
      hit: {
        enabled: true,
        radius: this.HIT_R,
        step: this.HIT_R * 1.2,
        group: this.dashGroup, // 없으면 모듈이 자동 생성
      },
      effect: {
        // spriteKey: 'dashBeam',       // 나중에 스프라이트 쓰고 싶으면 키 전달
        color: 0x00c5ff, // player2는 파란색 계열
        alpha: 0.35,
      },
      angleRad: this.getSkillAimAngle(),
      skillKey: "X",
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
