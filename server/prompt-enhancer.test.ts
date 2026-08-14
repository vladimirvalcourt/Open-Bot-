import { describe, expect, it } from "vitest";

import { cleanEnhancedPrompt, promptEnhancementInstruction, structuredPromptFallback } from "./prompt-enhancer.ts";

describe("prompt enhancer", () => {
  it("gives the model a strict no-invention rewrite contract", () => {
    const prompt = promptEnhancementInstruction("do reserarch about xyz", { botName: "Researcher", projectName: "Launch" });
    expect(prompt).toContain("Preserve the user's intent");
    expect(prompt).toContain("Do not invent facts");
    expect(prompt).toContain("Return only the enhanced prompt");
    expect(prompt).toContain("do reserarch about xyz");
  });

  it("creates a useful research prompt without inventing a topic", () => {
    const result = structuredPromptFallback("do reserarch about XYZ");
    expect(result).toContain("Research task: do reserarch about XYZ");
    expect(result).toContain("credible, current primary sources");
    expect(result).toContain("Separate confirmed facts");
  });

  it("creates an implementation-specific fallback", () => {
    const result = structuredPromptFallback("add a prompt enhancer");
    expect(result).toContain("Implementation task");
    expect(result).toContain("Preserve unrelated work");
    expect(result).toContain("regression coverage");
  });

  it("removes wrapper fences and quotes from model output", () => {
    expect(cleanEnhancedPrompt("```markdown\nTask: Research X\n```" )).toBe("Task: Research X");
    expect(cleanEnhancedPrompt('"Task: Research X"')).toBe("Task: Research X");
  });
});
