import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!secret || authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { ok: false, message: "Supabase keepalive is not configured." },
      { status: 503 },
    );
  }

  try {
    // Read-only, minimal query: verifies the database API can answer.
    // No application records are returned to the caller.
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/propositions?select=official_id&limit=1`,
      {
        method: "GET",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, status: response.status },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, message: "Supabase is unreachable." }, { status: 502 });
  }
}
