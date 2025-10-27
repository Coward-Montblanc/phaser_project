import { Network } from "../services/network.js";

export default class RoomBrowser extends Phaser.Scene {
  constructor() {
    super({ key: "RoomBrowser" });
  }

  create() {
    this.cameras.main.setBackgroundColor("#0f1115");

    const root = document.createElement("div");
    root.id = "lobbyRoot";
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
      <h3 style="margin:0 0 6px 0; font-size:14px; color:#c9c9c9">ROOM BROWSER</h3>
      <label style="display:flex; gap:6px; align-items:center">
        <span style="width:68px">Endpoint</span>
        <input id="ep" type="text" style="flex:1; background:#0f1115; color:#e6e6e6; border:1px solid #2a2f3a; border-radius:8px; padding:6px 8px;" />
      </label>
      <label style="display:flex; gap:6px; align-items:center">
        <span style="width:68px">닉네임</span>
        <input id="nick" type="text" maxlength="16" placeholder="guest" style="flex:1; background:#0f1115; color:#e6e6e6; border:1px solid #2a2f3a; border-radius:8px; padding:6px 8px;" />
      </label>
      <div style="display:flex; gap:6px">
        <button id="refresh">룸 새로고침</button>
        <button id="create">룸 생성</button>
      </div>
      <div id="rooms" style="display:flex; flex-direction:column; gap:6px; max-height:240px; overflow:auto;"></div>
    `;
    document.body.appendChild(root);

    this._dom = root;

    const $ = (id) => root.querySelector(id);
    const ep = $("#ep");
    const nick = $("#nick");
    const refreshBtn = $("#refresh");
    const createBtn = $("#create");
    const roomsEl = $("#rooms");

    ep.value = Network.endpoint;
    ep.addEventListener("change", () => Network.setEndpoint(ep.value));
    nick.addEventListener("input", () => Network.setNickname(nick.value));

    const renderRooms = (rooms) => {
      roomsEl.innerHTML = "";
      if (!rooms || rooms.length === 0) {
        const p = document.createElement("div");
        p.textContent = "참여 가능한 룸이 없습니다.";
        p.style.opacity = 0.8;
        roomsEl.appendChild(p);
        return;
      }
      for (const r of rooms) {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.alignItems = "center";
        row.innerHTML = `
          <div style="flex:1">
            <div style="font-size:13px">${r.roomId}</div>
            <div style="font-size:12px; opacity:.7">${r.clients}/${r.maxClients || "?"}</div>
          </div>
          <button data-id="${r.roomId}">입장</button>
        `;
        const btn = row.querySelector("button");
        btn.addEventListener("click", async () => {
          await this._joinRoom(r.roomId);
        });
        roomsEl.appendChild(row);
      }
    };

    const refresh = async () => {
      const list = await Network.listRooms();
      renderRooms(list);
    };

    refreshBtn.addEventListener("click", refresh);
    createBtn.addEventListener("click", async () => {
      const room = await Network.createRoom();
      this._enterLobby(room);
    });

    // initial load
    refresh();

    this.events.on("shutdown", () => this._teardown());
    this.events.on("destroy", () => this._teardown());
  }

  async _joinRoom(roomId) {
    try {
      const room = await Network.joinById(roomId);
      this._enterLobby(room);
    } catch (e) {
      console.error(e);
      alert("입장 실패");
    }
  }

  _enterLobby(room) {
    this.scene.start("RoomLobby", { room });
  }

  _teardown() {
    if (this._dom) {
      try { document.body.removeChild(this._dom); } catch (_) {}
      this._dom = null;
    }
  }
}


