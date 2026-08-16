import React, { useState, useEffect } from 'react';
import { getAllDrops, deleteDrop, subscribeToBroadcast } from '../services/storage';
import { Copy, Trash2, Shield, Clock, HardDrive, Download, ExternalLink } from 'lucide-react';

export default function MyDrops({ onSelectDrop, addToast }) {
  const [drops, setDrops] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDrops = async () => {
    try {
      const list = await getAllDrops();
      setDrops(list);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDrops();
    const unsubscribe = subscribeToBroadcast(() => {
      loadDrops();
    });
    return () => unsubscribe();
  }, []);

  const handleDelete = async (code) => {
    try {
      await deleteDrop(code);
      addToast(`Drop ${code} deleted.`, 'info');
      loadDrops();
    } catch (err) {
      console.error(err);
      addToast('Failed to delete drop.', 'error');
    }
  };

  const copyToClipboard = (text, label) => {
    navigator.clipboard.writeText(text);
    addToast(`${label} copied!`, 'success');
  };

  const formatSize = (bytes) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatExpiry = (drop) => {
    if (drop.expiryType === '1time') return 'Deletes after 1 download';
    if (!drop.expiresAt) return 'No expiry';
    const remainingMs = drop.expiresAt - Date.now();
    if (remainingMs <= 0) return 'Expired';

    const mins = Math.floor(remainingMs / (1000 * 60));
    if (mins < 60) return `${mins} mins remaining`;
    const hours = Math.floor(mins / 60);
    return `${hours} hrs remaining`;
  };

  if (isLoading) {
    return (
      <div className="glass-panel" style={{ padding: '40px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)' }}>Loading active drops...</p>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '36px 28px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h2 className="gradient-text" style={{ fontSize: '1.8rem', marginBottom: '4px' }}>
            My Active Drops
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Manage files dropped from this device and track download counts.
          </p>
        </div>
        <div style={{
          background: 'rgba(6, 182, 212, 0.1)',
          color: 'var(--color-primary)',
          padding: '8px 16px',
          borderRadius: '12px',
          fontFamily: 'var(--font-heading)',
          fontWeight: 600
        }}>
          {drops.length} Active Drops
        </div>
      </div>

      {drops.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
          <HardDrive size={48} style={{ opacity: 0.4, marginBottom: '12px' }} />
          <h3>No Active Drops Found</h3>
          <p style={{ fontSize: '0.85rem', marginTop: '4px' }}>
            Files you drop will appear here for easy management and link copying.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="drops-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>File Name</th>
                <th>Size</th>
                <th>Expiration</th>
                <th>Downloads</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {drops.map((drop) => {
                const shareUrl = `${window.location.origin}${window.location.pathname}?code=${drop.code}`;
                return (
                  <tr key={drop.code}>
                    <td>
                      <span className="code-badge" style={{ fontSize: '0.95rem', padding: '4px 10px' }}>
                        {drop.code}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                        {drop.fileName}
                        {drop.files && drop.files.length > 1 && (
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)', marginLeft: '6px', fontWeight: 500 }}>
                            ({drop.files.length} files)
                          </span>
                        )}
                      </div>
                      {drop.isEncrypted && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Shield size={12} /> Encrypted
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{formatSize(drop.fileSize)}</td>
                    <td style={{ color: 'var(--color-warning)' }}>{formatExpiry(drop)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                        <Download size={14} color="var(--color-primary)" />
                        {drop.downloadsCount || 0}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          className="btn-secondary"
                          onClick={() => copyToClipboard(drop.code, 'Code')}
                          title="Copy Code"
                          style={{ padding: '6px 10px' }}
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => copyToClipboard(shareUrl, 'Link')}
                          title="Copy Share Link"
                          style={{ padding: '6px 10px' }}
                        >
                          <ExternalLink size={14} />
                        </button>
                        <button
                          className="btn-danger"
                          onClick={() => handleDelete(drop.code)}
                          title="Delete Drop"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
