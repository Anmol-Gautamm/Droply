import React, { useState, useEffect } from 'react';
import { Search, Download, Lock, Key, AlertTriangle, FileCheck, Clock, Eye, EyeOff, FileText, Layers } from 'lucide-react';
import { getDrop, incrementDownload } from '../services/storage';
import { decryptFile } from '../services/crypto';
import FilePreview from './FilePreview';

export default function ClaimFile({ initialCode, addToast }) {
  const [inputCode, setInputCode] = useState(initialCode || '');
  const [dropData, setDropData] = useState(null);
  const [decryptedFiles, setDecryptedFiles] = useState([]);
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    setDecryptedFiles([]);
    setActiveFileIndex(0);

    try {
      const drop = await getDrop(code);
      if (!drop || drop.expired) {
        setNotFound(true);
        addToast('No active drop found for code: ' + code, 'error');
      } else {
        setDropData(drop);
        if (!drop.isEncrypted) {
          setDecryptedFiles(drop.files || [{ fileName: drop.fileName, fileBlob: drop.fileBlob, fileType: drop.fileType, fileSize: drop.fileSize }]);
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
      const filesToDecrypt = dropData.files || [{ fileName: dropData.fileName, fileBlob: dropData.fileBlob, fileType: dropData.fileType, fileSize: dropData.fileSize }];
      const decryptedList = [];

      for (const f of filesToDecrypt) {
        const blob = await decryptFile(f.fileBlob, password.trim(), f.fileType);
        decryptedList.push({ ...f, fileBlob: blob });
      }

      setDecryptedFiles(decryptedList);
      setActiveFileIndex(0);
      addToast('All files unlocked successfully!', 'success');
    } catch (err) {
      console.error(err);
      setPasswordError(true);
      addToast('Incorrect password. Please try again.', 'error');
    }
  };

  const downloadSingle = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadActive = async () => {
    if (!decryptedFiles || decryptedFiles.length === 0 || !dropData) return;

    try {
      const current = decryptedFiles[activeFileIndex] || decryptedFiles[0];
      downloadSingle(current.fileBlob, current.fileName);

      const updated = await incrementDownload(dropData.code);
      if (updated?.deletedAfterDownload) {
        addToast('File downloaded! Note: 1-time drop removed.', 'info');
      } else {
        addToast(`Download started: ${current.fileName}`, 'success');
      }
      if (updated) setDropData(updated);
    } catch (err) {
      console.error('Download error:', err);
      addToast('Failed to download file.', 'error');
    }
  };

  const handleDownloadAll = async () => {
    if (!decryptedFiles || decryptedFiles.length === 0 || !dropData) return;

    try {
      addToast(`Downloading ${decryptedFiles.length} file(s)...`, 'info');
      decryptedFiles.forEach((file, index) => {
        setTimeout(() => {
          downloadSingle(file.fileBlob, file.fileName);
        }, index * 350);
      });

      const updated = await incrementDownload(dropData.code);
      if (updated?.deletedAfterDownload) {
        addToast('All files downloaded! Note: 1-time drop removed.', 'info');
      }
      if (updated) setDropData(updated);
    } catch (err) {
      console.error('Download error:', err);
      addToast('Failed to download files.', 'error');
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const currentFile = decryptedFiles[activeFileIndex] || decryptedFiles[0];

  return (
    <div className="glass-panel" style={{ padding: '36px 28px', maxWidth: '720px', margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h2 className="gradient-text" style={{ fontSize: '2rem', marginBottom: '8px' }}>
          Access & Claim Shared Files
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Enter the 6-character drop code to preview and download up to 5 shared files.
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
            Total Size: {formatSize(dropData.fileSize)} • {dropData.files?.length || 1} file(s)
          </p>

          {/* Password Protection Form */}
          {dropData.isEncrypted && decryptedFiles.length === 0 && (
            <form onSubmit={handleDecrypt} style={{
              background: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '12px',
              padding: '20px',
              marginTop: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-secondary)', marginBottom: '12px' }}>
                <Lock size={20} />
                <h4 style={{ margin: 0 }}>This drop is password protected ({dropData.files?.length || 1} files)</h4>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="option-input"
                    placeholder="Enter secret password..."
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ width: '100%', paddingRight: '36px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? "Hide password" : "Show password"}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted, #94a3b8)',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <button type="submit" className="btn-primary" style={{ flexShrink: 0 }}>
                  <Key size={16} /> Unlock All
                </button>
              </div>
              {passwordError && (
                <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '6px' }}>
                  Incorrect password. Please verify and try again.
                </p>
              )}
            </form>
          )}

          {/* Decrypted File Preview & Multi-file Switcher */}
          {decryptedFiles.length > 0 && currentFile && (
            <div>
              {/* Multi-file Tabs */}
              {decryptedFiles.length > 1 && (
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  overflowX: 'auto',
                  paddingBottom: '10px',
                  marginBottom: '14px',
                  borderBottom: '1px solid var(--border-glass)'
                }}>
                  {decryptedFiles.map((file, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveFileIndex(idx)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '8px',
                        border: idx === activeFileIndex ? '1px solid var(--color-primary)' : '1px solid var(--border-glass)',
                        background: idx === activeFileIndex ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        color: idx === activeFileIndex ? 'var(--color-primary)' : 'var(--text-muted)',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                        fontWeight: idx === activeFileIndex ? 600 : 400
                      }}
                    >
                      <FileText size={14} />
                      <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.fileName}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <FilePreview
                fileBlob={currentFile.fileBlob}
                fileName={currentFile.fileName}
                fileType={currentFile.fileType}
              />

              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '20px', flexWrap: 'wrap' }}>
                <button
                  className="btn-primary"
                  onClick={handleDownloadActive}
                  style={{ padding: '14px 28px', fontSize: '1rem' }}
                >
                  <Download size={18} />
                  Download {decryptedFiles.length > 1 ? `File (${activeFileIndex + 1}/${decryptedFiles.length})` : 'File'}
                </button>

                {decryptedFiles.length > 1 && (
                  <button
                    className="btn-secondary"
                    onClick={handleDownloadAll}
                    style={{ padding: '14px 28px', fontSize: '1rem', background: 'rgba(139, 92, 246, 0.15)', border: '1px solid rgba(139, 92, 246, 0.4)', color: 'var(--color-secondary)' }}
                  >
                    <Layers size={18} />
                    Download All ({decryptedFiles.length} Files)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
