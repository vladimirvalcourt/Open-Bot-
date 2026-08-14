// The narrow bridge the Electron preload exposes. Absent in the browser.
export {};

declare global {
  interface Window {
    ogb?: {
      screenFrame(): Promise<string | null>;
      speechStart(): Promise<void>;
      speechStop(): Promise<void>;
      onSpeechTranscript(
        cb: (line: { partial?: boolean; text?: string; error?: string }) => void,
      ): () => void;
      onSpeechEnd(cb: (info: { code: number | null }) => void): () => void;
      /** {mic} TCC status: granted|denied|not-determined|unknown. Screen
       * status is deliberately absent — macOS 15+ caches it per-process,
       * so it lies for the whole session after a grant. */
      permStatus(): Promise<{ mic: string }>;
      /** Triggers the macOS microphone prompt; resolves true when granted. */
      permRequestMic(): Promise<boolean>;
      /** Opens System Settings on a privacy pane: mic|screen|speech. */
      permOpenSettings(pane: "mic" | "screen" | "speech"): Promise<void>;
      cua?: {
        status(): Promise<CuaStatus>;
        requestPermissions(): Promise<CuaStatus>;
        openSettings(pane: "accessibility" | "screen"): Promise<void>;
        restart(): Promise<CuaStatus>;
      };
      browser?: {
        show(botId: string, url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<{ url: string; title: string }>;
        navigate(botId: string, url: string): Promise<{ url: string; title: string }>;
        action(botId: string, action: "back" | "forward" | "reload"): Promise<{ url: string }>;
        hide(botId: string): Promise<void>;
        teachStart(botId: string): Promise<boolean>;
        teachStop(botId: string): Promise<{ steps: Array<{ action: string; ref?: string; url?: string; value?: string; at: number }> }>;
      };
      notifications?: {
        show(title: string, body: string): Promise<boolean>;
      };
      /** In-app auto-update (packaged app only; dormant in dev). onState
       * fires immediately with the current state, then on transitions. */
      updater?: {
        check(): Promise<void>;
        download(): Promise<void>;
        /** quit-and-install the downloaded update */
        install(): Promise<void>;
        onState(cb: (s: UpdaterState) => void): () => void;
      };
    };
  }
}

export interface CuaStatus {
  available: boolean;
  accessibility: boolean;
  screenRecording: boolean;
  connection?: { mode: "embedded" | "standalone" | "unavailable"; reason?: string } | null;
  error?: string;
}

export interface UpdaterState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "disabled" | "error";
  version?: string;
  percent?: number;
  message?: string;
}
