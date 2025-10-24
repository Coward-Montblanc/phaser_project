import { UI, GAME } from "../constants.js";

export default class HUD extends Phaser.GameObjects.Container {
  constructor(scene) {
    super(scene, 0, 0);
    scene.add.existing(this);
    this.setScrollFactor(0);
    this.setDepth(15);
    this.player = null;

    // 그래픽 요소
    this.hpBg = scene.add.graphics().setDepth(15);
    this.hpFg = scene.add.graphics().setDepth(15);
    this.hpText = scene.add.text(0, 0, '', { fontSize: 12, color: '#ffffff' }).setDepth(15);
    this.add([this.hpBg, this.hpFg, this.hpText]);

    this.skillIcons = {};
    this.skillMasks = {};
    this.skillTexts = {};
    this.skillFillers = {};
    this.skillRechargeFillers = {};
    this.skillStackTexts = {};

    this.relayout();
    scene.scale.on('resize', () => this.relayout());
  }

  relayout() {
    const cam = this.scene.cameras.main;
    const right = cam.width - UI.PADDING.RIGHT;
    const top = UI.PADDING.TOP;

    this.hpX = right - UI.HPBAR.W;
    this.hpY = top;
    this._drawHpBar(1, 0, 0);

    const size = UI.SKILL_ICON_SIZE;
    const sTop = this.hpY + UI.HPBAR.H + UI.PADDING.GAP;
    const rightEdge = this.hpX + UI.HPBAR.W;
    const gap = 6;
    const s3x = rightEdge - size;
    const s2x = s3x - gap - size;
    const s1x = s2x - gap - size;

    this._ensureSkillIcon(1, s1x, sTop, size); // Z
    this._ensureSkillIcon(2, s2x, sTop, size); // X
    this._ensureSkillIcon(3, s3x, sTop, size); // C
  }

  _ensureSkillIcon(id, x, y, size) {
    if (!this.skillIcons[id]) {
      const icon = this.scene.add.rectangle(x + size/2, y + size/2, size, size, 0xaaaaaa)
        .setStrokeStyle(2, 0x555555).setDepth(1000);
      
      // 마스크 없이 직접 그리는 방식으로 변경
      const filler = this.scene.add.graphics().setDepth(1001);
      const rechargeFiller = this.scene.add.graphics().setDepth(1002);
      const txt = this.scene.add.text(x + size/2, y + size/2, '', {
        fontSize: 10, color: '#ffffff'
      }).setOrigin(0.5).setDepth(1003);
      const stackTxt = this.scene.add.text(x + size - 2, y + size - 1, '', {
        fontSize: 9, color: '#ffffff', align: 'right'
      }).setOrigin(1, 1).setDepth(1004);

      this.add([icon, filler, rechargeFiller, txt, stackTxt]);
      this.skillIcons[id] = { icon, size };
      this.skillMasks[id] = null; // 마스크 사용 안함
      this.skillFillers[id] = filler;
      this.skillTexts[id] = txt;
      this.skillRechargeFillers[id] = rechargeFiller;
      this.skillStackTexts[id] = stackTxt;
      
      // 초기 상태 설정 - 쿨타임 없음
      this.updateSkillMask(id, 0, 0);
      this.updateSkillRechargeMask(id, 0);
    } else {
      const { icon } = this.skillIcons[id];
      icon.setPosition(x + size/2, y + size/2);
      this.skillTexts[id].setPosition(x + size/2, y + size/2);
      this.skillRechargeFillers[id].setDepth(1002);
      this.skillStackTexts[id].setPosition(x + size - 2, y + size - 1);
    }
  }

  drawHp(hp, maxHp) {
    const ratio = maxHp > 0 ? hp / maxHp : 0;
    this._drawHpBar(ratio, hp, maxHp);
  }

