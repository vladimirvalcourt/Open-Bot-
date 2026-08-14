// Auto-updates may only replace an app signed by the same publishing team.
// Local contributor builds use a different Apple Development certificate and
// must never offer the official feed: Squirrel will reject the replacement,
// and even if forced it would overwrite unshipped local work.
export const OFFICIAL_UPDATE_TEAM_ID = "993D98NH4J";

export function teamIdentifierFromCodesign(output) {
  return String(output ?? "").match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() || null;
}

export function updatePolicy(teamIdentifier) {
  if (teamIdentifier === OFFICIAL_UPDATE_TEAM_ID) return { enabled: true };
  return {
    enabled: false,
    reason: teamIdentifier
      ? "Local development build — automatic updates are disabled because official releases use a different signer."
      : "Unsigned local build — automatic updates are disabled.",
  };
}
