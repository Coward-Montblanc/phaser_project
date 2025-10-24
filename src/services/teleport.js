import { GAME } from '../constants.js';

export class TeleportManager {
  /**
   * @param {Phaser.Scene} scene
   * @param {Array} rules [{id, area:{tx,ty,w,h}, dir:'up|down|left|right', to:{tx,ty,face}}]
   * @param {Phaser.Tilemaps.TilemapLayer} wallLayer
   */
  constructor(scene, rules, wallLayer) {
    this.scene = scene;
    this.rules = rules;
    this.wallLayer = wallLayer;
    this._tpUntil = 0; // cooldown(ms timestamp)
  }

  inArea(tx, ty, A) {
    return tx >= A.tx && ty >= A.ty && tx < A.tx + A.w && ty < A.ty + A.h;
  }

  /** 내부에서 실제 텔레포트 실행 */
  _doTeleport(to, state) {
    const now = this.scene.time.now;
    if (now < this._tpUntil) return true; // 이미 최근에 텔레포트 함

    this._tpUntil = now + 250;
    this.scene.cameras.main.flash(120, 0, 0, 0);

    // 목적지 타일로 스냅
    state.grid.tx = Phaser.Math.Clamp(to.tx, 0, this.scene.map.width - 1);
    state.grid.ty = Phaser.Math.Clamp(to.ty, 0, this.scene.map.height - 1);
    state.player.setVelocity(0, 0);
    state.player.setPosition(
    state.grid.tx * GAME.TILE_SIZE + GAME.TILE_SIZE / 2,
    state.grid.ty * GAME.TILE_SIZE + GAME.TILE_SIZE / 2
);

    // 바라볼 방향
    state.facing = to.face || state.facing;
    state.player.facing = state.facing;
    state.player.playIdle();

    return true;
  }

  /** 격자 이동 직전 체크 */
  tryFromGrid(dir, state) {
    const hit = this.rules.find(r =>
      this.inArea(state.grid.tx, state.grid.ty, r.area) && r.dir === dir
    );
    if (hit) return this._doTeleport(hit.to, state);
    return false;
  }

  /** 자유 이동 프레임 체크 (player의 현재 좌표 기준) */
  tryFromFree(facing, state) {
    const tx = this.wallLayer.worldToTileX(state.player.x);
    const ty = this.wallLayer.worldToTileY(state.player.y);
    const hit = this.rules.find(r => this.inArea(tx, ty, r.area) && r.dir === facing);
    if (hit) return this._doTeleport(hit.to, state);
    return false;
  }
}
