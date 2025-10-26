import Player, { FACING_TO_RAD } from "./Player.js";
import { runDash } from "../SkillMech/Dash.js";
import { fireProjectiles } from "../services/projectiles.js";
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

    // 스킬 구현 바인딩(TempPlayer2 복제)
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

    // === 캐릭터 고유 스탯 ===
    this.maxHp = 30;
    this.hp = this.maxHp;
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    this.speed = 150;

    // === 캐릭터 고유 스킬 수치 ===
    this.SLASH_DAMAGE = 3;
    this.DASH_DAMAGE = 5;
    this.DASH_COOLDOWN_MS = 4000;

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 100;
    this.DASH_STAGGER_TIME = 100;
    this.PROJ_STAGGER_TIME = 0;
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

  /** 전방 180도 반원 휩쓸기 */
  _skillSlash180() {
    const scene = this.scene;
    const COOLDOWN = 400;
    const LIFETIME = 50;
    const RADIUS = 48;
    const RINGS = 3;
    const DOTS_PER_RING = 10;
    const SWEEP = Math.PI;
    const baseAngle = this.getSkillAimAngle();
    this.setCooldown("Z", COOLDOWN);
    this.lockMovement(LIFETIME);
    this.scene.time.delayedCall(LIFETIME + 60, () =>
      this.endAttackSession("U")
    );
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
    const HIT_R = this.HIT_R;
    const INNER = HIT_R;
    const OUTER = Math.max(INNER, RADIUS - HIT_R);
    for (let ring = 1; ring <= RINGS; ring++) {
      const rad = INNER + (OUTER - INNER) * (ring / RINGS);
      const margin = Math.asin(Math.min(1, HIT_R / Math.max(rad, 0.0001)));
      const start = baseAngle - SWEEP / 2 + margin;
      const end = baseAngle + SWEEP / 2 - margin;
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
        dot.damage = this.SLASH_DAMAGE;
        dot.staggerTime = this.SLASH_STAGGER_TIME;
        dot.skillId = this.getAttackSegmentId("U", 0);
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0);
        scene.time.delayedCall(LIFETIME, () => dot.destroy());
      }
    }
  }

  _skillDashHit() {
    this.setCooldown("X", this.DASH_COOLDOWN_MS);
    runDash(this, {
      distance: 100,
      speed: 900,
      width: 12,
      damage: this.DASH_DAMAGE,
      staggerTime: this.DASH_STAGGER_TIME,
      attack: true,
      invincible: false,
      wall: {
        layer: this.wallLayer,
        mode: "block_landing",
        pad: this.HIT_R + 1,
      },
      hit: {
        enabled: true,
        radius: this.HIT_R,
        step: this.HIT_R * 1.2,
        group: this.dashGroup,
      },
      effect: { color: 0xc50058, alpha: 0.35 },
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
}
