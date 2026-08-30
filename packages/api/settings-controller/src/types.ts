/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

/** Stable settings failure details returned by the `settings` namespace. */
export interface SettingsErrorDetailsMap {
  /**
   * Every seam refusal that is not a stale write: an unregistered or malformed
   * namespace, a read-only provider, schema validation, storage.
   */
  'settings-rejected': { readonly ns: string }
  /**
   * The stored revision moved after the caller read it. Its own outcome rather
   * than an invalid request: the caller must re-read and re-apply.
   */
  'settings-conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
}

/** Settings business failure carried by a rejected Remote call. */
export type SettingsError = {
  [Code in keyof SettingsErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: SettingsErrorDetailsMap[Code]
  }
}[keyof SettingsErrorDetailsMap]

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** One currency line of a DeepSeek account balance. */
export interface DeepSeekBalanceLine {
  readonly currency: string
  readonly total: string
  readonly toppedUp: string
  readonly granted: string
}

/**
 * The DeepSeek account balance as a configuration page may show it.
 *
 * The three states stay distinct on purpose: a page that collapsed
 * `unavailable` into a zero balance would tell the operator they have no money
 * left when the truth is that nobody could ask.
 */
export interface DeepSeekBalanceValue {
  /** `ok` carries balances; `unconfigured` means no API key; `unavailable` means the read failed. */
  readonly state: 'ok' | 'unconfigured' | 'unavailable'
  /** DeepSeek's own verdict on whether the account may still serve requests. */
  readonly isAvailable?: boolean
  /** One line per currency the account carries, in the order DeepSeek returned. */
  readonly balances?: readonly DeepSeekBalanceLine[]
  /** Why the read failed, safe to display: the key never reaches this text. */
  readonly reason?: string
}

/** Stable credential failure details returned by the `credentials` namespace. */
export interface CredentialErrorDetailsMap {
  /**
   * The provider refused a valid write, for example because a read-only source
   * shadows the reference. The details name only the reference, never the value.
   */
  'credential-rejected': { readonly ref: string }
}

/** Credential business failure carried by a rejected Remote call. */
export type CredentialError = {
  [Code in keyof CredentialErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: CredentialErrorDetailsMap[Code]
  }
}[keyof CredentialErrorDetailsMap]
