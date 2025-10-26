import { GAME } from "../constants.js";

const DIR8 = [
  "right",
  "down-right",
  "down",
  "down-left",
  "left",
  "up-left",
  "up",
  "up-right",
];
export const FACING_TO_RAD = {
  right: 0,
  "down-right": Math.PI / 4,
  down: Math.PI / 2,
  "down-left": (3 * Math.PI) / 4,
  left: Math.PI,
  "up-left": (-3 * Math.PI) / 4,
  up: -Math.PI / 2,
  "up-right": -Math.PI / 4,
};

// 8방향 결정(22.5° 경계, 45° 섹터)
function vectorToFacing8(vx, vy) {
  const len = Math.hypot(vx, vy);
  if (len === 0) return null;
  const a = Math.atan2(vy, vx); // -PI..PI
  // 0:0°=right, 1:45°=down-right ... (시계방향)
  let idx = Math.round(a / (Math.PI / 4));
  // Math.round는 음수도 반올림되므로 정규화
  idx = ((idx % 8) + 8) % 8;
  return DIR8[idx];
}

export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, tx, ty, texture = "player1") {
    super(scene, 0, 0, texture, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(1);
    this.body.setAllowGravity(false);
    this.setCollideWorldBounds(true);
    this.body.setImmovable(false);
    this.body.moves = true;
    // 스프라이트/물리 바디를 중앙 기준으로 사용
    this.setOrigin(0.5, 0.5);
    this._applyBodySize(12, 12);

    // 상태
    this.facing = "down";
    this.cooldowns = new Map(); // ex) this.cooldowns.set('U', nextUsableTimeMs)
    this.cooldownDurations = new Map();
    this.isSkillLock = false; // 스킬 시전 중 이동 불가
    this.isStaggered = false; // 피격으로 인한 경직 상태
    this.lastHitBySkill = {}; // (deprecated) 호환용
    this.hitProcessed = new Set(); // 중복 히트 방지용: 처리된 attackId 집합
    this.attackSeqByKey = new Map(); // 스킬 키별 세션 시퀀스
    this.currentAttackSession = new Map(); // 스킬 키별 현재 세션 ID
    this.skillKeyHeld = { Z: false, X: false, C: false }; // 각 스킬 키의 홀드 상태 추적
    this.skillKeyPrev = { Z: false, X: false, C: false }; // 이전 프레임 상태(JustDown 판정용)
    this.skillStaggerTimes = {}; // 각 스킬별 기절 시간 (밀리초)
    this.staggerTimer = null; // 기절 타이머 참조
    this.staggerTextCount = 0; // 현재 표시 중인 기절 텍스트 개수
    // 스킬 메타/충전 상태
    this.skillConfigs = new Map(); // key -> { charged, maxCharges, rechargeMs, useCooldownMs }
    this.skillChargeState = new Map(); // key -> { charges, nextRechargeAt }
    // HP(캐릭터 파일에서 덮어쓰기 권장)
    this.maxHp = 1;
    this.hp = this.maxHp;
    // HUD 등과 연동할 이벤트 버스
    this.events = new Phaser.Events.EventEmitter();

    // 애니메이션 프리픽스(스프라이트 텍스처와 별개로 키 이름을 구성)
    this.animPrefix = texture;
    // 애니메이션
    this._ensureAnims(scene, this.animPrefix);

    // 위치
    this.snapToTile(tx, ty);

    // 스킬 키 바인딩 (Z/X/C)
    this.skillKeys = scene.input.keyboard.addKeys({
      Z: Phaser.Input.Keyboard.KeyCodes.Z,
      X: Phaser.Input.Keyboard.KeyCodes.X,
      C: Phaser.Input.Keyboard.KeyCodes.C,
    });

    // 마우스 조준 각도 고정용 상태
    this._aimLocked = false;
    this._aimAngleLocked = 0;
    this._aimUnlockAt = 0;

    // 스킬별 조준 각도(사용 시점의 스냅샷)
    this._skillAimAngle = 0;
    // 현재 실행 중인 스킬 키(쿨다운 자동 적용용)
    this._activeSkillKey = null;
    this._lastEnabledBroadcastAt = 0;
  }

  _isSkillEnabled(key, cfg) {
    // 타겟 필요 조건
    if (cfg && cfg.requireTargetInRange && cfg.requireTargetInRange > 0) {
      const r = cfg.requireTargetInRange;
      const r2 = r * r;
      const targets = this.scene?.targets?.getChildren?.() || [];
      for (const t of targets) {
        if (!t || !t.active || t === this) continue;
        const dx = t.x - this.x;
        const dy = t.y - this.y;
        if (dx * dx + dy * dy <= r2) return true;
      }
      return false;
    }
    return true;
  }

  /** 현재 스프라이트 프레임 크기 기준으로 바디 오프셋을 정중앙에 맞춤 */
  _centerBodyOffsets() {
    const body = this.body;
    if (!body) return;
    const bw = body.width || 0;
    const bh = body.height || 0;
    const sw = this.width || this.displayWidth || 0;
    const sh = this.height || this.displayHeight || 0;
    if (bw > 0 && bh > 0 && sw > 0 && sh > 0) {
      const offX = Math.round((sw - bw) / 2);
      const offY = Math.round((sh - bh) / 2);
      body.setOffset(offX, offY);
    }
  }

  /** 바디 크기 지정 후 중앙 정렬 적용 */
  _applyBodySize(w = 12, h = 12) {
    if (this.body) {
      this.body.setSize(w, h);
      this._centerBodyOffsets();
    }
  }

  /** 텍스처/프레임 변경 시에도 항상 중앙 기준을 유지 */
  setTexture(key, frame) {
    super.setTexture(key, frame);
    this._centerBodyOffsets();
    return this;
  }

  /** 일정 시간 동안 이동/입력 잠금 */
  lockMovement(ms) {
    this.isSkillLock = true;
    this.setVelocity(0, 0); // 즉시 멈춤
    this.scene.time.delayedCall(ms, () => {
      this.isSkillLock = false;
    });
  }

  /** 현재 마우스 방향으로 조준 각도를 고정 */
  lockAimFor(ms) {
    // 현재 마우스 위치 기준(활성 포인터 + 카메라 변환)
    const pointer = this.scene.input.activePointer;
    pointer.updateWorldPoint(this.scene.cameras.main);
    const dx = pointer.worldX - this.x;
    const dy = pointer.worldY - this.y;
    this._aimAngleLocked = Math.atan2(dy, dx);
    this._aimLocked = true;
    this._aimUnlockAt = this.scene.time.now + ms;
  }

  /** 현재 조준 각도(잠금 중이면 고정 각도 반환, 아니면 현재 바라보는 방향 각도) */
  _facingAngleRad() {
    if (this._aimLocked) return this._aimAngleLocked;
    return FACING_TO_RAD[this.facing] ?? 0;
  }

  /** 현재 마우스 각도(잠금 무시, 즉시 계산) */
  _mouseAngleRad() {
    const pointer = this.scene.input.activePointer;
    pointer.updateWorldPoint(this.scene.cameras.main);
    const dx = pointer.worldX - this.x;
    const dy = pointer.worldY - this.y;
    return Math.atan2(dy, dx);
  }

  /** 직전 스킬 시점의 조준 각도 조회 */
  getSkillAimAngle() {
    return this._skillAimAngle || this._facingAngleRad();
  }

  /** 피격으로 인한 경직 상태 적용 */
  applyStagger(duration = 1000) {
    this.isStaggered = true;
    this.setVelocity(0, 0); // 즉시 멈춤

    // 기절 텍스트 효과 생성 (중첩시에도 개별 텍스트)
    this._createStaggerText(duration);

    // 기존 기절 타이머가 있다면 취소하고 새로운 타이머 설정
    if (this.staggerTimer) {
      this.staggerTimer.remove();
    }

    this.staggerTimer = this.scene.time.delayedCall(duration, () => {
      this.isStaggered = false;
      this.staggerTimer = null;
    });
  }

  /** 기절 텍스트 효과 생성 */
  _createStaggerText(duration) {
    const scene = this.scene;

    // 현재 표시 중인 기절 텍스트 개수에 따라 위치 조정
    const offsetY = this.staggerTextCount * 15; // 각 텍스트마다 15px 간격
    const startY = this.y - this.height / 2 - 10 - offsetY; // 체력바 위쪽에서 시작

    const staggerText = scene.add
      .text(this.x, startY, "기절", {
        fontSize: "16px", // 더 크게
        fill: "#ff0000", // 더 밝은 빨간색
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        stroke: "#ffffff", // 흰색 테두리로 더 눈에 띄게
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(20); // HUD보다 높은 depth

    // 텍스트 개수 증가
    this.staggerTextCount++;

    // 텍스트가 위로 올라가는 애니메이션
    scene.tweens.add({
      targets: staggerText,
      y: startY - 2, // 30px 위로 이동
      alpha: 0, // 서서히 투명해짐
      duration: duration,
      ease: "Power2.easeOut",
      onComplete: () => {
        staggerText.destroy();
        this.staggerTextCount--; // 텍스트 개수 감소
      },
    });
  }

  /** 스킬별 기절 시간 설정 */
  setSkillStaggerTime(skillKey, durationMs) {
    this.skillStaggerTimes[skillKey] = durationMs;
  }

  /** 스킬 히트 기록 초기화 */
  clearSkillHitRecord(skillKey) {
    if (!skillKey) return;
    // 구세대 방식 호환
    this.lastHitBySkill[skillKey] = null;
    // 세션/중복 히트 기록 클린업(프리픽스 매칭)
    const session = this.currentAttackSession.get(skillKey);
    if (session) {
      const prefix = `${session}`;
      for (const id of Array.from(this.hitProcessed)) {
        if (id && typeof id === "string" && id.startsWith(prefix))
          this.hitProcessed.delete(id);
      }
    }
  }

  /** 스킬 ID로 기절 시간 가져오기 */
  getStaggerTimeBySkillId(skillId) {
    if (!skillId) return 0;

    // 스킬 ID에서 스킬 키 추출 (예: U_1 -> U, U-123-seg0 -> U)
    const skillKey = skillId.split(/[_-]/)[0] || null;
    const staggerTime = this.skillStaggerTimes[skillKey] || 0;
    return staggerTime;
  }

  /** 공격 세션 시작: 한 번의 스킬 사용 단위 */
  beginAttackSession(skillKey) {
    const prev = this.attackSeqByKey.get(skillKey) || 0;
    const next = prev + 1;
    this.attackSeqByKey.set(skillKey, next);
    const session = `${skillKey}-${next}-${this.scene?.time?.now | 0}`;
    this.currentAttackSession.set(skillKey, session);
    return session;
  }

  /** 공격 세션 내부의 세그먼트 ID(동일 세그먼트는 중복 히트 1회로 제한) */
  getAttackSegmentId(skillKey, segmentIndex = 0) {
    const session = this.currentAttackSession.get(skillKey);
    if (session) return `${session}-seg${segmentIndex | 0}`;
    // 세션이 없을 때도 안전하게 고유 ID 발급
    return `${skillKey}-adhoc-${this.scene?.time?.now | 0}-seg${
      segmentIndex | 0
    }`;
  }

  /** 공격 세션 종료: 세션 프리픽스의 기록 정리(메모리 청소 목적) */
  endAttackSession(skillKey) {
    const session = this.currentAttackSession.get(skillKey);
    if (session) {
      const prefix = `${session}`;
      for (const id of Array.from(this.hitProcessed)) {
        if (id && typeof id === "string" && id.startsWith(prefix))
          this.hitProcessed.delete(id);
      }
    }
    this.currentAttackSession.delete(skillKey);
  }

  static _animsCreated = {};
  _ensureAnims(scene, texture) {
    if (Player._animsCreated[texture]) return;
    // 통합 시트 전환 시, 개별 시트가 로드되지 않은 상태라면 애니 생성 스킵
    if (!scene.textures.exists(texture)) return;
    Player._animsCreated[texture] = true;

    scene.anims.create({
      key: `${texture}-walk-down`,
      frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: 2 }),
      frameRate: 12,
      repeat: -1,
    });
    scene.anims.create({
      key: `${texture}-walk-left`,
      frames: scene.anims.generateFrameNumbers(texture, { start: 3, end: 5 }),
      frameRate: 12,
      repeat: -1,
    });
    scene.anims.create({
      key: `${texture}-walk-right`,
      frames: scene.anims.generateFrameNumbers(texture, { start: 6, end: 8 }),
      frameRate: 12,
      repeat: -1,
    });
    scene.anims.create({
      key: `${texture}-walk-up`,
      frames: scene.anims.generateFrameNumbers(texture, { start: 9, end: 11 }),
      frameRate: 12,
      repeat: -1,
    });
    scene.anims.create({
      key: `${texture}-idle-down`,
      frames: [{ key: texture, frame: 1 }],
    });
    scene.anims.create({
      key: `${texture}-idle-left`,
      frames: [{ key: texture, frame: 4 }],
    });
    scene.anims.create({
      key: `${texture}-idle-right`,
      frames: [{ key: texture, frame: 7 }],
    });
    scene.anims.create({
      key: `${texture}-idle-up`,
      frames: [{ key: texture, frame: 10 }],
    });

    // ⬇️ 대각선 애니 (스프라이트가 아직 없으면 '가까운' 애니를 재사용)
    const alias = (key, toKey) => {
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: 0 }),
      });
      scene.anims.chain(key, [toKey]); // 간단한 별칭 효과 (또는 아래처럼 그대로 play 시 key 매핑해도 됨)
    };
    // 스프라이트가 있다면 여기서 실제 프레임 인덱스 넣어줘:
    // 예) down-right = 12..14, down-left = 15..17, up-left = 18..20, up-right = 21..23
    // scene.anims.create({ key: `${texture}-walk-down-right`, frames: scene.anims.generateFrameNumbers(texture, { start: 12, end: 14 }), frameRate: 12, repeat:-1 });
    // ...
    // scene.anims.create({ key: `${texture}-idle-down-right`, frames: [{ key: texture, frame: 13 }] });
    // ...
  }

  tileToWorld(t) {
    return t * GAME.TILE_SIZE + GAME.TILE_SIZE / 2;
  }
  snapToTile(tx, ty) {
    this.setVelocity(0, 0);
    this.setPosition(this.tileToWorld(tx), this.tileToWorld(ty));
  }
  // Player.js 내부에 유틸 추가
  _resolveAnimKey(kind /* 'walk' | 'idle' */) {
    const tex = this.animPrefix || this.texture.key;
    const key = `${tex}-${kind}-${this.facing}`; // 예: player1-walk-down-right
    if (this.scene.anims.exists(key)) return key;

    // 대각선 → 4방향 폴백
    const diagToCard = {
      "down-right": "down",
      "down-left": "down",
      "up-right": "up",
      "up-left": "up",
    };
    const card = diagToCard[this.facing] || this.facing; // 이미 4방향이면 그대로
    return `${tex}-${kind}-${card}`;
  }
  // 재생 헬퍼를 8방향 키로 통일
  playIdle() {
    this.anims.play(this._resolveAnimKey("idle"), true);
  }
  playWalk() {
    this.anims.play(this._resolveAnimKey("walk"), true);
  }

  updateFree(cursors) {
    if (this.isSkillLock) {
      this.setVelocity(0, 0);
      this.playIdle();
      return;
    }

    let vx = 0,
      vy = 0;
    if (cursors.W.isDown) vy -= 1;
    if (cursors.S.isDown) vy += 1;
    if (cursors.A.isDown) vx -= 1;
    if (cursors.D.isDown) vx += 1;

    if (vx && vy) {
      const inv = 1 / Math.sqrt(2);
      vx *= inv;
      vy *= inv;
    }
    this.setVelocity(vx * (this.speed ?? 150), vy * (this.speed ?? 150));

    const f = vectorToFacing8(vx, vy);
    if (f) this.facing = f; // 움직일 때만 방향 갱신(정지 시 마지막 방향 유지)

    vx === 0 && vy === 0 ? this.playIdle() : this.playWalk();

    this._handleSkillInput();

    // --- 쿨다운 진행 상황을 HUD로 계속 보내기 ---
    const now = this.scene.time.now;
    for (const [key, endAt] of this.cooldowns) {
      const maxMs = this.cooldownDurations.get(key) ?? 0;
      const leftMs = Math.max(0, endAt - now);
      const leftSec = leftMs / 1000;
      const maxSec = maxMs / 1000;
      this.events.emit("skill:cd", { id: key, cd: leftSec, max: maxSec });
      if (leftMs <= 0) this.cooldowns.delete(key);
    }
    // --- 충전식 스킬 리차지 진행 및 HUD 갱신 ---
    for (const [key, cfg] of this.skillConfigs) {
      if (!cfg || !cfg.charged) continue;
      const state = this.skillChargeState.get(key) || {
        charges: 0,
        nextRechargeAt: 0,
      };
      // 리차지 스케줄이 없고 미만이면 스케줄 시작
      if (
        state.charges < (cfg.maxCharges ?? 1) &&
        (!state.nextRechargeAt || state.nextRechargeAt <= 0)
      ) {
        state.nextRechargeAt = now + (cfg.rechargeMs ?? 1000);
      }
      // 리차지 도착 처리
      if (state.nextRechargeAt && now >= state.nextRechargeAt) {
        state.charges = Math.min(cfg.maxCharges ?? 1, (state.charges | 0) + 1);
        if (state.charges < (cfg.maxCharges ?? 1)) {
          state.nextRechargeAt = now + (cfg.rechargeMs ?? 1000);
        } else {
          state.nextRechargeAt = 0;
        }
      }
      const rechargeLeftMs =
        state.nextRechargeAt && state.nextRechargeAt > now
          ? state.nextRechargeAt - now
          : 0;
      this.skillChargeState.set(key, state);
      this.events.emit("skill:charge", {
        id: key,
        charges: state.charges,
        maxCharges: cfg.maxCharges,
        rechargeLeft: rechargeLeftMs / 1000,
        rechargeMax: (cfg.rechargeMs ?? 0) / 1000,
      });
    }
  }

  /** 이동과 무관한 스킬/쿨다운/HUD 틱 전용 */
  tickSkillsAndHud() {
    // 스킬 입력 처리
    this._handleSkillInput();

    // 에임 잠금 해제 시점 도달 체크
    if (this._aimLocked && this.scene.time.now >= this._aimUnlockAt) {
      this._aimLocked = false;
    }

    // 쿨다운 진행 상황 HUD로 송신
    const now = this.scene.time.now;
    for (const [key, endAt] of this.cooldowns) {
      const maxMs = this.cooldownDurations.get(key) ?? 0;
      const leftMs = Math.max(0, endAt - now);
      const leftSec = leftMs / 1000;
      const maxSec = maxMs / 1000;
      this.events.emit("skill:cd", { id: key, cd: leftSec, max: maxSec });
      if (leftMs <= 0) this.cooldowns.delete(key);
    }
    // 충전식 스킬 리차지 진행 및 HUD 갱신
    for (const [key, cfg] of this.skillConfigs) {
      if (!cfg || !cfg.charged) continue;
      const state = this.skillChargeState.get(key) || {
        charges: 0,
        nextRechargeAt: 0,
      };
      if (
        state.charges < (cfg.maxCharges ?? 1) &&
        (!state.nextRechargeAt || state.nextRechargeAt <= 0)
      ) {
        state.nextRechargeAt = now + (cfg.rechargeMs ?? 1000);
      }
      if (state.nextRechargeAt && now >= state.nextRechargeAt) {
        state.charges = Math.min(cfg.maxCharges ?? 1, (state.charges | 0) + 1);
        if (state.charges < (cfg.maxCharges ?? 1)) {
          state.nextRechargeAt = now + (cfg.rechargeMs ?? 1000);
        } else {
          state.nextRechargeAt = 0;
        }
      }
      const rechargeLeftMs =
        state.nextRechargeAt && state.nextRechargeAt > now
          ? state.nextRechargeAt - now
          : 0;
      this.skillChargeState.set(key, state);
      this.events.emit("skill:charge", {
        id: key,
        charges: state.charges,
        maxCharges: cfg.maxCharges,
        rechargeLeft: rechargeLeftMs / 1000,
        rechargeMax: (cfg.rechargeMs ?? 0) / 1000,
      });
    }

    // 사용 가능 상태 주기적 브로드캐스트(150ms)
    const now2 = this.scene.time.now;
    if (
      !this._lastEnabledBroadcastAt ||
      now2 - this._lastEnabledBroadcastAt >= 150
    ) {
      for (const [key, cfg] of this.skillConfigs) {
        if (!cfg) continue;
        const en = this._isSkillEnabled(key, cfg);
        this.events.emit("skill:enabled", { id: key, enabled: !!en });
      }
      this._lastEnabledBroadcastAt = now2;
    }
  }

  _handleSkillInput() {
    const now = this.scene.time.now;

    // stagger 상태일 때는 스킬 사용 불가
    if (this.isStaggered) {
      return;
    }

    // 스킬 시전/대시 등으로 이동 잠금 중에는 스킬 재시작 금지
    if (this.isSkillLock) {
      return;
    }

    // Z/X/C 키 상태 업데이트
    this.skillKeyHeld.Z = !!this.skillKeys.Z.isDown;
    this.skillKeyHeld.X = !!this.skillKeys.X.isDown;
    this.skillKeyHeld.C = !!this.skillKeys.C.isDown;

    // JustDown 판정
    const justZ = this.skillKeyHeld.Z && !this.skillKeyPrev.Z;
    const justX = this.skillKeyHeld.X && !this.skillKeyPrev.X;
    const justC = this.skillKeyHeld.C && !this.skillKeyPrev.C;

    // 스킬 처리(한 번 눌림에 1회)
    if (justZ) this._tryUseSkill("Z", this.onSkillZ);
    if (justX) this._tryUseSkill("X", this.onSkillX);
    if (justC) this._tryUseSkill("C", this.onSkillC);

    // 홀드 자동 재시전: 쿨이 끝나는 즉시 다시 시도
    const tryAutoHold = (key, handler) => {
      const cfg = this.skillConfigs.get(key);
      if (cfg && cfg.autoHold && this.skillKeyHeld[key]) {
        this._tryUseSkill(key, handler);
      }
    };
    tryAutoHold("Z", this.onSkillZ);
    tryAutoHold("X", this.onSkillX);
    tryAutoHold("C", this.onSkillC);

    // prev 업데이트
    this.skillKeyPrev.Z = this.skillKeyHeld.Z;
    this.skillKeyPrev.X = this.skillKeyHeld.X;
    this.skillKeyPrev.C = this.skillKeyHeld.C;
  }

  /** 스킬 사용 시도(쿨다운/충전 규칙 적용) */
  _tryUseSkill(key, cb) {
    const now = this.scene.time.now;
    const cfg = this.skillConfigs.get(key);
    const next = this.cooldowns.get(key) ?? 0;
    // 사용 가능 조건(예: 타겟 필요) 사전 체크
    const enabled = this._isSkillEnabled(key, cfg);
    if (!enabled) {
      // HUD에 즉시 반영
      this.events.emit("skill:enabled", { id: key, enabled: false });
      return;
    }

    // 잠금 중에는 시도하지 않음(이중 안전장치)
    if (this.isSkillLock || this.isStaggered) return;

    if (cfg && cfg.charged) {
      const state = this.skillChargeState.get(key) || {
        charges: 0,
        nextRechargeAt: 0,
      };
      if (now >= next && state.charges > 0 && typeof cb === "function") {
        // 공통 에임 각도 스냅샷
        this._skillAimAngle = cfg.mouseAim
          ? this._mouseAngleRad()
          : this._facingAngleRad();
        // 스킬 사용 방향으로 스프라이트 바라보게(8방향 스냅)
        {
          const ang = this._skillAimAngle;
          const fx = Math.cos(ang);
          const fy = Math.sin(ang);
          const face = vectorToFacing8(fx, fy);
          if (face) this.facing = face;
        }
        // 공통 에임 잠금 처리(옵션)
        if (cfg.aimLock) this.lockAimFor(cfg.aimLockMs ?? 200);
        const useCd = cfg.useCooldownMs ?? 0;
        if (useCd > 0) this.setCooldown(key, useCd);
        else this.beginAttackSession(key);
        this._activeSkillKey = key;
        cb.call(this);
        this._activeSkillKey = null;
        state.charges = Math.max(0, (state.charges | 0) - 1);
        if (state.charges < (cfg.maxCharges ?? 1)) {
          const now2 = this.scene.time.now;
          const nextAt =
            state.nextRechargeAt && state.nextRechargeAt > now2
              ? state.nextRechargeAt
              : now2 + (cfg.rechargeMs ?? 1000);
          state.nextRechargeAt = nextAt;
        } else {
          state.nextRechargeAt = 0;
        }
        this.skillChargeState.set(key, state);
      }
      return;
    }

    // 일반 스킬: 기존 규칙 유지(스킬 내부에서 setCooldown 호출 기대)
    if (now >= next && typeof cb === "function") {
      // 공통 에임 각도 스냅샷
      if (cfg) {
        this._skillAimAngle = cfg.mouseAim
          ? this._mouseAngleRad()
          : this._facingAngleRad();
        // 스킬 사용 방향으로 스프라이트 바라보게(8방향 스냅)
        {
          const ang = this._skillAimAngle;
          const fx = Math.cos(ang);
          const fy = Math.sin(ang);
          const face = vectorToFacing8(fx, fy);
          if (face) this.facing = face;
        }
        if (cfg.aimLock) this.lockAimFor(cfg.aimLockMs ?? 200);
      } else {
        this._skillAimAngle = this._facingAngleRad();
      }
      this._activeSkillKey = key;
      cb.call(this);
      this._activeSkillKey = null;
    }
  }

  setCooldown(key, msFromNow) {
    const now = this.scene.time.now;
    this.cooldowns.set(key, now + msFromNow);
    this.cooldownDurations.set(key, msFromNow);

    // 새로운 공격 세션 시작(한 번의 스킬 사용 단위)
    this.beginAttackSession(key);
    // 구세대 기록 초기화(혹시 남아있을 수 있는 키 제거)
    this.lastHitBySkill[key] = null;

    // HUD가 바로 가려지도록 즉시 1회 알림(초 단위)
    this.events.emit("skill:cd", {
      id: key,
      cd: msFromNow / 1000,
      max: msFromNow / 1000,
    });
  }

  /** 현재 실행 중인 스킬 키에 쿨다운 적용(스킬 구현에서 키 하드코딩 없이 호출) */
  setCooldownCurrent(msFromNow) {
    const k = this._activeSkillKey;
    if (!k) return; // 안전장치: 활성 스킬이 없으면 무시
    this.setCooldown(k, msFromNow);
  }

  /** 스킬 바인딩 및 메타 설정(충전식 여부 등) */
  bindSkill(key, callback, config = {}) {
    if (key === "Z") this.onSkillZ = callback;
    else if (key === "X") this.onSkillX = callback;
    else if (key === "C") this.onSkillC = callback;

    const cfg = {
      charged: !!config.charged,
      maxCharges: Math.max(1, config.maxCharges ?? 1),
      rechargeMs: config.rechargeMs ?? 0,
      useCooldownMs: config.useCooldownMs ?? 0,
      mouseAim: !!config.mouseAim,
      aimLock: !!config.aimLock,
      aimLockMs: config.aimLockMs ?? 0,
      autoHold: config.autoHold ?? true,
      requireTargetInRange: config.requireTargetInRange ?? 0,
    };
    this.skillConfigs.set(key, cfg);

    if (cfg.charged) {
      // 초기 상태: 풀충전
      this.skillChargeState.set(key, {
        charges: cfg.maxCharges,
        nextRechargeAt: 0,
      });
      // HUD에 즉시 알림
      this.events.emit("skill:charge", {
        id: key,
        charges: cfg.maxCharges,
        maxCharges: cfg.maxCharges,
        rechargeLeft: 0,
        rechargeMax: cfg.rechargeMs / 1000,
      });
    }
  }

  // ===== HP/피해 처리 =====
  takeDamage(n = 0, skillId = null, staggerTimeOverride = null) {
    // 무적 상태일 때 피해 무시
    if (this.isInvincible) {
      return;
    }
    // 중복 히트 방지: 같은 attackId는 1회만 허용
    if (skillId) {
      if (this.hitProcessed.has(skillId)) return;
      this.hitProcessed.add(skillId);
    }

    const oldHp = this.hp;
    this.hp = Math.max(0, this.hp - Number(n));

    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });
    if (this.hp <= 0) this.events.emit("death");

    // 스킬별 기절 시간 적용
    if (skillId) {
      const staggerTime =
        (staggerTimeOverride ?? this.getStaggerTimeBySkillId(skillId)) | 0;
      console.log(
        "takeDamage - skillId:",
        skillId,
        "staggerTime:",
        staggerTime
      );
      if (staggerTime > 0) {
        this.applyStagger(staggerTime);
      }
    }

    // 체력바 업데이트 (다른 캐릭터인 경우)
    if (this.scene && this.scene._updateHealthBar) {
      this.scene._updateHealthBar(this);
    }
  }
  heal(n = 0) {
    this.hp = Math.min(this.maxHp, this.hp + Number(n));
    this.events.emit("hp:changed", { hp: this.hp, maxHp: this.maxHp });

    // 체력바 업데이트 (다른 캐릭터인 경우)
    if (this.scene && this.scene._updateHealthBar) {
      this.scene._updateHealthBar(this);
    }
  }
  isAlive() {
    return this.hp > 0;
  }
  receiveDamage(amount = 0, source = null, skillId = null, staggerTime = null) {
    this.takeDamage(amount, skillId, staggerTime);
  }
}
