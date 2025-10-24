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
    const s2x = rightEdge - size;
    const s1x = s2x - gap - size;

    this._ensureSkillIcon(1, s1x, sTop, size);
    this._ensureSkillIcon(2, s2x, sTop, size);
  }

  _ensureSkillIcon(id, x, y, size) {
    if (!this.skillIcons[id]) {
      const icon = this.scene.add.rectangle(x + size/2, y + size/2, size, size, 0xaaaaaa)
        .setStrokeStyle(2, 0x555555).setDepth(1000);
      const filler = this.scene.add.graphics().setDepth(1001);
      const maskShape = this.scene.add.graphics();
      const mask = maskShape.createGeometryMask();
      filler.setMask(mask);
      const txt = this.scene.add.text(x + size/2, y + size/2, '', {
        fontSize: 10, color: '#ffffff'
      }).setOrigin(0.5).setDepth(1002);

      this.add([icon, filler, txt]);
      this.skillIcons[id] = { icon, size };
      this.skillMasks[id] = { maskShape, mask };
      this.skillFillers[id] = filler;
      this.skillTexts[id] = txt;
    } else {
      const { icon } = this.skillIcons[id];
      icon.setPosition(x + size/2, y + size/2);
      this.skillTexts[id].setPosition(x + size/2, y + size/2);
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
    const { maskShape } = this.skillMasks[id];
    const cx = icon.icon.x, cy = icon.icon.y, r = icon.size/2 - 2;

    // 파이(부채꼴) 다시 그리기 — Phaser 3.55 호환 (arc 사용)
    filler.clear();
    if (ratio > 0) {
      const start = -Math.PI / 2;                 // 12시 방향
      const end   = start + Math.PI * 2 * ratio;  // 시계 방향 증분
      filler.fillStyle(0x000000, 0.45);
      filler.beginPath();
      filler.moveTo(cx, cy);
      filler.arc(cx, cy, r, start, end, false);   // false = 시계 방향
      filler.closePath();
      filler.fillPath();
    }

    maskShape.clear();
    maskShape.fillStyle(0xffffff, 1);
    maskShape.fillRoundedRect(cx - icon.size/2, cy - icon.size/2, icon.size, icon.size, 6);

    // 중앙 숫자(디버그): 남은 초 표시
    if (this.skillTexts?.[id]) {
       this.skillTexts[id].setText(leftSec > 0 && ratio > 0 ? leftSec.toFixed(1) : '');
    }
  }

  bind(player) {
    if (this.player) {
      this.player.events.off('hp:changed', this._hpHandler);
      this.player.events.off('skill:cd', this._cdHandler);
      this.player.events.off('death', this._deathHandler);
    }

    this.player = player;

    // HP 갱신
    this._hpHandler = ({ hp, maxHp }) => this.drawHp(hp, maxHp);
    player.events.on('hp:changed', this._hpHandler);
    this.drawHp(player.hp, player.maxHp);

    // 쿨다운 갱신
    this._cdHandler = ({ id, cd, max }) => {
      // 현재 구조: I=대시(슬롯1), U=슬래시(슬롯2)
      const slot = (id === 'I') ? 1 : 2;
      const ratio = (max > 0) ? Phaser.Math.Clamp(cd / max, 0, 1) : 0;
      this.updateSkillMask(slot, ratio, cd);
    };
    player.events.on('skill:cd', this._cdHandler);

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
