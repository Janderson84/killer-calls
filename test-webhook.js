#!/usr/bin/env node

/**
 * test-webhook.js
 * ───────────────
 * Simulates a Fireflies webhook hitting your local server.
 * Usage:
 *   node test-webhook.js                  # uses a default test meetingId
 *   node test-webhook.js <meetingId>      # uses a real Fireflies transcript ID
 */

const WEBHOOK_URL = `http://localhost:${process.env.PORT || 3000}/webhook/fireflies`;

async function main() {
  const meetingId = process.argv[2] || "TEST_MEETING_ID";

  console.log(`\n🧪 Sending test webhook to ${WEBHOOK_URL}`);
  console.log(`   meetingId: ${meetingId}\n`);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId })
    });

    const body = await response.json();

    console.log(`✅ Response: ${response.status} ${response.statusText}`);
    console.log(`   Body:`, JSON.stringify(body, null, 2));
    console.log(`\n💡 The server acknowledged the webhook.`);
    console.log(`   Check the server logs to see the pipeline processing.`);
    console.log(`   (Scoring + Slack posting happens async after the 200 response.)\n`);
  } catch (err) {
    if (err.cause && err.cause.code === "ECONNREFUSED") {
      console.error(`❌ Connection refused — is the server running?`);
      console.error(`   Start it with: npm start\n`);
    } else {
      console.error(`❌ Error: ${err.message}\n`);
    }
    process.exit(1);
  }
}

main();
