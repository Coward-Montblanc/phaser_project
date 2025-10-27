import Player1 from "../objects/player1.js";
import Player2 from "../objects/player2.js";
import TempPlayer1 from "../objects/tempplayer1.js";
import TempPlayer2 from "../objects/tempplayer2.js";
import Player3 from "../objects/player3.js";
import Player4 from "../objects/player4.js";
import HUD from "../ui/HUD.js";
import { TeleportManager } from "../services/teleport.js";
import { GAME } from "../constants.js";
import { Pathfinder } from "../services/pathfinding.js";
import { MovementController } from "../services/movement.js";
import { preloadUnifiedSprite } from "../services/spriteSet.js";
import { targetKnockback } from "../services/knockback.js";

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

  create(data) {
    // --- 모드 플래그 ---
    this.debugMode = !!(data && data.debugMode);
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
    } else if (selectedCharacter === "player4") {
      this.player = new Player4(this, GAME.START_TILE.X, GAME.START_TILE.Y);
    } else if (selectedCharacter === "tempplayer1") {
      this.player = new TempPlayer1(this, GAME.START_TILE.X, GAME.START_TILE.Y);
    } else if (selectedCharacter === "tempplayer2") {
      this.player = new TempPlayer2(this, GAME.START_TILE.X, GAME.START_TILE.Y);
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

    // 타겟으로 등록 (항상 플레이어는 포함)
    this.targets.add(this.player);

    // --- 디버그 모드일 때만 더미 생성 ---
    if (this.debugMode) {
      const dummyKey = (data && data.dummyCharacter) || this.registry.get("selectedDummyCharacter") || "player1";
      const createByKey = (key, tx, ty) => {
        if (key === "player2") return new Player2(this, tx, ty);
        if (key === "player3") return new Player3(this, tx, ty);
        if (key === "player4") return new Player4(this, tx, ty);
        if (key === "tempplayer1") return new TempPlayer1(this, tx, ty);
        if (key === "tempplayer2") return new TempPlayer2(this, tx, ty);
        return new Player1(this, tx, ty);
      };
      const dummy = createByKey(dummyKey, GAME.START_TILE.X + 4, GAME.START_TILE.Y);
      dummy.body.moves = false;
      dummy.setTint(0xffaaaa);
      // 더미도 벽 충돌 판단을 위해 동일 레이어 참조 필요
      dummy.wallLayer = wallLayer;
      dummy.maxHp = dummy.maxHp || 30;
      dummy.hp = Math.min(dummy.maxHp, dummy.hp || dummy.maxHp);
      dummy.events.on("hp:changed", ({ hp, maxHp }) => {
        console.log(`[DUMMY] HP: ${hp}/${maxHp}`);
      });
      dummy.events.emit("hp:changed", { hp: dummy.hp, maxHp: dummy.maxHp });
      this._createHealthBar(dummy);
      this.targets.add(dummy);
      this.dummy = dummy;

      // --- 디버그 오버레이 텍스트 (물리 디버그 시)
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

      // 디버그 패널 UI
      this._createDebugPanel();
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
            // 전방 동반 밀기: 스킬ID 단위로 1회만 적용
            if (hitbox.pushDistance && hitbox.pushDistance > 0) {
              if (target._lastPushedById !== skillId) {
                target._lastPushedById = skillId;
                const ang =
                  hitbox.pushAngle ?? hitbox.owner?._facingAngleRad?.() ?? 0;
                if (!target.wallLayer) target.wallLayer = this.wallLayer;
                targetKnockback(
                  hitbox.owner || {
                    getSkillAimAngle: () => ang,
                    _facingAngleRad: () => ang,
                  },
                  target,
                  {
                    direction: "skill",
                    distancePx: hitbox.pushDistance,
                    angleRad: ang,
                  }
                );
              }
            }
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

    // 더미 캐릭터 사망 이벤트 리스너 (디버그 전용)
    if (this.debugMode && this.dummy) {
      this.dummy.events.on("death", () => this._handleDummyDeath());
    }

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

    // 우클릭 시 경로 설정 (기존 경로는 덮어씀) 또는 디버그: 더미 위치 이동 1회 처리
    this.input.on("pointerdown", (pointer) => {
      if (!pointer.rightButtonDown()) return;

      // 디버그: 더미 위치 이동 1회 소비
      if (this.debugMode && this._awaitMoveDummy && this.dummy) {
        this._awaitMoveDummy = false;
        // 버튼 라벨 복구
        try {
          const btnMove = document.getElementById("dbgMoveDummy");
          if (btnMove) btnMove.textContent = "더미 위치 이동";
        } catch (_) {}

        const tx = this.wallLayer.worldToTileX(pointer.worldX);
        const ty = this.wallLayer.worldToTileY(pointer.worldY);
        let targetTile = null;
        if (!this.wallLayer.hasTileAt(tx, ty)) {
          targetTile = { tx, ty };
        } else if (this.pathfinder) {
          targetTile = this.pathfinder.findNearestWalkable(tx, ty);
        }
        if (targetTile) {
          const wx = this.toWorld(targetTile.tx);
          const wy = this.toWorld(targetTile.ty);
          this.dummy.setPosition(wx, wy);
          // 체력바 동기화
          this._updateHealthBar(this.dummy);
        }
        return; // 플레이어 우클릭 이동은 막음
      }

      // 암흑전진 등 특수 상태에서 우클릭 이동 금지(로컬 플레이어 전용)
      if (this.player && this.player._rcMoveDisabled) return;
      this.movement.setDestinationWorld(pointer.worldX, pointer.worldY);
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

    // 모든 대상의 체력바를 현재 위치로 동기화(넉백/즉시 이동 포함)
    const targets = this.targets?.getChildren?.() || [];
    for (const t of targets) {
      if (t?.healthBar) this._updateHealthBar(t);
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

  // 더미 캐릭터 사망 처리 (디버그 전용)
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

  // === 디버그 패널: HTML 요소 연동 ===
  _createDebugPanel() {
    if (!this.debugMode) return;
    if (this._debugPanelCreated) return;
    this._debugPanelCreated = true;

    // DOM 요소 참조
    const panel = document.getElementById("debugPanel");
    const btnReset = document.getElementById("dbgResetCd");
    const btnNoCd = document.getElementById("dbgNoCd");
    const inputHp = document.getElementById("dbgDummyHp");
    const btnSetHp = document.getElementById("dbgSetDummyHp");
    const btnAutoZ = document.getElementById("dbgAutoZ");
    const btnAutoX = document.getElementById("dbgAutoX");
    const btnAutoC = document.getElementById("dbgAutoC");
    const btnMoveDummy = document.getElementById("dbgMoveDummy");
    if (!panel) return;

    // 표시
    panel.style.display = "flex";

    // 상태
    this._auto = { Z: false, X: false, C: false };
    this._autoTimers = { Z: null, X: null, C: null };

    const updateNoCdLabel = () => {
      if (!btnNoCd) return;
      btnNoCd.textContent = `노쿨 모드: ${this.player?.noCooldownMode ? "ON" : "OFF"}`;
    };
    const updateAutoLabel = (key) => {
      const btn = key === "Z" ? btnAutoZ : key === "X" ? btnAutoX : btnAutoC;
      const name = key === "Z" ? "Z" : key === "X" ? "X" : "C";
      if (btn) btn.textContent = `더미 자동 ${name}: ${this._auto[key] ? "ON" : "OFF"}`;
    };

    const startAuto = (key) => {
      if (!this.dummy) return;
      if (this._autoTimers[key]) return;
      const tryUse = () => {
        if (!this.debugMode || !this.dummy || !this.player) return;
        const dx = this.player.x - this.dummy.x;
        const dy = this.player.y - this.dummy.y;
        this.dummy._debugAimOverrideAngle = Math.atan2(dy, dx);
        const handler = key === "Z" ? this.dummy.onSkillZ : key === "X" ? this.dummy.onSkillX : this.dummy.onSkillC;
        if (typeof handler === "function") {
          this.dummy._tryUseSkill(key, handler);
        }
      };
      this._autoTimers[key] = this.time.addEvent({ delay: 250, loop: true, callback: tryUse });
    };
    const stopAuto = (key) => {
      const ev = this._autoTimers[key];
      if (ev) ev.remove();
      this._autoTimers[key] = null;
    };

    // 리스너 보관해서 teardown 시 제거
    this._dbgHandlers = [];
    const on = (el, evt, fn) => {
      if (!el) return;
      el.addEventListener(evt, fn);
      this._dbgHandlers.push({ el, evt, fn });
    };

    on(btnReset, "click", () => {
      if (!this.debugMode) return;
      if (this.player?.resetAllCooldowns) this.player.resetAllCooldowns();
    });
    on(btnNoCd, "click", () => {
      if (!this.debugMode || !this.player) return;
      this.player.noCooldownMode = !this.player.noCooldownMode;
      if (this.player.noCooldownMode && this.player.resetAllCooldowns) {
        this.player.resetAllCooldowns();
      }
      updateNoCdLabel();
    });
    on(btnSetHp, "click", () => {
      if (!this.debugMode || !this.dummy || !inputHp) return;
      const n = Math.max(1, parseInt(inputHp.value, 10) || 1);
      this.dummy.maxHp = n;
      this.dummy.hp = Math.min(this.dummy.hp, n);
      this.dummy.events.emit("hp:changed", { hp: this.dummy.hp, maxHp: this.dummy.maxHp });
      this._updateHealthBar(this.dummy);
    });
    on(btnAutoZ, "click", () => {
      if (!this.debugMode || !this.dummy) return;
      this._auto.Z = !this._auto.Z;
      if (this._auto.Z) startAuto("Z"); else stopAuto("Z");
      updateAutoLabel("Z");
    });
    on(btnAutoX, "click", () => {
      if (!this.debugMode || !this.dummy) return;
      this._auto.X = !this._auto.X;
      if (this._auto.X) startAuto("X"); else stopAuto("X");
      updateAutoLabel("X");
    });
    on(btnAutoC, "click", () => {
      if (!this.debugMode || !this.dummy) return;
      this._auto.C = !this._auto.C;
      if (this._auto.C) startAuto("C"); else stopAuto("C");
      updateAutoLabel("C");
    });
    on(btnMoveDummy, "click", () => {
      if (!this.debugMode || !this.dummy) return;
      this._awaitMoveDummy = true;
      if (btnMoveDummy) btnMoveDummy.textContent = "더미 위치 이동: 우클릭 대기";
    });

    // 초기 레이블/값 설정
    updateNoCdLabel();
    updateAutoLabel("Z");
    updateAutoLabel("X");
    updateAutoLabel("C");
    if (inputHp && this.dummy) inputHp.value = String(this.dummy.maxHp | 0);

    // 씬 종료 시 정리
    this.events.on("shutdown", () => this._teardownDebugPanel());
    this.events.on("destroy", () => this._teardownDebugPanel());
  }

  _teardownDebugPanel() {
    const panel = document.getElementById("debugPanel");
    if (panel) panel.style.display = "none";
    if (this._dbgHandlers) {
      for (const { el, evt, fn } of this._dbgHandlers) {
        try { el.removeEventListener(evt, fn); } catch (_) {}
      }
      this._dbgHandlers = [];
    }
    if (this._autoTimers) {
      for (const k of ["Z", "X", "C"]) {
        const ev = this._autoTimers[k];
        if (ev) ev.remove();
        this._autoTimers[k] = null;
      }
    }
    // 버튼 라벨 복구 및 대기 상태 해제
    try {
      const btnMove = document.getElementById("dbgMoveDummy");
      if (btnMove) btnMove.textContent = "더미 위치 이동";
    } catch (_) {}
    this._awaitMoveDummy = false;
  }
}
