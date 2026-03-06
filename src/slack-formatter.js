const { WebClient } = require("@slack/web-api");
const { getRAG } = require("./constants");

// ─── AE Slack User IDs ──────────────────────────────────────────
// Used to @mention AEs when their call is scored.
// Add remaining Slack user IDs as you collect them.
const AE_SLACK_IDS = {
  "Pedro Cavagnari": "U0A7HQWP3GU",
  "Edgar Arana": "U0A6YPUEB7H",
  "Marc James Beauchamp": "U0A7T59MFCZ",
  "Zachary Obando": "U0A7C69UHK8",
  "Alfred Du": "U0A7T58JVHP",
  "Vanessa Fortune": "U0A7T58H2MP",
  "Marysol Ortega": "U0A6YPVA53R",
  "Gleidson Rocha": "U0A88GBQQQ0",
  "David Morawietz": "U0A89DVTWQ1",
};

function slackMention(repName) {
  const id = AE_SLACK_IDS[repName];
  return id ? `<@${id}>` : repName;
}

// ─── Slack Client ────────────────────────────────────────────────

let slackClient;
function getSlack() {
  if (!slackClient) {
    slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }
  return slackClient;
}

// ─── SPICED Pips ─────────────────────────────────────────────────
// Converts SPICED scores into visual status pips for Slack.

function spicedPip(element, data) {
  const letter = element.toUpperCase();
  if (data.status === "strong") return `✅ ${letter}`;
  if (data.status === "partial") return `🟡 ${letter}`;
  return `🔴 ${letter}`;
}

function formatSpicedLine(spiced) {
  return ["s", "p", "i", "c", "e"]
    .map((el) => spicedPip(el, spiced[el]))
    .join("   ");
}

// ─── BANT Pips ──────────────────────────────────────────────────

function formatBantLine(bant) {
  return ["b", "a", "n", "t"]
    .map((el) => spicedPip(el, bant[el]))
    .join("   ");
}

// ─── SVC Pips ───────────────────────────────────────────────────
// Converts SVC closing criteria into visual pips for Slack.

function ragToPip(label, rag) {
  if (rag === "g" || rag === "green") return `✅ ${label}`;
  if (rag === "y" || rag === "yellow") return `🟡 ${label}`;
  return `🔴 ${label}`;
}

function formatSvcLine(closing) {
  if (!closing || !closing.criteria) return "🔴 S   🔴 V   🔴 C";
  const c = closing.criteria;
  return [
    ragToPip("S", c.summary?.rag),
    ragToPip("V", c.value?.rag),
    ragToPip("C", c.close?.rag)
  ].join("   ");
}

// ─── RAG Emoji ───────────────────────────────────────────────────

function ragEmoji(rag) {
  if (rag === "green" || rag === "g") return "🟢";
  if (rag === "yellow" || rag === "y") return "🟡";
  return "🔴";
}

// ─── Framework Tags ──────────────────────────────────────────────
// Generates highlight tags based on scorecard data.

function buildFrameworkTags(scorecard) {
  const tags = [];
  const sp = scorecard.spiced;

  // Perfect SPICED?
  const allStrong = ["s", "p", "i", "c", "e"].every((el) => sp[el].status === "strong");
  if (allStrong) tags.push("⭐ Perfect SPICED");

  // ECIR count
  const ecir = scorecard.phases?.pricing?.criteria?.ecir;
  if (ecir && ecir.objectionsHandled > 0) {
    tags.push(`🎯 ECIR on ${ecir.objectionsHandled} objection${ecir.objectionsHandled > 1 ? "s" : ""}`);
  }

  // Full SVC executed?
  const closing = scorecard.phases?.closing;
  if (closing?.svcExecuted) tags.push("🎯 Full SVC close");

  // Clean close (C element green)?
  const closeEl = closing?.criteria?.close;
  if (closeEl && (closeEl.rag === "g" || closeEl.rag === "green")) tags.push("✅ Closed on call");

  // No discount?
  const discountScore = scorecard.phases?.pricing?.criteria?.noDiscount;
  if (discountScore && discountScore.score === 2) tags.push("💰 No discount");

  return tags;
}

// ─── Scorecard URL ──────────────────────────────────────────────

function scorecardUrl(scorecardId) {
  const base = process.env.APP_URL;
  if (!base || !scorecardId) return null;
  return `${base.replace(/\/$/, "")}/calls/${scorecardId}`;
}

// ─── #demo-reviews Message ───────────────────────────────────────
// Posts for EVERY scored demo.

