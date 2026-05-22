#!/usr/bin/env node
/**
 * openclaw-agent-run.js
 * Calls the OpenClaw Gateway via WebSocket to run an agent turn.
 * Usage: node openclaw-agent-run.js <promptFile> <sessionId> [timeoutSeconds]
 * Exits 0 on success, writes JSON result to stdout.
 */

const WebSocket = require("/usr/lib/node_modules/openclaw/node_modules/ws");
const { readFileSync } = require("fs");

const [,, promptFile, sessionId, timeoutArg] = process.argv;
if (!promptFile || !sessionId) {
  process.stderr.write("Usage: node openclaw-agent-run.js <promptFile> <sessionId> [timeoutSeconds]\n");
  process.exit(1);
}

const GATEWAY_PORT = parseInt(process.env.OPENCLAW_GATEWAY_PORT || "18789", 10);
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "db0c792ded6cc8e04163fdf6874b740323bbd1fce1dc0c8a";
const TIMEOUT_MS = (parseInt(timeoutArg || "300", 10)) * 1000;

const message = readFileSync(promptFile, "utf8");

const ws = new WebSocket(`ws://127.0.0.1:${GATEWAY_PORT}/api/v1/events`, {
  headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
});

let authenticated = false;
let resultText = null;
const deadline = setTimeout(() => {
  process.stderr.write("Timeout waiting for agent response\n");
  ws.close();
  process.exit(1);
}, TIMEOUT_MS);

ws.on("open", () => {
  // Gateway will send connect.challenge — wait for it
});

ws.on("message", (data) => {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }

  const { type, event, payload } = msg;

  if (type === "event" && event === "connect.challenge") {
    // Authenticate
    ws.send(JSON.stringify({
      type: "auth",
      token: GATEWAY_TOKEN,
      nonce: payload.nonce,
    }));
    return;
  }

  if (type === "auth.ok" || (type === "event" && event === "auth.ok")) {
    authenticated = true;
    // Send the agent turn
    ws.send(JSON.stringify({
      type: "agent.run",
      sessionId,
      message,
      json: true,
    }));
    return;
  }

  if (type === "auth.error" || (type === "event" && event === "auth.error")) {
    process.stderr.write("Auth error: " + JSON.stringify(payload) + "\n");
    clearTimeout(deadline);
    ws.close();
    process.exit(1);
    return;
  }

  // Look for the agent reply
  if (type === "agent.reply" || (type === "event" && event === "agent.reply")) {
    resultText = payload?.text || payload?.content || JSON.stringify(payload);
    clearTimeout(deadline);
    process.stdout.write(resultText);
    ws.close();
    process.exit(0);
    return;
  }

  // Also handle generic result/response shapes
  if (type === "result" || type === "response") {
    const text = payload?.text || payload?.payloads?.[0]?.text || JSON.stringify(payload);
    resultText = text;
    clearTimeout(deadline);
    process.stdout.write(text);
    ws.close();
    process.exit(0);
    return;
  }
});

ws.on("error", (err) => {
  process.stderr.write("WebSocket error: " + err.message + "\n");
  clearTimeout(deadline);
  process.exit(1);
});

ws.on("close", () => {
  if (!resultText) {
    process.stderr.write("Connection closed without result\n");
    clearTimeout(deadline);
    process.exit(1);
  }
});
