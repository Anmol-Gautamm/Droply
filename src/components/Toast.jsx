import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export default function Toast({ toasts, removeToast }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-item"
          role="button"
          tabIndex={0}
          title="Click to dismiss notification"
          aria-label={`Notification: ${toast.message}. Click to dismiss.`}
          onClick={() => removeToast(toast.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              removeToast(toast.id);
            }
          }}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" size={20} color="#10b981" aria-hidden="true" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" size={20} color="#ef4444" aria-hidden="true" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-cyan-400" size={20} color="#06b6d4" aria-hidden="true" />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
