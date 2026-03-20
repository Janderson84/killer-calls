// ─── Slack Formatter ────────────────────────────────────────────
// Shared Slack formatting for the poller pipeline.
// Port of src/slack-formatter.js to TypeScript.

import { WebClient } from "@slack/web-api";

// ─── RAG Logic (inlined from src/constants.js) ──────────────────

function getRAG(score: number): { label: string; emoji: string } {
  if (score >= 80) return { label: "Green", emoji: "\u{1F7E2}" };
  if (score >= 60) return { label: "Yellow", emoji: "\u{1F7E1}" };
  return { label: "Red", emoji: "\u{1F534}" };
}

// ─── Helpers ────────────────────────────────────────────────────

interface RosterEntry {
  name: string;
  email?: string;
  slackId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Scorecard = any;

interface Meta {
  repName: string;
  companyName: string;
  durationMinutes: number | null;
  date: string;
  callType?: string;
}

export interface TeamConfig {
  channelId?: string;
  killerChannelId?: string;
  appUrl?: string;
  roster?: RosterEntry[];
  slackBotToken?: string;
  killerThreshold?: number;
}

export function slackMention(repName: string, roster?: RosterEntry[]): string {
  if (Array.isArray(roster)) {
    const ae = roster.find((r) => r.name === repName);
    if (ae && ae.slackId) return `<@${ae.slackId}>`;
  }
  return repName;
}

function spicedPip(element: string, data: { status?: string }): string {
  const letter = element.toUpperCase();
  if (data.status === "strong") return `\u2705 ${letter}`;
  if (data.status === "partial") return `\u{1F7E1} ${letter}`;
  return `\u{1F534} ${letter}`;
}

export function formatSpicedLine(spiced: Record<string, { status?: string }>): string {
  return ["s", "p", "i", "c", "e"]
    .map((el) => spicedPip(el, spiced[el]))
    .join("   ");
}

export function formatBantLine(bant: Record<string, { status?: string }>): string {
  return ["b", "a", "n", "t"]
    .map((el) => spicedPip(el, bant[el]))
    .join("   ");
}

export function formatCloseLine(close: Scorecard): string | null {
  if (!close) return null;

  if (close.style === "none") {
    return "No close attempted \u2192 \u{1F534} S   \u{1F534} B   \u{1F534} A";
  }

  const steps = ["setup", "bridge", "ask"] as const;
  const pips = steps
    .map((step) => {
      const data = close[step];
      if (!data) return `\u{1F534} ${step[0].toUpperCase()}`;
      const label = data.label ? data.label.split(" ")[0][0] : step[0].toUpperCase();
      if (data.status === "strong") return `\u2705 ${label}`;
      if (data.status === "partial") return `\u{1F7E1} ${label}`;
      return `\u{1F534} ${label}`;
    })
    .join("   ");

  return `${close.styleName || close.style} \u2192 ${pips}`;
}

export function ragEmoji(rag: string): string {
  if (rag === "green" || rag === "g") return "\u{1F7E2}";
  if (rag === "yellow" || rag === "y") return "\u{1F7E1}";
  return "\u{1F534}";
}

export function buildFrameworkTags(scorecard: Scorecard): string[] {
  const tags: string[] = [];
  const sp = scorecard.spiced;

  const allSpicedStrong = ["s", "p", "i", "c", "e"].every((el) => sp[el].status === "strong");
  if (allSpicedStrong) tags.push("\u2B50 Perfect SPICED");

  const ecir = scorecard.phases?.pricing?.criteria?.ecir;
  if (ecir && ecir.objectionsHandled > 0) {
    tags.push(`\u{1F3AF} ECIR on ${ecir.objectionsHandled} objection${ecir.objectionsHandled > 1 ? "s" : ""}`);
  }

  const close = scorecard.close;
  if (close && close.style !== "none") {
    const allCloseStrong = ["setup", "bridge", "ask"].every((s) => close[s]?.status === "strong");
    if (allCloseStrong) {
      tags.push(`\u{1F3AF} Perfect ${close.styleName || close.style} Close`);
    } else if (close.ask && close.ask.status === "strong") {
      tags.push("\u2705 Closed on call");
    }
  }

  const discountScore = scorecard.phases?.pricing?.criteria?.noDiscount;
  if (discountScore && discountScore.score === 2) tags.push("\u{1F4B0} No discount");

  return tags;
}

export function scorecardUrl(scorecardId: string, appUrl?: string): string | null {
  const base = appUrl || process.env.APP_URL;
  if (!base || !scorecardId) return null;
  return `${base.replace(/\/$/, "")}/calls/${scorecardId}`;
}

// ─── #demo-reviews Message ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildDemoReviewBlocks(scorecard: Scorecard, meta: Meta, scorecardId: string, appUrl?: string, roster?: RosterEntry[]): any[] {
  const rag = getRAG(scorecard.score);
  const spicedLine = formatSpicedLine(scorecard.spiced);
  const bantLine = scorecard.bant ? formatBantLine(scorecard.bant) : null;
  const closeLine = scorecard.close ? formatCloseLine(scorecard.close) : null;
  const tags = buildFrameworkTags(scorecard);

