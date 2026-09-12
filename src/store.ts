import { randomUUID } from "node:crypto";
import type { FeedbackEvent, MailMessage, Opportunity, UserProfile } from "./types.js";

export class Store {
  profiles = new Map<string, UserProfile>();
  messages = new Map<string, MailMessage>();
  opportunities = new Map<string, Opportunity>();
  feedback: FeedbackEvent[] = [];

  upsertProfile(input: Omit<UserProfile, "updatedAt"> & { updatedAt?: string }) {
    const profile = { ...input, updatedAt: input.updatedAt ?? new Date().toISOString() };
    this.profiles.set(profile.userId, profile);
    return profile;
  }
  addMessage(message: MailMessage) { this.messages.set(message.id, message); return message; }
  addOpportunity(input: Omit<Opportunity, "id" | "createdAt" | "updatedAt">) {
    const now = new Date().toISOString();
    const opportunity: Opportunity = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.opportunities.set(opportunity.id, opportunity); return opportunity;
  }
  updateOpportunity(id: string, patch: Partial<Opportunity>) {
    const current = this.opportunities.get(id); if (!current) return undefined;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.opportunities.set(id, next); return next;
  }
}
