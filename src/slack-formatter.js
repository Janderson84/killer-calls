const { WebClient } = require("@slack/web-api");
const { getRAG } = require("./constants");

function slackMention(repName, roster) {
  if (Array.isArray(roster)) {
    const ae = roster.find((r) => r.name === repName);
    if (ae && ae.slackId) return `<@${ae.slackId}>`;
  }
  return repName;
}

// ─── Slack Client ────────────────────────────────────────────────

const slackClients = {};
function getSlack(token) {
  const t = token || process.env.SLACK_BOT_TOKEN;
  if (!slackClients[t]) {
    slackClients[t] = new WebClient(t);
  }
  return slackClients[t];
}

// ─── SPICED Pips ─────────────────────────────────────────────────

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

// ─── Close Pips ────────────────────────────────────────────────

function formatCloseLine(close) {
  if (!close) return null;

  if (close.style === "none") {
    return "No close attempted → 🔴 S   🔴 B   🔴 A";
  }

  const steps = ["setup", "bridge", "ask"];
  const pips = steps
    .map((step) => {
      const data = close[step];
      if (!data) return `🔴 ${step[0].toUpperCase()}`;
      const label = data.label ? data.label.split(" ")[0][0] : step[0].toUpperCase();
      if (data.status === "strong") return `✅ ${label}`;
      if (data.status === "partial") return `🟡 ${label}`;
      return `🔴 ${label}`;
    })
    .join("   ");

  return `${close.styleName || close.style} → ${pips}`;
}

// ─── RAG Emoji ───────────────────────────────────────────────────

function ragEmoji(rag) {
  if (rag === "green" || rag === "g") return "🟢";
  if (rag === "yellow" || rag === "y") return "🟡";
  return "🔴";
}

// ─── Framework Tags ──────────────────────────────────────────────

function buildFrameworkTags(scorecard) {
  const tags = [];
  const sp = scorecard.spiced;

  const allStrong = ["s", "p", "i", "c", "e"].every((el) => sp[el].status === "strong");
  if (allStrong) tags.push("⭐ Perfect SPICED");

  const ecir = scorecard.phases?.pricing?.criteria?.ecir;
  if (ecir && ecir.objectionsHandled > 0) {
    tags.push(`🎯 ECIR on ${ecir.objectionsHandled} objection${ecir.objectionsHandled > 1 ? "s" : ""}`);
  }

  const close = scorecard.close;
  if (close && close.style !== "none") {
    const allStrong = ["setup", "bridge", "ask"].every((s) => close[s]?.status === "strong");
    if (allStrong) {
      tags.push(`🎯 Perfect ${close.styleName || close.style} Close`);
    } else if (close.ask && close.ask.status === "strong") {
      tags.push("✅ Closed on call");
    }
  }

  const discountScore = scorecard.phases?.pricing?.criteria?.noDiscount;
  if (discountScore && discountScore.score === 2) tags.push("💰 No discount");

  return tags;
}

// ─── Scorecard URL ──────────────────────────────────────────────

function scorecardUrl(scorecardId, appUrl) {
  const base = appUrl || process.env.APP_URL;
  if (!base || !scorecardId) return null;
  return `${base.replace(/\/$/, "")}/calls/${scorecardId}`;
}

// ─── #demo-reviews Message ───────────────────────────────────────

function buildDemoReviewBlocks(scorecard, meta, scorecardId, appUrl, roster) {
  const rag = getRAG(scorecard.score);
  const spicedLine = formatSpicedLine(scorecard.spiced);
  const bantLine = scorecard.bant ? formatBantLine(scorecard.bant) : null;
  const closeLine = scorecard.close ? formatCloseLine(scorecard.close) : null;
  const tags = buildFrameworkTags(scorecard);

  let frameworksText = `*SPICED*\n${spicedLine}`;
  if (bantLine) frameworksText += `\n\n*BANT*\n${bantLine}`;
  if (closeLine) frameworksText += `\n\n*Close*\n${closeLine}`;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${rag.emoji} *New Demo Scored | ${slackMention(meta.repName, roster)} → ${meta.companyName}*${meta.callType === "followup" ? "  🔄 Follow-up" : ""}`
      }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Score*\n${scorecard.score}/100 · ${rag.label}` },
        { type: "mrkdwn", text: `*Duration*\n${meta.durationMinutes || "?"} min` },
        { type: "mrkdwn", text: `*Date*\n${meta.date}` },
        { type: "mrkdwn", text: frameworksText }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `> _${scorecard.verdict}_`
      }
    }
  ];

  if (tags.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: tags.join("  ·  ") }]
    });
  }

  const url = scorecardUrl(scorecardId, appUrl);
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

