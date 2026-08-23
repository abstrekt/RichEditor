import { fromJSON, toJSON } from '../model'
import type { Doc } from '../model'

/**
 * Persistence, and the reason it exists here at all.
 *
 * The requirement is that the model serializes to JSON and reconstructs
 * perfectly. Tests prove that in isolation, but a round trip nothing ever
 * performs is a claim rather than a demonstration — so the document is written
 * out on every change and read back on load. Refreshing the page is the round
 * trip, exercised the way it would actually be used.
 */

const STORAGE_KEY = 'rich-text-editor-core:document'

export function save(document: Doc): void {
  try {
    localStorage.setItem(STORAGE_KEY, toJSON(document))
  } catch {
    /*
     * Storage can fail for reasons that have nothing to do with this document:
     * private browsing modes reject writes outright, and the quota is shared
     * across the origin. Losing persistence is a far smaller problem than
     * losing the keystroke that triggered it, so the failure is swallowed.
     */
  }
}

/**
 * Reads a stored document back, or nothing if there isn't a usable one.
 *
 * Everything here is untrusted input. It may be absent, corrupt, hand-edited,
 * or written by a version of this model that no longer exists — so it goes
 * through the same validating deserializer as any external document, and a
 * failure starts fresh rather than preventing the editor from booting.
 */
export function load(): Doc | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null

  try {
    return fromJSON(raw)
  } catch {
    return null
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* Same reasoning as save. */
  }
}
