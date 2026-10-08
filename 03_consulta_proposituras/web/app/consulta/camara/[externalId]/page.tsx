import Link from "next/link";
import { notFound } from "next/navigation";
import { camaraProvider } from "../../../../../providers/camara/client";

type Props = {
  params: Promise<{ externalId: string }>;
};

export default async function PropositionDetailPage({ params }: Props) {
  const { externalId } = await params;

  try {
    const [proposition, movements] = await Promise.all([
      camaraProvider.getProposition(externalId),
      camaraProvider.getMovements(externalId),
    ]);

    if (!proposition) {
      notFound();
    }

    return (
      <main className="page">
        <header className="topbar">
          <Link href="/consulta" className="brand">← Monitor Legislativo</Link>
          <span className="source-badge">Câmara dos Deputados</span>
        </header>

        <section className="content detail">
          <span className="eyebrow">{proposition.type ?? "PROPOSIÇÃO"}</span>
          <h1>{proposition.title}</h1>

          <div className="detail-grid">
            <div><strong>Identificador</strong><span>{proposition.externalId}</span></div>
            <div><strong>Situação</strong><span>{proposition.status ?? "—"}</span></div>
            <div><strong>Regime</strong><span>{proposition.currentRegime ?? "—"}</span></div>
            <div><strong>Órgão atual</strong><span>{proposition.currentOrgan ?? "—"}</span></div>
          </div>

          {proposition.officialUrl && (
            <a
              className="official-link"
              href={proposition.officialUrl}
              target="_blank"
              rel="noreferrer"
            >
              Abrir registro oficial →
            </a>
          )}

          <section className="timeline">
            <h2>Tramitações</h2>
            {movements.length === 0 ? (
              <p>Nenhuma tramitação retornada pela fonte.</p>
            ) : (
              movements.map((movement) => (
                <article className="movement" key={movement.fingerprint}>
                  <time>{new Date(movement.eventAt).toLocaleString("pt-BR")}</time>
                  <strong>{movement.eventType ?? "Tramitação"}</strong>
                  <p>{movement.description ?? "Sem descrição."}</p>
                  {movement.organ && <small>{movement.organ}</small>}
                </article>
              ))
            )}
          </section>
        </section>
      </main>
    );
  } catch {
    notFound();
  }
}
