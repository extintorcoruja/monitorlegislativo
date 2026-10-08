import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase
      .from("sources")
      .select("code")
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          service: "monitor-legislativo",
          database: "error",
          message: error.message,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      service: "monitor-legislativo",
      database: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "monitor-legislativo",
        database: "not_configured",
        message: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 503 },
    );
  }
}
