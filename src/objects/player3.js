import Player, { FACING_TO_RAD } from "./Player.js";
import { runDash } from "../SkillMech/Dash.js";
import { fireProjectiles } from "../services/projectiles.js";
import {
  ensureSpriteAnimations,
  getIdleFrame,
  preloadUnifiedSprite,
} from "../services/spriteSet.js";

export default class Player3 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, "player3");

    // 통합 시트 사용: player3은 인덱스 2 사용
    preloadUnifiedSprite(scene);
    ensureSpriteAnimations(scene, "player3", 2);
    // 초기 텍스처/프레임 설정(애니 프리픽스는 'player3' 유지)
    this.setTexture("sprite", getIdleFrame(2, "down"));

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
    this.bindSkill("Z", () => this._skillSlash180(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 120,
    });
    this.bindSkill("X", () => this._skillDashHit(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 150,
    });
    this.bindSkill("C", () => this._skillConeProjectiles(), {
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
    this.DASH_DAMAGE = 5;
    this.DASH_COOLDOWN_MS = 4000;

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 100; // U스킬: 0.5초 기절 (player2보다 짧음)
    this.DASH_STAGGER_TIME = 100; // I스킬: 0.8초 기절 (player2보다 짧음)
    this.PROJ_STAGGER_TIME = 0; // C스킬(투사체) 스턴 시간 (0이면 스턴 없음)
  }

  /** 전방 90도 콘으로 5발 투사체 발사 */
  _skillConeProjectiles() {
    // 쿨다운 설정
    const COOLDOWN = 1500;
    this.setCooldown("C", COOLDOWN);

    // 파라미터
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

  /** 전방 180도 반원 휩쓸기 */
  _skillSlash180() {
    const scene = this.scene;

    // 쿨다운 & 연출 파라미터
    const COOLDOWN = 400;
    const LIFETIME = 50;
    const RADIUS = 48; // 부채꼴 시각효과 끝 반경
    const RINGS = 3;
    const DOTS_PER_RING = 10;
    const SWEEP = Math.PI; // 180도
    const baseAngle = this.getSkillAimAngle();
    this.setCooldown("Z", COOLDOWN);
    this.lockMovement(LIFETIME);
    // 세션 종료 예약
    this.scene.time.delayedCall(LIFETIME + 60, () =>
      this.endAttackSession("U")
    );

    // 시각효과(선택): 반투명 부채꼴 그리기
    const g = scene.add.graphics().setDepth(10);
    this._sweepFanVfx(
      this.x,
      this.y,
      baseAngle,
      RADIUS,
      LIFETIME,
      0xc50058,
      0.3
    );
    scene.tweens.add({
      targets: g,
      alpha: 0,
      duration: LIFETIME,
      onComplete: () => g.destroy(),
    });

    // === 여기부터 '원 전체가 부채꼴 내부'가 되도록 보정 ===
    const HIT_R = this.HIT_R; // 원 히트박스 반지름(예: 6)
    const INNER = HIT_R; // 안쪽은 중심이 최소 HIT_R 떨어져 있어야 함
    const OUTER = Math.max(INNER, RADIUS - HIT_R); // 바깥쪽도 HIT_R만큼 안쪽으로

    for (let ring = 1; ring <= RINGS; ring++) {
      const rad = INNER + (OUTER - INNER) * (ring / RINGS); // 보정된 반경

      // 양끝 각도 여유: 경계선까지의 수직거리 r*sin(margin) >= HIT_R
      // => margin = asin(HIT_R / r)
      const margin = Math.asin(Math.min(1, HIT_R / Math.max(rad, 0.0001)));

      // 원 중심이 머무를 수 있는 각 구간(부채꼴 가장자리에서 margin만큼 깎음)
      const start = baseAngle - SWEEP / 2 + margin;
      const end = baseAngle + SWEEP / 2 - margin;
      if (end <= start) continue; // 너무 가까우면 스킵

      for (let i = 0; i < DOTS_PER_RING; i++) {
        const t = DOTS_PER_RING === 1 ? 0.5 : i / (DOTS_PER_RING - 1);
        const ang = start + t * (end - start);
        const px = this.x + Math.cos(ang) * rad;
        const py = this.y + Math.sin(ang) * rad;

        const dot = this.slashGroup.create(px, py, this.HIT_TEX);
        dot.setOrigin(0.5, 0.5);
        dot.setVisible(false); // 디버그 시 true
        dot.owner = this;
        dot.damage = this.SLASH_DAMAGE; // ⬅️ 슬래시 피해량
        dot.staggerTime = this.SLASH_STAGGER_TIME; // ⬅️ 슬래시 스턴 시간
        dot.skillId = this.getAttackSegmentId("U", 0); // 한 번의 베기(세그먼트 0)
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0); // 중심 = (px, py)

        scene.time.delayedCall(LIFETIME, () => dot.destroy());
      }
    }
    // 실제 타격은 GameScene 쪽 overlap 콜백에서 처리(아래 참고)
  }

  /** 전방 대시 */
  _skillDashHit() {
    // 캐릭터 고유 쿨타임
    this.setCooldown("X", this.DASH_COOLDOWN_MS);
    runDash(this, {
      distance: 100,
      speed: 900,
      width: 12,
      damage: this.DASH_DAMAGE, // ⬅️ 대시 피해량
      staggerTime: this.DASH_STAGGER_TIME, // ⬅️ 대시 스턴 시간
      attack: true, // ⬅️ 대시 공격 여부 (true: 히트판정 생성)
      invincible: false, // ⬅️ 대시 중 무적 여부 (true: 피해 무시)
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
        color: 0xc50058,
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
