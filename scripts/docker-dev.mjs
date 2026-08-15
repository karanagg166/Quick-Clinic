#!/usr/bin/env node
import net from "node:net";
import { spawn } from "node:child_process";

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.once("close", () => resolve(true)).close();
      })
      .listen(port, "0.0.0.0");
  });
}

async function getAvailablePort(preferredPort, label = "Port") {
  for (let port = preferredPort; port < preferredPort + 50; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      if (port !== preferredPort) {
        console.log(`⚠️  ${label} ${preferredPort} is already in use. Auto-switching to port ${port}.`);
      }
      return port;
    }
  }
  return preferredPort;
}

async function main() {
  const appPort = await getAvailablePort(Number(process.env.APP_PORT || 3000), "Frontend Port");
  const socketPort = await getAvailablePort(Number(process.env.SOCKET_PORT || 4000), "Socket Server Port");

  console.log("==========================================");
  console.log("  🚀 Launching Quick-Clinic in Docker");
  console.log(`  🌐 Frontend:      http://localhost:${appPort}`);
  console.log(`  🔌 Socket Server: http://localhost:${socketPort}`);
  console.log("==========================================\n");

  const env = {
    ...process.env,
    APP_PORT: String(appPort),
    SOCKET_PORT: String(socketPort),
    FRONTEND_URL: `http://localhost:${appPort}`,
    NEXT_PUBLIC_SOCKET_URL: `http://localhost:${socketPort}`,
  };

  const child = spawn("docker", ["compose", "up", ...process.argv.slice(2)], {
    env,
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

main().catch((err) => {
  console.error("Failed to start docker compose:", err);
  process.exit(1);
});
