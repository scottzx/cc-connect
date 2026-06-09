import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  init: () => void;
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyTheme(resolved: 'light' | 'dark', target?: HTMLElement | null) {
  // In embed mode, the shadow root container receives the class instead of
  // documentElement, so we skip document-level manipulation.
  const el = target ?? (!globalThis.__CC_EMBED_MODE__ ? document.documentElement : null);
  if (!el) return;
  el.classList.toggle('dark', resolved === 'dark');
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: 'dark',
  resolved: 'dark',
  setTheme: (theme: Theme) => {
    const resolved = resolveTheme(theme);
    localStorage.setItem('cc_theme', theme);
    applyTheme(resolved);
    set({ theme, resolved });
  },
  init: () => {
    const params = new URLSearchParams(window.location.search);
    const queryTheme = params.get('theme') as Theme | null;
    let saved = queryTheme || (localStorage.getItem('cc_theme') as Theme) || 'dark';
    if (saved !== 'light' && saved !== 'dark' && saved !== 'system') {
      saved = 'dark';
    }
    const resolved = resolveTheme(saved);
    applyTheme(resolved);
    set({ theme: saved, resolved });

    // Live theme updates via iframe postMessage
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'THEME_CHANGE') {
        const newTheme = e.data.theme as Theme;
        if (newTheme === 'light' || newTheme === 'dark' || newTheme === 'system') {
          const resolvedVal = resolveTheme(newTheme);
          applyTheme(resolvedVal);
          set({ theme: newTheme, resolved: resolvedVal });
        }
      }
    };
    window.addEventListener('message', handleMessage);
  },
}));
