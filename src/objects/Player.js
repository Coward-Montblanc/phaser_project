import { GAME } from '../constants.js';

const DIR8 = ['right','down-right','down','down-left','left','up-left','up','up-right'];
export const FACING_TO_RAD = {
  'right': 0,
  'down-right': Math.PI/4,
  'down': Math.PI/2,
  'down-left': 3*Math.PI/4,
  'left': Math.PI,
  'up-left': -3*Math.PI/4,
  'up': -Math.PI/2,
  'up-right': -Math.PI/4,
};

// 8방향 결정(22.5° 경계, 45° 섹터)
function vectorToFacing8(vx, vy) {
    const len = Math.hypot(vx, vy);
    if (len === 0) return null;
    const a = Math.atan2(vy, vx);                 // -PI..PI
    // 0:0°=right, 1:45°=down-right ... (시계방향)
    let idx = Math.round(a / (Math.PI/4));
    // Math.round는 음수도 반올림되므로 정규화
    idx = (idx % 8 + 8) % 8;
    return DIR8[idx];
}

export default class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, tx, ty, texture = 'player1') {
    super(scene, 0, 0, texture, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(1);
    this.body.setAllowGravity(false);
    this.setCollideWorldBounds(true);
    this.body.setImmovable(false);
    this.body.moves = true;
    this.setSize(12, 12).setOffset(2, 2);

    // 상태
    this.facing = 'down';
    this.cooldowns = new Map(); // ex) this.cooldowns.set('U', nextUsableTimeMs)
    this.cooldownDurations = new Map();
    this.isSkillLock = false; // 스킬 시전 중 이동 불가
    this.isStaggered = false; // 피격으로 인한 경직 상태
    this.lastHitBySkill = {}; // (deprecated) 호환용
    this.hitProcessed = new Set(); // 중복 히트 방지용: 처리된 attackId 집합
    this.attackSeqByKey = new Map(); // 스킬 키별 세션 시퀀스
    this.currentAttackSession = new Map(); // 스킬 키별 현재 세션 ID
    this.skillKeyHeld = { U: false, I: false }; // 각 스킬 키의 홀드 상태 추적
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

    // 애니메이션
    this._ensureAnims(scene, texture);

    // 위치
    this.snapToTile(tx, ty);

    // 스킬 키 바인딩 (U/I 등)
    this.skillKeys = scene.input.keyboard.addKeys({
      U: Phaser.Input.Keyboard.KeyCodes.U,
      I: Phaser.Input.Keyboard.KeyCodes.I,
    });
  }

  /** 일정 시간 동안 이동/입력 잠금 */
  lockMovement(ms) {
    this.isSkillLock = true;
    this.setVelocity(0, 0); // 즉시 멈춤
    this.scene.time.delayedCall(ms, () => {
      this.isSkillLock = false;
    });
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
    
    const staggerText = scene.add.text(this.x, startY, '기절', {
      fontSize: '16px',  // 더 크게
      fill: '#ff0000',   // 더 밝은 빨간색
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      stroke: '#ffffff', // 흰색 테두리로 더 눈에 띄게
      strokeThickness: 3
    }).setOrigin(0.5, 0.5).setDepth(20); // HUD보다 높은 depth
    
    // 텍스트 개수 증가
    this.staggerTextCount++;
    
    // 텍스트가 위로 올라가는 애니메이션
    scene.tweens.add({
      targets: staggerText,
      y: startY - 2, // 30px 위로 이동
      alpha: 0,      // 서서히 투명해짐
      duration: duration,
      ease: 'Power2.easeOut',
      onComplete: () => {
        staggerText.destroy();
        this.staggerTextCount--; // 텍스트 개수 감소
      }
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
        if (id && typeof id === 'string' && id.startsWith(prefix)) this.hitProcessed.delete(id);
      }
    }
  }

  /** 스킬 ID로 기절 시간 가져오기 */
  getStaggerTimeBySkillId(skillId) {
    if (!skillId) return 0;
    
    // 스킬 ID에서 스킬 키 추출 (예: U_1 -> U, U-123-seg0 -> U)
    const skillKey = (skillId.split(/[_-]/)[0]) || null;
    const staggerTime = this.skillStaggerTimes[skillKey] || 0;
    return staggerTime;
  }

