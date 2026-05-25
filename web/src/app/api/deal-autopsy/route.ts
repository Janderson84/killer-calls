import { NextRequest, NextResponse } from "next/server";

const RAILWAY_API = process.env.RAILWAY_API_URL || "https://killer-calls-api-production.up.railway.app";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dealId = searchParams.get("dealId");
  const rep = searchParams.get("rep");
  const days = searchParams.get("days") || "30";

  if (!dealId && !rep) {
    return NextResponse.json(
      { error: "Provide ?dealId=X or ?rep=NAME" },
      { status: 400 }
    );
  }

  const params = new URLSearchParams();
  if (dealId) params.set("dealId", dealId);
  if (rep) params.set("rep", rep);
  params.set("days", days);

  try {
    const resp = await fetch(`${RAILWAY_API}/api/deal-autopsy?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET || ""}`,
      },
    });
    const data = await resp.json();

    if (!resp.ok) {
      return NextResponse.json(data, { status: resp.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Autopsy engine unreachable: ${err.message}` },
      { status: 502 }
    );
  }
}
