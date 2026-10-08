/**
 * Self-hosted TinyMCE 6 (same editor as the website, which loads it from a
 * CDN) — bundled so notes can be edited offline. Loaded lazily on first use.
 */
let loading: Promise<any> | null = null;

export function loadTinymce(): Promise<any> {
  if (loading) return loading;
  loading = (async () => {
    const [{ default: tinymce }] = await Promise.all([import('tinymce')]);
    await Promise.all([
      import('tinymce/models/dom/model'),
      import('tinymce/themes/silver'),
      import('tinymce/icons/default'),
      import('tinymce/plugins/lists'),
      import('tinymce/plugins/link'),
      import('tinymce/plugins/image'),
      import('tinymce/plugins/code')
    ]);
    return tinymce;
  })();
  return loading;
}

/** Skin CSS (UI + content) for the current theme, as strings. */
export async function tinymceSkin(dark: boolean): Promise<{ ui: string; contentUi: string; content: string }> {
  if (dark) {
    const [ui, contentUi, content] = await Promise.all([
      import('tinymce/skins/ui/oxide-dark/skin.min.css?inline'),
      import('tinymce/skins/ui/oxide-dark/content.min.css?inline'),
      import('tinymce/skins/content/dark/content.min.css?inline')
    ]);
    return { ui: ui.default, contentUi: contentUi.default, content: content.default };
  }
  const [ui, contentUi, content] = await Promise.all([
    import('tinymce/skins/ui/oxide/skin.min.css?inline'),
    import('tinymce/skins/ui/oxide/content.min.css?inline'),
    import('tinymce/skins/content/default/content.min.css?inline')
  ]);
  return { ui: ui.default, contentUi: contentUi.default, content: content.default };
}
