import type {
  LegislativeSource,
  MovementDraft,
  PropositionDraft,
} from "./domain";

export interface ProviderSearchParams {
  query?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface LegislativeProvider {
  readonly source: LegislativeSource;

  searchPropositions(params: ProviderSearchParams): Promise<PropositionDraft[]>;

  getProposition(externalId: string): Promise<PropositionDraft | null>;

  getMovements(externalId: string): Promise<MovementDraft[]>;
}
