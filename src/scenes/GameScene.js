import Player1 from '../objects/player1.js';
import Player2 from '../objects/player2.js';
import HUD from "../ui/HUD.js";
import { TeleportManager } from '../services/teleport.js';
import { GAME } from '../constants.js';

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  preload() {
    this.load.tilemapTiledJSON('map1', 'assets/mapping/map1.tmj');
    this.load.image('map1_orgin', 'assets/map/map1_orgin.png');
    this.load.spritesheet('player1', 'assets/player/player1.png', {
      frameWidth: 16, frameHeight: 16
    });
    // player2는 일단 player1과 같은 스프라이트 사용
    this.load.spritesheet('player2', 'assets/player/player1.png', {
      frameWidth: 16, frameHeight: 16
    });
  }

  create() {
    // --- 맵/레이어 ---
    const map = this.make.tilemap({ key: 'map1' });
    const tileset = map.addTilesetImage('map1', 'map1_orgin', GAME.TILE_SIZE, GAME.TILE_SIZE, 0, 0);
    const groundLayer = map.createLayer('바닥', tileset, 0, 0);
    const decoLayer   = map.createLayer('장식', tileset, 0, 0);
    const wallLayer   = map.createLayer('벽',   tileset, 0, 0);
    wallLayer.setCollisionByExclusion([-1]);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    groundLayer.setDepth(0); decoLayer.setDepth(2); wallLayer.setDepth(3);

    // --- 플레이어 ---
    // 선택된 캐릭터 정보 가져오기 (기본값: player1)
    const selectedCharacter = this.registry.get('selectedCharacter') || 'player1';
    
    // 선택된 캐릭터에 따라 적절한 플레이어 클래스 사용
    if (selectedCharacter === 'player2') {
      this.player = new Player2(this, GAME.START_TILE.X, GAME.START_TILE.Y);
    } else {
      this.player = new Player1(this, GAME.START_TILE.X, GAME.START_TILE.Y);
    }
    // 대시 모듈이 벽 레이어를 참조할 수 있도록 연결
    this.player.wallLayer = wallLayer;

    // HUD 연결
    this.hud = new HUD(this);
    this.hud.bind(this.player);

    // --- 상태/헬퍼 ---
    this.map = map;
    this.wallLayer = wallLayer;
    this.grid = { tx: GAME.START_TILE.X, ty: GAME.START_TILE.Y, moving: false };
    this.facing = this.player.facing;

    this.toWorld = (t) => t * GAME.TILE_SIZE + GAME.TILE_SIZE / 2;
    this.inBounds = (tx, ty) => tx >= 0 && ty >= 0 && tx < map.width && ty < map.height;
    this.isWalkable = (tx, ty) => this.inBounds(tx, ty) && !wallLayer.hasTileAt(tx, ty);

    // --- 카메라 ---
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // --- 입력 ---
    this.keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // --- 타겟 그룹(피격 대상) ---
    this.targets = this.physics.add.group();

    // --- 플레이어들 생성 (테스트용 2인) ---
    const dummy = new Player1(this, GAME.START_TILE.X + 4, GAME.START_TILE.Y);

    // 더미는 움직이지 않게
    dummy.body.moves = false;
    dummy.setTint(0xffaaaa);
    
    // 더미 캐릭터 체력 설정
    dummy.maxHp = 30;
    dummy.hp = 30;
    
    // 더미 캐릭터 체력바 생성
    this._createHealthBar(dummy);

    // 타겟으로 등록
    this.targets.add(this.player);
    this.targets.add(dummy);
    
    // 더미 캐릭터 참조 저장
    this.dummy = dummy;

    // 조작 주체의 slashGroup과 타겟 간 겹침 판정
    this.physics.add.overlap(this.player.slashGroup, this.targets, (hitbox, target) => {
        // 자기 자신은 무시
        if (hitbox.owner === target) return;
  
        // 피해 적용
        if (typeof target.receiveDamage === 'function') {
          const dmg = hitbox.damage ?? 0;
          if (dmg > 0) {
            const skillId = hitbox.skillId || 'slash_unknown';
            const staggerTime = hitbox.staggerTime || 0; // 스턴 시간 가져오기
            target.receiveDamage(dmg, hitbox.owner, skillId, staggerTime);
          }
        }
        // 피격 연출
        if (!target._hitCooldown || this.time.now >= target._hitCooldown) {
          target._hitCooldown = this.time.now + 200;
          target.setTintFill(0xffffff);
          this.tweens.add({ targets: target, alpha: 0.3, yoyo: true, duration: 60, repeat: 2, onComplete: () => {
            target.clearTint();
            target.setAlpha(1);
          }});
        }
    });
    // 조작 주체의 dashGroup 타겟 간 겹침 판정
    this.physics.add.overlap(this.player.dashGroup, this.targets, (hitbox, target) => {
        if (hitbox.owner === target) return;
        // 피해 적용
        if (typeof target.receiveDamage === 'function') {
          const dmg = hitbox.damage ?? 0;
          if (dmg > 0) {
            const skillId = hitbox.skillId || 'dash_unknown';
            const staggerTime = hitbox.staggerTime || 0; // 스턴 시간 가져오기
            target.receiveDamage(dmg, hitbox.owner, skillId, staggerTime);
          }
        }
        if (!target._hitCooldown || this.time.now >= target._hitCooldown) {
          target._hitCooldown = this.time.now + 150;
          target.setTintFill(0xffffff);
          this.tweens.add({ targets: target, alpha: 0.35, yoyo: true, duration: 60, repeat: 2,
            onComplete: () => { target.clearTint(); target.setAlpha(1); }
          });
        }
      });

    // --- 충돌자 (자유이동 전용) ---
    this.wallCollider = this.physics.add.collider(this.player, wallLayer);
    this.wallCollider.active = true;
    
    // 더미 캐릭터 사망 이벤트 리스너
    this.dummy.events.on('death', () => this._handleDummyDeath());

    // --- 텔레포트 규칙 & 매니저 ---
    const tpRules = [
      { id:'door-1', area:{tx:38,ty:81,w:1,h:1}, dir:'up',    to:{tx:39,ty:31,face:'up'} },
      { id:'door-2', area:{tx:39,ty:31,w:1,h:1}, dir:'down',  to:{tx:38,ty:81,face:'down'} },
      { id:'door-3', area:{tx:13, ty:8, w:1,h:1}, dir:'left',  to:{tx:68,ty:9, face:'left'} },
      { id:'door-4', area:{tx:68,ty:9, w:1,h:1}, dir:'right', to:{tx:13, ty:8, face:'right'} },
    ];
    this.tp = new TeleportManager(this, tpRules, wallLayer);

    // --- UI / 모드 전환 ---
    this.mode = 'free';                      // 'free' | 'grid'
    this.inputQueue = [];
    this.hold = { dir: null, timer: 0 };

    const modeBtn = document.getElementById('modeBtn');
    const reloadBtn = document.getElementById('reloadBtn');
    const applyModeText = () => modeBtn.textContent = `격자 이동: ${this.mode === 'grid' ? 'ON' : 'OFF'}`;
    applyModeText();

    reloadBtn.onclick = () => this.scene.restart();
    modeBtn.onclick = () => {
      if (this.mode === 'free') {
        // 자유→격자
        this.mode = 'grid';
        const tx = wallLayer.worldToTileX(this.player.x);
        const ty = wallLayer.worldToTileY(this.player.y);
        this.grid.tx = Phaser.Math.Clamp(tx, 0, map.width - 1);
        this.grid.ty = Phaser.Math.Clamp(ty, 0, map.height - 1);
        this.player.snapToTile(this.grid.tx, this.grid.ty);
        this.wallCollider.active = false;
        this.hold.dir = null; this.hold.timer = 0; this.inputQueue.length = 0;
      } else {
        // 격자→자유
        this.mode = 'free';
        this.tweens.killTweensOf(this.player);
        this.grid.moving = false;
        this.inputQueue.length = 0;
        this.hold.dir = null; this.hold.timer = 0;
        this.wallCollider.active = true;
      }
      applyModeText();
    };

    // --- 격자 이동 디큐 ---
    this._dequeueMove = () => {
      if (this.grid.moving || this.inputQueue.length === 0) return;

      const { dx, dy, dir } = this.inputQueue.shift();

      // 이동 직전 텔레포트 체크
      if (this.tp.tryFromGrid(dir, this)) {
        // 텔레포트했다면 다음 입력 즉시 체크
        this._dequeueMove();
        return;
      }

      const nx = this.grid.tx + dx;
      const ny = this.grid.ty + dy;
      if (!this.isWalkable(nx, ny)) {
        this._dequeueMove();
        return;
      }

      this.grid.moving = true;
      this.wallCollider.active = false;

      // 바라보는 방향/애니메이션
      this.facing = dir; this.player.facing = dir; this.player.playWalk();

      this.tweens.add({
        targets: this.player,
        x: this.toWorld(nx),
        y: this.toWorld(ny),
        duration: GAME.MOVE_DURATION,
        ease: 'Linear',
        onComplete: () => {
          this.grid.tx = nx; this.grid.ty = ny;
          this.grid.moving = false;
          if (this.mode === 'free') this.wallCollider.active = true;
          this.player.playIdle();
          this._dequeueMove();
        }
      });
    };
  }

  update(time, delta) {
    if (!this.keys) return;

    // stagger 상태일 때는 이동과 스킬 사용 불가
    if (this.player.isStaggered) {
      return;
    }

    if (this.mode === 'grid') {
      // 홀드 입력 읽기
      let wantDir = null;
      if (this.keys.W.isDown) wantDir = 'up';
      else if (this.keys.S.isDown) wantDir = 'down';
      else if (this.keys.A.isDown) wantDir = 'left';
      else if (this.keys.D.isDown) wantDir = 'right';

      if (!wantDir) { this.hold.dir = null; this.hold.timer = 0; return; }

      if (this.hold.dir !== wantDir) {
        this.hold.dir = wantDir;
        this.hold.timer = 0; // 즉시 1칸
      }

      this.hold.timer -= delta;
      if (this.hold.timer > 0) return;
      if (this.grid.moving) { this.hold.timer = 16; return; }

      // 텔레포트는 _dequeueMove 안에서도 다시 체크되지만
      // 입력 직후 우선 체크하여 부드럽게
      if (this.tp.tryFromGrid(this.hold.dir, this)) {
        this.hold.timer = 80;
        return;
      }

      let dx=0, dy=0;
      switch (this.hold.dir) {
        case 'up': dy = -1; break;
        case 'down': dy = 1; break;
        case 'left': dx = -1; break;
        case 'right': dx = 1; break;
      }
      this.inputQueue.push({ dx, dy, dir: this.hold.dir });
      if (!this.grid.moving) this._dequeueMove();
      this.hold.timer = GAME.HOLD_REPEAT_DELAY;

    } else {
      // 자유 이동
      this.wallCollider.active = true;
      // 이동/애니메이션
      this.player.updateFree(this.keys);

      // 텔레포트
      if (this.player.facing) {
        if (this.tp.tryFromFree(this.player.facing, this)) {
          return; // 텔레포트했으면 이번 프레임 종료
        }
      }
    }
  }

  // 체력바 생성 함수
  _createHealthBar(character) {
    const healthBarBg = this.add.graphics().setDepth(5);
    const healthBarFg = this.add.graphics().setDepth(6);
    
    // 체력바 크기 설정 (캐릭터 크기의 1.5배 x 0.3배)
    const barWidth = character.width * 1.5;
    const barHeight = character.height * 0.3;
    
    character.healthBar = {
      bg: healthBarBg,
      fg: healthBarFg,
      width: barWidth,
      height: barHeight
    };
    
    // 초기 체력바 그리기
    this._updateHealthBar(character);
  }

  // 체력바 업데이트 함수
  _updateHealthBar(character) {
    if (!character.healthBar) return;
    
    const { bg, fg, width, height } = character.healthBar;
    const ratio = character.maxHp > 0 ? character.hp / character.maxHp : 0;
    
    // 배경 (빨간색)
    bg.clear();
    bg.fillStyle(0x333333, 1);
    bg.fillRoundedRect(-width/2, -height/2, width, height, 2);
    
    // 체력 (초록색)
    fg.clear();
    if (ratio > 0) {
      fg.fillStyle(0x4caf50, 1);
      fg.fillRoundedRect(-width/2, -height/2, width * ratio, height, 2);
    }
    
    // 체력바 위치 설정 (캐릭터 위쪽)
    bg.setPosition(character.x, character.y - character.height/2 - height/2 - 2);
    fg.setPosition(character.x, character.y - character.height/2 - height/2 - 2);
  }

  // 더미 캐릭터 사망 처리
  _handleDummyDeath() {
    
    // 더미 캐릭터 숨기기
    this.dummy.setVisible(false);
    this.dummy.active = false;
    
    // 체력바 숨기기
    if (this.dummy.healthBar) {
      this.dummy.healthBar.bg.setVisible(false);
      this.dummy.healthBar.fg.setVisible(false);
    }
    
    // 타겟 그룹에서 제거
    this.targets.remove(this.dummy);
    
    // RESPAWN_COUNTDOWN 시간 후 재생성
    this.time.delayedCall(GAME.RESPAWN_COUNTDOWN * 1000, () => {
      this._respawnDummy();
    });
  }

  // 더미 캐릭터 재생성
  _respawnDummy() {
    
    // 체력 복구
    this.dummy.hp = this.dummy.maxHp;
    this.dummy.active = true;
    this.dummy.setVisible(true);
    
    // 체력바 다시 보이기
    if (this.dummy.healthBar) {
      this.dummy.healthBar.bg.setVisible(true);
      this.dummy.healthBar.fg.setVisible(true);
    }
    
    // 타겟 그룹에 다시 추가
    this.targets.add(this.dummy);
    
    // 체력바 업데이트
    this._updateHealthBar(this.dummy);
  }
}
