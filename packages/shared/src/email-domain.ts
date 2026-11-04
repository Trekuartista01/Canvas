/** "trekuartista.com, example.com" → ["trekuartista.com", "example.com"]. */
export function parseAllowedEmailDomains(list: string): string[] {
  return list
    .split(",")
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** The whole domain must match: no subdomains, and no look-alikes. */
export function isAllowedEmail(email: string, domains: string[]): boolean {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  return Boolean(local) && domains.includes(domain ?? "");
}

export function allowedEmailMessage(domains: string[]): string {
  return `Canvas is only for ${domains.map((d) => `@${d}`).join(" or ")} email addresses.`;
}
