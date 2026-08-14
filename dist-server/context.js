const bytes = (value) => Buffer.byteLength(value, "utf8");
export function compactTranscript(turns, maxBytes = 96_000, keepBytes = 48_000) {
    if (turns.reduce((sum, item) => sum + bytes(item.text), 0) <= maxBytes)
        return turns;
    let size = 0;
    let cut = turns.length;
    for (let index = turns.length - 1; index >= 0; index--) {
        size += bytes(turns[index].text);
        if (size > keepBytes)
            break;
        if (turns[index].role === "user")
            cut = index;
    }
    if (cut <= 0 || cut >= turns.length)
        cut = Math.max(1, turns.length - 8);
    const omitted = turns.slice(0, cut);
    const digest = omitted
        .filter((item) => item.text.trim())
        .slice(-24)
        .map((item) => `- ${item.role === "user" ? "User" : "Assistant"}: ${item.text.replace(/\s+/g, " ").slice(0, 240)}`)
        .join("\n")
        .slice(0, 8_000);
    return [
        { role: "user", text: `[Summary of earlier conversation (mechanically compacted)]\n${digest}` },
        { role: "assistant", text: "Understood. I will continue from that context." },
        ...turns.slice(cut),
    ];
}
