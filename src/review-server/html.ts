// Page HTML shells served by the review server. Each page is a minimal document:
// the shared <head> (charset, viewport, title, favicon, the page stylesheet) and
// a mount element plus the page's module script. The shared UI module renders the
// header, navigation, and content into the mount on the public pages it has
// already migrated; pages not yet migrated keep their existing body. `data-theme`
// defaults to light on <html> so there is no unstyled flash before the theme
// helper applies the stored or preferred theme.

type PageDocumentOptions = {
  title: string;
  css: string;
  js: string;
  body: string;
  // Pages migrated onto the shared UI module link the shared stylesheet; pages
  // not yet migrated keep only their own stylesheet so the shared global rules
  // (box-sizing, body tokens) do not shift their existing layout.
  ui: boolean;
};

function pageDocument(options: PageDocumentOptions): string {
  const uiLink = options.ui ? `    <link rel="stylesheet" href="/review-assets/ui.css">\n` : "";
  return `<!doctype html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${options.title}</title>
    <link rel="icon" type="image/svg+xml" href="/review-assets/favicon.svg">
${uiLink}    <link rel="stylesheet" href="/review-assets/${options.css}">
  </head>
  <body>
${options.body}
    <script type="module" src="/review-assets/${options.js}"></script>
  </body>
</html>`;
}

export function settingsHtml(sessionId: string): string {
  return pageDocument({
    title: "Say Ur Intent Settings",
    css: "settings.css",
    js: "settings.js",
    ui: true,
    body: `    <div id="settings-app" data-settings-session-id="${escapeHtml(sessionId)}"></div>`
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return replacements[char] ?? char;
  });
}