  /** 공격 세션 시작: 한 번의 스킬 사용 단위 */
  beginAttackSession(skillKey) {
    const prev = this.attackSeqByKey.get(skillKey) || 0;
    const next = prev + 1;
    this.attackSeqByKey.set(skillKey, next);
    const session = `${skillKey}-${next}-${(this.scene?.time?.now|0)}`;
    this.currentAttackSession.set(skillKey, session);
    return session;
  }

  /** 공격 세션 내부의 세그먼트 ID(동일 세그먼트는 중복 히트 1회로 제한) */
  getAttackSegmentId(skillKey, segmentIndex = 0) {
    const session = this.currentAttackSession.get(skillKey);
    if (session) return `${session}-seg${segmentIndex|0}`;
    // 세션이 없을 때도 안전하게 고유 ID 발급
    return `${skillKey}-adhoc-${(this.scene?.time?.now|0)}-seg${segmentIndex|0}`;
  }

  /** 공격 세션 종료: 세션 프리픽스의 기록 정리(메모리 청소 목적) */
  endAttackSession(skillKey) {
    const session = this.currentAttackSession.get(skillKey);
    if (session) {
      const prefix = `${session}`;
      for (const id of Array.from(this.hitProcessed)) {
        if (id && typeof id === 'string' && id.startsWith(prefix)) this.hitProcessed.delete(id);
      }
    }
    this.currentAttackSession.delete(skillKey);
  }

