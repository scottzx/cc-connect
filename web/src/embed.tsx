/**
 * Embed entry for 1agents host integration.
 *
 * Loaded as `<script type="module" src=".../cc-connect-embed.js">` by the
 * host. Defines a `<cc-connect-panel>` custom element that mounts the
 * regular cc-connect React tree inside a `MemoryRouter` so the host's
 * window.history is not polluted.
 *
 * Notes:
 *  - cc-connect has a Login page at /login with a `ProtectedRoute` that
 *    requires `useAuthStore.isAuthenticated === true`. In embed mode the
 *    host must pass an `auth-token` attribute (e.g. fetched from
 *    1agents' `/api/cc-connect/url`); we call `useAuthStore.login()`
 *    on it before mounting so ProtectedRoute lets us through.
 *  - `Layout.tsx` already hides its sidebar/header/footer when running
 *    inside an iframe (`window.self !== window.top`). We extend that
 *    check with the `__CC_EMBED_MODE__` flag so the chrome is hidden in
 *    custom-element mode too.
 *  - The `chat` route (which embeds the xterm terminal) is intentionally
 *    NOT rendered via this custom element — the host keeps the original
 *    cc-connect iframe for that one route per project decision
 *    ("暂时不动终端"). The host should not pass `route="chat"`.
 *
 * Communication contract with the host:
 *   host → element   attribute: theme, lang, route, auth-token, server-url
 *   element → host   CustomEvent('navigate', { detail: { path } })
 */

import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";

import App from "./App";
import { useAuthStore } from "./store/auth";
import { useThemeStore } from "./store/theme";
import i18n from "./i18n";
import embedCss from "./embed.css?inline";
import { PortalContainerContext } from "./lib/portal-container";

declare global {
  // Set in connectedCallback. Read by Layout.tsx (and any other component
  // that needs to know it is running inside the host, not an iframe).
  // eslint-disable-next-line no-var
  var __CC_EMBED_MODE__: boolean | undefined;
}

function toI18nLang(lang: string): string {
  const lower = lang.toLowerCase();
  if (lower.startsWith("zh-tw") || lower.startsWith("zh-hk")) return "zh-TW";
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("es")) return "es";
  return "en";
}

function normalizeRoute(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

function applyTheme(theme: string): void {
  if (theme !== "light" && theme !== "dark" && theme !== "system") return;
  useThemeStore.getState().setTheme(theme);
}

function applyLang(lang: string): void {
  const next = toI18nLang(lang);
  i18n.changeLanguage(next);
  try {
    localStorage.setItem("cc_lang", next);
  } catch {
    /* storage may be unavailable */
  }
}

function applyAuth(token: string, serverUrl: string): void {
  if (!token) return;
  useAuthStore.getState().login(token, serverUrl || undefined);
}

/**
 * Bridge component living inside the MemoryRouter. Handles both
 * directions: react-router → host (via CustomEvent on the element) and
 * host → react-router (via CustomEvent on the element, listen here).
 *
 * cc-connect has no `useNavReporter` equivalent of its own, so unlike
 * 1skills we cannot rely on an existing dispatch hook.
 */
function EmbedBridge({ target }: { target: HTMLElement }) {
  const location = useLocation();
  const navigate = useNavigate();

  // outgoing: any location change inside cc-connect becomes a navigate
  // event on the host element
  useEffect(() => {
    target.dispatchEvent(
      new CustomEvent("navigate", {
        detail: { path: location.pathname },
        bubbles: true,
        composed: true,
      }),
    );
  }, [target, location.pathname]);

  // incoming: host pushes a new route attribute; we forward to the
  // memory router
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail;
      if (!detail?.path) return;
      if (detail.path === location.pathname) return;
      navigate(detail.path);
    };
    target.addEventListener("cc-embed-route", handler);
    return () => target.removeEventListener("cc-embed-route", handler);
  }, [target, navigate, location.pathname]);

  return null;
}

class CcConnectPanelElement extends HTMLElement {
  static observedAttributes = [
    "theme",
    "lang",
    "route",
    "auth-token",
    "server-url",
  ] as const;

  private root: Root | undefined;
  private mounted = false;
  private portalContainer: HTMLDivElement | null = null;
  private wrapper: HTMLDivElement | null = null; // dark-mode container

