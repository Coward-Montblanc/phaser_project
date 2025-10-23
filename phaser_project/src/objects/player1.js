import Player, { FACING_TO_RAD } from './Player.js';

export default class Player1 extends Player {
  constructor(scene, tx, ty) {
    super(scene, tx, ty, 'player1');

    // 히트박스 전용 그룹(겹침 판정용, 보이진 않음)
    this.slashGroup = scene.physics.add.group({
      allowGravity: false,
      immovable: true
    });
    // 히트박스용 원 텍스처(지름=2R) 1회 생성
    this.HIT_R = 6;
    this.HIT_TEX = this._ensureHitTexture(scene, this.HIT_R);

    // 스킬 구현 바인딩
    this.onSkillU = () => this._skillSlash180();
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

  /** 전방 180도 반원 휩쓸기 */
  _skillSlash180() {
    const scene = this.scene;

    // 쿨다운 & 연출 파라미터
    const COOLDOWN = 500;
    const LIFETIME = 50;
    const RADIUS   = 48;      // 부채꼴 시각효과 끝 반경
    const RINGS    = 3;
    const DOTS_PER_RING = 10;
    const SWEEP    = Math.PI; // 180도
    const baseAngle = this._facingAngleRad();
    this.setCooldown('U', COOLDOWN);
    this.lockMovement(LIFETIME);

    // 시각효과(선택): 반투명 부채꼴 그리기
    const g = scene.add.graphics().setDepth(10);
    this._sweepFanVfx(this.x, this.y, baseAngle, RADIUS, LIFETIME, 0xC50058, 0.3);
    scene.tweens.add({ targets: g, alpha: 0, duration: LIFETIME, onComplete: () => g.destroy() });

    // === 여기부터 '원 전체가 부채꼴 내부'가 되도록 보정 ===
    const HIT_R = this.HIT_R;         // 원 히트박스 반지름(예: 6)
    const INNER = HIT_R;              // 안쪽은 중심이 최소 HIT_R 떨어져 있어야 함
    const OUTER = Math.max(INNER, RADIUS - HIT_R); // 바깥쪽도 HIT_R만큼 안쪽으로

    for (let ring = 1; ring <= RINGS; ring++) {
    const rad = INNER + (OUTER - INNER) * (ring / RINGS); // 보정된 반경

    // 양끝 각도 여유: 경계선까지의 수직거리 r*sin(margin) >= HIT_R
    // => margin = asin(HIT_R / r)
    const margin = Math.asin(Math.min(1, HIT_R / Math.max(rad, 0.0001)));

    // 원 중심이 머무를 수 있는 각 구간(부채꼴 가장자리에서 margin만큼 깎음)
    const start = baseAngle - SWEEP / 2 + margin;
    const end   = baseAngle + SWEEP / 2 - margin;
    if (end <= start) continue; // 너무 가까우면 스킵

    for (let i = 0; i < DOTS_PER_RING; i++) {
        const t = (DOTS_PER_RING === 1) ? 0.5 : i / (DOTS_PER_RING - 1);
        const ang = start + t * (end - start);
        const px = this.x + Math.cos(ang) * rad;
        const py = this.y + Math.sin(ang) * rad;

        const dot = this.slashGroup.create(px, py, this.HIT_TEX);
        dot.setOrigin(0.5, 0.5);
        dot.setVisible(false);                // 디버그 시 true
        dot.owner = this;
        dot.body.setAllowGravity(false);
        dot.body.setImmovable(true);
        dot.body.setCircle(HIT_R, 0, 0);      // 중심 = (px, py)

        scene.time.delayedCall(LIFETIME, () => dot.destroy());
    }
    }
    // 실제 타격은 GameScene 쪽 overlap 콜백에서 처리(아래 참고)
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
