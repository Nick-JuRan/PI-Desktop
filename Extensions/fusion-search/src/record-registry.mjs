/**
 * In-process registry of the records this plugin has already shown the agent.
 *
 * `fusion_full_text` takes one argument, the `pnId` listed in a result page.
 * The quick-view endpoint also wants the search session (`ssid` header), the
 * view database and, as a fallback identity, the application number. Every one
 * of those passed through this plugin already: the Boolean search knows which
 * database it searched and which session it created, and the result page sees
 * the raw provider rows (`ssId`, `anId`, `dbName`, `ti`) before projecting them.
 * Remembering them here keeps those fields out of the tool schema.
 *
 * The registry is process-scoped state like `activeSemanticElementId`: the main
 * agent and its delegates share one plugin instance, so a record the reader is
 * asked to read was listed moments earlier. A miss (app restart, a pnId that
 * never appeared in a result page) is not an error; the caller sends a bare
 * request and lets the provider decide.
 */

export const RECORD_REGISTRY_MAX_RECORDS = 2000;
export const RECORD_REGISTRY_MAX_SESSIONS = 200;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

/** Members of a provider `pnId` (`CN1A;CN1B`), normalized for lookup. */
export function publicationMembers(pnId) {
  return text(pnId)
    .split(";")
    .map((member) => member.replace(/\s+/gu, "").toUpperCase())
    .filter((member) => member.length > 0);
}

function evictOldest(map, max) {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

export function createRecordRegistry({
  maxRecords = RECORD_REGISTRY_MAX_RECORDS,
  maxSessions = RECORD_REGISTRY_MAX_SESSIONS,
} = {}) {
  /** session_id → displayed database code */
  const sessions = new Map();
  /** normalized publication member → record facts */
  const records = new Map();

  return {
    /** Remember which database a Boolean search session was run against. */
    rememberSession(sessionId, database) {
      const id = text(sessionId);
      const db = text(database).toUpperCase();
      if (!id || !db) return;
      sessions.delete(id);
      sessions.set(id, db);
      evictOldest(sessions, maxSessions);
    },

    /** Remember the raw provider rows of one result page. */
    rememberRecords(sessionId, rows) {
      const session = text(sessionId);
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        if (!isObject(row)) continue;
        const pnId = text(row.pnId);
        const members = publicationMembers(pnId);
        if (members.length === 0) continue;
        const record = {
          pnId,
          anId: text(row.anId),
          database: text(row.dbName).toUpperCase() || sessions.get(session) || "",
          sessionId: text(row.ssId) || session,
          title: text(row.ti),
        };
        for (const member of members) {
          records.delete(member);
          records.set(member, record);
        }
      }
      evictOldest(records, maxRecords);
    },

    /**
     * Facts for a pnId as the agent typed it: the whole provider value or any
     * one of its members. `null` when nothing was listed under it.
     */
    resolve(pnId) {
      for (const member of publicationMembers(pnId)) {
        const record = records.get(member);
        if (record) return { ...record };
      }
      return null;
    },

    /** Database a session was searched in, when this plugin created it. */
    databaseForSession(sessionId) {
      return sessions.get(text(sessionId)) ?? "";
    },

    clear() {
      sessions.clear();
      records.clear();
    },
  };
}
