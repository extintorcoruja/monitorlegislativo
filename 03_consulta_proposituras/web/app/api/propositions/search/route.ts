import { NextRequest, NextResponse } from "next/server";
import { camaraProvider } from "../../../../providers/camara/client";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  try {
    const propositions = await camaraProvider.searchPropositions({
      query: params.get("q") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      limit: Math.min(Number(params.get("limit") ?? "15") || 15, 100),
    });

    return NextResponse.json({
      ok: true,
      source: "camara",
      count: propositions.length,
      data: propositions,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        source: "camara",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 502 },
    );
  }
}
