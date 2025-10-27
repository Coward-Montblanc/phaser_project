// Lightweight Colyseus client wrapper

const DEFAULT_ENDPOINT = (location && location.hostname) ? `ws://${location.hostname}:2567` : "ws://localhost:2567";

class NetworkService {
  constructor() {
    this.client = null;
    this.room = null;
    this.endpoint = DEFAULT_ENDPOINT;
    this.nickname = "guest";
  }

  setEndpoint(url) {
    this.endpoint = url;
  }

  setNickname(name) {
    this.nickname = String(name || "guest").slice(0, 16);
  }

  ensureClient() {
    if (!this.client) {
      if (!window.Colyseus) throw new Error("colyseus.js not loaded");
      this.client = new window.Colyseus.Client(this.endpoint);
    }
    return this.client;
  }

  async listRooms() {
    const client = this.ensureClient();
    try {
      return await client.getAvailableRooms("game");
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  async createRoom(options = {}) {
    const client = this.ensureClient();
    const room = await client.create("game", { nickname: this.nickname, ...options });
    this.room = room;
    return room;
  }

  async joinById(roomId, options = {}) {
    const client = this.ensureClient();
    const room = await client.joinById(roomId, { nickname: this.nickname, ...options });
    this.room = room;
    return room;
  }

  leave() {
    if (this.room) {
      try { this.room.leave(); } catch (_) {}
      this.room = null;
    }
  }
}

export const Network = new NetworkService();


