import Player, { FACING_TO_RAD } from './Player.js';
import { runDash } from '../SkillMech/Dash.js';

export default class Player2 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, 'player2');

    // 히트박스 전용 그룹(겹침 판정용, 보이진 않음)
    this.slashGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true
    });
    // 히트박스용 원 텍스처(지름=2R) 1회 생성
    this.HIT_R = 6;
    this.HIT_TEX = this._ensureHitTexture(scene, this.HIT_R);
    // 히트박스 전용 그룹(겹침 판정용, 보이진 않음)
    this.dashGroup = scene.physics.add.group({ allowGravity: false, immovable: true });

    // 스킬 구현 바인딩 (I는 충전식)
    this.bindSkill('U', () => this._skillSlash180());
    this.bindSkill('I', () => this._skillDashHit(), {
      charged: true,
      maxCharges: 3,
      rechargeMs: 3000,     // 충전시간 3초
      useCooldownMs: 500   // 재사용대기시간 1초
    });

    // === 캐릭터 고유 스탯 ===
    this.maxHp = 25;
    this.hp = this.maxHp;
    this.events.emit('hp:changed', { hp: this.hp, maxHp: this.maxHp });
    this.speed = 180;  // 캐릭터별 이동속도 (player1보다 빠름)

    // === 캐릭터 고유 스킬 수치 ===
    this.SLASH_DAMAGE = 1;  // player1보다 낮은 데미지
    this.DASH_DAMAGE  = 0;  // player1보다 낮은 데미지
    this.DASH_COOLDOWN_MS = 1500;  // player1보다 짧은 쿨다운

    // === 스킬별 스턴 시간 (밀리초) ===
    this.SLASH_STAGGER_TIME = 700;  // U스킬: 1초 기절
    this.DASH_STAGGER_TIME = 0;   // I스킬: 1초 기절
  }

    _ensureHitTexture(scene, r) {
        const key = `hit_${r}`;
        if (scene.textures.exists(key)) return key;
        const g = scene.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xff00ff, 1);
        g.fillCircle(r, r, r);          // 중심이 (r, r)인 원
        g.generateTexture(key, r * 2, r * 2);
        g.destroy();
        return key;
    }

  /** 5번 연속 베기 스킬 */
  _skillSlash180() {
    const scene = this.scene;

    // 스킬 파라미터
    const COOLDOWN = 5000;  // 전체 스킬 쿨다운
    const SLASH_COUNT = 5;  // 베기 횟수
    const SLASH_INTERVAL = 100;  // 베기 간격 (0.5초)
    const SLASH_DAMAGE = this.SLASH_DAMAGE;  // 각 베기 데미지
    const LIFETIME = 50;    // 각 베기 지속시간
    const RADIUS = 35;       // 베기 반경
    const SWEEP = Math.PI;   // 180도
    const baseAngle = this._facingAngleRad();
    
    this.setCooldown('U', COOLDOWN);
    this.lockMovement(SLASH_COUNT * SLASH_INTERVAL + 200); // 전체 스킬 지속시간 동안 이동 잠금
    // 전체 U 세션 종료 예약(모든 베기 끝난 뒤 약간의 여유)
    this.scene.time.delayedCall(SLASH_COUNT * SLASH_INTERVAL + 220, () => this.endAttackSession('U'));

    // 5번 연속 베기 실행
    for (let slashIndex = 0; slashIndex < SLASH_COUNT; slashIndex++) {
      const delay = slashIndex * SLASH_INTERVAL;
      
      scene.time.delayedCall(delay, () => {
        // 각 베기마다 시각효과
        this._sweepFanVfx(this.x, this.y, baseAngle, RADIUS, LIFETIME, 0x00C5FF, 0.4);
        
        // 각 베기마다 히트박스 생성
        this._createSlashHitbox(scene, baseAngle, RADIUS, LIFETIME, SLASH_DAMAGE, slashIndex);
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
        const t = (DOTS_PER_RING === 1) ? 0.5 : i / (DOTS_PER_RING - 1);
        const ang = start + t * (end - start);
        const px = this.x + Math.cos(ang) * rad;
        const py = this.y + Math.sin(ang) * rad;

        const dot = this.slashGroup.create(px, py, this.HIT_TEX);
        dot.setOrigin(0.5, 0.5);
        dot.setVisible(false);
        dot.owner = this;
        dot.damage = damage;
        dot.skillId = this.getAttackSegmentId('U', slashIndex); // 각 베기 세그먼트 ID
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
        distance: 80,   // player1보다 짧은 거리
        speed: 1000,    // player1보다 빠른 속도
        width: 10,      // player1보다 좁은 폭
        damage: this.DASH_DAMAGE,     // ⬅️ 대시 피해량
        staggerTime: this.DASH_STAGGER_TIME, // ⬅️ 대시 스턴 시간
        attack: false,                 // ⬅️ 대시 공격 여부 (true: 히트판정 생성)
        invincible: true,             // ⬅️ 대시 중 무적 여부 (true: 피해 무시)
        wall: {
          layer: this.wallLayer,          // GameScene에서 this.player.wallLayer = this.wallLayer; 해둔 값
          mode: 'block_landing',          // 'always' | 'block_landing' | 'block_all'
          pad: this.HIT_R + 1,
        },
        hit: {
          enabled: true,
          radius: this.HIT_R,
          step: this.HIT_R * 1.2,
          group: this.dashGroup,          // 없으면 모듈이 자동 생성
        },
        effect: {
          // spriteKey: 'dashBeam',       // 나중에 스프라이트 쓰고 싶으면 키 전달
          color: 0x00C5FF,  // player2는 파란색 계열
          alpha: 0.35,
        }
      });
  }  
  

  _facingAngleRad() {
    return FACING_TO_RAD[this.facing] ?? 0;
  }

  _sweepFanVfx(cx, cy, baseAngle, radius, durationMs, color = 0xffffff, alpha = 0.15) {
    const g = this.scene.add.graphics().setDepth(10);
  
    const SWEEP = Math.PI; // 180도
    const startAngle = baseAngle - SWEEP / 2;  // 왼쪽 경계에서 시작
    const endAngle   = baseAngle + SWEEP / 2;  // 오른쪽 경계가 최종
  
    this.scene.tweens.addCounter({
      from: 0, to: 1, duration: durationMs, ease: 'Sine.easeOut',
      onUpdate: (tw) => {
        const p = tw.getValue();                 // 0..1
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
      }
    });
  
    return g;
  }
}
