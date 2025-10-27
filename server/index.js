const http = require("http");
const { Server } = require("colyseus");
const { GameRoom } = require("./rooms/GameRoom");

const PORT = process.env.PORT || 2567;

async function main() {
  const httpServer = http.createServer();

  const gameServer = new Server({ server: httpServer });

  gameServer.define("game", GameRoom);

  httpServer.listen(PORT, () => {
    console.log(`[server] listening on ws://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


