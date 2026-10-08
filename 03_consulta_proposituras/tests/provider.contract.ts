import type { LegislativeProvider } from "../core/provider";

export async function assertProviderContract(
  provider: LegislativeProvider,
): Promise<void> {
  if (!provider.source) {
    throw new Error("Provider sem source.");
  }

  const results = await provider.searchPropositions({ limit: 1 });

  if (!Array.isArray(results)) {
    throw new Error("searchPropositions deve retornar um array.");
  }

  for (const proposition of results) {
    if (
      proposition.source !== provider.source ||
      !proposition.externalId ||
      !proposition.externalKey ||
      !proposition.title
    ) {
      throw new Error("Provider retornou proposição fora do contrato.");
    }
  }
}
