import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import confetti from 'canvas-confetti';
import { Copy, QrCode, X, Check, Share2, ShieldAlert } from 'lucide-react';

export default function ShareModal({ drop, onClose, addToast }) {
  const canvasRef = useRef(null);

  const shareUrl = `${window.location.origin}${window.location.pathname}?code=${drop.code}`;

  useEffect(() => {
    // Trigger confetti explosion on successful drop creation
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.6 }
    });

    // Render QR Code onto canvas
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        shareUrl,
        {
          width: 160,
          margin: 2,
          color: {
            dark: '#06b6d4',
            light: '#090d16'
          }
        },
        (err) => {
          if (err) console.error('QR code generation error:', err);
        }
      );
    }
  }, [drop, shareUrl]);

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    addToast(`${label} copied to clipboard!`, 'success');
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          <X size={24} />
        </button>

        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: 'rgba(6, 182, 212, 0.15)',
            color: 'var(--color-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justify-content: 'center',
            marginBottom: '12px'
          }}>
            <Share2 size={26} />
          </div>
          <h3 style={{ fontSize: '1.5rem', color: 'var(--text-main)' }}>Your File is Ready to Share!</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Anyone with this code or link can claim and download your file.
          </p>
        </div>

        {/* Big Code Display */}
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <div className="code-badge">{drop.code}</div>
          <div style={{ marginTop: '10px' }}>
            <button
              className="btn-primary"
              onClick={() => copyToClipboard(drop.code, 'Share Code')}
              style={{ padding: '8px 18px', fontSize: '0.9rem' }}
            >
              <Copy size={16} /> Copy Code
            </button>
          </div>
        </div>

        {/* Share Link */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Direct Shareable URL:
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="option-input"
              style={{ width: '100%', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}
            />
            <button
              className="btn-secondary"
              onClick={() => copyToClipboard(shareUrl, 'Share Link')}
              style={{ padding: '8px 14px' }}
            >
              <Copy size={16} />
            </button>
          </div>
        </div>

        {/* QR Code */}
        <div style={{ textAlign: 'center', background: 'rgba(9, 13, 22, 0.8)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
            <QrCode size={16} /> Scan with mobile camera:
          </div>
          <canvas ref={canvasRef} style={{ borderRadius: '8px', margin: '0 auto' }} />
        </div>

        {drop.isEncrypted && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '16px',
            padding: '10px 14px',
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '8px',
            color: 'var(--color-secondary)',
            fontSize: '0.85rem'
          }}>
            <ShieldAlert size={18} />
            This drop is encrypted with a password. Recipient will need the password to open.
          </div>
        )}
      </div>
    </div>
  );
}
