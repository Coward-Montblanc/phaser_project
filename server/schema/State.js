const schema = require("@colyseus/schema");
const { Schema, type, MapSchema } = schema;

class PlayerState extends Schema {}
schema.defineTypes(PlayerState, {
  x: "number",
  y: "number",
  nickname: "string",
  characterKey: "string",
});

class State extends Schema {}
schema.defineTypes(State, {
  players: { map: PlayerState },
  phase: "string", // lobby | playing
  hostId: "string",
});

State.prototype.players = new MapSchema();
State.prototype.phase = "lobby";
State.prototype.hostId = "";

module.exports = { State, PlayerState };


