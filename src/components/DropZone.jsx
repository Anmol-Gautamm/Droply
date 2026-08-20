import React, { useState, useRef } from 'react';
import { UploadCloud, File, Lock, Clock, Sparkles, CheckCircle, Eye, EyeOff, X, Plus, Trash2 } from 'lucide-react';
import { encryptFile } from '../services/crypto';
import { saveDrop } from '../services/storage';

export default function DropZone({ onDropCreated, addToast }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [expiryType, setExpiryType] = useState('24h');
  const [password, setPassword] = useState('');
  const [enablePassword, setEnablePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleIncomingFiles = (newFiles) => {
    if (!newFiles || newFiles.length === 0) return;
    const incoming = Array.from(newFiles);
    
    setSelectedFiles((prev) => {
      const available = 5 - prev.length;
      if (available <= 0) {
        addToast('Maximum 5 files limit reached.', 'error');
        return prev;
      }
      const toAdd = incoming.slice(0, available);
      if (incoming.length > available) {
        addToast(`Maximum 5 files allowed. Added ${toAdd.length} file(s).`, 'info');
      } else {
        addToast(`Added ${toAdd.length} file(s) for sharing.`, 'success');
      }
      return [...prev, ...toAdd];
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleIncomingFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleIncomingFiles(e.target.files);
      e.target.value = ''; // Reset input to allow selecting same file again
    }
  };

  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const totalBytes = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);

  const handleCreateDrop = async () => {
    if (selectedFiles.length === 0) return;

    try {
      setIsProcessing(true);
      const processedFiles = [];

      for (const file of selectedFiles) {
        let fileBlob = file;
        if (enablePassword && password.trim()) {
          fileBlob = await encryptFile(file, password.trim());
        }
        processedFiles.push({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileBlob: fileBlob
        });
      }

      const dropRecord = await saveDrop({
        files: processedFiles,
        expiryType,
        isEncrypted: enablePassword && Boolean(password.trim()),
        password: enablePassword ? password.trim() : null
      });

      addToast(`File drop created with ${processedFiles.length} file(s)!`, 'success');
      onDropCreated(dropRecord);
      
      // Reset form
      setSelectedFiles([]);
      setPassword('');
      setEnablePassword(false);
    } catch (err) {
      console.error(err);
      addToast('Failed to create drop: ' + err.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '36px 28px' }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h2 className="gradient-text" style={{ fontSize: '2rem', marginBottom: '8px' }}>
          Drop & Share Anything
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Share multiple files together with instant code and encrypted links.
        </p>
      </div>

      {/* Drag & Drop Area */}
      <div
        className={`dropzone-container ${dragActive ? 'drag-active' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload files dropzone. Drag files here or press Enter to browse files."
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={(e) => {
          if (e.target.closest('.btn-remove-file') || e.target.closest('.action-btn-pill')) return;
          fileInputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target.closest('.btn-remove-file') || e.target.closest('.action-btn-pill')) return;
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          multiple
          aria-hidden="true"
          style={{ display: 'none' }}
        />

        <div className="dropzone-icon-pulse">
          <UploadCloud size={36} />
        </div>

        {selectedFiles.length > 0 ? (
          <div style={{ width: '100%', maxWidth: '460px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                color: 'var(--color-success)',
                fontWeight: 600,
                fontSize: '0.9rem'
              }}>
                <CheckCircle size={16} /> {selectedFiles.length} File{selectedFiles.length > 1 ? 's' : ''} Ready
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>
                Total: {formatSize(totalBytes)}
              </span>
            </div>

            {/* List of files */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px', marginBottom: '14px' }}>
              {selectedFiles.map((file, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'rgba(13, 20, 33, 0.7)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: '8px',
                    fontSize: '0.85rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <File size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>
                      {file.name}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
                      ({formatSize(file.size)})
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-remove-file"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(idx);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      padding: '2px'
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              {selectedFiles.length < 5 && (
                <button
                  type="button"
                  className="action-btn-pill"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{
                    background: 'rgba(6, 182, 212, 0.1)',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    color: 'var(--color-primary)',
                    padding: '6px 14px',
                    borderRadius: '20px',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={14} /> Add Files
                </button>
              )}
              <button
                type="button"
                className="action-btn-pill"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFiles([]);
                }}
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: 'var(--color-danger)',
                  padding: '6px 14px',
                  borderRadius: '20px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Trash2 size={14} /> Clear All
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 style={{ color: 'var(--text-main)', fontSize: '1.2rem', marginBottom: '6px' }}>
              Drop up to 5 files here, or <span style={{ color: 'var(--color-primary)' }}>browse</span>
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Supports documents, images, videos, code, audio, and archives up to 500MB total
            </p>
          </div>
        )}
      </div>

      {/* Configuration Options */}
      {selectedFiles.length > 0 && (
        <div style={{ marginTop: '28px' }}>
          <div className="options-grid">
            {/* Expiration selection */}
            <div className="option-group">
              <label className="option-label">
                <Clock size={16} color="var(--color-primary)" />
                Expiration Timer
              </label>
              <select
                className="option-select"
                value={expiryType}
                onChange={(e) => setExpiryType(e.target.value)}
              >
                <option value="10m">10 Minutes</option>
                <option value="1h">1 Hour</option>
                <option value="24h">24 Hours (Default)</option>
                <option value="7d">7 Days</option>
                <option value="30d">30 Days</option>
                <option value="1y">1 Year (Long Term)</option>
                <option value="never">Permanent (No Expiration)</option>
                <option value="1time">Delete after 1 download</option>
              </select>
            </div>

            {/* Password protection toggle */}
            <div className="option-group">
              <label className="option-label">
                <Lock size={16} color="var(--color-secondary)" />
                Password Protection
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  id="enablePass"
                  checked={enablePassword}
                  onChange={(e) => setEnablePassword(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'var(--color-secondary)', cursor: 'pointer' }}
                />
                <label htmlFor="enablePass" style={{ fontSize: '0.9rem', color: 'var(--text-main)', cursor: 'pointer' }}>
                  Encrypt with password
                </label>
              </div>

              {enablePassword && (
                <div style={{ position: 'relative', marginTop: '4px', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    className="option-input"
                    placeholder="Set secret password..."
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
              )}
            </div>
          </div>

          <div style={{ textAlign: 'center', marginTop: '28px' }}>
            <button
              className="btn-primary"
              onClick={handleCreateDrop}
              disabled={isProcessing}
              style={{ padding: '14px 36px', fontSize: '1.05rem', width: '100%', maxWidth: '360px' }}
            >
              <Sparkles size={20} />
              {isProcessing ? 'Generating Drop Code...' : `Share ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
