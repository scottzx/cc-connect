import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import Footer from './Footer';
import { cn } from '@/lib/utils';

export default function Layout() {
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
        <main className="flex-1 overflow-y-auto p-6 flex flex-col min-h-0">
          <div className="flex-1 flex flex-col">
            <Outlet />
          </div>
          {!isEmbedded && <Footer />}
        </main>
      </div>
    </div>
  );
}
