import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Sidebar from './Sidebar';
import Header from './Header';
import Footer from './Footer';
import { cn } from '@/lib/utils';

export default function Layout() {
  const { t } = useTranslation();
  // Remount key: bumping it re-mounts the routed content, re-running every
  // page's on-mount data fetch — a "refresh just this embed" that doesn't
  // reload the host browser page.
  const [refreshKey, setRefreshKey] = useState(0);
  // Iframe embed: window.self !== window.top.
  // Custom-element embed: __CC_EMBED_MODE__ is set by `embed.tsx` before
  // the React tree mounts. The Layout chrome (sidebar / header / footer)
  // is owned by the host in both cases, so we hide it the same way.
  const isEmbedded =
    window.self !== window.top ||
    (globalThis as unknown as { __CC_EMBED_MODE__?: boolean })
      .__CC_EMBED_MODE__ === true;
  return (
    <div
      className={cn(
        'flex overflow-hidden',
        isEmbedded ? 'h-full' : 'h-screen',
        'bg-gradient-to-br from-gray-100 via-white to-gray-100',
        'dark:from-gray-950 dark:via-[#0a0a0c] dark:to-gray-950',
      )}
    >
      {!isEmbedded && <Sidebar />}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!isEmbedded && <Header />}
        {/* Embedded: the host hides our Header, so surface a thin refresh bar
            here that re-mounts the content (host page is never reloaded). */}
        {isEmbedded && (
          <div className="flex justify-end px-3 py-1.5 border-b border-gray-200/60 dark:border-gray-800/60 shrink-0">
            <button
              type="button"
              onClick={() => setRefreshKey((k) => k + 1)}
              title={t('common.refresh', 'Refresh')}
              aria-label={t('common.refresh', 'Refresh')}
              className="p-1.5 rounded-lg text-gray-500 hover:text-accent hover:bg-accent/10 transition-colors"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-6 flex flex-col min-h-0">
          <div key={refreshKey} className="flex-1 flex flex-col">
            <Outlet />
          </div>
          {!isEmbedded && <Footer />}
        </main>
      </div>
    </div>
  );
}
