import { useEffect, useState } from "react";
import { Loader2 } from "@/components/icons";
import { StoreProvider, useStore } from "@/state/store";
import { Onboarding } from "@/components/Onboarding";
import { emailGateDone, initAnalytics } from "@/lib/analytics";
import { Sidebar } from "@/components/Sidebar";
import { ChatView } from "@/components/ChatView";
import { SettingsPanel } from "@/components/SettingsPanel";
import { PluginsPanel } from "@/components/PluginsPanel";
import { ComputerPanel } from "@/components/ComputerPanel";
import { AppSettingsPanel } from "@/components/AppSettingsPanel";
import { UpdateBanner } from "@/components/UpdateBanner";
import { RoutinesPanel } from "@/components/RoutinesPanel";
import { BrowserPanel } from "@/components/BrowserPanel";
import { WorkPanel } from "@/components/WorkPanel";
import { MemoryPanel } from "@/components/MemoryPanel";
import { TeamPanel } from "@/components/TeamPanel";
import { MissionControlPanel } from "@/components/MissionControlPanel";

function Shell() {
  const { state } = useStore();
  const bot = state.bots.find((b) => b.id === state.selectedId) ?? state.bots[0];
  return (
    <div className="flex h-full flex-col">
      {/* fixed-position popup, bottom-left — outside the layout flow */}
      <UpdateBanner />
      <div className="relative flex min-h-0 flex-1">
      <Sidebar />
      {bot ? (
        <ChatView bot={bot} />
      ) : (
        <main className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app text-ink-secondary">
          <Loader2 size={20} className="animate-spin" />
          <div className="text-[14px]">
            {state.connected ? "No bots yet" : "Connecting to the bot server…"}
          </div>
          {!state.connected && (
            <div className="text-[12px]">
              Start it with <code className="rounded bg-raised px-1.5 py-0.5">pnpm dev:server</code>
            </div>
          )}
        </main>
      )}
      {state.settingsOpen && bot && <SettingsPanel bot={bot} />}
      {state.computerOpen && bot && <ComputerPanel bot={bot} />}
      {state.browserOpen && bot && <BrowserPanel bot={bot} />}
      {state.appSettingsOpen && <AppSettingsPanel />}
      {state.pluginsOpen && <PluginsPanel />}
      {state.routinesOpen && <RoutinesPanel />}
      {state.workOpen && <WorkPanel />}
      {state.memoryOpen && <MemoryPanel />}
      {state.teamOpen && <TeamPanel />}
      {state.missionControlOpen && <MissionControlPanel />}
      </div>
    </div>
  );
}

export default function App() {
  const [gated, setGated] = useState(() => !emailGateDone());
  useEffect(() => {
    void fetch("/api/governance")
      .then((response) => response.json())
      .then((body) => initAnalytics(body.governance?.privacy?.analytics === true))
      .catch(() => {});
  }, []);
  return (
    <StoreProvider>
      <Shell />
      {gated && <Onboarding onDone={() => setGated(false)} />}
    </StoreProvider>
  );
}
