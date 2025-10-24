export default class CharacterSelect extends Phaser.Scene {
  constructor() {
    super({ key: 'CharacterSelect' });
  }

  preload() {
    // 플레이어 스프라이트 로드
    this.load.spritesheet('player1', 'assets/player/player1.png', {
      frameWidth: 16, frameHeight: 16
    });
    // player2는 일단 player1과 같은 스프라이트 사용 (나중에 별도 스프라이트로 교체 가능)
    this.load.spritesheet('player2', 'assets/player/player1.png', {
      frameWidth: 16, frameHeight: 16
    });
  }

  create() {
    // 배경색 설정
    this.cameras.main.setBackgroundColor('#0f1115');

    // 캐릭터 선택 제목
    this.add.text(this.cameras.main.centerX, 50, '캐릭터 선택', {
      fontSize: '24px',
      fill: '#e6e6e6',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }).setOrigin(0.5);

    // 격자 설정
    this.gridWidth = 10;
    this.gridHeight = 5;
    this.cellSize = 32;
    this.startX = this.cameras.main.centerX - (this.gridWidth * this.cellSize) / 2;
    this.startY = this.cameras.main.centerY - (this.gridHeight * this.cellSize) / 2;

    // 현재 선택된 위치 (0, 0에서 시작)
    this.selectedX = 0;
    this.selectedY = 0;

    // 격자 그리기
    this.drawGrid();

    // 선택 표시기 생성
    this.selectionIndicator = this.add.graphics();
    this.updateSelectionIndicator();

    // 캐릭터 배치
    this.placeCharacter(0, 0, 'player1');
    this.placeCharacter(1, 0, 'player2');

    // 조작 안내
    this.add.text(this.cameras.main.centerX, this.cameras.main.height - 50, '좌클릭: 캐릭터 고르기 · Z/X/C: 선택', {
      fontSize: '14px',
      fill: '#888888',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }).setOrigin(0.5);

    // 키 입력 설정
    this.keys = this.input.keyboard.addKeys({
      Z: Phaser.Input.Keyboard.KeyCodes.Z,
      X: Phaser.Input.Keyboard.KeyCodes.X,
      C: Phaser.Input.Keyboard.KeyCodes.C
    });

    // 마우스 좌클릭으로 선택 칸 이동
    this.input.on('pointerdown', (pointer) => {
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

  placeCharacter(gridX, gridY, characterKey) {
    const x = this.startX + gridX * this.cellSize + this.cellSize / 2;
    const y = this.startY + gridY * this.cellSize + this.cellSize / 2;

    // 캐릭터 스프라이트 생성 (크기 조정)
    const character = this.add.sprite(x, y, characterKey);
    character.setScale(1.5);
    character.setDepth(1);
  }

  update() {
    if (!this.keys) return;

    // WASD 이동 제거 (좌클릭으로만 이동)

    // 선택 입력 처리 (Z/X/C 또는 커서 위치 기준 선택)
    if (Phaser.Input.Keyboard.JustDown(this.keys.Z)) {
      // 기본 player1 슬롯(0,0)
      this.selectedX = 0; this.selectedY = 0; this.updateSelectionIndicator();
      this.registry.set('selectedCharacter', 'player1');
      this.scene.start('GameScene');
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.X)) {
      // 기본 player2 슬롯(1,0)
      this.selectedX = 1; this.selectedY = 0; this.updateSelectionIndicator();
      this.registry.set('selectedCharacter', 'player2');
      this.scene.start('GameScene');
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.C)) {
      // 커서 위치의 캐릭터를 선택(없으면 player1)
      let chosen = 'player1';
      if (this.selectedX === 1 && this.selectedY === 0) chosen = 'player2';
      this.registry.set('selectedCharacter', chosen);
      this.scene.start('GameScene');
    }
  }
}