  let frameworksText = `*SPICED*\n${spicedLine}`;
  if (bantLine) frameworksText += `\n\n*BANT*\n${bantLine}`;
  if (closeLine) frameworksText += `\n\n*Close*\n${closeLine}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${rag.emoji} *New Demo Scored | ${slackMention(meta.repName, roster)} \u2192 ${meta.companyName}*${meta.callType === "followup" ? "  \u{1F504} Follow-up" : ""}`
      }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Score*\n${scorecard.score}/100 \u00B7 ${rag.label}` },
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
      elements: [{ type: "mrkdwn", text: tags.join("  \u00B7  ") }]
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
          text: { type: "plain_text", text: "\u{1F4CB} View Full Scorecard" },
          url,
          style: "primary"
        }
      ]
    });
  }

  return blocks;
}

// ─── Thread: Coaching Detail ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildThreadBlocks(scorecard: Scorecard): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [];

  if (scorecard.wins && scorecard.wins.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*\u2705 What landed*\n${scorecard.wins.map((w: string) => `\u2022 ${w}`).join("\n")}`
      }
    });
  }

  if (scorecard.fixes && scorecard.fixes.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*\u{1F527} Priority fixes*\n${scorecard.fixes.map((f: string) => `\u2022 ${f}`).join("\n")}`
      }
    });
  }

  if (scorecard.closingTips && scorecard.closingTips.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*\u{1F3AF} Closing tips*\n${scorecard.closingTips.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}`
      }
    });
  }

  if (scorecard.quoteOfTheCall && scorecard.quoteOfTheCall.text) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*\u{1F4AC} Quote of the call* (\u25B6 ${scorecard.quoteOfTheCall.timestamp})\n> _"${scorecard.quoteOfTheCall.text}"_`
      }
    });
  }

  return blocks;
}

// ─── #killer-calls Message ──────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildKillerCallBlocks(scorecard: Scorecard, meta: Meta, scorecardId: string, appUrl?: string, roster?: RosterEntry[]): any[] {
  const tags = buildFrameworkTags(scorecard);
  const spicedLine = formatSpicedLine(scorecard.spiced);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\u{1F525} *KILLER CALL | ${slackMention(meta.repName, roster)} \u2014 ${scorecard.score}/100*`
      }
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Prospect*\n${meta.companyName}` },
        { type: "mrkdwn", text: `*Duration*\n${meta.durationMinutes || "?"} min \u00B7 ${meta.date}` },
        { type: "mrkdwn", text: `*SPICED*\n${spicedLine}` }
      ]
    }
  ];

  if (tags.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: tags.join("  \u00B7  ") }]
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
          text: { type: "plain_text", text: "\u{1F525} View Full Scorecard" },
          url,
          style: "primary"
        }
      ]
    });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "\u{1F4D6} Study this call \u2014 drop your takeaways in the thread \u{1F447}" }]
  });

  return blocks;
}

// ─── Post to Slack ──────────────────────────────────────────────

export async function postDemoReview(
  scorecard: Scorecard,
  meta: Meta,
  scorecardId: string,
  teamConfig: TeamConfig = {}
): Promise<{ reviewTs: string | null }> {
  const channelId = teamConfig.channelId || process.env.SLACK_CHANNEL_REVIEWS;
  if (!channelId) {
    console.warn("[slack] No reviews channel configured — skipping #demo-reviews post");
    return { reviewTs: null };
  }

  const appUrl = teamConfig.appUrl || process.env.APP_URL;
  const roster = teamConfig.roster || [];
  const slackToken = teamConfig.slackBotToken || process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    console.warn("[slack] No Slack bot token configured — skipping #demo-reviews post");
    return { reviewTs: null };
  }
  const slack = new WebClient(slackToken);
  const rag = getRAG(scorecard.score);
  const blocks = buildDemoReviewBlocks(scorecard, meta, scorecardId, appUrl, roster);

  console.log(`[slack] Posting to #demo-reviews (score: ${scorecard.score}, ${rag.label})...`);

  try {
    const result = await slack.chat.postMessage({
      channel: channelId,
      text: `${rag.emoji} New Demo Scored | ${slackMention(meta.repName, roster)} \u2192 ${meta.companyName} \u2014 ${scorecard.score}/100`,
      blocks,
      unfurl_links: false
    });
    console.log(`[slack] Posted to #demo-reviews: ${result.ts}`);

    const threadBlocks = buildThreadBlocks(scorecard);
    if (threadBlocks.length > 0 && result.ts) {
      await slack.chat.postMessage({
        channel: channelId,
        thread_ts: result.ts,
        text: "Coaching detail",
        blocks: threadBlocks,
        unfurl_links: false
      });
      console.log(`[slack] Posted coaching thread under ${result.ts}`);
    }

    return { reviewTs: result.ts || null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[slack] Failed to post to #demo-reviews: ${msg}`);
    return { reviewTs: null };
  }
}

