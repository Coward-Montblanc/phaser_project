import InitialScreen from "./scenes/InitialScreen.js";
import CharacterSelect from "./scenes/CharacterSelect.js";
import GameScene from "./scenes/GameScene.js";
import { GAME } from "./constants.js";

// -----------------------------
// Phaser 설정
// -----------------------------

const config = {
  type: Phaser.AUTO, // 렌더러 선택 WEBGL은 GPU CANVAS는 CPU AUTO는 자동선택
  parent: "game", // id="game"인 부분 안에 삽입됨. parent를 안주면 바디 끝에붙음음
  width: 30 * GAME.TILE_SIZE, // 내부 렌더 해상도(카메라 보이는 영역) — CSS scale로 2배 노출
  height: 14 * GAME.TILE_SIZE, // 내부 렌더 해상도(카메라 보이는 영역) — CSS scale로 2배 노출
  backgroundColor: "#0f1115", // 기본배경색
  physics: { default: "arcade", arcade: { debug: true } }, //기본 물리엔진과 해당 엔진옵션, 축정렬 충돌박스임. 디버그를 true로 두면 오버레이 표기
  scene: [InitialScreen, CharacterSelect, GameScene], //아래쪽 함수들 콜백 연결, this는 scene 컨텍스트로 바인딩됨
};
new Phaser.Game(config); //config를 바탕으로 게임 인스턴스 부팅
