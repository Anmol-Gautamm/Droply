import React, { useState, useRef } from 'react';
import { UploadCloud, File, Lock, Clock, Sparkles, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { encryptFile } from '../services/crypto';
import { saveDrop } from '../services/storage';

export default function DropZone({ onDropCreated, addToast }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
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

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleCreateDrop = async () => {
    if (!selectedFile) return;

    try {
      setIsProcessing(true);
      let fileToStore = selectedFile;
      let isEncrypted = false;

      if (enablePassword && password.trim()) {
        fileToStore = await encryptFile(selectedFile, password.trim());
        isEncrypted = true;
      }

      const dropRecord = await saveDrop({
        fileBlob: fileToStore,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
        expiryType,
        isEncrypted,
        password: isEncrypted ? password.trim() : null
      });

      addToast('File dropped successfully! Code generated.', 'success');
      onDropCreated(dropRecord);
      
      // Reset form
      setSelectedFile(null);
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
          Drag a file to generate a 6-character sharing code & link instantly.
        </p>
      </div>

      {/* Drag & Drop Area */}
      <div
        className={`dropzone-container ${dragActive ? 'drag-active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        <div className="dropzone-icon-pulse">
          <UploadCloud size={36} />
        </div>

        {selectedFile ? (
          <div>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--color-success)',
              fontWeight: 600,
              marginBottom: '6px'
            }}>
              <CheckCircle size={18} /> File Ready
            </span>
            <h3 style={{ color: 'var(--text-main)', fontSize: '1.1rem', marginBottom: '4px' }}>
              {selectedFile.name}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {formatSize(selectedFile.size)} • {selectedFile.type || 'Unknown type'}
            </p>
          </div>
        ) : (
          <div>
            <h3 style={{ color: 'var(--text-main)', fontSize: '1.2rem', marginBottom: '6px' }}>
              Drop your file here, or <span style={{ color: 'var(--color-primary)' }}>browse</span>
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Supports documents, images, videos, code, audio, and archives up to 500MB
            </p>
          </div>
        )}
      </div>

      {/* Configuration Options */}
      {selectedFile && (
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
              {isProcessing ? 'Generating Drop Code...' : 'Get Share Code & Link'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
