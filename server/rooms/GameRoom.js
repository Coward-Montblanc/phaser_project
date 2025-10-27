const planck = require("planck");
const { Room } = require("colyseus");
const { State, PlayerState } = require("../schema/State");

class GameRoom extends Room {
  onCreate(options) {
    this.setState(new State());
    this.maxClients = 4;

    // physics world (meters)
    this.world = planck.World({
      gravity: planck.Vec2(0, 0),
    });

    this.bodies = new Map(); // sessionId -> planck.Body

    // simple map boundaries (meters)
    const halfWidth = 100;
    const halfHeight = 100;
    const ground = this.world.createBody();
    const edge = planck.Edge;
    ground.createFixture(edge(planck.Vec2(-halfWidth, -halfHeight), planck.Vec2(halfWidth, -halfHeight)));
    ground.createFixture(edge(planck.Vec2(halfWidth, -halfHeight), planck.Vec2(halfWidth, halfHeight)));
    ground.createFixture(edge(planck.Vec2(halfWidth, halfHeight), planck.Vec2(-halfWidth, halfHeight)));
    ground.createFixture(edge(planck.Vec2(-halfWidth, halfHeight), planck.Vec2(-halfWidth, -halfHeight)));

    // inputs cache: sessionId -> { up, down, left, right }
    this.inputs = new Map();

    this.onMessage("input", (client, message) => {
      this.inputs.set(client.sessionId, message || {});
    });

    this.onMessage("selectCharacter", (client, message) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.characterKey = typeof message?.characterKey === "string" ? message.characterKey : p.characterKey;
    });

    this.onMessage("requestStart", (client) => {
      // host: first joined client
      if (this.state.hostId && this.state.hostId !== client.sessionId) return;
      this.state.phase = "playing";
    });

    // tick @ 60Hz
    this.setSimulationInterval((deltaTimeMs) => this.update(deltaTimeMs), 1000 / 60);
  }

  onAuth(client, options, request) {
    // trust
    return true;
  }

  onJoin(client, options) {
    const nickname = String(options?.nickname || "guest").slice(0, 16);
    if (!this.state.hostId) this.state.hostId = client.sessionId;

    // create schema player
    const playerState = new PlayerState();
    playerState.x = 0;
    playerState.y = 0;
    playerState.nickname = nickname;
    playerState.characterKey = "player1";
    this.state.players.set(client.sessionId, playerState);

    // create body
    const body = this.world.createDynamicBody({
      position: planck.Vec2(0, 0),
      fixedRotation: true,
      linearDamping: 10,
    });
    body.createFixture(planck.Circle(0.5), { density: 1, friction: 0, restitution: 0 });
    this.bodies.set(client.sessionId, body);

    // default inputs
    this.inputs.set(client.sessionId, {});
  }

  onLeave(client, consented) {
    // remove schema
    this.state.players.delete(client.sessionId);
    // remove body
    const body = this.bodies.get(client.sessionId);
    if (body) {
      this.world.destroyBody(body);
      this.bodies.delete(client.sessionId);
    }
    this.inputs.delete(client.sessionId);

    if (this.state.hostId === client.sessionId) {
      // reassign host
      const next = Array.from(this.clients)[0];
      this.state.hostId = next ? next.sessionId : "";
    }
  }

  update(deltaTimeMs) {
    const dt = Math.min(1 / 30, deltaTimeMs / 1000); // clamp

    // apply inputs as forces
    for (const [sessionId, body] of this.bodies.entries()) {
      const input = this.inputs.get(sessionId) || {};
      const desired = planck.Vec2(0, 0);
      const speed = 6; // m/s
      if (input.up) desired.y -= 1;
      if (input.down) desired.y += 1;
      if (input.left) desired.x -= 1;
      if (input.right) desired.x += 1;
      if (desired.x !== 0 || desired.y !== 0) {
        desired.normalize();
        const vel = planck.Vec2(desired.x * speed, desired.y * speed);
        body.setLinearVelocity(vel);
      } else {
        // friction via damping
        body.setLinearVelocity(planck.Vec2(0, 0));
      }
    }

    this.world.step(dt);

    // sync back to state
    for (const [sessionId, body] of this.bodies.entries()) {
      const p = this.state.players.get(sessionId);
      if (!p) continue;
      const pos = body.getPosition();
      p.x = pos.x;
      p.y = pos.y;
    }
  }
}

module.exports = { GameRoom };


