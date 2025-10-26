import Player1 from "../objects/player1.js";
import Player2 from "../objects/player2.js";
import Player3 from "../objects/player3.js";
import HUD from "../ui/HUD.js";
import { TeleportManager } from "../services/teleport.js";
import { GAME } from "../constants.js";
import { Pathfinder } from "../services/pathfinding.js";
import { MovementController } from "../services/movement.js";
import { preloadUnifiedSprite } from "../services/spriteSet.js";

export default class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: "GameScene" });
  }

  preload() {
    this.load.tilemapTiledJSON("map1", "assets/mapping/map1.tmj");
    this.load.image("map1_orgin", "assets/map/map1_orgin.png");
    // 통합 스프라이트 시트 로드(32x32)
    preloadUnifiedSprite(this);
  }

  create() {
    // --- 맵/레이어 ---
    const map = this.make.tilemap({ key: "map1" });
    const tileset = map.addTilesetImage(
      "map1",
      "map1_orgin",
      GAME.TILE_SIZE,
      GAME.TILE_SIZE,
      0,
      0
    );
    const groundLayer = map.createLayer("바닥", tileset, 0, 0);
    const decoLayer = map.createLayer("장식", tileset, 0, 0);
    const wallLayer = map.createLayer("벽", tileset, 0, 0);
    wallLayer.setCollisionByExclusion([-1]);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    groundLayer.setDepth(0);
    decoLayer.setDepth(2);
    wallLayer.setDepth(3);

    // --- 플레이어 ---
    // 선택된 캐릭터 정보 가져오기 (기본값: player1)
    const selectedCharacter =
      this.registry.get("selectedCharacter") || "player1";

    // 선택된 캐릭터에 따라 적절한 플레이어 클래스 사용
    if (selectedCharacter === "player2") {
      this.player = new Player2(this, GAME.START_TILE.X, GAME.START_TILE.Y);
    } else if (selectedCharacter === "player3") {
      this.player = new Player3(this, GAME.START_TILE.X, GAME.START_TILE.Y);
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
    this.inBounds = (tx, ty) =>
      tx >= 0 && ty >= 0 && tx < map.width && ty < map.height;
    this.isWalkable = (tx, ty) =>
      this.inBounds(tx, ty) && !wallLayer.hasTileAt(tx, ty);

    // --- 카메라 ---
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    // --- 입력(우클릭 이동 전용으로 변경) ---
    this.input.mouse?.disableContextMenu();
    const reloadBtn = document.getElementById("reloadBtn");
    if (reloadBtn) reloadBtn.onclick = () => this.scene.restart();

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
    // 더미 체력 로그: 체력 변동 시 콘솔 표기
    dummy.events.on("hp:changed", ({ hp, maxHp }) => {
      console.log(`[DUMMY] HP: ${hp}/${maxHp}`);
    });
    // 초기 상태도 1회 표기
    dummy.events.emit("hp:changed", { hp: dummy.hp, maxHp: dummy.maxHp });

    // 더미 캐릭터 체력바 생성
    this._createHealthBar(dummy);

    // 타겟으로 등록
    this.targets.add(this.player);
    this.targets.add(dummy);

    // 더미 캐릭터 참조 저장
    this.dummy = dummy;

    // --- 디버그: 플레이어-더미 거리 표시 (physics.arcade.debug가 true일 때만)
    const physCfg = (this.sys?.game?.config?.physics || {}).arcade || {};
    this._debugArcadeEnabled = !!physCfg.debug;
    if (this._debugArcadeEnabled) {
      this._distText = this.add
        .text(8, 8, "dist(player,dummy): -", {
          fontSize: "12px",
          fill: "#e6e6e6",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          stroke: "#000000",
          strokeThickness: 3,
        })
        .setScrollFactor(0)
        .setDepth(1000);
    }

    // 조작 주체의 slashGroup과 타겟 간 겹침 판정
    this.physics.add.overlap(
      this.player.slashGroup,
      this.targets,
      (hitbox, target) => {
        // 자기 자신은 무시
        if (hitbox.owner === target) return;

        // 피해 적용
        if (typeof target.receiveDamage === "function") {
          const dmg = hitbox.damage ?? 0;
          if (dmg > 0) {
            const skillId = hitbox.skillId || "slash_unknown";
            const staggerTime = hitbox.staggerTime || 0; // 스턴 시간 가져오기
            target.receiveDamage(dmg, hitbox.owner, skillId, staggerTime);
          }
        }
        // 피격 연출
        if (!target._hitCooldown || this.time.now >= target._hitCooldown) {
          target._hitCooldown = this.time.now + 200;
          target.setTintFill(0xffffff);
          this.tweens.add({
            targets: target,
            alpha: 0.3,
            yoyo: true,
            duration: 60,
            repeat: 2,
            onComplete: () => {
              target.clearTint();
              target.setAlpha(1);
            },
          });
        }
      }
    );
    // 조작 주체의 dashGroup 타겟 간 겹침 판정
    this.physics.add.overlap(
      this.player.dashGroup,
      this.targets,
      (hitbox, target) => {
        if (hitbox.owner === target) return;
        // 피해 적용
        if (typeof target.receiveDamage === "function") {
          const dmg = hitbox.damage ?? 0;
          if (dmg > 0) {
            const skillId = hitbox.skillId || "dash_unknown";
            const staggerTime = hitbox.staggerTime || 0; // 스턴 시간 가져오기
            target.receiveDamage(dmg, hitbox.owner, skillId, staggerTime);
          }
        }
        if (!target._hitCooldown || this.time.now >= target._hitCooldown) {
          target._hitCooldown = this.time.now + 150;
          target.setTintFill(0xffffff);
          this.tweens.add({
            targets: target,
            alpha: 0.35,
            yoyo: true,
            duration: 60,
            repeat: 2,
            onComplete: () => {
              target.clearTint();
              target.setAlpha(1);
            },
          });
        }
      }
    );

    // 조작 주체의 projectileGroup 타겟 간 겹침 판정(있을 때만)
    if (this.player.projectileGroup) {
      this.physics.add.overlap(
        this.player.projectileGroup,
        this.targets,
        (proj, target) => {
          if (proj.owner === target) return;
          // 커스텀 onHit 훅이 있으면 우선 처리
          if (typeof proj.onHit === "function") {
            const res = proj.onHit(target, this);
            if (res === "handled" || res === "skip") return;
          }
          if (typeof target.receiveDamage === "function") {
            const dmg = proj.damage ?? 0;
            if (dmg > 0) {
              const skillId = proj.skillId || "proj_unknown";
              const staggerTime = proj.staggerTime || 0;
              target.receiveDamage(dmg, proj.owner, skillId, staggerTime);
            }
          }
          if (proj && proj.active) proj.destroy();
        }
      );
      // 벽과 충돌: wallPierce면 물리 충돌 자체를 비활성화(process), 아니면 파괴
      this.physics.add.collider(
        this.player.projectileGroup,
        wallLayer,
        (proj) => {
          if (proj && proj.active) {
            if (!proj.wallPierce) proj.destroy();
          }
        },
        (proj /*, tile */) => {
          // process callback: true면 충돌 처리 수행, false면 무시(관통)
          return !proj.wallPierce;
        }
      );
    }

    // 빔 그룹과 타겟 간 겹침 판정(있을 때만) - 1회 피해
    if (this.player.beamGroup) {
      this.physics.add.overlap(
        this.player.beamGroup,
        this.targets,
        (hb, target) => {
          if (hb.owner === target) return;
          if (typeof target.receiveDamage === "function") {
            const dmg = hb.damage ?? 0;
            if (dmg > 0) {
              const skillId = hb.skillId || "beam_unknown";
              const staggerTime = hb.staggerTime || 0;
              target.receiveDamage(dmg, hb.owner, skillId, staggerTime);
            }
          }
        }
      );
    }

    // --- 충돌자 (자유이동 전용) ---
    this.wallCollider = this.physics.add.collider(this.player, wallLayer);
    this.wallCollider.active = true;

    // 더미 캐릭터 사망 이벤트 리스너
    this.dummy.events.on("death", () => this._handleDummyDeath());

    // --- 텔레포트 규칙 & 매니저 ---
    const tpRules = [
      {
        id: "door-1",
        area: { tx: 38, ty: 81, w: 1, h: 1 },
        dir: "up",
        to: { tx: 39, ty: 31, face: "up" },
      },
      {
        id: "door-2",
        area: { tx: 39, ty: 31, w: 1, h: 1 },
        dir: "down",
        to: { tx: 38, ty: 81, face: "down" },
      },
      {
        id: "door-3",
        area: { tx: 13, ty: 8, w: 1, h: 1 },
        dir: "left",
        to: { tx: 68, ty: 9, face: "left" },
      },
      {
        id: "door-4",
        area: { tx: 68, ty: 9, w: 1, h: 1 },
        dir: "right",
        to: { tx: 13, ty: 8, face: "right" },
      },
    ];
    this.tp = new TeleportManager(this, tpRules, wallLayer);

    // --- 경로탐색/이동 컨트롤러 ---
    // 길찾기는 통로 폭을 제한하지 않도록 팽창은 제거 (clearanceTiles=0)
    this.pathfinder = new Pathfinder(
      wallLayer,
      (tx, ty) => this.isWalkable(tx, ty),
      { clearanceTiles: 0 }
    );
    this.movement = new MovementController(
      this,
      this.player,
      wallLayer,
      this.pathfinder
    );

    // 우클릭 시 경로 설정 (기존 경로는 덮어씀)
    this.input.on("pointerdown", (pointer) => {
      if (pointer.rightButtonDown()) {
        this.movement.setDestinationWorld(pointer.worldX, pointer.worldY);
      }
    });
  }

  update(time, delta) {
    // 클릭 이동 업데이트 + 스킬 입력/쿨다운 틱
    this.movement.update(delta);
    if (this.player && typeof this.player.tickSkillsAndHud === "function") {
      this.player.tickSkillsAndHud();
    }

    // 디버그 거리 표시 업데이트
    if (this._distText && this.player && this.dummy) {
      const dx = this.player.x - this.dummy.x;
      const dy = this.player.y - this.dummy.y;
      const d = Math.hypot(dx, dy);
      this._distText.setText(`dist(player,dummy): ${d.toFixed(1)} px`);
    }

    // 텔레포트 (이동/스킬 처리 후 체크)
    if (this.player.facing) {
      if (this.tp.tryFromFree(this.player.facing, this)) {
        return;
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
      height: barHeight,
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
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 2);

    // 체력 (초록색)
    fg.clear();
    if (ratio > 0) {
      fg.fillStyle(0x4caf50, 1);
      fg.fillRoundedRect(-width / 2, -height / 2, width * ratio, height, 2);
    }

    // 체력바 위치 설정 (캐릭터 위쪽)
    bg.setPosition(
      character.x,
      character.y - character.height / 2 - height / 2 - 2
    );
    fg.setPosition(
      character.x,
      character.y - character.height / 2 - height / 2 - 2
    );
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

    // 체력 변경 로그 트리거
    this.dummy.events.emit("hp:changed", {
      hp: this.dummy.hp,
      maxHp: this.dummy.maxHp,
    });

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
