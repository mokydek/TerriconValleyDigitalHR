/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Конфигурация во время выполнения из /config.js (используется Docker-сборкой) */
interface Window {
  __JANAMEN__?: { supabaseUrl?: string; anonKey?: string; realtime?: boolean }
}
