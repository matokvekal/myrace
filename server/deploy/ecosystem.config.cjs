// PM2 app for the Commissaire API. Installed root-owned at
// /opt/commissaire-api/bin/ecosystem.config.cjs and started only by
// deploy-gate.sh, as the commissaire user (its own PM2 daemon, apart from El Niño's).
// Settings come from /opt/commissaire-api/shared/.env (server/.env in each release links to it).
const fs = require("node:fs");
const path = require("node:path");

const base = process.env.COMMISSAIRE_DEPLOY_BASE || "/opt/commissaire-api";
const current = path.join(base, "current");
let release = "unknown";
try {
  release = fs.readFileSync(path.join(current, "REVISION"), "utf8").trim();
} catch {
  // no current release yet
}

module.exports = {
  apps: [
    {
      name: "commissaire-api-live",
      cwd: path.join(current, "server"),
      script: "dist/server.js",
      interpreter: process.env.COMMISSAIRE_NODE_BIN || "node",
      exec_mode: "fork",
      instances: 1, // Socket.IO rooms are in memory: exactly one process
      autorestart: true,
      max_memory_restart: "512M",
      kill_timeout: 10000,
      time: true,
      env: { COMMISSAIRE_RELEASE: release }, // reported by /api/v1/health
    },
  ],
};
