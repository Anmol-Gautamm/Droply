import React, { useState, useEffect } from 'react';
import { Search, Download, Lock, Key, AlertTriangle, FileCheck, Clock, Eye } from 'lucide-react';
import { getDrop, incrementDownload } from '../services/storage';
import { decryptFile } from '../services/crypto';
import FilePreview from './FilePreview';

export default function ClaimFile({ initialCode, addToast }) {
  const [inputCode, setInputCode] = useState(initialCode || '');
  const [dropData, setDropData] = useState(null);
  const [decryptedBlob, setDecryptedBlob] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (initialCode) {
      handleLookup(initialCode);
    }
  }, [initialCode]);

  const handleLookup = async (codeToSearch) => {
    const code = (codeToSearch || inputCode).trim();
    if (!code) return;

    setIsLoading(true);
    setNotFound(false);
    setDropData(null);
    setDecryptedBlob(null);

    try {
      const drop = await getDrop(code);
      if (!drop || drop.expired) {
        setNotFound(true);
        addToast('No active drop found for code: ' + code, 'error');
      } else {
        setDropData(drop);
        if (!drop.isEncrypted) {
          setDecryptedBlob(drop.fileBlob);
        }
      }
    } catch (err) {
      console.error(err);
      addToast('Error retrieving drop', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecrypt = async (e) => {
    e.preventDefault();
    if (!password.trim() || !dropData) return;

    try {
      setPasswordError(false);
      const blob = await decryptFile(dropData.fileBlob, password.trim(), dropData.fileType);
      setDecryptedBlob(blob);
      addToast('File unlocked successfully!', 'success');
    } catch (err) {
      console.error(err);
      setPasswordError(true);
      addToast('Incorrect password. Please try again.', 'error');
    }
  };

  const handleDownload = async () => {
    if (!decryptedBlob || !dropData) return;

    try {
      // Trigger Blob download
      const url = URL.createObjectURL(decryptedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = dropData.fileName || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Increment download counter or handle 1-time deletion
      const updated = await incrementDownload(dropData.code);
      if (updated?.deletedAfterDownload) {
        addToast('File downloaded! Note: This drop was set to 1-time download and is now removed.', 'info');
      } else {
        addToast('File download started!', 'success');
      }

      // Update state
      if (updated) {
        setDropData(updated);
      }
    } catch (err) {
      console.error('Download error:', err);
      addToast('Failed to download file.', 'error');
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="glass-panel" style={{ padding: '36px 28px', maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h2 className="gradient-text" style={{ fontSize: '2rem', marginBottom: '8px' }}>
          Access & Claim Shared File
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Enter the 6-character drop code to preview and download the file.
        </p>
      </div>

      {/* Code Input Form */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', gap: '12px', maxWidth: '440px', margin: '0 auto' }}>
          <input
            type="text"
            className="code-input-large"
            placeholder="e.g. DROP-8492"
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && handleLookup()}
          />
          <button
            className="btn-primary"
            onClick={() => handleLookup()}
            disabled={isLoading || !inputCode.trim()}
            style={{ padding: '0 24px', flexShrink: 0 }}
          >
            <Search size={20} />
            {isLoading ? 'Searching...' : 'Claim'}
          </button>
        </div>
      </div>

      {/* Not Found state */}
      {notFound && (
        <div style={{
          textAlign: 'center',
          padding: '24px',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          color: 'var(--color-danger)'
        }}>
          <AlertTriangle size={36} style={{ marginBottom: '8px' }} />
          <h4>Drop Not Found or Expired</h4>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            Check the code for typos or request a new drop code from the sender.
          </p>
        </div>
      )}

      {/* Drop Metadata & File Actions */}
      {dropData && (
        <div style={{
          background: 'rgba(13, 20, 33, 0.8)',
          border: '1px solid var(--border-glass-glow)',
          borderRadius: '16px',
          padding: '24px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <span className="code-badge" style={{ fontSize: '1.2rem', padding: '6px 14px' }}>
                {dropData.code}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              <span>Downloads: {dropData.downloadsCount || 0}</span>
              {dropData.expiresAt && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--color-warning)' }}>
                  <Clock size={14} /> Expiring soon
                </span>
              )}
            </div>
          </div>

          <h3 style={{ color: 'var(--text-main)', fontSize: '1.2rem', marginBottom: '6px' }}>
            {dropData.fileName}
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '16px' }}>
            Size: {formatSize(dropData.fileSize)} • Type: {dropData.fileType || 'File'}
          </p>

          {/* Password Protection Form */}
          {dropData.isEncrypted && !decryptedBlob && (
            <form onSubmit={handleDecrypt} style={{
              background: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '12px',
              padding: '20px',
              marginTop: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-secondary)', marginBottom: '12px' }}>
                <Lock size={20} />
                <h4 style={{ margin: 0 }}>This drop is password protected</h4>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  className="option-input"
                  placeholder="Enter secret password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%' }}
                />
                <button type="submit" className="btn-primary" style={{ flexShrink: 0 }}>
                  <Key size={16} /> Unlock
                </button>
              </div>
              {passwordError && (
                <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '6px' }}>
                  Incorrect password. Please verify and try again.
                </p>
              )}
            </form>
          )}

          {/* Decrypted File Preview & Download */}
          {decryptedBlob && (
            <div>
              <FilePreview
                fileBlob={decryptedBlob}
                fileName={dropData.fileName}
                fileType={dropData.fileType}
              />

              <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <button
                  className="btn-primary"
                  onClick={handleDownload}
                  style={{ padding: '14px 40px', fontSize: '1.05rem' }}
                >
                  <Download size={20} />
                  Download File
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
