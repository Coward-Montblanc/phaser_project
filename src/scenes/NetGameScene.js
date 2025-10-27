import { GAME } from "../constants.js";

export default class NetGameScene extends Phaser.Scene {
  constructor() {
    super({ key: "NetGameScene" });
  }

  preload() {
    this.load.tilemapTiledJSON("map1", "assets/mapping/map1.tmj");
    this.load.image("map1_orgin", "assets/map/map1_orgin.png");
  }

  create(data) {
    this.room = data?.room || null;
    if (!this.room) {
      this.scene.start("InitialScreen");
      return;
    }

    const map = this.make.tilemap({ key: "map1" });
    const tileset = map.addTilesetImage("map1", "map1_orgin", GAME.TILE_SIZE, GAME.TILE_SIZE, 0, 0);
    const groundLayer = map.createLayer("바닥", tileset, 0, 0);
    const decoLayer = map.createLayer("장식", tileset, 0, 0);
    const wallLayer = map.createLayer("벽", tileset, 0, 0);
    groundLayer.setDepth(0);
    decoLayer.setDepth(2);
    wallLayer.setDepth(3);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    this.players = new Map(); // id -> sprite
    const meterToPx = (m) => m * GAME.TILE_SIZE;

    const ensureSprite = (id, ps) => {
      let s = this.players.get(id);
      if (!s) {
        s = this.add.rectangle(0, 0, 12, 12, 0x66ccff).setDepth(5);
        this.players.set(id, s);
        if (id === this.room.sessionId) {
          s.setFillStyle(0x88ff88);
          this.cameras.main.startFollow(s, true, 0.15, 0.15);
        }
      }
      s.setPosition(meterToPx(ps.x), meterToPx(ps.y));
    };

    // initial
    this.room.state.players.forEach((p, id) => ensureSprite(id, p));

    this.room.state.players.onAdd = (p, id) => ensureSprite(id, p);
    this.room.state.players.onRemove = (_, id) => {
      const s = this.players.get(id);
      if (s) s.destroy();
      this.players.delete(id);
    };
    this.room.state.players.onChange = (p, id) => {
      const s = this.players.get(id);
      if (s) s.setPosition(meterToPx(p.x), meterToPx(p.y));
    };

    // inputs
    this.cursors = this.input.keyboard.createCursorKeys();

    this.time.addEvent({ delay: 50, loop: true, callback: () => this._sendInput() });

    this.events.on("shutdown", () => this._teardown());
    this.events.on("destroy", () => this._teardown());
  }

  _sendInput() {
    if (!this.room) return;
    const i = {
      up: this.cursors.up.isDown,
      down: this.cursors.down.isDown,
      left: this.cursors.left.isDown,
      right: this.cursors.right.isDown,
    };
    try { this.room.send("input", i); } catch (_) {}
  }

  _teardown() {
    // keep room for next scene
  }
}


