import { NextResponse } from "next/server";

const functionUrl =
  process.env.SUPABASE_FUNCTION_URL ??
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monitor-rpc`;

export async function POST(request: Request) {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { ok: false, message: "Supabase não configurado." },
        { status: 503 },
      );
    }

    const body = await request.text();

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });

    const payload = await response.json();

    return NextResponse.json(payload, {
      status: response.ok ? 200 : response.status,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Erro no backend.",
      },
      { status: 502 },
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
    },
  });
}
