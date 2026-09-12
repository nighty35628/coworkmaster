import { randomUUID } from "node:crypto";

export type DemoStage = "SIGNIN" | "PROFILE" | "PROFILE_FILLED" | "SUCCESS";

export interface DemoProfile {
  firstName: string;
  lastName: string;
  companyName: string;
  jobTitle: string;
  biography: string;
  currentProjects: string;
  skills: string;
  startupDescription?: string;
  areasOfInterest: string;
  employment: string[];
  helpWith: string[];
  lookingFor: string[];
  introPreference: string;
  contactPreference: string;
  role: string;
  dietaryRestrictions?: string;
}

export interface DemoSession {
  id: string;
  email: string;
  stage: DemoStage;
  profile?: DemoProfile;
  registrationId?: string;
  updatedAt: string;
}

const requiredFields: Array<keyof DemoProfile> = [
  "firstName", "lastName", "companyName", "jobTitle", "biography",
  "currentProjects", "skills", "areasOfInterest", "introPreference",
  "contactPreference", "role",
];

export class DemoStore {
  sessions = new Map<string, DemoSession>();

  create(email = "demo@example.com") {
    const session: DemoSession = { id: randomUUID(), email, stage: "SIGNIN", updatedAt: new Date().toISOString() };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string) { return this.sessions.get(id); }

  login(id: string, email: string) {
    const session = this.require(id);
    session.email = email;
    session.stage = "PROFILE";
    return this.touch(session);
  }

  fillProfile(id: string, input: Partial<DemoProfile>) {
    const session = this.require(id);
    const profile = { ...(session.profile ?? {}), ...input } as DemoProfile;
    const missing = requiredFields.filter((field) => !String(profile[field] ?? "").trim());
    if (missing.length) return { session: this.touch(session), missing };
    session.profile = profile;
    session.stage = "PROFILE_FILLED";
    return { session: this.touch(session), missing: [] as string[] };
  }

  submit(id: string) {
    const session = this.require(id);
    if (!session.profile) return { session: this.touch(session), error: "profile_required" as const };
    session.stage = "SUCCESS";
    session.registrationId ??= `HK-DEMO-${session.id.slice(0, 6).toUpperCase()}`;
    return { session: this.touch(session) };
  }

  private require(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw new Error("demo_session_not_found");
    return session;
  }

  private touch(session: DemoSession) {
    session.updatedAt = new Date().toISOString();
    this.sessions.set(session.id, session);
    return session;
  }
}
