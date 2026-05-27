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

// ─── Pipedrive Deal URL ───────────────────────────────────────────

function pipedriveDealUrl(dealId) {
  if (!dealId) return null;
  return `https://wishpond.pipedrive.com/deal/${dealId}`;
}

// ─── QUICK Pips ──────────────────────────────────────────────────

function quickPip(element, letter, data) {
  if (data.status === "strong") return `✅ ${letter}`;
  if (data.status === "partial") return `🟡 ${letter}`;
  return `🔴 ${letter}`;
}

const QUICK_LABELS = [
  { key: "s", letter: "Q", name: "Questioning" },
  { key: "p", letter: "U", name: "Uncover Pain" },
  { key: "i", letter: "I", name: "Impact" },
  { key: "c", letter: "C", name: "Close Readiness" },
  { key: "e", letter: "K", name: "Know-How" },
];

function formatQuickLine(spiced) {
  return QUICK_LABELS
    .map(({ key, letter }) => quickPip(key, letter, spiced[key]))
    .join("   ");
}

// ─── BANT Pips ──────────────────────────────────────────────────

function formatBantLine(bant) {
  return ["b", "a", "n", "t"]
    .map((el) => quickPip(el, el.toUpperCase(), bant[el]))
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
  if (allStrong) tags.push("⭐ Perfect QUICK");

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
  const quickLine = formatQuickLine(scorecard.spiced);
  const bantLine = scorecard.bant ? formatBantLine(scorecard.bant) : null;
  const closeLine = scorecard.close ? formatCloseLine(scorecard.close) : null;
  const tags = buildFrameworkTags(scorecard);

  let frameworksText = `*QUICK*\n${quickLine}`;
  if (bantLine) frameworksText += `\n\n*BANT*\n${bantLine}`;
  if (closeLine) frameworksText += `\n\n*Close*\n${closeLine}`;

  const dealUrl = pipedriveDealUrl(meta.pipedriveDealId);
  const dealInfo = meta.pipedriveDealId
    ? `${meta.pipedriveDealStage || "Deal"}${meta.pipedriveDealValue ? ` · $${Number(meta.pipedriveDealValue).toLocaleString()}` : ""}`
    : null;

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

  // Stall risk block goes right after verdict
  const stallRisk = calculateStallRisk(scorecard.spiced);
  const stallBlock = stallRiskBlock(stallRisk);
  if (stallBlock) {
    blocks.splice(3, 0, stallBlock);
  }

  if (tags.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: tags.join("  ·  ") }]
    });
  }

  // Pipedrive deal link
  if (dealUrl) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *Pipedrive:* <${dealUrl}|${meta.pipedriveDealTitle || `Deal #${meta.pipedriveDealId}`}> — ${dealInfo}`
      }
    });
  }

  const url = scorecardUrl(scorecardId, appUrl);
  if (url) {
    if (!dealUrl) blocks.push({ type: "divider" });
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

function buildThreadBlocks(scorecard, meta, scorecardId) {
  const blocks = [];

  // Coaching header — personal and supportive
  const firstName = meta.repName?.split(" ")[0] || "rep";
  const rag = getRAG(scorecard.score);
  let coachingTone;
  if (scorecard.score >= 80) {
    coachingTone = `Excellent call, ${firstName} — this is the bar. Here is what made it work and where you can push even further:`;
  } else if (scorecard.score >= 60) {
    coachingTone = `Solid foundation, ${firstName}. A few adjustments will take this from good to great:`;
  } else {
    coachingTone = `Growth opportunity here, ${firstName}. Honest look at what to tighten up:`;
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*🎯 ${coachingTone}*`
    }
  });

  // Recent trend (if available)
  if (meta.recentAvg != null) {
    const diff = scorecard.score - meta.recentAvg;
    const trendEmoji = diff >= 5 ? "📈" : diff >= -5 ? "➡️" : "📉";
    let trendText;
    if (diff >= 5) {
      trendText = `${diff} pts above your recent average`;
    } else if (diff <= -5) {
      trendText = `${Math.abs(diff)} pts below your recent average`;
    } else {
      trendText = `right around your recent average`;
    }
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `${trendEmoji} ${trendText} (last ${meta.recentCount || 5} calls: ${meta.recentAvg}/100)` }]
    });
  }

  // Pipedrive deal link in thread
  const dealUrl = pipedriveDealUrl(meta.pipedriveDealId);
  if (dealUrl) {
    const dealValueStr = meta.pipedriveDealValue
      ? ` · $${Number(meta.pipedriveDealValue).toLocaleString()}`
      : "";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *Linked Deal:* <${dealUrl}|${meta.pipedriveDealTitle || `Deal #${meta.pipedriveDealId}`}> — ${meta.pipedriveDealStage || "Active"}${dealValueStr}`
      }
    });
  }

  if (scorecard.wins && scorecard.wins.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*✅ What worked*\n${scorecard.wins.map((w) => `• ${w}`).join("\n")}`
      }
    });
  }

  if (scorecard.fixes && scorecard.fixes.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📈 Areas to develop*\n${scorecard.fixes.map((f) => `• ${f}`).join("\n")}`
      }
    });
  }

  if (scorecard.closingTips && scorecard.closingTips.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🎯 Try this next time*\n${scorecard.closingTips.map((t, i) => `${i + 1}. ${t}`).join("\n")}`
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
  const quickLine = formatQuickLine(scorecard.spiced);

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
        { type: "mrkdwn", text: `*QUICK*\n${quickLine}` }
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

    const threadBlocks = buildThreadBlocks(scorecard, meta, scorecardId);
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

// ─── Stall Risk Calculation ──────────────────────────────────
// Based on data analysis: QUICK-I (Impact), QUICK-C (Close Readiness),
// and QUICK-K (Know-How) are the strongest predictors of deal progression.
// Calls weak on all three have HIGH stall risk.

function calculateStallRisk(spiced) {
  if (!spiced) return { level: "LOW", factors: [] };

  const predictive = ["i", "c", "e"];
  const weakFactors = [];

  for (const el of predictive) {
    const status = spiced[el]?.status;
    if (!status || status === "partial" || status === "missing") {
      const names = { i: "Impact Quantified", c: "Close Readiness", e: "Know-How" };
      weakFactors.push(names[el]);
    }
  }

  let level;
  if (weakFactors.length >= 3) level = "HIGH";
  else if (weakFactors.length >= 2) level = "MEDIUM";
  else level = "LOW";

  return { level, factors: weakFactors };
}

function stallRiskEmoji(level) {
  if (level === "HIGH") return "⚠️";
  if (level === "MEDIUM") return "🟡";
  return "✅";
}

function stallRiskBlock(stallRisk) {
  if (!stallRisk || stallRisk.level === "LOW") return null;

  const emoji = stallRiskEmoji(stallRisk.level);
  const text = stallRisk.level === "HIGH"
    ? `${emoji} *Stall Risk: HIGH* — Coach on: quantify impact, establish close readiness, map decision process before next touch`
    : `${emoji} *Stall Risk: MEDIUM* — Strengthen ${stallRisk.factors.join(" and ")} to reduce risk`;

  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }]
  };
}

module.exports = { postDemoReview, postKillerCall, calculateStallRisk, stallRiskBlock };
