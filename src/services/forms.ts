export interface FormAdapter {
  inspect(url: string): Promise<{ url: string; fields: string[] }>;
  prepare(url: string, values: Record<string, string>): Promise<{ url: string; fields: Record<string, string> }>;
  submit(url: string, values: Record<string, string>): Promise<{ confirmation: string }>;
}

/** Contract used by the Agent; replace with a Playwright adapter for a real form. */
export class MockFormAdapter implements FormAdapter {
  async inspect(url: string) { return { url, fields: ["name", "school", "program", "bio", "projects"] }; }
  async prepare(url: string, values: Record<string, string>) { return { url, fields: values }; }
  async submit(_url: string, _values: Record<string, string>) { return { confirmation: `demo-${Date.now()}` }; }
}