  _drawHpBar(ratio, hp = 0, maxHp = 0) {
    const g0 = this.hpBg, g1 = this.hpFg;
    g0.clear(); g1.clear();

    g0.fillStyle(0x333333, 1);
    g0.fillRoundedRect(this.hpX, this.hpY, UI.HPBAR.W, UI.HPBAR.H, 6);

    const w = Math.floor(UI.HPBAR.W * Phaser.Math.Clamp(ratio, 0, 1));
    g1.fillStyle(0xd32f2f, 1);
    g1.fillRoundedRect(this.hpX, this.hpY, w, UI.HPBAR.H, 6);

    this.hpText.setText(`${hp}/${maxHp}`);
    this.hpText.setPosition(
      this.hpX + UI.HPBAR.W / 2 - this.hpText.width / 2,
      this.hpY + (UI.HPBAR.H - this.hpText.height) / 2 - 1 // 바 중앙에 살짝 내려 겹치기
    );
  }

  updateSkillMask(id, ratio, leftSec = 0) {
    const icon = this.skillIcons[id]; if (!icon) return;
    const filler = this.skillFillers[id];
    const cx = icon.icon.x, cy = icon.icon.y;
    const halfSize = icon.size / 2;

    // 네모 모양의 부채꼴 그리기
    filler.clear();
    if (ratio > 0) {
      // 12시 방향에서 시작 (위쪽 중앙)
      const start = Math.PI / 4;                 // 12시 방향
      const end   = start - Math.PI * 2 * ratio;    // 시계 방향 증분
      
      // 네모 모양의 부채꼴 그리기
      filler.fillStyle(0x000000, 0.3);
      filler.beginPath();
      filler.moveTo(cx, cy);
      
      // 네모 경계선을 따라 부채꼴 그리기
      const segments = Math.max(20, Math.floor(ratio * 60));
      for (let i = 0; i <= segments; i++) {
        const angle = start + (end - start) * (i / segments);
        
        // 각도에 따라 네모 경계선에서의 위치 계산
        let x, y;
        
        // 각도를 0~2π 범위로 정규화
        let normalizedAngle = angle;
        while (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
        while (normalizedAngle >= 2 * Math.PI) normalizedAngle -= 2 * Math.PI;
        
        if (normalizedAngle >= 0 && normalizedAngle < Math.PI/2) {
          // 위쪽 변 (12시 → 3시) - 12시가 위쪽 중앙에서 시작
          const t = normalizedAngle / (Math.PI/2);
          x = cx - halfSize + t * icon.size;
          y = cy - halfSize;
        } else if (normalizedAngle >= Math.PI/2 && normalizedAngle < Math.PI) {
          // 오른쪽 변 (3시 → 6시)
          const t = (normalizedAngle - Math.PI/2) / (Math.PI/2);
          x = cx + halfSize;
          y = cy - halfSize + t * icon.size;
        } else if (normalizedAngle >= Math.PI && normalizedAngle < 3*Math.PI/2) {
          // 아래쪽 변 (6시 → 9시)
          const t = (normalizedAngle - Math.PI) / (Math.PI/2);
          x = cx + halfSize - t * icon.size;
          y = cy + halfSize;
        } else {
          // 왼쪽 변 (9시 → 12시)
          const t = (normalizedAngle - 3*Math.PI/2) / (Math.PI/2);
          x = cx - halfSize;
          y = cy + halfSize - t * icon.size;
        }
        
        filler.lineTo(x, y);
      }
      filler.closePath();
      filler.fillPath();
    }

    // 중앙 숫자(디버그): 남은 초 표시
    if (this.skillTexts?.[id]) {
       this.skillTexts[id].setText(leftSec > 0 && ratio > 0 ? leftSec.toFixed(1) : '');
    }
  }

  // 충전(리차지) 오버레이 업데이트 - 빨간 반투명
  updateSkillRechargeMask(id, ratio) {
    const icon = this.skillIcons[id]; if (!icon) return;
    const filler = this.skillRechargeFillers[id];
    const cx = icon.icon.x, cy = icon.icon.y;
    const halfSize = icon.size / 2;

    filler.clear();
    if (ratio > 0) {
      const start = Math.PI / 4;                 // 12시 방향
      const end   = start - Math.PI * 2 * ratio; // 시계 방향
      filler.fillStyle(0xff0000, 0.35);
      filler.beginPath();
      filler.moveTo(cx, cy);
      const segments = Math.max(20, Math.floor(ratio * 60));
      for (let i = 0; i <= segments; i++) {
        const angle = start + (end - start) * (i / segments);
        let x, y;
        let normalizedAngle = angle;
        while (normalizedAngle < 0) normalizedAngle += 2 * Math.PI;
        while (normalizedAngle >= 2 * Math.PI) normalizedAngle -= 2 * Math.PI;
        if (normalizedAngle >= 0 && normalizedAngle < Math.PI/2) {
          const t = normalizedAngle / (Math.PI/2);
          x = cx - halfSize + t * icon.size; y = cy - halfSize;
        } else if (normalizedAngle >= Math.PI/2 && normalizedAngle < Math.PI) {
          const t = (normalizedAngle - Math.PI/2) / (Math.PI/2);
          x = cx + halfSize; y = cy - halfSize + t * icon.size;
        } else if (normalizedAngle >= Math.PI && normalizedAngle < 3*Math.PI/2) {
          const t = (normalizedAngle - Math.PI) / (Math.PI/2);
          x = cx + halfSize - t * icon.size; y = cy + halfSize;
        } else {
          const t = (normalizedAngle - 3*Math.PI/2) / (Math.PI/2);
          x = cx - halfSize; y = cy + halfSize - t * icon.size;
        }
        filler.lineTo(x, y);
      }
      filler.closePath();
      filler.fillPath();
    }
  }

  bind(player) {
    if (this.player) {
      this.player.events.off('hp:changed', this._hpHandler);
      this.player.events.off('skill:cd', this._cdHandler);
      this.player.events.off('skill:charge', this._chargeHandler);
      this.player.events.off('death', this._deathHandler);
    }

    this.player = player;

    // HP 갱신
    this._hpHandler = ({ hp, maxHp }) => this.drawHp(hp, maxHp);
    player.events.on('hp:changed', this._hpHandler);
    this.drawHp(player.hp, player.maxHp);

    // 쿨다운 갱신
    this._cdHandler = ({ id, cd, max }) => {
      // 매핑: Z=1, X=2, C=3
      const slot = (id === 'Z') ? 1 : (id === 'X') ? 2 : 3;
      const ratio = (max > 0) ? Phaser.Math.Clamp(cd / max, 0, 1) : 0;
      
      this.updateSkillMask(slot, ratio, cd);
    };
    player.events.on('skill:cd', this._cdHandler);

    // 충전(스택/리차지) 갱신
    this._chargeHandler = ({ id, charges, maxCharges, rechargeLeft, rechargeMax }) => {
      // 매핑: Z=1, X=2, C=3
      const slot = (id === 'Z') ? 1 : (id === 'X') ? 2 : 3;
      // 스택 숫자 우하단 표시
      if (this.skillStackTexts?.[slot]) {
        this.skillStackTexts[slot].setText(typeof charges === 'number' ? String(charges) : '');
      }
      // 리차지 오버레이
      const ratio = (rechargeMax > 0) ? Phaser.Math.Clamp((rechargeLeft ?? 0) / rechargeMax, 0, 1) : 0;
      this.updateSkillRechargeMask(slot, ratio);
    };
    player.events.on('skill:charge', this._chargeHandler);

    // 사망 이벤트
    this._deathHandler = () => this._startDeathFlow();
    player.events.on('death', this._deathHandler);
  }

  _startDeathFlow() {
    const cam = this.scene.cameras.main;
    const w = cam.width, h = cam.height;
    const overlay = this.scene.add.rectangle(w/2, h/2, w, h, 0x000000, 0.6)
      .setScrollFactor(0).setDepth(5000);
    const txt = this.scene.add.text(w/2, h/2, '10', {
      fontSize: 72, color: '#ff3b3b', fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(5001);

    this.player.active = false;
    let left = GAME.RESPAWN_COUNTDOWN;

    this.scene.time.addEvent({
      delay: 1000, repeat: left - 1, callback: () => {
        left -= 1; txt.setText(String(left));
        if (left <= 0) {
          overlay.destroy(); txt.destroy();
          this.player.hp = this.player.maxHp;
          this.player.events.emit('hp:changed', { hp: this.player.hp, maxHp: this.player.maxHp });
          this.player.active = true;
        }
      }
    });
  }
}
