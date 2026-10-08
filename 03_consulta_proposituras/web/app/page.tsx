import Link from "next/link";

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">MONITOR LEGISLATIVO 2.0</span>
        <h1>Acompanhe o que muda no Legislativo.</h1>
        <p>
          Uma nova base para consultar proposições, tramitações, regimes e
          alterações de forma rastreável e independente da origem dos dados.
        </p>
        <div className="actions">
          <Link className="primary" href="/api/health">
            Verificar API
          </Link>
          <a className="secondary" href="https://github.com/extintorcoruja/monitorlegislativo">
            Código-fonte
          </a>
        </div>
      </section>
    </main>
  );
}
