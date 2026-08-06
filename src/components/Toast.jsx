import React from 'react';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export default function Toast({ toasts, removeToast }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast-item" onClick={() => removeToast(toast.id)}>
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" size={20} color="#10b981" />}
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400" size={20} color="#ef4444" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-cyan-400" size={20} color="#06b6d4" />}
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
