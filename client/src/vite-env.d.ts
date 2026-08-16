/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Host of the Cloudflare Worker, e.g. `long-noon.<account>.workers.dev`.
   *
   * Set in Vercel for production and preview. Omitted locally, where the
   * default points at `wrangler dev` on 8787.
   */
  readonly VITE_PARTY_HOST?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
