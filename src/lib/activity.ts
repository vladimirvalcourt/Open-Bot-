// Provider runtimes expose low-level tool names such as `js`, shell commands,
// and MCP method names. Those belong in the Work audit trail, not customer chat.
// The only activity message currently written for conversation semantics is a
// bot-to-bot handoff, which reads as normal product language.
export function isCustomerVisibleActivity(name?: string): boolean {
  return Boolean(name && /^asked @[^:]+:/i.test(name));
}
