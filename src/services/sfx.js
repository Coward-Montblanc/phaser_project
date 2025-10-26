// 간단 SFX 재생 유틸 import { soundEffect, preloadSfx } from "../services/sfx.js";
// 사용 예: soundEffect(scene, 1)  // assets/soundEffect/1.mp3 재생
// GameScene.preload()에서 호출 preloadSfx(this, [1, 2, 3]); // 예: GameScene.preload()

const BASE_PATH = "assets/soundEffect/";

function _keyOf(id) {
  return `sfx_${id}`;
}

/** 사운드가 캐시에 있는지 확인 */
function _isLoaded(scene, key) {
  try {
    return !!scene?.cache?.audio?.exists(key);
  } catch (_) {
    return false;
  }
}

/** 번호 목록 선로딩 (선택) */
export function preloadSfx(scene, ids = []) {
  if (!scene || !scene.load) return;
  for (const id of ids) {
    const key = _keyOf(id);
    if (_isLoaded(scene, key)) continue;
    scene.load.audio(key, `${BASE_PATH}${id}.mp3`);
  }
}

/** 번호로 효과음 재생 (동적 로드 지원) */
export function soundEffect(scene, id, opts = {}) {
  if (!scene || !scene.sound) return;
  const key = _keyOf(id);
  const config = {
    volume: Math.min(1, Math.max(0, opts.volume ?? 1)),
    rate: opts.rate ?? 1,
    detune: opts.detune ?? 0,
    loop: !!opts.loop,
  };

  if (_isLoaded(scene, key)) {
    scene.sound.play(key, config);
    return;
  }

  // 동적 로드 후 재생
  scene.load.audio(key, `${BASE_PATH}${id}.mp3`);
  const onComplete = () => {
    scene.sound.play(key, config);
    scene.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
  };
  scene.load.on(Phaser.Loader.Events.COMPLETE, onComplete);
  scene.load.start();
}
