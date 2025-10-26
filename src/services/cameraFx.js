/** 간단 카메라 연출 유틸 */
export function shakeCamera(scene, opts = {}) {
  const cam = scene?.cameras?.main;
  if (!cam) return;
  const durationMs = Math.max(1, opts.durationMs ?? 80);
  // intensity: 0..1, 아주 약하게 기본값 설정
  const intensity = Math.min(1, Math.max(0, opts.intensity ?? 0.01));
  cam.shake(durationMs, intensity);
}