  static _animsCreated = {};
  _ensureAnims(scene, texture) {
    if (Player._animsCreated[texture]) return;
    Player._animsCreated[texture] = true;

    scene.anims.create({ key: `${texture}-walk-down`,  frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: 2 }),  frameRate: 12, repeat: -1 });
    scene.anims.create({ key: `${texture}-walk-left`,  frames: scene.anims.generateFrameNumbers(texture, { start: 3, end: 5 }),  frameRate: 12, repeat: -1 });
    scene.anims.create({ key: `${texture}-walk-right`, frames: scene.anims.generateFrameNumbers(texture, { start: 6, end: 8 }),  frameRate: 12, repeat: -1 });
    scene.anims.create({ key: `${texture}-walk-up`,    frames: scene.anims.generateFrameNumbers(texture, { start: 9, end: 11 }), frameRate: 12, repeat: -1 });
    scene.anims.create({ key: `${texture}-idle-down`,  frames: [{ key: texture, frame: 1 }] });
    scene.anims.create({ key: `${texture}-idle-left`,  frames: [{ key: texture, frame: 4 }] });
    scene.anims.create({ key: `${texture}-idle-right`, frames: [{ key: texture, frame: 7 }] });
    scene.anims.create({ key: `${texture}-idle-up`,    frames: [{ key: texture, frame: 10 }] });

    // ⬇️ 대각선 애니 (스프라이트가 아직 없으면 '가까운' 애니를 재사용)
    const alias = (key, toKey) => {
        scene.anims.create({ key, frames: scene.anims.generateFrameNumbers(texture, { start: 0, end: 0 }) });
        scene.anims.chain(key, [toKey]); // 간단한 별칭 효과 (또는 아래처럼 그대로 play 시 key 매핑해도 됨)
    };
    // 스프라이트가 있다면 여기서 실제 프레임 인덱스 넣어줘:
    // 예) down-right = 12..14, down-left = 15..17, up-left = 18..20, up-right = 21..23
    // scene.anims.create({ key: `${texture}-walk-down-right`, frames: scene.anims.generateFrameNumbers(texture, { start: 12, end: 14 }), frameRate: 12, repeat:-1 });
    // ...
    // scene.anims.create({ key: `${texture}-idle-down-right`, frames: [{ key: texture, frame: 13 }] });
    // ...
  }

  tileToWorld(t) { return t * GAME.TILE_SIZE + GAME.TILE_SIZE / 2; }
  snapToTile(tx, ty) {
    this.setVelocity(0,0);
    this.setPosition(this.tileToWorld(tx), this.tileToWorld(ty));
  }
    // Player.js 내부에 유틸 추가
    _resolveAnimKey(kind /* 'walk' | 'idle' */) {
        const tex = this.texture.key;
        const key = `${tex}-${kind}-${this.facing}`; // 예: player1-walk-down-right
        if (this.scene.anims.exists(key)) return key;
    
        // 대각선 → 4방향 폴백
        const diagToCard = {
        'down-right': 'down',
        'down-left':  'down',
        'up-right':   'up',
        'up-left':    'up',
        };
        const card = diagToCard[this.facing] || this.facing; // 이미 4방향이면 그대로
        return `${tex}-${kind}-${card}`;
    }
    // 재생 헬퍼를 8방향 키로 통일
    playIdle() { this.anims.play(this._resolveAnimKey('idle'), true); }
    playWalk() { this.anims.play(this._resolveAnimKey('walk'), true); }

    updateFree(cursors) {
        if (this.isSkillLock) {
          this.setVelocity(0, 0);
          this.playIdle();
          return;
        }
      
        let vx=0, vy=0;
        if (cursors.W.isDown) vy -= 1;
        if (cursors.S.isDown) vy += 1;
        if (cursors.A.isDown) vx -= 1;
        if (cursors.D.isDown) vx += 1;
      
        if (vx && vy) { const inv = 1/Math.sqrt(2); vx*=inv; vy*=inv; }
        this.setVelocity(vx * (this.speed ?? 150), vy * (this.speed ?? 150));
      
        const f = vectorToFacing8(vx, vy);
        if (f) this.facing = f;      // 움직일 때만 방향 갱신(정지 시 마지막 방향 유지)
      
        (vx===0 && vy===0) ? this.playIdle() : this.playWalk();
      
        this._handleSkillInput();

          // --- 쿨다운 진행 상황을 HUD로 계속 보내기 ---
          const now = this.scene.time.now;
          for (const [key, endAt] of this.cooldowns) {
            const maxMs = this.cooldownDurations.get(key) ?? 0;
            const leftMs = Math.max(0, endAt - now);
            const leftSec = leftMs / 1000;
            const maxSec = maxMs / 1000;
            this.events.emit('skill:cd', { id: key, cd: leftSec, max: maxSec });
            if (leftMs <= 0) this.cooldowns.delete(key);
          }
          // --- 충전식 스킬 리차지 진행 및 HUD 갱신 ---
          for (const [key, cfg] of this.skillConfigs) {
            if (!cfg || !cfg.charged) continue;
            const state = this.skillChargeState.get(key) || { charges: 0, nextRechargeAt: 0 };
            // 리차지 스케줄이 없고 미만이면 스케줄 시작
            if (state.charges < (cfg.maxCharges ?? 1) && (!state.nextRechargeAt || state.nextRechargeAt <= 0)) {
              state.nextRechargeAt = now + (cfg.rechargeMs ?? 1000);
            }
            // 리차지 도착 처리
            if (state.nextRechargeAt && now >= state.nextRechargeAt) {
              state.charges = Math.min((cfg.maxCharges ?? 1), (state.charges | 0) + 1);
              if (state.charges < (cfg.maxCharges ?? 1)) {
                state.nextRechargeAt = now + (cfg.rechargeMs ?? 1000);
              } else {
                state.nextRechargeAt = 0;
              }
            }
            const rechargeLeftMs = (state.nextRechargeAt && state.nextRechargeAt > now) ? (state.nextRechargeAt - now) : 0;
            this.skillChargeState.set(key, state);
            this.events.emit('skill:charge', {
              id: key,
              charges: state.charges,
              maxCharges: cfg.maxCharges,
              rechargeLeft: (rechargeLeftMs / 1000),
              rechargeMax: ((cfg.rechargeMs ?? 0) / 1000)
            });
          }
      }

  _handleSkillInput() {
    const now = this.scene.time.now;

    // stagger 상태일 때는 스킬 사용 불가
    if (this.isStaggered) {
      return;
    }

    // U 스킬 키 상태 업데이트
    if (this.skillKeys.U.isDown) {
      this.skillKeyHeld.U = true;
    } else {
      this.skillKeyHeld.U = false;
    }

    // I 스킬 키 상태 업데이트
    if (this.skillKeys.I.isDown) {
      this.skillKeyHeld.I = true;
    } else {
      this.skillKeyHeld.I = false;
    }

    // U 스킬 처리
    if (this.skillKeyHeld.U) {
      this._tryUseSkill('U', this.onSkillU);
    }

    // I 스킬 처리
    if (this.skillKeyHeld.I) {
      this._tryUseSkill('I', this.onSkillI);
    }
  }

  /** 스킬 사용 시도(쿨다운/충전 규칙 적용) */
  _tryUseSkill(key, cb) {
    const now = this.scene.time.now;
    const cfg = this.skillConfigs.get(key);
    const next = this.cooldowns.get(key) ?? 0;

    if (cfg && cfg.charged) {
      const state = this.skillChargeState.get(key) || { charges: 0, nextRechargeAt: 0 };
      if (now >= next && state.charges > 0 && typeof cb === 'function') {
        const useCd = cfg.useCooldownMs ?? 0;
        if (useCd > 0) this.setCooldown(key, useCd); else this.beginAttackSession(key);
        cb.call(this);
        state.charges = Math.max(0, (state.charges | 0) - 1);
        if (state.charges < (cfg.maxCharges ?? 1)) {
          const now2 = this.scene.time.now;
          const nextAt = state.nextRechargeAt && state.nextRechargeAt > now2 ? state.nextRechargeAt : (now2 + (cfg.rechargeMs ?? 1000));
          state.nextRechargeAt = nextAt;
        } else {
          state.nextRechargeAt = 0;
        }
        this.skillChargeState.set(key, state);
      }
      return;
    }

    // 일반 스킬: 기존 규칙 유지(스킬 내부에서 setCooldown 호출 기대)
    if (now >= next && typeof cb === 'function') {
      cb.call(this);
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
    this.events.emit('skill:cd', {
      id: key,
      cd: msFromNow / 1000,
      max: msFromNow / 1000
    });
  }

  /** 스킬 바인딩 및 메타 설정(충전식 여부 등) */
  bindSkill(key, callback, config = {}) {
    if (key === 'U') this.onSkillU = callback;
    else if (key === 'I') this.onSkillI = callback;

    const cfg = {
      charged: !!config.charged,
      maxCharges: Math.max(1, config.maxCharges ?? 1),
      rechargeMs: config.rechargeMs ?? 0,
      useCooldownMs: config.useCooldownMs ?? 0,
    };
    this.skillConfigs.set(key, cfg);

    if (cfg.charged) {
      // 초기 상태: 풀충전
      this.skillChargeState.set(key, { charges: cfg.maxCharges, nextRechargeAt: 0 });
      // HUD에 즉시 알림
      this.events.emit('skill:charge', {
        id: key,
        charges: cfg.maxCharges,
        maxCharges: cfg.maxCharges,
        rechargeLeft: 0,
        rechargeMax: cfg.rechargeMs / 1000
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
        this.hp = Math.max(0, this.hp - (n|0));
        
        this.events.emit('hp:changed', { hp: this.hp, maxHp: this.maxHp });
        if (this.hp <= 0) this.events.emit('death');
        
        // 스킬별 기절 시간 적용
        if (skillId) {
            const staggerTime = (staggerTimeOverride ?? this.getStaggerTimeBySkillId(skillId)) | 0;
            console.log('takeDamage - skillId:', skillId, 'staggerTime:', staggerTime);
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
        this.hp = Math.min(this.maxHp, this.hp + (n|0));
        this.events.emit('hp:changed', { hp: this.hp, maxHp: this.maxHp });
        
        // 체력바 업데이트 (다른 캐릭터인 경우)
        if (this.scene && this.scene._updateHealthBar) {
            this.scene._updateHealthBar(this);
        }
    }
    isAlive() { return this.hp > 0; }
    receiveDamage(amount = 0, source = null, skillId = null, staggerTime = null) { this.takeDamage(amount, skillId, staggerTime); }
}
