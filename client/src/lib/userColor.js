/**
 * Shared color utility — converts a username string into a consistent HSL color.
 * Used by both UserPresence (avatar background) and CodeEditor (cursor bar color)
 * so each user always gets the same color everywhere in the UI.
 */
export function userColor(username) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}
