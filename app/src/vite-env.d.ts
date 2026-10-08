/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

/** app/package.json version, injected by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Android build includes google-services.json (push notifications), see vite.config.ts. */
declare const __FCM_ENABLED__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// TinyMCE side-effect modules (self-hosted editor, see lib/tinymce.ts).
declare module 'tinymce/models/dom/model';
declare module 'tinymce/themes/silver';
declare module 'tinymce/icons/default';
declare module 'tinymce/plugins/*';
