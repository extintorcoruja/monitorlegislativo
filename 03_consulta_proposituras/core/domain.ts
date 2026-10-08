export type LegislativeSource = "camara" | "senado" | "alesp";

export interface PropositionRef {
  source: LegislativeSource;
  externalId: string;
  externalKey: string;
  type?: string;
  number?: number;
  year?: number;
}

export interface PropositionDraft extends PropositionRef {
  title: string;
  summary?: string;
  author?: string;
  status?: string;
  currentRegime?: string;
  currentOrgan?: string;
  officialUrl?: string;
}

export interface MovementDraft {
  externalEventId?: string;
  eventAt: string;
  eventType?: string;
  description?: string;
  organ?: string;
  status?: string;
  regime?: string;
  sourceUrl?: string;
  fingerprint: string;
}
