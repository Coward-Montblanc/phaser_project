import Player, { FACING_TO_RAD } from "./Player.js";
import { runDash } from "../SkillMech/Dash.js";
import { fireBeam } from "../services/beam.js";
import { shakeCamera } from "../services/cameraFx.js";
import { selfKnockback } from "../services/knockback.js";
import {
  ensureSpriteAnimations,
  getIdleFrame,
  preloadUnifiedSprite,
} from "../services/spriteSet.js";

export default class TempPlayer1 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, "tempplayer1");

    // 통합 시트 사용: tempplayer1은 인덱스 3 사용(기존 player4)
    preloadUnifiedSprite(scene);
    ensureSpriteAnimations(scene, "tempplayer1", 3);
    this.setTexture("sprite", getIdleFrame(3, "down"));

    this.slashGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });
    this.HIT_R = 6;
    this.HIT_TEX = this._ensureHitTexture(scene, this.HIT_R);
    if (this.body) {
      this.body.setCircle(this.HIT_R, 0, 0);
      this._centerBodyOffsets();
    }
    this.dashGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });
    this.beamGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true,
    });

    this.bindSkill("Z", () => this._skillSlash180(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 80,
    });
    this.bindSkill("X", () => this._skillDashHit(), {
      charged: true,
      maxCharges: 3,
      rechargeMs: 3000,
      useCooldownMs: 500,
      mouseAim: true,
      aimLock: true,
      aimLockMs: 120,
    });
    this.bindSkill("C", () => this._skillBeam(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 60,
    });

    this.maxHp = 25;
    this.hp = this.maxHp;
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    this.speed = 180;
    this.SLASH_DAMAGE = 1;
    this.DASH_DAMAGE = 0;
    this.DASH_COOLDOWN_MS = 1500;
    this.BEAM_COOLDOWN_MS = 2000;
    this.BEAM_STAGGER_TIME = 0;
    this.SLASH_STAGGER_TIME = 700;
    this.DASH_STAGGER_TIME = 0;
  }

  _skillBeam() {
    const angle = this.getSkillAimAngle();
    this.setCooldownCurrent(this.BEAM_COOLDOWN_MS);
    const PRE_CAST_MS = 130;
    this.lockMovement(PRE_CAST_MS);
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
    scene.time.delayedCall(PRE_CAST_MS, () => {
      tele.destroy();
      shakeCamera(this.scene, { durationMs: 90, intensity: 0.024 });
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
    g.fillCircle(r, r, r);
    g.generateTexture(key, r * 2, r * 2);
    g.destroy();
    return key;
  }

  _skillSlash180() {
    const scene = this.scene;
    const COOLDOWN = 5000;
    const SLASH_COUNT = 5;
    const SLASH_INTERVAL = 100;
    const SLASH_DAMAGE = this.SLASH_DAMAGE;
    const LIFETIME = 50;
    const RADIUS = 35;
    const SWEEP = Math.PI;
    const baseAngle = this.getSkillAimAngle();
    this.setCooldown("Z", COOLDOWN);
    this.lockMovement(SLASH_COUNT * SLASH_INTERVAL + 200);
    this.scene.time.delayedCall(SLASH_COUNT * SLASH_INTERVAL + 220, () =>
      this.endAttackSession("Z")
    );
    for (let slashIndex = 0; slashIndex < SLASH_COUNT; slashIndex++) {
      const delay = slashIndex * SLASH_INTERVAL;
      scene.time.delayedCall(delay, () => {
        this._sweepFanVfx(
          this.x,
          this.y,
          baseAngle,
          RADIUS,
          LIFETIME,
          0x00c5ff,
          0.4
        );
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
        dot.skillId = this.getAttackSegmentId("Z", slashIndex);
        dot.staggerTime = this.SLASH_STAGGER_TIME;
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0);
        scene.time.delayedCall(lifetime, () => dot.destroy());
      }
    }
  }

  _skillDashHit() {
    runDash(this, {
      distance: 80,
      speed: 1000,
      width: 10,
      damage: this.DASH_DAMAGE,
      staggerTime: this.DASH_STAGGER_TIME,
      attack: false,
      invincible: true,
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
      effect: { color: 0x00c5ff, alpha: 0.35 },
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