export async function postKillerCall(
  scorecard: Scorecard,
  meta: Meta,
  scorecardId: string,
  teamConfig: TeamConfig = {}
): Promise<{ killerTs: string | null }> {
  const threshold = teamConfig.killerThreshold || 80;
  if (scorecard.score < threshold) return { killerTs: null };

  const channelId = teamConfig.killerChannelId || process.env.SLACK_CHANNEL_KILLER;
  if (!channelId) {
    console.warn("[slack] No killer channel configured — skipping #killer-calls post");
    return { killerTs: null };
  }

  const appUrl = teamConfig.appUrl || process.env.APP_URL;
  const roster = teamConfig.roster || [];
  const slackToken = teamConfig.slackBotToken || process.env.SLACK_BOT_TOKEN;
  if (!slackToken) {
    console.warn("[slack] No Slack bot token configured — skipping #killer-calls post");
    return { killerTs: null };
  }
  const slack = new WebClient(slackToken);
  const blocks = buildKillerCallBlocks(scorecard, meta, scorecardId, appUrl, roster);

  console.log(`[slack] Posting to #killer-calls (score: ${scorecard.score}, threshold: ${threshold})...`);

  try {
    const result = await slack.chat.postMessage({
      channel: channelId,
      text: `\u{1F525} KILLER CALL | ${slackMention(meta.repName, roster)} \u2014 ${scorecard.score}/100`,
      blocks,
      unfurl_links: false
    });
    console.log(`[slack] Posted to #killer-calls: ${result.ts}`);
    return { killerTs: result.ts || null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[slack] Failed to post to #killer-calls: ${msg}`);
    return { killerTs: null };
  }
}
