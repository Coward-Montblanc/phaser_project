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
      }

  _handleSkillInput() {
    const now = this.scene.time.now;

    // U 스킬
    if (Phaser.Input.Keyboard.JustDown(this.skillKeys.U)) {
      const next = this.cooldowns.get('U') ?? 0;
      if (now >= next && this.onSkillU) this.onSkillU();
    }
    // I 스킬
    if (Phaser.Input.Keyboard.JustDown(this.skillKeys.I)) {
      const next = this.cooldowns.get('I') ?? 0;
      if (now >= next && this.onSkillI) this.onSkillI();
    }
  }

  setCooldown(key, msFromNow) {
    const now = this.scene.time.now;
    this.cooldowns.set(key, now + msFromNow);
    this.cooldownDurations.set(key, msFromNow);
    // HUD가 바로 가려지도록 즉시 1회 알림(초 단위)
    this.events.emit('skill:cd', {
      id: key,
      cd: msFromNow / 1000,
      max: msFromNow / 1000
    });
  }

  // ===== HP/피해 처리 =====
    takeDamage(n = 0) {
        this.hp = Math.max(0, this.hp - (n|0));
        this.events.emit('hp:changed', { hp: this.hp, maxHp: this.maxHp });
        if (this.hp <= 0) this.events.emit('death');
    }
    heal(n = 0) {
        this.hp = Math.min(this.maxHp, this.hp + (n|0));
        this.events.emit('hp:changed', { hp: this.hp, maxHp: this.maxHp });
    }
    isAlive() { return this.hp > 0; }
    receiveDamage(amount = 0, source = null) { this.takeDamage(amount); }
}
