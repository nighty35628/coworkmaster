export type OpportunityCategory =
  | "opportunity"
  | "action_required"
  | "academic"
  | "transactional"
  | "newsletter"
  | "low_priority"
  | string;

export interface UserProfile {
  name: string;
  school?: string;
  program?: string;
  year?: string;
  interests?: string[];
  skills?: string[];
  projects?: string | string[];
  links?: string[];
  github?: string;
  portfolio?: string;
  bio?: string;
}

export interface Opportunity {
  id: string;
  title: string;
  sender?: string;
  summary?: string;
  category?: OpportunityCategory;
  priority?: string;
  deadline?: string;
  fitScore?: number;
  fitReasons?: string[];
  action?: string;
  sourceUrl?: string;
  status?: string;
  draft?: Draft;
}

export interface Draft {
  subject?: string;
  body?: string;
  fields?: Record<string, string>;
  version?: string;
}

export interface AgentApi {
  getProfile(userId: string): Promise<UserProfile | null>;
  saveProfile(userId: string, profile: UserProfile): Promise<UserProfile>;
  scan(userId: string): Promise<Opportunity[]>;
  getOpportunity(id: string, userId: string): Promise<Opportunity>;
  prepareForm(id: string, userId: string): Promise<Opportunity>;
  updateDraft?(id: string, userId: string, draft: Draft): Promise<Opportunity>;
  decide(id: string, userId: string, decision: "approve" | "reject"): Promise<Opportunity>;
  submit(id: string, userId: string, version?: string): Promise<Opportunity>;
}

export interface SlackAdapterOptions {
  api: AgentApi;
  signingSecret?: string;
  botToken?: string;
  appToken?: string;
  /** Start without Slack credentials and exercise handlers in tests. */
  mock?: boolean;
  /** API user identity used by the demo; real deployments use Slack user IDs. */
  defaultUserId?: string;
}
