import { NextResponse } from "next/server";
import { camaraProvider } from "../../../../../../providers/camara/client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ externalId: string }> },
) {
  try {
    const { externalId } = await params;
    const [proposition, movements] = await Promise.all([
      camaraProvider.getProposition(externalId),
      camaraProvider.getMovements(externalId),
    ]);

    if (!proposition) {
      return NextResponse.json({ ok: false, message: "Não encontrada." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, data: { proposition, movements } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Erro desconhecido" },
      { status: 502 },
    );
  }
}
