import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { WebClient } from "@slack/web-api";

const AE_SLACK_IDS: Record<string, string> = {
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

export const maxDuration = 30;

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { meetingId, repName, companyName, date, durationMinutes, title, scorecard, call_type, prospect_email } = body;

  if (!meetingId || !scorecard || typeof scorecard.score !== "number") {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Ensure close object always exists — external scorers (OpenClaw) may omit it
  if (!scorecard.close) {
    scorecard.close = {
      style: "none",
      styleName: "No Close Detected",
      setup: { score: 0, status: "missing", label: "No setup detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      bridge: { score: 0, status: "missing", label: "No bridge detected", feedback: "No close execution was detected in this call.", timestamps: [] },
      ask: { score: 0, status: "missing", label: "No ask detected", feedback: "No close execution was detected in this call.", timestamps: [] },
    };
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Resolve team — use first team as default for save-score API
    const teamRows = await sql`SELECT id FROM teams LIMIT 1`;
    const teamId = body.teamId || (teamRows.length > 0 ? teamRows[0].id : null);
    if (!teamId) {
      return NextResponse.json({ error: "No team found" }, { status: 400 });
    }

    // Find or create rep
    const repRows = await sql`SELECT id FROM reps WHERE name = ${repName} AND team_id = ${teamId} LIMIT 1`;
    let repId: string;
    if (repRows.length > 0) {
      repId = repRows[0].id;
    } else {
      const newRep = await sql`INSERT INTO reps (name, team_id) VALUES (${repName}, ${teamId}) RETURNING id`;
      repId = newRep[0].id;
    }

    // Save scorecard
    const inserted = await sql`
      INSERT INTO scorecards (
        rep_id, meeting_id, title, company_name, rep_name,
        call_date, duration_minutes,
        score, rag, verdict,
        score_pre_call, score_discovery, score_presentation, score_pricing, score_closing,
        spiced_s, spiced_p, spiced_i, spiced_c, spiced_e,
        bant_b, bant_a, bant_n, bant_t,
        close_style, close_setup, close_bridge, close_ask,
        call_type, prospect_email,
        scorecard_json, team_id
      ) VALUES (
        ${repId}, ${meetingId}, ${title || `${repName} → ${companyName}`}, ${companyName}, ${repName},
        ${date}, ${durationMinutes},
        ${scorecard.score}, ${scorecard.rag}, ${scorecard.verdict},
        ${scorecard.phases?.preCall?.score || null},
        ${scorecard.phases?.discovery?.score || null},
        ${scorecard.phases?.presentation?.score || null},
        ${scorecard.phases?.pricing?.score || null},
        ${scorecard.phases?.closing?.score || null},
        ${scorecard.spiced?.s?.status || null},
        ${scorecard.spiced?.p?.status || null},
        ${scorecard.spiced?.i?.status || null},
        ${scorecard.spiced?.c?.status || null},
        ${scorecard.spiced?.e?.status || null},
        ${scorecard.bant?.b?.status || null},
        ${scorecard.bant?.a?.status || null},
        ${scorecard.bant?.n?.status || null},
        ${scorecard.bant?.t?.status || null},
        ${scorecard.close?.style || null},
        ${scorecard.close?.setup?.status || null},
        ${scorecard.close?.bridge?.status || null},
        ${scorecard.close?.ask?.status || null},
        ${call_type || "discovery"}, ${prospect_email || null},
        ${JSON.stringify(scorecard)}, ${teamId}
      )
      ON CONFLICT (meeting_id) DO UPDATE SET
        score = EXCLUDED.score, rag = EXCLUDED.rag, verdict = EXCLUDED.verdict,
        scorecard_json = EXCLUDED.scorecard_json,
        bant_b = EXCLUDED.bant_b, bant_a = EXCLUDED.bant_a,
        bant_n = EXCLUDED.bant_n, bant_t = EXCLUDED.bant_t,
        close_style = EXCLUDED.close_style, close_setup = EXCLUDED.close_setup,
        close_bridge = EXCLUDED.close_bridge, close_ask = EXCLUDED.close_ask,
        call_type = EXCLUDED.call_type, prospect_email = EXCLUDED.prospect_email,
        team_id = EXCLUDED.team_id
      RETURNING id`;

    const scorecardId = inserted[0].id;

    // Post to Slack
    const slackToken = process.env.SLACK_BOT_TOKEN;
    const channelId = process.env.SLACK_CHANNEL_REVIEWS;
    if (slackToken && channelId) {
      try {
        const slack = new WebClient(slackToken);
        const mention = AE_SLACK_IDS[repName] ? `<@${AE_SLACK_IDS[repName]}>` : repName;
        const ragEmoji = scorecard.rag === "green" ? "🟢" : scorecard.rag === "yellow" ? "🟡" : "🔴";
        const ragLabel = scorecard.score >= 80 ? "Green" : scorecard.score >= 60 ? "Yellow" : "Red";

        const spicedLine = ["s", "p", "i", "c", "e"]
          .map((el) => {
            const d = scorecard.spiced?.[el];
            const pip = d?.status === "strong" ? "✅" : d?.status === "partial" ? "🟡" : "🔴";
            return `${pip} ${el.toUpperCase()}`;
          })
          .join("   ");

        const bantLine = ["b", "a", "n", "t"]
          .map((el) => {
            const d = scorecard.bant?.[el];
            const pip = d?.status === "strong" ? "✅" : d?.status === "partial" ? "🟡" : "🔴";
            return `${pip} ${el.toUpperCase()}`;
          })
          .join("   ");

        const closeStyle = scorecard.close?.styleName || "No close";
        const closeLine = ["setup", "bridge", "ask"]
          .map((key) => {
            const d = scorecard.close?.[key];
            const pip = d?.status === "strong" ? "✅" : d?.status === "partial" ? "🟡" : "🔴";
            const label = d?.label || key.charAt(0).toUpperCase() + key.slice(1);
            return `${pip} ${label}`;
          })
          .join("\n");

        const url = process.env.APP_URL
          ? `${process.env.APP_URL.replace(/\/$/, "")}/calls/${scorecardId}`
          : null;

        // --- Main message: score summary only ---
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mainBlocks: any[] = [
          { type: "section", text: { type: "mrkdwn", text: `${ragEmoji} *New Demo Scored | ${mention} → ${companyName}*` } },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Date*\n${date}` },
              { type: "mrkdwn", text: `*BANT*\n${bantLine}` },
              { type: "mrkdwn", text: `*Duration*\n${durationMinutes || "?"} min` },
              { type: "mrkdwn", text: `*SPICED*\n${spicedLine}` },
              { type: "mrkdwn", text: `*Score*\n${scorecard.score}/100 · ${ragLabel}` },
              { type: "mrkdwn", text: `*Close · ${closeStyle}*\n${closeLine}` },
            ],
          },
          { type: "section", text: { type: "mrkdwn", text: `> _${scorecard.verdict}_` } },
        ];

        if (url) {
          mainBlocks.push({ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "📋 View Full Scorecard" }, url, style: "primary" }] });
        }

        const result = await slack.chat.postMessage({
          channel: channelId,
          text: `${ragEmoji} New Demo Scored | ${mention} → ${companyName} — ${scorecard.score}/100`,
          blocks: mainBlocks,
          unfurl_links: false,
        });

        if (result.ts) {
          await sql`UPDATE scorecards SET slack_review_ts = ${result.ts} WHERE id = ${scorecardId}`;

          // --- Post to #killer-calls if score >= 80 ---
          const killerChannelId = process.env.SLACK_CHANNEL_KILLER;
          if (killerChannelId && scorecard.score >= 80) {
            try {
              const killerBlocks: any[] = [
                { type: "section", text: { type: "mrkdwn", text: `🔥 *KILLER CALL | ${mention} — ${scorecard.score}/100*` } },
                {
                  type: "section",
                  fields: [
                    { type: "mrkdwn", text: `*Prospect*\n${companyName}` },
                    { type: "mrkdwn", text: `*Duration*\n${durationMinutes || "?"} min · ${date}` },
                    { type: "mrkdwn", text: `*SPICED*\n${spicedLine}` },
                  ],
                },
                { type: "section", text: { type: "mrkdwn", text: `> _${scorecard.verdict}_` } },
              ];
              if (url) {
                killerBlocks.push({
                  type: "actions",
                  elements: [{ type: "button", text: { type: "plain_text", text: "🔥 View Full Scorecard" }, url, style: "primary" }],
                });
              }
              killerBlocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "📖 Study this call — drop your takeaways in the thread 👇" }] });

              const killerResult = await slack.chat.postMessage({
                channel: killerChannelId,
                text: `🔥 KILLER CALL | ${mention} — ${scorecard.score}/100`,
                blocks: killerBlocks,
                unfurl_links: false,
              });
              if (killerResult.ts) {
                await sql`UPDATE scorecards SET slack_killer_ts = ${killerResult.ts} WHERE id = ${scorecardId}`;
              }
            } catch (killerErr: unknown) {
              const msg = killerErr instanceof Error ? killerErr.message : String(killerErr);
              console.error("Killer calls Slack error:", msg);
            }
          }

          // --- Thread reply: detailed coaching ---
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const threadBlocks: any[] = [];

          if (scorecard.wins?.length > 0) {
            threadBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*✅ What landed*\n${scorecard.wins.map((w: string) => `• ${w}`).join("\n")}` } });
          }
          if (scorecard.fixes?.length > 0) {
            threadBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*🔧 Priority fixes*\n${scorecard.fixes.map((f: string) => `• ${f}`).join("\n")}` } });
          }
          if (scorecard.closingTips?.length > 0) {
            threadBlocks.push({ type: "divider" });
            threadBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*🎯 Closing tips*\n${scorecard.closingTips.map((t: string, i: number) => `${i + 1}. ${t}`).join("\n")}` } });
          }
          if (scorecard.quoteOfTheCall?.text) {
            threadBlocks.push({ type: "divider" });
            threadBlocks.push({ type: "section", text: { type: "mrkdwn", text: `*💬 Quote of the call* (▶ ${scorecard.quoteOfTheCall.timestamp})\n> _"${scorecard.quoteOfTheCall.text}"_` } });
          }

          if (threadBlocks.length > 0) {
            await slack.chat.postMessage({
              channel: channelId,
              thread_ts: result.ts,
              text: "Detailed coaching notes",
              blocks: threadBlocks,
              unfurl_links: false,
            });
          }
        }
      } catch (slackErr: unknown) {
        const msg = slackErr instanceof Error ? slackErr.message : String(slackErr);
        console.error("Slack error:", msg);
      }
    }

    return NextResponse.json({ status: "ok", scorecardId, score: scorecard.score, rag: scorecard.rag });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ status: "error", error: msg }, { status: 500 });
  }
}
