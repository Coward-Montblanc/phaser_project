import Player, { FACING_TO_RAD } from "./Player.js";
import { shakeCamera } from "../services/cameraFx.js";
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

    // 통합 시트 사용: player3은 인덱스 39 사용
    preloadUnifiedSprite(scene);
    ensureSpriteAnimations(scene, "player3", 39);
    // 초기 텍스처/프레임 설정(애니 프리픽스는 'player3' 유지)
    this.setTexture("sprite", getIdleFrame(39, "down"));

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
    this.bindSkill("Z", () => this._skillComboZ(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 1400,
    });
    this.bindSkill("X", () => this._skillDashHit(), {
      mouseAim: true,
      aimLock: true,
      aimLockMs: 150,
    });
    this.bindSkill("C", () => this._skillYellowBuff(), {
      mouseAim: false,
      aimLock: false,
    });

    // === 캐릭터 고유 스탯 ===
    this.maxHp = 30;
    this.hp = this.maxHp;
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    this.speed = 150; // 캐릭터별 이동속도

    // === 캐릭터 고유 스킬 수치 ===
    this.SLASH_DAMAGE = 3;
    this.DASH_DAMAGE = 0;
    this.DASH_COOLDOWN_MS = 1500;

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 100; // U스킬: 0.5초 기절 (player2보다 짧음)
    this.DASH_STAGGER_TIME = 0; // I스킬: 0.8초 기절 (player2보다 짧음)
    this.PROJ_STAGGER_TIME = 0; // C스킬(투사체) 스턴 시간 (0이면 스턴 없음)

    // C 버프 상태
    this._yellowBuffActive = false;
    this._yellowBuffTimer = null;
    this._yellowBuffPrevSpeedMul = 1;
    this._yellowFlickerTimer = null;
    this._yellowBuffBarBg = null;
    this._yellowBuffBarFg = null;
    this._yellowBuffBarUpdater = null;
    this._yellowBuffEndsAt = 0;
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

  // Z 연속 콤보 스킬 구현
  _skillComboZ() {
    const scene = this.scene;
    const angle = this.getSkillAimAngle();
    const cos = Math.cos(angle),
      sin = Math.sin(angle);

    // 전체 시전 시간 동안 이동/스킬 잠금 (0.25s 간격*2 + 여유)
    const totalMs = 250 + 250 + 200;
    this.lockMovement(totalMs);
    // 버프 중엔 Z 쿨타임을 3초로 단축, 아니면 기본 5초
    this.setCooldown("Z", this._yellowBuffActive ? 3000 : 5000);

    // 단계 1: 약진 15 + 전방 직사각형 타격 (40x20), 피해5, 기절0.2
    this._moveForwardWithBlocking(15, angle);
    this._spawnRectHit(angle, 40, 10, 5, 200, this.getAttackSegmentId("Z", 1));
    shakeCamera(scene, { durationMs: 90, intensity: 0.02 });

    // 단계 2: 0.25s 뒤 약진 15 + 전방 75° 부채꼴(반지름40), 피해5, 기절0.3
    scene.time.delayedCall(250, () => {
      this._moveForwardWithBlocking(15, angle);
      this._spawnArcHit(angle, 75, 60, 5, 300, this.getAttackSegmentId("Z", 2));
      shakeCamera(scene, { durationMs: 90, intensity: 0.02 });
    });

    // 단계 3: 다시 0.25s 뒤 돌진 50, 첫 적 충돌 시 정지, 피해10 + 넉백40, 벽충돌 시 추가 피해10+기절3s
    scene.time.delayedCall(500, () => {
      this._dashHitFirstTarget(angle, 50);
      shakeCamera(scene, { durationMs: 90, intensity: 0.02 });
    });
  }

  _moveForwardWithBlocking(distance, angle) {
    const layer = this.wallLayer;
    const step = 2;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= steps; i++) {
      // 현재 스텝 시작 위치 저장(백오프용)
      const sx = this.x,
        sy = this.y;
      let cx = sx + cos * step;
      let cy = sy + sin * step;
      if (!this._isCircleFree(cx, cy, this.HIT_R, layer)) break;
      this.setPosition(cx, cy);

      // 약진 중 몸 겹침 시 끌고감: 겹친 대상은 내 앞 위치로 이동(벽 차단)
      const targets = this.scene?.targets?.getChildren?.() || [];
      for (const t of targets) {
        if (!t || !t.active || t === this) continue;
        const tgtR = Math.max(
          t.HIT_R ?? 8,
          (t.body?.width || 0) / 2,
          (t.body?.height || 0) / 2
        );
        const dx = t.x - this.x;
        const dy = t.y - this.y;
        if (Math.hypot(dx, dy) <= this.HIT_R + tgtR) {
          // 기본 앞 위치 계산
          const frontDist = this.HIT_R + tgtR + 2;
          let fx = this.x + cos * frontDist;
          let fy = this.y + sin * frontDist;
          const tryPlace = (x, y) => this._isCircleFree(x, y, tgtR, layer);
          let placed = tryPlace(fx, fy);

          // 좌우 슬라이드로 위치 보정
          if (!placed) {
            const px = -sin,
              py = cos;
            for (let sld = 1; sld <= 3 && !placed; sld++) {
              const off = 2 * sld;
              if (tryPlace(fx + px * off, fy + py * off)) {
                fx += px * off;
                fy += py * off;
                placed = true;
                break;
              }
              if (tryPlace(fx - px * off, fy - py * off)) {
                fx -= px * off;
                fy -= py * off;
                placed = true;
                break;
              }
            }
          }
          // 앞 거리 줄여가며 시도
          if (!placed) {
            for (
              let b = frontDist - 2;
              b >= Math.max(0, frontDist - 10);
              b -= 2
            ) {
              const tx = this.x + cos * b;
              const ty = this.y + sin * b;
              if (tryPlace(tx, ty)) {
                fx = tx;
                fy = ty;
                placed = true;
                break;
              }
            }
          }
          // 그래도 불가하면: 플레이어 스텝 백오프하여 둘 다 벽 앞에 정렬
          if (!placed) {
            for (let back = step - 1; back >= 0 && !placed; back--) {
              const px2 = sx + cos * back;
              const py2 = sy + sin * back;
              if (!this._isCircleFree(px2, py2, this.HIT_R, layer)) continue;
              const tfx = px2 + cos * frontDist;
              const tfy = py2 + sin * frontDist;
              if (tryPlace(tfx, tfy)) {
                this.setPosition(px2, py2);
                fx = tfx;
                fy = tfy;
                placed = true;
                break;
              }
            }
          }
          if (placed) {
            if (!t.wallLayer) t.wallLayer = layer;
            t.setPosition(fx, fy);
          }
        }
      }
    }
  }

  _isCircleFree(x, y, r, layer) {
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

  _spawnRectHit(angle, len, width, damage, staggerMs, skillId) {
    const scene = this.scene;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    // 직사각형 중심 라인을 따라 샘플링
    const alongStep = 10;
    const acrossStep = 10;
    for (let a = 5; a <= len; a += alongStep) {
      for (let off = -width / 2; off <= width / 2; off += acrossStep) {
        const px = this.x + cos * a + -sin * off;
        const py = this.y + sin * a + cos * off;
        const dot = this.slashGroup.create(px, py, this.HIT_TEX);
        dot.setOrigin(0.5, 0.5);
        dot.setVisible(false);
        dot.owner = this;
        dot.damage = damage;
        dot.skillId = skillId;
        dot.staggerTime = staggerMs;
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(this.HIT_R, 0, 0);
        scene.time.delayedCall(80, () => dot.destroy());
      }
    }
    // 사용자 몸 중심에도 히트판정 추가
    const bodyDot = this.slashGroup.create(this.x, this.y, this.HIT_TEX);
    bodyDot.setOrigin(0.5, 0.5);
    bodyDot.setVisible(false);
    bodyDot.owner = this;
    bodyDot.damage = damage;
    bodyDot.skillId = skillId;
    bodyDot.staggerTime = staggerMs;
    bodyDot.body.setAllowGravity(false);
    bodyDot.body.setImmovable(true);
    bodyDot.body.setCircle(this.HIT_R, 0, 0);
    scene.time.delayedCall(80, () => bodyDot.destroy());
  }

  _spawnSemiHit(angle, radius, damage, staggerMs, skillId) {
    const scene = this.scene;
    const HIT_R = this.HIT_R;
    const INNER = HIT_R;
    const OUTER = Math.max(INNER, radius - HIT_R);
    const RINGS = 2;
    const DOTS_PER_RING = 10;
    const baseAngle = angle;
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
        dot.skillId = skillId;
        dot.staggerTime = staggerMs;
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0);
        scene.time.delayedCall(80, () => dot.destroy());
      }
    }
    // 사용자 몸 중심에도 히트판정 추가
    const bodyDot = this.slashGroup.create(this.x, this.y, this.HIT_TEX);
    bodyDot.setOrigin(0.5, 0.5);
    bodyDot.setVisible(false);
    bodyDot.owner = this;
    bodyDot.damage = damage;
    bodyDot.skillId = skillId;
    bodyDot.staggerTime = staggerMs;
    bodyDot.body.setAllowGravity(false);
    bodyDot.body.setImmovable(true);
    bodyDot.body.setCircle(HIT_R, 0, 0);
    scene.time.delayedCall(80, () => bodyDot.destroy());
  }

  // sweepDeg(중앙 각을 기준으로 좌우로 절반씩 퍼지는 부채꼴)
  _spawnArcHit(angle, sweepDeg, radius, damage, staggerMs, skillId) {
    const scene = this.scene;
    const HIT_R = this.HIT_R;
    const INNER = HIT_R;
    const OUTER = Math.max(INNER, radius - HIT_R);
    const baseAngle = angle;
    const sweepRad = Phaser.Math.DegToRad(Math.max(1, Math.min(359, sweepDeg)));
    const half = sweepRad / 2;

    // 히트 원 반경 기준으로 빈틈 없이 채우도록 간격 계산
    const stepRad = HIT_R * 0.9;
    const startAll = baseAngle - half;
    const endAll = baseAngle + half;

    for (let rad = INNER; rad <= OUTER + 0.0001; rad += stepRad) {
      const safeR = Math.max(rad, 0.0001);
      const margin = Math.asin(Math.min(1, HIT_R / safeR));
      const start = startAll + margin;
      const end = endAll - margin;
      if (end <= start) continue;

      // 호 길이가 히트 원 지름보다 촘촘하도록 각도 간격 설정
      const stepAng = Math.min(Phaser.Math.DegToRad(30), (HIT_R * 0.9) / safeR);
      for (let ang = start; ang <= end + 1e-6; ang += stepAng) {
        const px = this.x + Math.cos(ang) * rad;
        const py = this.y + Math.sin(ang) * rad;
        const dot = this.slashGroup.create(px, py, this.HIT_TEX);
        dot.setOrigin(0.5, 0.5);
        dot.setVisible(false);
        dot.owner = this;
        dot.damage = damage;
        dot.skillId = skillId;
        dot.staggerTime = staggerMs;
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0);
        scene.time.delayedCall(80, () => dot.destroy());
      }
    }
    // 사용자 몸 중심에도 히트판정 추가
    const bodyDot = this.slashGroup.create(this.x, this.y, this.HIT_TEX);
    bodyDot.setOrigin(0.5, 0.5);
    bodyDot.setVisible(false);
    bodyDot.owner = this;
    bodyDot.damage = damage;
    bodyDot.skillId = skillId;
    bodyDot.staggerTime = staggerMs;
    bodyDot.body.setAllowGravity(false);
    bodyDot.body.setImmovable(true);
    bodyDot.body.setCircle(HIT_R, 0, 0);
    scene.time.delayedCall(80, () => bodyDot.destroy());
  }

  _dashHitFirstTarget(angle, distance) {
    const scene = this.scene;
    const targets = scene.targets?.getChildren?.() || [];
    const layer = this.wallLayer;
    const step = 2;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const steps = Math.max(1, Math.ceil(distance / step));
    let hitTarget = null;
    for (let i = 0; i < steps; i++) {
      let nx = this.x + cos * step;
      let ny = this.y + sin * step;
      if (!this._isCircleFree(nx, ny, this.HIT_R, layer)) {
        // 벽에 걸치면 진행 방향을 유지하면서 옆으로 미끄러지듯 보정
        const px = -sin,
          py = cos; // 진행에 수직(좌/우) 단위 벡터
        const slideStep = step;
        let slid = false;
        for (let s = 1; s <= 3; s++) {
          // 좌측으로 보정
          let sx = this.x + cos * step + px * slideStep * s;
          let sy = this.y + sin * step + py * slideStep * s;
          if (this._isCircleFree(sx, sy, this.HIT_R, layer)) {
            nx = sx;
            ny = sy;
            slid = true;
            break;
          }
          // 우측으로 보정
          sx = this.x + cos * step - px * slideStep * s;
          sy = this.y + sin * step - py * slideStep * s;
          if (this._isCircleFree(sx, sy, this.HIT_R, layer)) {
            nx = sx;
            ny = sy;
            slid = true;
            break;
          }
        }
        if (!slid) break; // 양측 모두 불가면 중단
      }
      // 충돌 검사(유리한 판정: 진행선(캡슐) 기준 측면 근접 허용)
      for (const t of targets) {
        if (!t || !t.active || t === this) continue;
        const dx0 = t.x - this.x;
        const dy0 = t.y - this.y;
        const selfR =
          Math.max(
            this.HIT_R ?? 0,
            (this.body?.width || 0) / 2,
            (this.body?.height || 0) / 2
          ) + 6;
        const tgtR = t.HIT_R ?? 8;
        const perp = Math.abs(dx0 * -sin + dy0 * cos);
        const along = dx0 * cos + dy0 * sin;
        const lateralGrace = 10;
        // 세그먼트 길이(step) 내에서만 유효하게 제한
        if (
          along >= -tgtR &&
          along <= step + tgtR &&
          perp <= selfR + tgtR + lateralGrace
        ) {
          hitTarget = t;
          break;
        }
      }
      this.setPosition(nx, ny);
      if (hitTarget) break;
    }
    if (hitTarget) {
      // 피해 10
      const skillId = this.getAttackSegmentId("Z", 3);
      if (typeof hitTarget.receiveDamage === "function") {
        hitTarget.receiveDamage(10, this, skillId, 0);
      }
      // 넉백 거리 2배 (80)
      const wanted = 80;
      const before = { x: hitTarget.x, y: hitTarget.y };
      // 사용 방향으로 밀치기
      const pushAngle = angle;
      this._knockbackWithWall(hitTarget, pushAngle, wanted);
      const moved = Math.hypot(hitTarget.x - before.x, hitTarget.y - before.y);
      if (moved < wanted - 1) {
        // 벽에 부딪힘: 추가 피해10 + 기절3s
        if (typeof hitTarget.receiveDamage === "function") {
          hitTarget.receiveDamage(
            10,
            this,
            this.getAttackSegmentId("Z", 4),
            3000
          );
        }
      }
    }
  }

  _knockbackWithWall(target, angle, distance) {
    const layer = target.wallLayer || this.wallLayer;
    const step = 2;
    const cos = Math.cos(angle),
      sin = Math.sin(angle);
    const steps = Math.max(1, Math.ceil(distance / step));
    const r = Math.max(
      target?.HIT_R ?? 0,
      (target?.body?.width || 0) / 2,
      (target?.body?.height || 0) / 2,
      6
    );
    for (let i = 1; i <= steps; i++) {
      const cx = target.x + cos * step;
      const cy = target.y + sin * step;
      if (!this._isCircleFree(cx, cy, r, layer)) break;
      target.setPosition(cx, cy);
    }
  }

  /** 전방 대시 */
  _skillDashHit() {
    // 캐릭터 고유 쿨타임
    // 버프 중엔 X 쿨타임을 1초로 단축
    this.setCooldown(
      "X",
      this._yellowBuffActive ? 1000 : this.DASH_COOLDOWN_MS
    );
    runDash(this, {
      distance: 35,
      speed: 2000,
      width: 12,
      damage: this.DASH_DAMAGE, // ⬅️ 대시 피해량
      staggerTime: this.DASH_STAGGER_TIME, // ⬅️ 대시 스턴 시간
      attack: false, // ⬅️ 대시 공격 여부 (true: 히트판정 생성)
      invincible: true, // ⬅️ 대시 중 무적 여부 (true: 피해 무시)
      wall: {
        layer: this.wallLayer, // GameScene에서 this.player.wallLayer = this.wallLayer; 해둔 값
        mode: "block_all", // 'always' | 'block_landing' | 'block_all'
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

  // C: 8초 버프 (노란 오버레이, Z/X 쿨다운 단축, 이속 +10%)
  _skillYellowBuff() {
    if (this._yellowBuffActive) return; // 중복 사용 방지

    const scene = this.scene;
    this._yellowBuffActive = true;

    // HUD: C 스킬을 노란색 오버레이로 잠금 표시
    if (scene?.hud?.setSkillOverlayColor) {
      scene.hud.setSkillOverlayColor("C", 0xffeb3b, 0.45);
      // 즉시 비활성 상태 반영
      if (scene.hud.updateSkillEnabled)
        scene.hud.updateSkillEnabled("C", false);
    }

    // 캐릭터 본체 틴트(노란-하양 번갈아 깜빡임)
    const flickerColors = [0xffeb3b, 0xffffff];
    let flickIdx = 0;
    this.setTint(flickerColors[flickIdx]);
    if (this._yellowFlickerTimer) {
      try {
        this._yellowFlickerTimer.remove(false);
      } catch (_) {}
    }
    this._yellowFlickerTimer = scene.time.addEvent({
      loop: true,
      delay: 140,
      callback: () => {
        if (!this._yellowBuffActive) return;
        flickIdx = (flickIdx ^ 1) | 0;
        this.setTint(flickerColors[flickIdx]);
      },
    });

    // 이동 속도 +10%
    const prevMul = this.speedMultiplier ?? 1;
    this._yellowBuffPrevSpeedMul = prevMul;
    this.speedMultiplier = prevMul * 1.1;

    // 8초 후 버프 종료 → 이때부터 C 쿨타임(6초) 시작
    const DURATION_MS = 8000;
    const COOLDOWN_MS = 6000;
    this._yellowBuffEndsAt = scene.time.now + DURATION_MS;

    // 남은 시간 바 생성(몸 아래)
    const barW = Math.max(24, Math.floor((this.width || 24) * 0.8));
    const barH = 3;
    const barOffsetY = (this.height || 16) / 2 + 6;
    if (!this._yellowBuffBarBg)
      this._yellowBuffBarBg = scene.add.graphics().setDepth(7);
    if (!this._yellowBuffBarFg)
      this._yellowBuffBarFg = scene.add.graphics().setDepth(8);

    const drawBuffBar = () => {
      const now = scene.time.now;
      const left = Math.max(0, this._yellowBuffEndsAt - now);
      const ratio = Math.max(0, Math.min(1, left / DURATION_MS));
      const x = this.x;
      const y = this.y + barOffsetY;
      // 배경(어두운 회색)
      this._yellowBuffBarBg.clear();
      this._yellowBuffBarBg.fillStyle(0x333333, 0.9);
      this._yellowBuffBarBg.fillRect(x - barW / 2, y - barH / 2, barW, barH);
      // 전경(황백색)
      this._yellowBuffBarFg.clear();
      const fgW = Math.floor(barW * ratio);
      this._yellowBuffBarFg.fillStyle(0xfff176, 1);
      this._yellowBuffBarFg.fillRect(x - barW / 2, y - barH / 2, fgW, barH);
    };

    drawBuffBar();
    if (this._yellowBuffBarUpdater) {
      try {
        this._yellowBuffBarUpdater.remove(false);
      } catch (_) {}
    }
    this._yellowBuffBarUpdater = scene.time.addEvent({
      loop: true,
      delay: 50,
      callback: () => {
        if (!this._yellowBuffActive) return;
        drawBuffBar();
      },
    });

    const endBuff = () => {
      this._yellowBuffActive = false;

      // 틴트/플리커 정리
      this.clearTint();
      if (this._yellowFlickerTimer) {
        try {
          this._yellowFlickerTimer.remove(false);
        } catch (_) {}
        this._yellowFlickerTimer = null;
      }

      // 이동 속도 복원
      this.speedMultiplier = this._yellowBuffPrevSpeedMul;

      // 버프 바 정리
      if (this._yellowBuffBarUpdater) {
        try {
          this._yellowBuffBarUpdater.remove(false);
        } catch (_) {}
        this._yellowBuffBarUpdater = null;
      }
      if (this._yellowBuffBarBg) {
        this._yellowBuffBarBg.destroy();
        this._yellowBuffBarBg = null;
      }
      if (this._yellowBuffBarFg) {
        this._yellowBuffBarFg.destroy();
        this._yellowBuffBarFg = null;
      }

      // HUD 오버레이 색상 원복(검정) + 즉시 활성화 표시
      if (scene?.hud?.setSkillOverlayColor) {
        scene.hud.setSkillOverlayColor("C", 0x000000, 0.45);
        if (scene.hud.updateSkillEnabled)
          scene.hud.updateSkillEnabled("C", true);
      }

      // 이제부터 C 쿨타임 시작
      this.setCooldown("C", COOLDOWN_MS);
    };

    this._yellowBuffTimer = scene.time.delayedCall(DURATION_MS, endBuff);
  }

  // 버프 중에는 C 스킬 사용 불가하도록 사용 가능 판정 오버라이드
  _isSkillEnabled(key, cfg) {
    if (key === "C" && this._yellowBuffActive) return false;
    return super._isSkillEnabled(key, cfg);
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
