export type Category = "opportunity" | "action_required" | "informational" | "noise";
export type OpportunityStatus = "DISCOVERED" | "CLASSIFIED" | "QUALIFIED" | "FORM_PREPARED" | "WAITING_APPROVAL" | "SENT" | "SUBMITTED" | "REJECTED" | "STALE";

export interface UserProfile {
  userId: string;
  name: string;
  school?: string;
  program?: string;
  interests: string[];
  skills: string[];
  projects: string[];
  links: string[];
  bio?: string;
  updatedAt: string;
}

export interface MailMessage {
  id: string;
  accountId: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  receivedAt: string;
  unread: boolean;
  url?: string;
}

export interface Opportunity {
  id: string;
  messageId: string;
  category: Category;
  priority: "high" | "medium" | "low";
  title: string;
  sender?: string;
  summary?: string;
  fitReasons?: string[];
  action?: string;
  sourceUrl?: string;
  deadline?: string;
  fitScore: number;
  evidence: string[];
  nextAction: string;
  status: OpportunityStatus;
  draft?: string;
  form?: { url: string; fields: Record<string, string>; preparedAt: string };
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackEvent { id: string; opportunityId?: string; userId: string; kind: string; comment?: string; createdAt: string; }
