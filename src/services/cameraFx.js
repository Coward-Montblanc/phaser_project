/** 간단 카메라 연출 유틸 */
export function shakeCamera(scene, opts = {}) {
  const cam = scene?.cameras?.main;
  if (!cam) return;
  const durationMs = Math.max(1, opts.durationMs ?? 80);
  // intensity: 0..1, 아주 약하게 기본값 설정
  const intensity = Math.min(1, Math.max(0, opts.intensity ?? 0.01));
  cam.shake(durationMs, intensity);
}

/** 암흑 오버레이/마스크 공통 관리자 */
class DarkOverlayManager {
  constructor(scene) {
    this.scene = scene;
    this.selfOverlay = null;
    this.selfMaskShape = null;
    this.selfUpdater = null;
    this.otherCircles = new Map(); // player -> { g, updater }
  }

  enableSelf(player, radius) {
    const scene = this.scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    const cam = scene.cameras.main;

    // 이미 활성화되어 있으면 갱신만
    if (!this.selfOverlay) {
      const overlay = scene.add.graphics().setScrollFactor(0).setDepth(998);
      overlay.fillStyle(0x000000, 1);
      overlay.fillRect(0, 0, w, h);
      const hole = scene.add.graphics({ x: 0, y: 0 });
      hole.setScrollFactor(0);
      const mask = hole.createGeometryMask();
      mask.invertAlpha = true;
      overlay.setMask(mask);
      this.selfOverlay = overlay;
      this.selfMaskShape = hole;
      this.selfUpdater = () => {
        if (!this.selfOverlay || !this.selfMaskShape) return;
        const px = player.x - cam.worldView.x;
        const py = player.y - cam.worldView.y;
        this.selfMaskShape.clear();
        this.selfMaskShape.fillStyle(0xffffff, 1);
        this.selfMaskShape.beginPath();
        this.selfMaskShape.fillCircle(px, py, radius);
      };
      scene.events.on("postupdate", this.selfUpdater);
    }
    // 즉시 1회 그리기
    if (this.selfUpdater) this.selfUpdater();
  }

  disableSelf() {
    const scene = this.scene;
    if (this.selfUpdater) scene.events.off("postupdate", this.selfUpdater);
    this.selfUpdater = null;
    try { this.selfOverlay?.clear?.(); this.selfOverlay?.destroy?.(); } catch (_) {}
    try { this.selfMaskShape?.destroy?.(); } catch (_) {}
    this.selfOverlay = null;
    this.selfMaskShape = null;
  }

  enableFor(player, radius) {
    const scene = this.scene;
    if (this.otherCircles.has(player)) return;
    const g = scene.add.graphics().setDepth(997);
    g.fillStyle(0x000000, 1);
    g.fillCircle(0, 0, radius);
    g.setPosition(player.x, player.y);
    g.setScrollFactor(1);
    const updater = () => {
      if (!g || !g.active) return;
      g.setPosition(player.x, player.y);
    };
    scene.events.on("postupdate", updater);
    this.otherCircles.set(player, { g, updater });
  }

  disableFor(player) {
    const scene = this.scene;
    const rec = this.otherCircles.get(player);
    if (!rec) return;
    const { g, updater } = rec;
    if (updater) scene.events.off("postupdate", updater);
    try { g?.destroy?.(); } catch (_) {}
    this.otherCircles.delete(player);
  }

  disableAllOthers() {
    for (const p of Array.from(this.otherCircles.keys())) this.disableFor(p);
  }
}

export function getDarkOverlayManager(scene) {
  if (!scene) return null;
  if (!scene._darkOverlayManager) scene._darkOverlayManager = new DarkOverlayManager(scene);
  return scene._darkOverlayManager;
}