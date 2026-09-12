import type { AgentApi, Draft, Opportunity, UserProfile } from "./types.js";

/** HTTP adapter for the backend contract. Slack handlers stay independent of storage and mail protocols. */
export class HttpAgentApi implements AgentApi {
  constructor(private readonly baseUrl: string, private readonly fetcher: typeof fetch = fetch) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers || {}) },
    });
    if (!response.ok) throw new Error(`Agent API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async getProfile(userId: string) {
    try {
      const profile = await this.request<any>(`/v1/profile?userId=${encodeURIComponent(userId)}`);
      const links: string[] = profile.links || [];
      return {
        ...profile,
        projects: Array.isArray(profile.projects) ? profile.projects.join("; ") : profile.projects,
        links,
        github: profile.github || links.find((link) => /github\.com/i.test(link)),
        portfolio: profile.portfolio || links.find((link) => !/github\.com/i.test(link)),
      } as UserProfile;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Agent API 404")) return null;
      throw error;
    }
  }
  saveProfile(userId: string, profile: UserProfile) {
    const projects = typeof profile.projects === "string" ? profile.projects.split(/\n|;/).map((x) => x.trim()).filter(Boolean) : (profile.projects || []);
    const links = profile.links || [profile.github, profile.portfolio].filter(Boolean) as string[];
    return this.request<UserProfile>("/v1/profile", { method: "POST", body: JSON.stringify({ userId, ...profile, projects, links }) });
  }
  async scan(userId: string) {
    const response = await this.request<any>("/v1/scan", { method: "POST", body: JSON.stringify({ userId }) });
    return (response.opportunities || response).map((item: any) => this.normalise(item));
  }
  async getOpportunity(id: string, userId: string) { return this.normalise(await this.request<any>(`/v1/opportunities/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`)); }
  async prepareForm(id: string, userId: string) {
    return this.normalise(await this.request<any>(`/v1/opportunities/${encodeURIComponent(id)}/prepare-form`, { method: "POST", body: JSON.stringify({ userId }) }));
  }
  async updateDraft(id: string, userId: string, draft: Draft) {
    return this.normalise(await this.request<any>(`/v1/opportunities/${encodeURIComponent(id)}/draft`, { method: "PATCH", body: JSON.stringify({ userId, draft: draft.body, fields: draft.fields }) }));
  }
  async decide(id: string, userId: string, decision: "approve" | "reject") {
    return this.normalise(await this.request<any>(`/v1/opportunities/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ userId, decision }) }));
  }
  async submit(id: string, userId: string, version?: string) {
    return this.normalise(await this.request<any>(`/v1/opportunities/${encodeURIComponent(id)}/submit`, { method: "POST", body: JSON.stringify({ userId, version }) }));
  }
  private normalise(item: any): Opportunity {
    return {
      ...item,
      sender: item.sender || item.from,
      sourceUrl: item.sourceUrl || item.form?.url,
      fitReasons: item.fitReasons || item.evidence,
      action: item.action || item.nextAction,
      draft: typeof item.draft === "string" ? { body: item.draft } : item.draft || (item.form ? { fields: item.form.fields } : undefined),
    };
  }
}

/** Deterministic fixture for local Slack UI development without credentials or a running backend. */
export class MockAgentApi implements AgentApi {
  private profile: UserProfile | null = null;
  private readonly opportunities = new Map<string, Opportunity>([["demo-1", {
    id: "demo-1", title: "HKUST AI Hackathon", sender: "organizer@hkust.example",
    summary: "报名截止今晚 23:59。Agent 已读取报名要求并准备答案。", category: "opportunity", priority: "high",
    deadline: "今晚 23:59", fitScore: 0.94, fitReasons: ["与你的 AI 兴趣匹配", "日程没有冲突"], action: "complete_registration", status: "QUALIFIED",
  }]]);
  async getProfile() { return this.profile; }
  async saveProfile(_userId: string, profile: UserProfile) { this.profile = profile; return profile; }
  async scan() { return [...this.opportunities.values()]; }
  async getOpportunity(id: string) { const value = this.opportunities.get(id); if (!value) throw new Error("Opportunity not found"); return value; }
  async prepareForm(id: string) {
    const value = await this.getOpportunity(id);
    value.draft = { fields: { 姓名: this.profile?.name || "待填写", 学校: this.profile?.school || "待填写", 参加动机: "希望在实践中探索 AI Agent。" }, version: `demo-${Date.now()}` };
    value.status = "FORM_PREPARED";
    return value;
  }
  async updateDraft(id: string, _userId: string, draft: Draft) {
    const value = await this.getOpportunity(id);
    value.draft = draft;
    return value;
  }
  async decide(id: string, _userId: string, decision: "approve" | "reject") { const value = await this.getOpportunity(id); value.status = decision === "approve" ? "WAITING_APPROVAL" : "REJECTED"; return value; }
  async submit(id: string) { const value = await this.getOpportunity(id); value.status = "SUBMITTED"; return value; }
}
