// This small boundary is bundled during build:server so the packaged desktop
// app does not depend on a node_modules tree at runtime.
export { Composio, type Session } from "@composio/core";
