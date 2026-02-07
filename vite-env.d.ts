/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PAI_API_URL: string
  readonly VITE_PAI_API_TOKEN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
