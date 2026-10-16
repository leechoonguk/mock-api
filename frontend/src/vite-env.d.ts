/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute origin of the mock server; unset, the page's own origin. */
  readonly VITE_MOCK_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