  connectedCallback(): void {
    if (this.mounted) return;
    this.mounted = true;

    // Flip the embed flag so Layout.tsx hides its sidebar/header/footer
    // (it already does this for iframes; we extend the check).
    globalThis.__CC_EMBED_MODE__ = true;

    // Auth first, so ProtectedRoute lets the initial render through.
    const token = this.getAttribute("auth-token") || "";
    const serverUrl = this.getAttribute("server-url") || "";
    if (token) applyAuth(token, serverUrl);

    // Theme + lang initial sync.
    const initialTheme = this.getAttribute("theme") || "dark";
    applyTheme(initialTheme);
    applyLang(this.getAttribute("lang") || "en");

    const initialPath = this.getAttribute("route")
      ? normalizeRoute(this.getAttribute("route") as string)
      : "/providers";

    // ── Shadow DOM isolation ──────────────────────────────────────────
    // Attach shadow so host page styles cannot bleed into the panel.
    const shadow = this.attachShadow({ mode: "open" });

    // Inject all bundled CSS into the shadow root.
    const style = document.createElement("style");
    style.textContent = embedCss;
    shadow.appendChild(style);

    // CSS custom properties for the accent color (defined on :root in
    // the standalone build, but we're inside a shadow tree so :root
    // refers to the shadow root — we define them on :host instead).
    const vars = document.createElement("style");
    vars.textContent = `
      :host {
        --color-accent: 22 163 74;
        --color-accent-dim: 21 128 61;
      }
    `;
    shadow.appendChild(vars);

    // Dark-mode wrapper. Tailwind's darkMode: 'class' relies on a
    // `.dark` ancestor in the DOM tree. Since the shadow boundary
    // isolates us from the host's <html class="dark">, we must
    // maintain our own `.dark` wrapper.
    this.wrapper = document.createElement("div");
    this.wrapper.className = initialTheme === "dark" ? "dark" : "";
    // `transform` makes the wrapper the containing block for descendant
    // `position: fixed` elements (e.g. the Modal's `fixed inset-0` overlay).
    // Without it, fixed elements resolve against the viewport, so modals
    // center on the whole window instead of within this embedded panel. Set
    // via inline style (not className) because the theme handler reassigns
    // className on every theme change and would clobber an extra class.
    this.wrapper.style.cssText = "width:100%;height:100%;display:flex;flex-direction:column;min-height:0;transform:translateZ(0)";
    shadow.appendChild(this.wrapper);

    // Portal container: Radix UI / React portals will be mounted here
    // (inside the shadow root) instead of document.body.
    this.portalContainer = document.createElement("div");
    this.portalContainer.className = "cc-portal-container";
    this.wrapper.appendChild(this.portalContainer);

    // React root container.
    const appRoot = document.createElement("div");
    appRoot.className = "cc-embed-root";
    this.wrapper.appendChild(appRoot);

    this.root = createRoot(appRoot);
    this.root.render(
      <PortalContainerContext.Provider value={this.portalContainer}>
        <MemoryRouter initialEntries={[initialPath]}>
          <App />
          <EmbedBridge target={this} />
        </MemoryRouter>
      </PortalContainerContext.Provider>,
    );
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = undefined;
    this.mounted = false;
    this.portalContainer = null;
    this.wrapper = null;
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this.mounted) return;
    this.applyAttribute(name, newValue);
  }

  private applyAttribute(name: string, value: string | null): void {
    if (value == null) return;
    if (name === "theme") {
      applyTheme(value);
      // Toggle the shadow-root scoped dark class so tailwind's
      // dark: variants work inside the shadow tree. We read the
      // resolved value from the store (applyTheme already called
      // setTheme, which resolves system → light/dark).
      if (this.wrapper) {
        const resolved = useThemeStore.getState().resolved;
        this.wrapper.className = resolved === 'dark' ? 'dark' : '';
      }
    } else if (name === "lang") {
      applyLang(value);
    } else if (name === "route") {
      this.dispatchEvent(
        new CustomEvent("cc-embed-route", {
          detail: { path: normalizeRoute(value) },
        }),
      );
    } else if (name === "auth-token") {
      const serverUrl = this.getAttribute("server-url") || "";
      applyAuth(value, serverUrl);
    } else if (name === "server-url") {
      const token = this.getAttribute("auth-token") || "";
      if (token) applyAuth(token, value);
    }
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("cc-connect-panel")
) {
  customElements.define("cc-connect-panel", CcConnectPanelElement);
}
