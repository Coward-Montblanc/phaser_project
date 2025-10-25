// 공용 스프라이트 시트에서 캐릭터 인덱스로 3x4(가로3, 세로4) 셋을 잘라
// 각 플레이어의 애니메이션을 생성하는 유틸
// 전제: assets/player/sprite.png 는 32x32 셀로 쪼갠 스프라이트시트이고,
//       캐릭터 셋(3x4)은 가로로 5개씩 배치되어 세로로 이어짐.

import Player from "../objects/Player.js";

const CELL_W = 32;
const CELL_H = 32;
const SET_COLS = 3; // 1 캐릭터 셋의 가로 프레임 수
const SET_ROWS = 4; // 1 캐릭터 셋의 세로 프레임 수
const CHARS_PER_ROW = 5; // 가로로 배치된 캐릭터 셋 개수

const SHEET_KEY = "sprite";
const SHEET_COLS = SET_COLS * CHARS_PER_ROW; // 전체 시트의 가로 셀 수

function frameNumberFor(index, localX, localY) {
  const setRow = Math.floor(index / CHARS_PER_ROW);
  const setCol = index % CHARS_PER_ROW;
  const baseCol = setCol * SET_COLS;
  const baseRow = setRow * SET_ROWS;
  const globalCol = baseCol + localX;
  const globalRow = baseRow + localY;
  return globalRow * SHEET_COLS + globalCol;
}

export function preloadUnifiedSprite(scene) {
  if (!scene.textures.exists(SHEET_KEY)) {
    scene.load.spritesheet(SHEET_KEY, "assets/player/sprite.png", {
      frameWidth: CELL_W,
      frameHeight: CELL_H,
    });
  }
}

export function ensureSpriteAnimations(scene, virtualKey, index) {
  // 이미 생성된 경우 재생성 방지
  if (scene.anims.exists(`${virtualKey}-walk-down`)) {
    return;
  }

  // 각 방향별 프레임(행 기준)
  const rows = {
    down: 0,
    left: 1,
    right: 2,
    up: 3,
  };

  const makeFrames = (row) => [
    { key: SHEET_KEY, frame: frameNumberFor(index, 0, row) },
    { key: SHEET_KEY, frame: frameNumberFor(index, 1, row) },
    { key: SHEET_KEY, frame: frameNumberFor(index, 2, row) },
  ];

  scene.anims.create({
    key: `${virtualKey}-walk-down`,
    frames: makeFrames(rows.down),
    frameRate: 12,
    repeat: -1,
  });
  scene.anims.create({
    key: `${virtualKey}-walk-left`,
    frames: makeFrames(rows.left),
    frameRate: 12,
    repeat: -1,
  });
  scene.anims.create({
    key: `${virtualKey}-walk-right`,
    frames: makeFrames(rows.right),
    frameRate: 12,
    repeat: -1,
  });
  scene.anims.create({
    key: `${virtualKey}-walk-up`,
    frames: makeFrames(rows.up),
    frameRate: 12,
    repeat: -1,
  });

  // 가운데 프레임을 idle 로 사용
  scene.anims.create({
    key: `${virtualKey}-idle-down`,
    frames: [{ key: SHEET_KEY, frame: frameNumberFor(index, 1, rows.down) }],
  });
  scene.anims.create({
    key: `${virtualKey}-idle-left`,
    frames: [{ key: SHEET_KEY, frame: frameNumberFor(index, 1, rows.left) }],
  });
  scene.anims.create({
    key: `${virtualKey}-idle-right`,
    frames: [{ key: SHEET_KEY, frame: frameNumberFor(index, 1, rows.right) }],
  });
  scene.anims.create({
    key: `${virtualKey}-idle-up`,
    frames: [{ key: SHEET_KEY, frame: frameNumberFor(index, 1, rows.up) }],
  });

  // Player의 기본 애니 생성 우회를 위해 생성 완료 표시
  if (Player && typeof Player === "function") {
    Player._animsCreated = Player._animsCreated || {};
    Player._animsCreated[virtualKey] = true;
  }
}

export function getIdleFrame(index, facing = "down") {
  const row =
    facing === "left" ? 1 : facing === "right" ? 2 : facing === "up" ? 3 : 0;
  return frameNumberFor(index, 1, row);
}
