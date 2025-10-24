import { GAME } from '../constants.js';

// 우클릭 경로 추종 이동 컨트롤러
export class MovementController {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../objects/Player.js').default} player
   * @param {Phaser.Tilemaps.TilemapLayer} wallLayer
   * @param {import('./pathfinding.js').Pathfinder} pathfinder
   */
  constructor(scene, player, wallLayer, pathfinder) {
    this.scene = scene;
    this.player = player;
    this.wallLayer = wallLayer;
    this.pathfinder = pathfinder;
    this.tileToWorld = (t) => t * GAME.TILE_SIZE + GAME.TILE_SIZE / 2;

    this.currentPath = []; // [{x,y}] world coords
    this.pendingPath = null;
    this.arrivalTolerance = 2; // px
  }

  _tileCenterToWorld(tx, ty) { return this.tileToWorld(tx); }

  _tileCenterWorld(tx, ty) {
    const c = this.tileToWorld;
    return { x: c(tx), y: c(ty) };
  }

  // 주변 벽(충돌 타일) 기준으로 대상 타일 중심에서 벽을 멀어지는 방향의 법선 벡터 계산
  _wallNormalAtTile(tx, ty) {
    let nx = 0, ny = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nxT = tx + dx, nyT = ty + dy;
        if (!this.pathfinder.inBounds(nxT, nyT)) continue;
        if (this.wallLayer.hasTileAt(nxT, nyT)) {
          // 벽 타일 중심 → 대상 타일 중심 방향(멀어짐)
          const from = this._tileCenterWorld(nxT, nyT);
          const to   = this._tileCenterWorld(tx, ty);
          const vx = to.x - from.x, vy = to.y - from.y;
          const len = Math.hypot(vx, vy) || 1;
          nx += vx / len;
          ny += vy / len;
        }
      }
    }
    const len = Math.hypot(nx, ny);
    if (len === 0) return { x: 0, y: 0 };
    return { x: nx / len, y: ny / len };
  }

  // 경로 타일 목록에서 코너/목표 오프셋 웨이포인트 생성 (자유 각도로 직선 연결)
  _buildOffsetPath(pathTiles, radiusPx) {
    const pts = [];
    if (!pathTiles || pathTiles.length === 0) return pts;

    // 코너 오프셋: 90° 턴에서만 생성
    for (let i = 1; i < pathTiles.length - 1; i++) {
      const a = pathTiles[i - 1];
      const b = pathTiles[i];
      const c = pathTiles[i + 1];
      const aw = this._tileCenterWorld(a.tx, a.ty);
      const bw = this._tileCenterWorld(b.tx, b.ty);
      const cw = this._tileCenterWorld(c.tx, c.ty);
      const u = { x: bw.x - aw.x, y: bw.y - aw.y };
      const v = { x: cw.x - bw.x, y: cw.y - bw.y };
      const ul = Math.hypot(u.x, u.y) || 1, vl = Math.hypot(v.x, v.y) || 1;
      u.x /= ul; u.y /= ul; v.x /= vl; v.y /= vl;
      const dot = u.x * v.x + u.y * v.y;
      // 직각(90°) 판정: 내적 ~ 0
      if (Math.abs(dot) < 0.001) {
        // 두 방향의 합(45° 방위)으로 반지름만큼 이동
        const bis = { x: u.x + v.x, y: u.y + v.y };
        const bl = Math.hypot(bis.x, bis.y) || 1;
        const n = { x: bis.x / bl, y: bis.y / bl };
        const corner = { x: bw.x + n.x * radiusPx, y: bw.y + n.y * radiusPx };
        pts.push(corner);
      }
    }

    // 목표 A 지점: 목표 타일의 벽 법선 방향으로 반경만큼 오프셋
    const last = pathTiles[pathTiles.length - 1];
    const lastCenter = this._tileCenterWorld(last.tx, last.ty);
    const n = this._wallNormalAtTile(last.tx, last.ty);
    const A = (n.x === 0 && n.y === 0)
      ? { x: lastCenter.x, y: lastCenter.y }
      : { x: lastCenter.x + n.x * radiusPx, y: lastCenter.y + n.y * radiusPx };
    pts.push(A);

    return pts;
  }

  /** 클릭 월드 좌표를 목표로 설정 */
  setDestinationWorld(wx, wy) {
    const fromTx = this.wallLayer.worldToTileX(this.player.x);
    const fromTy = this.wallLayer.worldToTileY(this.player.y);
    const toTxRaw = this.wallLayer.worldToTileX(wx);
    const toTyRaw = this.wallLayer.worldToTileY(wy);

    const nearest = this.pathfinder.findNearestWalkable(toTxRaw, toTyRaw);
    if (!nearest) return;
    let pathTiles = this.pathfinder.findPath(fromTx, fromTy, nearest.tx, nearest.ty);
    if (!pathTiles || pathTiles.length === 0) return;
    // 경로 스무딩(시야가 닿는 구간은 직선화)
    pathTiles = this.pathfinder.smoothPathTiles(pathTiles);
    // 코너/목표 오프셋 폴리라인 생성 (캐릭터 반경 = 크기 절반)
    const radiusPx = (Math.max(this.player.body?.width || 12, this.player.body?.height || 12) / 2) | 0;
    const pathWorld = this._buildOffsetPath(pathTiles, radiusPx);

    // 스킬 중이면 pending, 아니면 즉시 적용
    if (this.player.isSkillLock || this.player.isStaggered) {
      this.pendingPath = pathWorld;
    } else {
      this.currentPath = pathWorld;
    }
  }

  clear() {
    this.currentPath = [];
    this.pendingPath = null;
  }

  _advanceIfArrived() {
    if (this.currentPath.length === 0) return;
    const target = this.currentPath[0];
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    if (Math.hypot(dx, dy) <= this.arrivalTolerance) {
      this.currentPath.shift();
    }
  }

  _updateFacingByVelocity(vx, vy) {
    if (vx === 0 && vy === 0) return;
    // 360도 자유 방향(가장 가까운 방향으로 애니메이션 키만 맞춤)
    const a = Math.atan2(vy, vx);
    const dirs = ['right','down-right','down','down-left','left','up-left','up','up-right'];
    let idx = Math.round(a / (Math.PI/4));
    idx = (idx % 8 + 8) % 8;
    this.player.facing = dirs[idx];
  }

  update(delta) {
    // 스킬/스태거 중: 이동 정지, 입력 큐만 유지
    if (this.player.isSkillLock || this.player.isStaggered) {
      this.player.setVelocity(0, 0);
      this.player.playIdle();
      return;
    }

    // 스킬 종료 후 큐 적용
    if (this.pendingPath) {
      this.currentPath = this.pendingPath;
      this.pendingPath = null;
    }

    // 도착 처리
    this._advanceIfArrived();
    if (this.currentPath.length === 0) {
      this.player.setVelocity(0, 0);
      this.player.playIdle();
      return;
    }

    // 다음 웨이포인트로 추진
    const target = this.currentPath[0];
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const speed = this.player.speed ?? 150;
    const vx = ux * speed;
    const vy = uy * speed;

    this.player.setVelocity(vx, vy);
    this._updateFacingByVelocity(vx, vy);
    this.player.playWalk();

    // 목표에 충분히 가까워졌다면 다음 웨이포인트로
    this._advanceIfArrived();
  }
}


