export default class RoomLobby extends Phaser.Scene {
  constructor() {
    super({ key: "RoomLobby" });
  }

  create(data) {
    this.cameras.main.setBackgroundColor("#0f1115");
    this.room = data?.room || null;
    if (!this.room) {
      this.scene.start("RoomBrowser");
      return;
    }

    const root = document.createElement("div");
    root.id = "roomLobbyRoot";
    root.style.position = "fixed";
    root.style.top = "60px";
    root.style.left = "12px";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "8px";
    root.style.padding = "10px";
    root.style.width = "320px";
    root.style.background = "rgba(15,17,21,0.9)";
    root.style.border = "1px solid #2a2f3a";
    root.style.borderRadius = "10px";
    root.style.zIndex = 100000;
    root.innerHTML = `
      <h3 style="margin:0 0 6px 0; font-size:14px; color:#c9c9c9">ROOM: ${this.room.id}</h3>
      <div id="host" style="font-size:12px; opacity:.8">host: -</div>
      <div id="players" style="display:flex; flex-direction:column; gap:4px"></div>
      <div style="display:flex; gap:6px">
        <button id="start">게임 시작</button>
        <button id="leave">나가기</button>
      </div>
    `;
    document.body.appendChild(root);
    this._dom = root;

    const $ = (id) => root.querySelector(id);
    const hostEl = $("#host");
    const playersEl = $("#players");
    const startBtn = $("#start");
    const leaveBtn = $("#leave");

    const renderPlayers = () => {
      playersEl.innerHTML = "";
      const arr = [];
      this.room.state.players.forEach((p, id) => {
        arr.push({ id, p });
      });
      for (const { id, p } of arr) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.alignItems = "center";
        row.innerHTML = `
          <div style="flex:1">
            <div style="font-size:13px">${p.nickname || id}</div>
            <div style="font-size:12px; opacity:.7">${p.characterKey}</div>
          </div>
        `;
        playersEl.appendChild(row);
      }
      hostEl.textContent = `host: ${this.room.state.hostId}`;
      const isHost = this.room.sessionId === this.room.state.hostId;
      startBtn.disabled = !isHost;
    };

    // state listeners
    this.room.state.players.onAdd = () => renderPlayers();
    this.room.state.players.onRemove = () => renderPlayers();
    this.room.state.players.onChange = () => renderPlayers();
    this.room.state.onChange = () => {
      if (this.room.state.phase === "playing") {
        this._goCharacterSelect();
      } else {
        renderPlayers();
      }
    };

    // initial paint
    renderPlayers();

    startBtn.addEventListener("click", () => {
      try { this.room.send("requestStart"); } catch (_) {}
    });

    leaveBtn.addEventListener("click", () => {
      try { this.room.leave(); } catch (_) {}
      this.scene.start("RoomBrowser");
    });

    this.events.on("shutdown", () => this._teardown());
    this.events.on("destroy", () => this._teardown());
  }

  _goCharacterSelect() {
    this.scene.start("CharacterSelect", { debugMode: false, room: this.room });
  }

  _teardown() {
    if (this._dom) {
      try { document.body.removeChild(this._dom); } catch (_) {}
      this._dom = null;
    }
  }
}


