/**
 * Credential and token persistence on the plugin's private settings file.
 *
 * Everything lives in the plugin data directory (~/.pi-desktop[-dev]/plugins/
 * data/local.fusion-search/settings.json): workspace-independent, never in
 * git, and never surfaced in the Settings UI because none of these keys are
 * declared in contributes.settings. Values the file already holds but the
 * manifest does not declare survive get/set round-trips, which is what keeps
 * this channel usable without touching the settings sheet.
 *
 * The two accessors take the `pi`-shaped plugin object so tests can pass a
 * stub; nothing here imports the global.
 */

const CREDENTIAL_KEYS = Object.freeze(["username", "password"]);

export async function readSettings(pi) {
  try {
    const settings = await pi.plugin.getSettings();
    return settings && typeof settings === "object" && !Array.isArray(settings)
      ? settings
      : {};
  } catch (error) {
    throw Object.assign(
      new Error(`plugin settings could not be read: ${error?.message ?? error}`),
      { code: "SETTINGS_UNAVAILABLE" },
    );
  }
}

export async function writeSettings(pi, partial) {
  try {
    await pi.plugin.setSettings(partial);
  } catch (error) {
    throw Object.assign(
      new Error(`plugin settings could not be written: ${error?.message ?? error}`),
      { code: "SETTINGS_UNAVAILABLE" },
    );
  }
}

/** { username, password } or null; never echoes the password. */
export function readCredentials(settings) {
  const username = typeof settings.username === "string" ? settings.username.trim() : "";
  const password = typeof settings.password === "string" ? settings.password : "";
  if (!username || !password) return null;
  return { username, password };
}

/** A usable stored token: non-empty, either Bearer-prefixed or bare. */
export function readStoredToken(settings) {
  const token = typeof settings.token === "string" ? settings.token.trim() : "";
  if (!token) return null;
  return token;
}

export function normalizeAuthorizationHeader(token) {
  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

export async function persistToken(pi, token) {
  await writeSettings(pi, { token });
}
