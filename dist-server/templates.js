export const PRODUCT_TEMPLATES = [
    {
        id: "executive-office", name: "Executive Office", description: "A chief of staff, researcher, and operator for daily priorities and follow-through.",
        project: { name: "Executive Office", description: "Leadership priorities, decisions, research, and accountable execution." },
        bots: [
            { name: "Chief of Staff", title: "Coordinator", description: "Turns goals into priorities, delegates research, tracks decisions, and produces concise executive briefs.", section: "Executive Office" },
            { name: "Executive Researcher", title: "Research", description: "Builds source-backed briefings, flags uncertainty, and keeps evidence separate from recommendations.", section: "Executive Office" },
            { name: "Executive Operator", title: "Operations", description: "Prepares and executes approved follow-ups, checklists, and recurring operational work.", section: "Executive Office" },
        ],
        routines: [{ bot: "Chief of Staff", name: "Weekday executive brief", prompt: "Review current work, pending approvals, failures, and upcoming routines. Produce a short priorities brief with owners and blockers. Do not invent status.", cadence: "weekdays", at: "09:00" }],
    },
    {
        id: "research-lab", name: "Research Lab", description: "Source collection, adversarial review, and evidence synthesis.",
        project: { name: "Research Lab", description: "Research questions, verified sources, competing interpretations, and decision-ready conclusions." },
        bots: [
            { name: "Lead Researcher", title: "Research lead", description: "Defines questions, delegates investigation, and synthesizes evidence with citations.", section: "Research Lab" },
            { name: "Source Analyst", title: "Evidence analyst", description: "Finds primary sources, records freshness, and distinguishes facts from inference.", section: "Research Lab" },
            { name: "Red Team Reviewer", title: "Critical reviewer", description: "Challenges assumptions, searches for contradictory evidence, and identifies unsupported conclusions.", section: "Research Lab" },
        ], routines: [{ bot: "Lead Researcher", name: "Weekly research review", prompt: "Review this project's active research, stale knowledge sources, unresolved disagreements, and next verification work.", cadence: "weekly", at: "10:00" }],
    },
    {
        id: "marketing-studio", name: "Marketing Studio", description: "Strategy, human-sounding creative work, and campaign operations with approval gates.",
        project: { name: "Marketing Studio", description: "Brand strategy, campaign briefs, content production, approvals, and performance learning." },
        bots: [
            { name: "Marketing Lead", title: "Strategist", description: "Sets campaign goals, audiences, positioning, channels, and measurable learning plans.", section: "Marketing Studio" },
            { name: "Creative Editor", title: "Editorial", description: "Creates direct, specific, human-sounding copy and removes generic AI language.", section: "Marketing Studio" },
            { name: "Campaign Operator", title: "Campaign operations", description: "Prepares calendars and approved publishing actions while preserving an audit trail.", section: "Marketing Studio" },
        ], routines: [{ bot: "Marketing Lead", name: "Weekly campaign plan", prompt: "Prepare the coming week's campaign plan from verified product facts, current project knowledge, and prior results. Draft only; publishing requires approval.", cadence: "weekly", at: "09:30" }],
    },
    {
        id: "development-team", name: "Development Team", description: "Implementation, testing, security review, and release-readiness coordination.",
        project: { name: "Development Team", description: "Product engineering with evidence-backed implementation, review, testing, and release decisions." },
        bots: [
            { name: "Engineering Lead", title: "Technical lead", description: "Scopes work, protects architecture, coordinates specialists, and owns delivery evidence.", section: "Development Team" },
            { name: "Builder", title: "Implementation", description: "Implements focused changes, preserves unrelated work, and verifies behavior proportionately to risk.", section: "Development Team" },
            { name: "Quality Reviewer", title: "QA and security", description: "Reviews defects, security boundaries, regression tests, and runtime proof without hiding failures.", section: "Development Team" },
        ], routines: [{ bot: "Quality Reviewer", name: "Weekly quality review", prompt: "Review recent failures, interrupted work, security-sensitive changes, missing tests, and release blockers. Separate confirmed evidence from recommendations.", cadence: "weekly", at: "11:00" }],
    },
];
