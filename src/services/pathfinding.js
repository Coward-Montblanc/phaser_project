// 간단한 A* 길찾기 + 클릭 지점에서 가장 가까운 보행 가능 타일 탐색
export class Pathfinder {
  /**
   * @param {Phaser.Tilemaps.TilemapLayer} wallLayer
   * @param {(tx:number,ty:number)=>boolean} [isWalkableFn]
   * @param {{clearanceTiles?:number}} [options]
   */
  constructor(wallLayer, isWalkableFn, options = {}) {
    this.wallLayer = wallLayer;
    this.isWalkableBase = isWalkableFn || ((tx, ty) => this.inBounds(tx, ty) && !this.wallLayer.hasTileAt(tx, ty));
    const map = wallLayer.tilemap;
    this.width = map.width;
    this.height = map.height;
    // 여유 공간은 후처리로 처리하므로 기본 0으로 둬서 통로 폭을 제한하지 않음
    this.clearanceTiles = Math.max(0, options.clearanceTiles | 0);
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  _isWalkableInflated(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    if (this.clearanceTiles <= 0) return this.isWalkableBase(tx, ty);
    for (let dy = -this.clearanceTiles; dy <= this.clearanceTiles; dy++) {
      for (let dx = -this.clearanceTiles; dx <= this.clearanceTiles; dx++) {
        const nx = tx + dx, ny = ty + dy;
        if (!this.inBounds(nx, ny)) return false;
        if (this.wallLayer.hasTileAt(nx, ny)) return false;
      }
    }
    return true;
  }

  /** 클릭 목표 근처의 가장 가까운 보행 가능 타일 찾기 (BFS) */
  findNearestWalkable(targetTx, targetTy, maxRadius = 64) {
    if (this._isWalkableInflated(targetTx, targetTy)) {
      return { tx: targetTx, ty: targetTy };
    }
    const visited = new Set();
    const q = [];
    const push = (x, y, d) => {
      const key = x + "," + y;
      if (visited.has(key)) return;
      visited.add(key);
      if (!this.inBounds(x, y)) return;
      q.push({ x, y, d });
    };
    push(targetTx, targetTy, 0);
    while (q.length) {
      const { x, y, d } = q.shift();
      if (d > maxRadius) break;
      if (this._isWalkableInflated(x, y)) return { tx: x, ty: y };
      // 4방향 확장
      push(x + 1, y, d + 1);
      push(x - 1, y, d + 1);
      push(x, y + 1, d + 1);
      push(x, y - 1, d + 1);
    }
    return null;
  }

  /** 8방향 A* 최단 경로 (시작/끝 포함). 없으면 null */
  findPath(fromTx, fromTy, toTx, toTy) {
    const start = { x: fromTx, y: fromTy };
    const goal = { x: toTx, y: toTy };
    const key = (x, y) => x + "," + y;
    const h = (x, y) => {
      const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
      // Octile heuristic for 8-direction grid
      const F = Math.SQRT2 - 1;
      return (dx < dy) ? F * dx + dy : F * dy + dx;
    };

    const open = new MinHeap((a, b) => a.f - b.f);
    const gScore = new Map();
    const came = new Map();

    const startKey = key(start.x, start.y);
    gScore.set(startKey, 0);
    open.push({ x: start.x, y: start.y, f: h(start.x, start.y) });

    const pushNeighbor = (nx, ny, curKey, curG, stepCost) => {
      if (!this.inBounds(nx, ny) || !this._isWalkableInflated(nx, ny)) return;
      const nKey = key(nx, ny);
      const tentativeG = curG + stepCost;
      const bestG = gScore.get(nKey);
      if (bestG === undefined || tentativeG < bestG) {
        gScore.set(nKey, tentativeG);
        came.set(nKey, curKey);
        open.push({ x: nx, y: ny, f: tentativeG + h(nx, ny) });
      }
    };

    while (!open.isEmpty()) {
      const cur = open.pop();
      const curKey = key(cur.x, cur.y);
      if (cur.x === goal.x && cur.y === goal.y) {
        // reconstruct
        const path = [];
        let k = curKey;
        while (k) {
          const [sx, sy] = k.split(",").map(Number);
          path.push({ tx: sx, ty: sy });
          k = came.get(k);
        }
        path.reverse();
        return path;
      }
      const curG = gScore.get(curKey) ?? Infinity;
      // 8방향 (대각선 코너 끼기 방지)
      // 직교
      pushNeighbor(cur.x + 1, cur.y, curKey, curG, 1);
      pushNeighbor(cur.x - 1, cur.y, curKey, curG, 1);
      pushNeighbor(cur.x, cur.y + 1, curKey, curG, 1);
      pushNeighbor(cur.x, cur.y - 1, curKey, curG, 1);
      // 대각: 두 직교 인접이 모두 통과 가능해야 허용
      const can = (ax, ay) => this._isWalkableInflated(ax, ay);
      if (can(cur.x + 1, cur.y) && can(cur.x, cur.y + 1)) pushNeighbor(cur.x + 1, cur.y + 1, curKey, curG, Math.SQRT2);
      if (can(cur.x - 1, cur.y) && can(cur.x, cur.y + 1)) pushNeighbor(cur.x - 1, cur.y + 1, curKey, curG, Math.SQRT2);
      if (can(cur.x + 1, cur.y) && can(cur.x, cur.y - 1)) pushNeighbor(cur.x + 1, cur.y - 1, curKey, curG, Math.SQRT2);
      if (can(cur.x - 1, cur.y) && can(cur.x, cur.y - 1)) pushNeighbor(cur.x - 1, cur.y - 1, curKey, curG, Math.SQRT2);
    }
    return null;
  }

  /** 타일 직선 시야 체크(팽창 충돌 기준). 세밀 샘플링 */
  hasLineOfSightTiles(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    if (steps === 0) return true;
    const sx = dx / steps, sy = dy / steps;
    let x = ax, y = ay;
    for (let i = 0; i <= steps; i++) {
      const tx = Math.round(x), ty = Math.round(y);
      if (!this._isWalkableInflated(tx, ty)) return false;
      x += sx; y += sy;
    }
    return true;
  }

  /** 경로 단순화(가시선으로 문자열 당기기) */
  smoothPathTiles(path) {
    if (!path || path.length <= 2) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      for (; j > i + 1; j--) {
        if (this.hasLineOfSightTiles(path[i].tx, path[i].ty, path[j].tx, path[j].ty)) {
          break;
        }
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }
}

class MinHeap {
  constructor(compare) {
    this.a = [];
    this.cmp = compare;
  }
  isEmpty() { return this.a.length === 0; }
  push(v) { this.a.push(v); this._up(this.a.length - 1); }
  pop() {
    if (this.a.length === 0) return null;
    const r = this.a[0];
    const last = this.a.pop();
    if (this.a.length > 0) { this.a[0] = last; this._down(0); }
    return r;
  }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.cmp(this.a[i], this.a[p]) < 0) {
        const t = this.a[i]; this.a[i] = this.a[p]; this.a[p] = t; i = p;
      } else break;
    }
  }
  _down(i) {
    const n = this.a.length;
    while (true) {
      let l = i * 2 + 1, r = l + 1, m = i;
      if (l < n && this.cmp(this.a[l], this.a[m]) < 0) m = l;
      if (r < n && this.cmp(this.a[r], this.a[m]) < 0) m = r;
      if (m === i) break;
      const t = this.a[i]; this.a[i] = this.a[m]; this.a[m] = t; i = m;
    }
  }
}