function buildDemoReviewBlocks(scorecard, meta, scorecardId) {
  const rag = getRAG(scorecard.score);
  const spicedLine = formatSpicedLine(scorecard.spiced);
  const bantLine = scorecard.bant ? formatBantLine(scorecard.bant) : null;
  const svcLine = formatSvcLine(scorecard.phases?.closing);
  const closingScore = scorecard.phases?.closing;
  const closingText = closingScore
    ? `*Close (SVC)*\n${svcLine}  ·  ${closingScore.score || 0}/12`
    : `*Close (SVC)*\n${svcLine}`;
  const tags = buildFrameworkTags(scorecard);

  const blocks = [
    // Title
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${rag.emoji} *New Demo Scored | ${slackMention(meta.repName)} → ${meta.companyName}*`
      }
    },
    // Score + verdict
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Score*\n${scorecard.score}/100 · ${rag.label}` },
        { type: "mrkdwn", text: `*Duration*\n${meta.durationMinutes || "?"} min` },
        { type: "mrkdwn", text: `*Date*\n${meta.date}` },
        { type: "mrkdwn", text: bantLine ? `*SPICED*\n${spicedLine}\n\n*BANT*\n${bantLine}` : `*SPICED*\n${spicedLine}` }
      ]
    },
    // Closing row
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: closingText }
      ]
    },
    // Verdict
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `> _${scorecard.verdict}_`
      }
    }
  ];

  // Framework tags (if any)
  if (tags.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: tags.join("  ·  ") }]
    });
  }

  // Top coaching notes — wins
  if (scorecard.wins && scorecard.wins.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ What landed*\n${scorecard.wins.map((w) => `• ${w}`).join("\n")}`
      }
    });
  }

  // Top fixes
  if (scorecard.fixes && scorecard.fixes.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🔧 Priority fixes*\n${scorecard.fixes.map((f) => `• ${f}`).join("\n")}`
      }
    });
  }

  // Quote of the call
  if (scorecard.quoteOfTheCall && scorecard.quoteOfTheCall.text) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*💬 Quote of the call* (▶ ${scorecard.quoteOfTheCall.timestamp})\n> _"${scorecard.quoteOfTheCall.text}"_`
      }
    });
  }

  // Deep link to full scorecard
  const url = scorecardUrl(scorecardId);
  if (url) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "📋 View Full Scorecard" },
          url,
          style: "primary"
        }
      ]
    });
  }

  return blocks;
}

// ─── #killer-calls Message ───────────────────────────────────────
// Posts ONLY for calls scoring 80+. Celebratory tone.

function buildKillerCallBlocks(scorecard, meta, scorecardId) {
  const tags = buildFrameworkTags(scorecard);
  const spicedLine = formatSpicedLine(scorecard.spiced);

  const blocks = [
    // Celebratory header
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔥 *KILLER CALL | ${slackMention(meta.repName)} — ${scorecard.score}/100*`
      }
    },
    // Details
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Prospect*\n${meta.companyName}` },
        { type: "mrkdwn", text: `*Duration*\n${meta.durationMinutes || "?"} min · ${meta.date}` },
        { type: "mrkdwn", text: `*SPICED*\n${spicedLine}` }
      ]
    }
  ];

  // Framework highlight tags
  if (tags.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: tags.join("  ·  ") }]
    });
  }

  // Verdict
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `> _${scorecard.verdict}_`
    }
  });

  // Deep link to full scorecard
  const url = scorecardUrl(scorecardId);
  if (url) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "🔥 View Full Scorecard" },
          url,
          style: "primary"
        }
      ]
    });
  }

  // CTA
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "📖 Study this call — drop your takeaways in the thread 👇" }]
  });

  return blocks;
}

// ─── Post to Slack ───────────────────────────────────────────────

async function postDemoReview(scorecard, meta, scorecardId) {
  const channelId = process.env.SLACK_CHANNEL_REVIEWS;
  if (!channelId) {
    console.warn("[slack] SLACK_CHANNEL_REVIEWS not set — skipping #demo-reviews post");
    return null;
  }

  const rag = getRAG(scorecard.score);
  const blocks = buildDemoReviewBlocks(scorecard, meta, scorecardId);

  console.log(`[slack] Posting to #demo-reviews (score: ${scorecard.score}, ${rag.label})...`);

  try {
    const result = await getSlack().chat.postMessage({
      channel: channelId,
      text: `${rag.emoji} New Demo Scored | ${slackMention(meta.repName)} → ${meta.companyName} — ${scorecard.score}/100`,
      blocks,
      unfurl_links: false
    });
    console.log(`[slack] Posted to #demo-reviews: ${result.ts}`);
    return result;
  } catch (err) {
    console.error(`[slack] Failed to post to #demo-reviews: ${err.message}`);
    return null;
  }
}

async function postKillerCall(scorecard, meta, scorecardId) {
  if (scorecard.score < 80) return null;

  const channelId = process.env.SLACK_CHANNEL_KILLER;
  if (!channelId) {
    console.warn("[slack] SLACK_CHANNEL_KILLER not set — skipping #killer-calls post");
    return null;
  }

  const blocks = buildKillerCallBlocks(scorecard, meta, scorecardId);

  console.log(`[slack] Posting to #killer-calls (score: ${scorecard.score})...`);

  try {
    const result = await getSlack().chat.postMessage({
      channel: channelId,
      text: `🔥 KILLER CALL | ${slackMention(meta.repName)} — ${scorecard.score}/100`,
      blocks,
      unfurl_links: false
    });
    console.log(`[slack] Posted to #killer-calls: ${result.ts}`);
    return result;
  } catch (err) {
    console.error(`[slack] Failed to post to #killer-calls: ${err.message}`);
    return null;
  }
}

module.exports = { postDemoReview, postKillerCall };
