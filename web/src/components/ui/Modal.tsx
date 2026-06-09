import { cn } from '@/lib/utils';
import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { usePortalContainer } from '@/lib/portal-container';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  const portalContainer = usePortalContainer();
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        role="presentation"
      />
      <div
        className={cn(
          'relative w-full max-w-lg rounded-2xl p-6 shadow-2xl animate-fade-in flex flex-col max-h-[calc(100vh-2rem)]',
          'bg-white/95 backdrop-blur-xl border border-gray-200/90',
          'dark:bg-[rgba(0,0,0,0.88)] dark:border-white/[0.1] dark:shadow-black/50',
          className
        )}
      >
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'p-1 rounded-lg transition-colors duration-200',
              'text-gray-400 hover:bg-gray-100/90 dark:hover:bg-white/[0.08]'
            )}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
          {children}
        </div>
      </div>
    </div>,
    portalContainer ?? document.body
  );
}
