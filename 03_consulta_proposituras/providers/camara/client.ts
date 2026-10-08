import type {
  PropositionDraft,
  MovementDraft,
} from "../../core/domain";
import type {
  LegislativeProvider,
  ProviderSearchParams,
} from "../../core/provider";

const BASE_URL = "https://dadosabertos.camara.leg.br/api/v2";

interface CamaraPage<T> {
  dados: T[];
  links?: Array<{ rel: string; href: string }>;
}

interface CamaraProposition {
  id: number;
  siglaTipo?: string;
  numero?: number;
  ano?: number;
  ementa?: string;
  uri?: string;
  statusProposicao?: {
    descricaoSituacao?: string;
    descricaoTramitacao?: string;
    regime?: string;
    descricaoRegime?: string;
    descricaoUltimoDespacho?: string;
    dataHora?: string;
    siglaOrgao?: string;
  };
  urlInteiroTeor?: string;
}

interface CamaraMovement {
  id?: number;
  dataHora?: string;
  sequencia?: number;
  siglaOrgao?: string;
  siglaOrgaoDestino?: string;
  descricaoTipoTramitacao?: string;
  descricaoTramitacao?: string;
  regime?: string;
  texto?: string;
  url?: string;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Câmara API ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

function propositionFromApi(item: CamaraProposition): PropositionDraft {
  const type = item.siglaTipo ?? "desconhecido";
  const number = item.numero;
  const year = item.ano;

  return {
    source: "camara",
    externalId: String(item.id),
    externalKey: `${type}-${number ?? "sem-numero"}-${year ?? "sem-ano"}`,
    type,
    number,
    year,
    title: item.ementa?.trim() || `${type} ${number ?? ""}/${year ?? ""}`.trim(),
    summary: item.ementa?.trim(),
    status: item.statusProposicao?.descricaoSituacao,
    currentRegime:
      item.statusProposicao?.descricaoRegime ??
      item.statusProposicao?.regime,
    currentOrgan: item.statusProposicao?.siglaOrgao,
    officialUrl: item.uri ?? item.urlInteiroTeor,
  };
}

export const camaraProvider: LegislativeProvider = {
  source: "camara",

  async searchPropositions(params: ProviderSearchParams) {
    const search = new URLSearchParams();

    if (params.query) search.set("ementa", params.query);
    if (params.from) search.set("dataInicio", params.from);
    if (params.to) search.set("dataFim", params.to);
    search.set("itens", String(Math.min(params.limit ?? 15, 100)));

    const data = await getJson<CamaraPage<CamaraProposition>>(
      `${BASE_URL}/proposicoes?${search.toString()}`,
    );

    return data.dados.map(propositionFromApi);
  },

  async getProposition(externalId: string) {
    const data = await getJson<CamaraProposition>(
      `${BASE_URL}/proposicoes/${encodeURIComponent(externalId)}`,
    );
    return propositionFromApi(data);
  },

  async getMovements(externalId: string) {
    const data = await getJson<CamaraPage<CamaraMovement>>(
      `${BASE_URL}/proposicoes/${encodeURIComponent(externalId)}/tramitacoes`,
    );

    return data.dados.map((item, index): MovementDraft => {
      const eventAt =
        item.dataHora ?? new Date(0).toISOString();

      return {
        externalEventId:
          item.id != null
            ? String(item.id)
            : `${externalId}:${item.sequencia ?? index}`,
        eventAt,
        eventType: item.descricaoTipoTramitacao,
        description: item.descricaoTramitacao ?? item.texto,
        organ: item.siglaOrgao ?? item.siglaOrgaoDestino,
        regime: item.regime,
        sourceUrl: item.url,
        fingerprint: [
          externalId,
          eventAt,
          item.sequencia ?? index,
          item.descricaoTipoTramitacao ?? "",
          item.descricaoTramitacao ?? "",
        ].join("|"),
      };
    });
  },
};
