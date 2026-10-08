"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type Proposition = {
  externalId: string;
  externalKey: string;
  type?: string;
  number?: number;
  year?: number;
  title: string;
  summary?: string;
  status?: string;
  currentRegime?: string;
  currentOrgan?: string;
  officialUrl?: string;
};

export default function ConsultaPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Proposition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/propositions/search?q=${encodeURIComponent(query)}&limit=20`,
      );
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message ?? "Não foi possível consultar a Câmara.");
      }

      setResults(payload.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="topbar">
        <Link href="/" className="brand">Monitor Legislativo</Link>
        <span className="source-badge">Câmara dos Deputados</span>
      </header>

      <section className="content">
        <div className="section-heading">
          <span className="eyebrow">CONSULTA</span>
          <h1>Pesquisar proposições</h1>
          <p>
            A busca abaixo consulta a fonte oficial da Câmara em tempo real.
          </p>
        </div>

        <form className="search-form" onSubmit={submit}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex.: bombeiros, extintor, segurança contra incêndio..."
            aria-label="Termo de busca"
          />
          <button type="submit" disabled={loading}>
            {loading ? "Consultando..." : "Pesquisar"}
          </button>
        </form>

        {error && <div className="error">{error}</div>}

        <div className="results">
          {results.map((item) => (
            <article className="result-card" key={item.externalId}>
              <div className="result-meta">
                <span>{item.type ?? "Proposição"}</span>
                {item.number && item.year ? <span>{item.number}/{item.year}</span> : null}
              </div>
              <h2>{item.title}</h2>
              {item.status && <p><strong>Situação:</strong> {item.status}</p>}
              {item.currentRegime && <p><strong>Regime:</strong> {item.currentRegime}</p>}
              {item.currentOrgan && <p><strong>Órgão:</strong> {item.currentOrgan}</p>}
              <div className="result-actions">
                <Link href={`/consulta/camara/${item.externalId}`}>Ver detalhes</Link>
                {item.officialUrl && (
                  <a href={item.officialUrl} target="_blank" rel="noreferrer">
                    Fonte oficial
                  </a>
                )}
              </div>
            </article>
          ))}

          {!loading && !error && results.length === 0 && (
            <div className="empty">
              Faça uma pesquisa para carregar proposições diretamente da Câmara.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
