export interface PromptEnhancementContext {
  botName: string;
  botTitle?: string;
  botDescription?: string;
  projectName?: string;
  projectDescription?: string;
}

export function promptEnhancementInstruction(input: string, context: PromptEnhancementContext) {
  const role = [context.botTitle, context.botDescription].filter(Boolean).join(" — ");
  const project = [context.projectName, context.projectDescription].filter(Boolean).join(" — ");
  return [
    "Rewrite the rough user prompt below into a strong, execution-ready prompt for an AI agent.",
    "Preserve the user's intent and language. Correct spelling and ambiguity that can be resolved safely.",
    "Add only useful structure: objective, relevant context, scope, expected deliverable, constraints, and how the result should be verified.",
    "Do not invent facts, requirements, people, credentials, deadlines, URLs, metrics, or preferences the user did not provide.",
    "When a material decision is unknown, instruct the agent to ask one focused question or state a reasonable assumption instead of fabricating it.",
    "For research, require credible current sources, citations near claims, dates, competing evidence, and a distinction between fact and inference.",
    "For implementation, require inspection of the existing system, preservation of unrelated work, proportional tests, and runtime verification when relevant.",
    "Return only the enhanced prompt. Do not preface it, explain the rewrite, or wrap it in quotation marks or a code fence.",
    `Target bot: ${context.botName}${role ? ` (${role})` : ""}.`,
    project ? `Project context: ${project}.` : "",
    `Rough prompt:\n${input.trim()}`,
  ].filter(Boolean).join("\n\n");
}

function cleanSubject(input: string) {
  return input.trim().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
}

export function structuredPromptFallback(input: string) {
  const subject = cleanSubject(input);
  if (/\b(re[a-z]{1,6}arch|investigate|compare|analy[sz]e|find out)\b/i.test(subject)) {
    return [
      `Research task: ${subject}`,
      "",
      "Objective:",
      "Produce a clear, evidence-backed answer that is useful for making a decision or understanding the subject.",
      "",
      "Research requirements:",
      "- Clarify the central question and define any important terms.",
      "- Use credible, current primary sources where available.",
      "- Include dates and cite sources close to the claims they support.",
      "- Compare meaningful alternatives or competing interpretations.",
      "- Separate confirmed facts, reasonable inferences, and unresolved uncertainty.",
      "",
      "Deliverable:",
      "Provide a concise executive summary, the key findings, supporting evidence, risks or limitations, and practical next steps. Ask one focused question first only if a missing detail would materially change the research direction.",
    ].join("\n");
  }
  if (/\b(build|implement|code|fix|debug|refactor|add|create an? (?:app|feature|website|api))\b/i.test(subject)) {
    return [
      `Implementation task: ${subject}`,
      "",
      "Objective:",
      "Complete the requested change in the existing project and leave it in a verified, usable state.",
      "",
      "Requirements:",
      "- Inspect the relevant code and existing conventions before editing.",
      "- Preserve unrelated work and avoid unnecessary architectural changes.",
      "- Handle important error, loading, empty, and accessibility states.",
      "- Add or update focused regression coverage.",
      "- Verify the result proportionately with tests, typechecking, builds, and runtime behavior where relevant.",
      "",
      "Deliverable:",
      "Implement the change, summarize what changed, report verification evidence, and clearly identify any remaining blocker or assumption.",
    ].join("\n");
  }
  return [
    `Task: ${subject}`,
    "",
    "Objective:",
    "Complete the request accurately and produce a result that is ready to use.",
    "",
    "Working approach:",
    "- Use the available context and tools instead of guessing.",
    "- Preserve the user's intent and relevant constraints.",
    "- Ask one focused question only if a missing detail would materially change the result.",
    "- Verify important claims and completed actions before reporting success.",
    "",
    "Deliverable:",
    "Provide the completed result first, followed by concise supporting details, assumptions, and any remaining limitations.",
  ].join("\n");
}

export function cleanEnhancedPrompt(value: string) {
  let text = value.trim();
  const fenced = /^```(?:text|markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(text);
  if (fenced) text = fenced[1].trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”"))) text = text.slice(1, -1).trim();
  return text.slice(0, 16_000);
}
