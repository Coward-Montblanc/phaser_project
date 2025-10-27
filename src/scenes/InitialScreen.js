export default class InitialScreen extends Phaser.Scene {
  constructor() {
    super({ key: 'InitialScreen' });
  }

  create() {
    // 배경색 설정
    this.cameras.main.setBackgroundColor('#0f1115');

    // 게임 타이틀
    this.add.text(this.cameras.main.centerX, this.cameras.main.centerY - 50, 'Scarlet Devil Mansion', {
      fontSize: '28px',
      fill: '#e6e6e6',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }).setOrigin(0.5);

    // 시작 안내 텍스트
    this.add.text(this.cameras.main.centerX, this.cameras.main.centerY + 20, 'Z: 멀티플레이 · Enter: 디버그 모드', {
      fontSize: '16px',
      fill: '#888888',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }).setOrigin(0.5);

    // IP 연결 기능 안내 (나중에 구현 예정)
    this.add.text(this.cameras.main.centerX, this.cameras.main.centerY + 50, 'IP 연결 기능 (구현 예정)', {
      fontSize: '12px',
      fill: '#666666',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    }).setOrigin(0.5);

    // 키 입력 이벤트 리스너: Z → 멀티플레이 로비, Enter → 디버그(로컬)
    this.input.keyboard.on('keydown', (event) => {
      if (event.code === 'KeyZ') {
        this.scene.start('RoomBrowser');
      } else if (event.code === 'Enter') {
        this.scene.start('CharacterSelect', { debugMode: true });
      }
    });
  }
}
