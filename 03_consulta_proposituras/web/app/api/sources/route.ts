import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    sources: [
      { code: "camara", name: "Câmara dos Deputados", status: "online" },
      { code: "senado", name: "Senado Federal", status: "planned" },
      { code: "alesp", name: "Assembleia Legislativa do Estado de São Paulo", status: "planned" },
    ],
  });
}