// ─── Thread: Coaching Detail ─────────────────────────────────────

function buildThreadBlocks(scorecard, scorecardId) {
  const blocks = [];

  if (scorecard.wins && scorecard.wins.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ What landed*\n${scorecard.wins.map((w) => `• ${w}`).join("\n")}`
      }
    });
  }

  if (scorecard.fixes && scorecard.fixes.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🔧 Priority fixes*\n${scorecard.fixes.map((f) => `• ${f}`).join("\n")}`
      }
    });
  }

  if (scorecard.closingTips && scorecard.closingTips.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🎯 Closing tips*\n${scorecard.closingTips.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
      }
    });
  }

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

  return blocks;
}

// ─── #killer-calls Message ───────────────────────────────────────

function buildKillerCallBlocks(scorecard, meta, scorecardId, appUrl, roster) {
  const tags = buildFrameworkTags(scorecard);
  const spicedLine = formatSpicedLine(scorecard.spiced);

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `🔥 *KILLER CALL | ${slackMention(meta.repName, roster)} — ${scorecard.score}/100*`
      }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Prospect*\n${meta.companyName}` },
        { type: "mrkdwn", text: `*Duration*\n${meta.durationMinutes || "?"} min · ${meta.date}` },
        { type: "mrkdwn", text: `*SPICED*\n${spicedLine}` }
      ]
    }
  ];

  if (tags.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: tags.join("  ·  ") }]
    });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `> _${scorecard.verdict}_`
    }
  });

  const url = scorecardUrl(scorecardId, appUrl);
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

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "📖 Study this call — drop your takeaways in the thread 👇" }]
  });

  return blocks;
}

// ─── Post to Slack ───────────────────────────────────────────────
// Now accepts optional teamConfig with channelId and appUrl

async function postDemoReview(scorecard, meta, scorecardId, teamConfig = {}) {
  const channelId = teamConfig.channelId || process.env.SLACK_CHANNEL_REVIEWS;
  if (!channelId) {
    console.warn("[slack] No reviews channel configured — skipping #demo-reviews post");
    return null;
  }

  const appUrl = teamConfig.appUrl || process.env.APP_URL;
  const roster = teamConfig.roster || [];
  const slack = getSlack(teamConfig.slackBotToken);
  const rag = getRAG(scorecard.score);
  const blocks = buildDemoReviewBlocks(scorecard, meta, scorecardId, appUrl, roster);

  console.log(`[slack] Posting to #demo-reviews (score: ${scorecard.score}, ${rag.label})...`);

  try {
    const result = await slack.chat.postMessage({
      channel: channelId,
      text: `${rag.emoji} New Demo Scored | ${slackMention(meta.repName, roster)} → ${meta.companyName} — ${scorecard.score}/100`,
      blocks,
      unfurl_links: false
    });
    console.log(`[slack] Posted to #demo-reviews: ${result.ts}`);

    const threadBlocks = buildThreadBlocks(scorecard, scorecardId);
    if (threadBlocks.length > 0) {
      await slack.chat.postMessage({
        channel: channelId,
        thread_ts: result.ts,
        text: "Coaching detail",
        blocks: threadBlocks,
        unfurl_links: false
      });
      console.log(`[slack] Posted coaching thread under ${result.ts}`);
    }

    return result;
  } catch (err) {
    console.error(`[slack] Failed to post to #demo-reviews: ${err.message}`);
    return null;
  }
}

async function postKillerCall(scorecard, meta, scorecardId, teamConfig = {}) {
  const threshold = teamConfig.killerThreshold || 80;
  if (scorecard.score < threshold) return null;

  const channelId = teamConfig.channelId || process.env.SLACK_CHANNEL_KILLER;
  if (!channelId) {
    console.warn("[slack] No killer channel configured — skipping #killer-calls post");
    return null;
  }

  const appUrl = teamConfig.appUrl || process.env.APP_URL;
  const roster = teamConfig.roster || [];
  const slack = getSlack(teamConfig.slackBotToken);
  const blocks = buildKillerCallBlocks(scorecard, meta, scorecardId, appUrl, roster);

  console.log(`[slack] Posting to #killer-calls (score: ${scorecard.score}, threshold: ${threshold})...`);

  try {
    const result = await slack.chat.postMessage({
      channel: channelId,
      text: `🔥 KILLER CALL | ${slackMention(meta.repName, roster)} — ${scorecard.score}/100`,
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
