/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// TinyMCE side-effect modules (self-hosted editor, see lib/tinymce.ts).
declare module 'tinymce/models/dom/model';
declare module 'tinymce/themes/silver';
declare module 'tinymce/icons/default';
declare module 'tinymce/plugins/*';
