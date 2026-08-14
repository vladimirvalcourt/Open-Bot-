import { track } from "@/lib/analytics";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Mic, Pencil, Square } from "./icons";
import { api, useStore, type AttachmentInfo, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { MausAvatar } from "./Avatar";
import { normalizeState } from "@/lib/mascot";

/** The active @mention query at the caret: the text between an `@` that
 * starts a word and the caret. null = no mention being typed. */
function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(upto[at - 1])) return null; // user@host, not a tag
  const query = upto.slice(at + 1);
  if (query.length > 24 || query.includes("@") || query.includes("\n")) return null;
  return { start: at, query };
}

export function Composer({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [caret, setCaret] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // what was typed before the mic went on — partials append after it
  const baseText = useRef("");

  // ── @mention picker (tag another bot; the agent reaches it via ask_bot) ──
  const mention = mentionQueryAt(text, caret);
  const candidates = useMemo(() => {
    if (!mention || mention.start === dismissedAt) return [];
    const peers = state.bots.filter((b) => b.id !== bot.id && !b.hidden);
    const q = mention.query.trim().toLowerCase();
    // "@Scout " — the full name plus a space — is a COMPLETED tag, not a
    // search: keep the picker closed so Enter sends instead of re-picking
    if (mention.query.endsWith(" ") && peers.some((b) => b.name.toLowerCase() === q)) return [];
    return peers.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, dismissedAt, state.bots, bot.id]);
  const pickerOpen = candidates.length > 0;

  useEffect(() => setHighlight(0), [mention?.start, mention?.query]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  }, [text]);

  const pickMention = (peer: Bot) => {
    if (!mention) return;
    const after = text.slice(caret);
    const next = `${text.slice(0, mention.start)}@${peer.name} ${after}`;
    setText(next);
    const newCaret = mention.start + peer.name.length + 2;
    setCaret(newCaret);
    // picking completes this tag — close the popup so the next Enter sends
    setDismissedAt(mention.start);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(newCaret, newCaret);
    });
  };

  const send = () => {
    if ((!text.trim() && !attachments.length) || bot.busy || uploading || enhancing) return;
    dispatch({ type: "send", botId: bot.id, text: text.trim() || "Please review the attached files.", attachments });
    track("message_sent", { driver: bot.modelSelection?.instanceId });
    setText("");
    setAttachments([]);
  };

  const enhancePrompt = async () => {
    const rough = text.trim();
    if (rough.length < 3 || bot.busy || enhancing) return;
    setEnhancing(true);
    setSpeechError(null);
    try {
      const result = await api(`/api/bots/${bot.id}/enhance-prompt`, {
        method: "POST",
        body: JSON.stringify({ text: rough }),
      });
      const enhanced = String(result.text ?? "").trim();
      if (!enhanced) throw new Error("The prompt enhancer returned an empty result.");
      setText(enhanced);
      setCaret(enhanced.length);
      setDismissedAt(null);
      track("prompt_enhanced", { driver: bot.modelSelection?.instanceId, source: result.source });
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(enhanced.length, enhanced.length);
      });
    } catch (reason) {
      setSpeechError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEnhancing(false);
    }
  };

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true); setSpeechError(null);
    try {
      const added: AttachmentInfo[] = [];
      for (const file of Array.from(files).slice(0, 10 - attachments.length)) {
        if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is larger than 20 MB`);
        const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.readAsDataURL(file); });
        const result = await api("/api/attachments", { method: "POST", body: JSON.stringify({ name: file.name, mime: file.type, base64 }) });
        added.push(result.attachment);
      }
      setAttachments((current) => [...current, ...added].slice(0, 10));
    } catch (reason) { setSpeechError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  // native dictation: partials stream into the input while the Swift
  // helper runs; the final transcript stays in the box, ready to edit/send
  useEffect(() => {
    if (!recording) return;
    const bridge = window.ogb;
    if (!bridge) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (typeof line.text === "string") {
        const base = baseText.current;
        setText(base ? `${base} ${line.text}` : line.text);
      }
    });
    const offEnd = bridge.onSpeechEnd(({ code }) => {
      setRecording(false);
      if (code === 1) {
        setSpeechError(
          "Dictation needs Microphone + Speech Recognition access — System Settings → Privacy & Security.",
        );
      }
    });
    void bridge.speechStart();
    return () => {
      offTranscript();
      offEnd();
      void bridge.speechStop();
    };
  }, [recording]);

  const toggleMic = () => {
    if (!window.ogb) {
      setSpeechError("Voice input needs the desktop app — run pnpm dev:desktop.");
      return;
    }
    baseText.current = text.trim();
    setRecording((r) => !r);
  };

  return (
    <div className="px-5 pb-5 pt-2">
      {speechError && (
        <div className="mx-auto mb-2 max-w-[900px] rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          {speechError}
        </div>
      )}
      <div className="relative mx-auto max-w-[900px]">
        {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{attachments.map((item) => <button key={item.id} onClick={() => setAttachments((current) => current.filter((value) => value.id !== item.id))} className="rounded-full border border-hairline/40 bg-raised px-3 py-1 text-[12px] text-ink" title="Remove attachment">{item.name} ×</button>)}</div>}
        {pickerOpen && (
          <div className="absolute bottom-full left-10 z-20 mb-2 w-72 overflow-hidden rounded-xl border border-hairline/40 bg-raised shadow-lg">
            {candidates.map((peer, i) => (
              <button
                key={peer.id}
                onClick={() => pickMention(peer)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left",
                  i === highlight ? "bg-raised-hover" : "",
                )}
              >
                <MausAvatar color={peer.color} state={normalizeState(peer.mascotExpression) ?? "happy"} size={24} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{peer.name}</span>
                <span className="shrink-0 text-xs text-ink-secondary">Agent</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-hairline/40 bg-raised/60 py-2 pl-2 pr-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || attachments.length >= 10}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          title="Attach"
        >
          <Plus size={20} />
        </button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(event) => void attachFiles(event.target.files)} />
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setDismissedAt(null);
          }}
          onKeyUp={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          onKeyDown={(e) => {
            if (pickerOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const delta = e.key === "ArrowDown" ? 1 : -1;
                setHighlight((h) => (h + delta + candidates.length) % candidates.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickMention(candidates[highlight]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDismissedAt(mention?.start ?? null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape" && recording) setRecording(false);
          }}
          placeholder={
            recording ? "Listening…" : bot.busy ? `${bot.name} is working…` : `Message ${bot.name}`
          }
          className="max-h-40 min-h-8 w-full resize-none overflow-y-auto bg-transparent py-1 text-[15px] leading-6 text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          onClick={() => void enhancePrompt()}
          disabled={text.trim().length < 3 || bot.busy || enhancing || uploading}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-35",
            enhancing ? "bg-accent/15 text-accent" : "text-ink-secondary hover:bg-raised hover:text-accent",
          )}
          title="Enhance prompt"
          aria-label="Enhance prompt"
        >
          {enhancing ? <Loader2 size={17} className="animate-spin" /> : <Pencil size={17} />}
        </button>
        {bot.busy ? (
          <button
            onClick={() => dispatch({ type: "interrupt", botId: bot.id })}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
            title="Stop"
          >
            <Square size={14} className="fill-current" />
          </button>
        ) : (
          <button
            onClick={toggleMic}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full",
              recording
                ? "animate-pulse bg-danger/20 text-danger"
                : "text-ink-secondary hover:bg-raised hover:text-ink",
            )}
            title={recording ? "Stop dictation (Esc)" : "Dictate"}
          >
            <Mic size={18} />
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
