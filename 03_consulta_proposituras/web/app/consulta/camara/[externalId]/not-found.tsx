import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page">
      <section className="content empty-page">
        <span className="eyebrow">CÂMARA</span>
        <h1>Proposição não encontrada</h1>
        <p>Não foi possível localizar esse registro na fonte oficial.</p>
        <Link href="/consulta">Voltar para a consulta</Link>
      </section>
    </main>
  );
}
