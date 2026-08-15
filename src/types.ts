export type Severity = "low" | "medium" | "high" | "critical";

export type Tone = "warm" | "playful" | "firm";

export interface AuditIssue {
  severity: Severity;
  category: string;
  explanation: string;
  howToFix: string;
}

export interface ReplyVariant {
  tone: Tone;
  labelRu: string;
  ru: string;
  en: string;
}

export interface MemberFact {
  field: string;
  value: string;
  confidence: "low" | "medium" | "high";
}

export interface AuditResult {
  score: number;
  stage: string;
  summary: string;
  strengths: string[];
  issues: AuditIssue[];
  missingContext: string[];
  memberFacts: MemberFact[];
  replyVariants: ReplyVariant[];
  safeToSend: boolean;
}

export interface AnalyzeInput {
  text: string;
  images: Buffer[];
  mode?: "audit" | "reply" | "filter";
}

export interface RiskHit {
  category: string;
  severity: Severity;
}
