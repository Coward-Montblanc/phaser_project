export default class CharacterSelect extends Phaser.Scene {
  constructor() {
    super({ key: "CharacterSelect" });
  }

  preload() {
    // 통합 스프라이트 시트 로드(32x32)
    this.load.spritesheet("sprite", "assets/player/sprite.png", {
      frameWidth: 32,
      frameHeight: 32,
    });
  }

  create() {
    // 배경색 설정
    this.cameras.main.setBackgroundColor("#0f1115");

    // 캐릭터 선택 제목
    this.add
      .text(this.cameras.main.centerX, 50, "캐릭터 선택", {
        fontSize: "24px",
        fill: "#e6e6e6",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      })
      .setOrigin(0.5);

    // 격자 설정
    this.gridWidth = 10;
    this.gridHeight = 5;
    this.cellSize = 32;
    this.startX =
      this.cameras.main.centerX - (this.gridWidth * this.cellSize) / 2;
    this.startY =
      this.cameras.main.centerY - (this.gridHeight * this.cellSize) / 2;

    // 현재 선택된 위치 (0, 0에서 시작)
    this.selectedX = 0;
    this.selectedY = 0;

    // 격자 그리기
    this.drawGrid();

    // 선택 표시기 생성
    this.selectionIndicator = this.add.graphics();
    this.updateSelectionIndicator();

    // 캐릭터 슬롯 맵 (gridX,gridY -> characterKey)
    this.characterSlots = new Map();

    // 캐릭터 배치(각 키에 해당하는 인덱스 지정)
    this.placeCharacter(0, 0, "player1", 0);
    this.placeCharacter(1, 0, "player2", 1);
    this.placeCharacter(2, 0, "player3", 39);
    // temp 캐릭터: 맨 왼쪽 아래 라인
    this.placeCharacter(0, this.gridHeight - 1, "tempplayer1", 3);
    this.placeCharacter(1, this.gridHeight - 1, "tempplayer2", 39);

    // 조작 안내
    this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.height - 50,
        "좌클릭: 캐릭터 고르기 · Z/X/C: 선택",
        {
          fontSize: "14px",
          fill: "#888888",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        }
      )
      .setOrigin(0.5);

    // 키 입력 설정
    this.keys = this.input.keyboard.addKeys({
      Z: Phaser.Input.Keyboard.KeyCodes.Z,
      X: Phaser.Input.Keyboard.KeyCodes.X,
      C: Phaser.Input.Keyboard.KeyCodes.C,
    });

    // 마우스 좌클릭으로 선택 칸 이동
    this.input.on("pointerdown", (pointer) => {
      if (!pointer.leftButtonDown()) return;
      pointer.updateWorldPoint(this.cameras.main);
      const wx = pointer.worldX;
      const wy = pointer.worldY;
      const gx = Math.floor((wx - this.startX) / this.cellSize);
      const gy = Math.floor((wy - this.startY) / this.cellSize);
      if (gx >= 0 && gy >= 0 && gx < this.gridWidth && gy < this.gridHeight) {
        this.selectedX = gx;
        this.selectedY = gy;
        this.updateSelectionIndicator();
      }
    });
  }

  drawGrid() {
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x444444, 0.5);

    // 격자선 그리기
    for (let x = 0; x <= this.gridWidth; x++) {
      const lineX = this.startX + x * this.cellSize;
      graphics.moveTo(lineX, this.startY);
      graphics.lineTo(lineX, this.startY + this.gridHeight * this.cellSize);
    }

    for (let y = 0; y <= this.gridHeight; y++) {
      const lineY = this.startY + y * this.cellSize;
      graphics.moveTo(this.startX, lineY);
      graphics.lineTo(this.startX + this.gridWidth * this.cellSize, lineY);
    }

    graphics.strokePath();
  }

  updateSelectionIndicator() {
    this.selectionIndicator.clear();
    this.selectionIndicator.lineStyle(2, 0x00ff00, 1);

    const x = this.startX + this.selectedX * this.cellSize;
    const y = this.startY + this.selectedY * this.cellSize;

    this.selectionIndicator.strokeRect(x, y, this.cellSize, this.cellSize);
  }

  placeCharacter(gridX, gridY, characterKey, spriteIndex = 0) {
    const x = this.startX + gridX * this.cellSize + this.cellSize / 2;
    const y = this.startY + gridY * this.cellSize + this.cellSize / 2;

    // 통합 스프라이트 시트의 idle-down(행 0, 가운데 프레임)을 미리보기로 사용
    const SHEET_COLS = 3 * 5; // setCols(3) * charsPerRow(5)
    const baseRow = Math.floor(spriteIndex / 5) * 4; // setRows=4
    const baseCol = (spriteIndex % 5) * 3; // setCols=3
    const idleDownFrame = (baseRow + 0) * SHEET_COLS + (baseCol + 1);

    const character = this.add.sprite(x, y, "sprite", idleDownFrame);
    character.setScale(1.5);
    character.setDepth(1);

    // 슬롯 등록
    this.characterSlots.set(`${gridX},${gridY}`, characterKey);
  }

  update() {
    if (!this.keys) return;

    // Z/X/C 중 아무 키로 현재 선택 칸의 캐릭터 확정
    const confirm =
      Phaser.Input.Keyboard.JustDown(this.keys.Z) ||
      Phaser.Input.Keyboard.JustDown(this.keys.X) ||
      Phaser.Input.Keyboard.JustDown(this.keys.C);
    if (confirm) {
      const key = this.characterSlots.get(
        `${this.selectedX},${this.selectedY}`
      );
      if (key) {
        this.registry.set("selectedCharacter", key);
        this.scene.start("GameScene");
      } else {
        // 빈 칸이면 무시(선택 유지)
      }
    }
  }
}
