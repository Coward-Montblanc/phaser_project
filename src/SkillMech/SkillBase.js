export default class SkillBase {
    constructor({ id, cooldown = 1, damage = 0 } = {}) {
      this.id = id;
      this.cooldown = cooldown;
      this.cooldownLeft = 0;
      this.damage = damage;
      this.owner = null;
    }
    bindOwner(owner) { this.owner = owner; }
    canUse() { return this.cooldownLeft <= 0; }
    startCooldown() {
      this.cooldownLeft = this.cooldown;
      this._emitCd();
    }
    tick(dt) {
      if (this.cooldownLeft > 0) {
        this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
        this._emitCd();
      }
    }
    _emitCd() {
      this.owner?.events?.emit('skill:cd', {
        id: this.id, cd: this.cooldownLeft, max: this.cooldown
      });
    }
    // override in child class
    use(...args) { return false; }
  }
  