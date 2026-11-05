/// <reference types="vite/client" />

interface ImportMetaEnv {
   readonly VITE_SUPABASE_URL?: string;
   readonly VITE_SUPABASE_ANON_KEY?: string;
   readonly VITE_API_URL?: string;
   /** Commissaire multi-user server (e.g. https://api.commissaire.us). Unset = local-only app. */
   readonly VITE_SERVER_URL?: string;
   /** Google OAuth client id of the Commissaire web app (Sign in with Google). */
   readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
   readonly env: ImportMetaEnv;
}

declare module "*.png" {
   const src: string;
   export default src;
}

declare module "*.jpg" {
   const src: string;
   export default src;
}

declare module "*.jpeg" {
   const src: string;
   export default src;
}

declare module "*.svg" {
   const src: string;
   export default src;
}

declare module "*.gif" {
   const src: string;
   export default src;
}

declare module "*.webp" {
   const src: string;
   export default src;
}
