import React from 'react';
import { UploadCloud, Download, HardDrive, Shield } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, activeCount }) {
  return (
    <nav className="glass-panel navbar">
      <a href="#" className="brand-logo" onClick={(e) => { e.preventDefault(); setActiveTab('upload'); }}>
        <div className="logo-icon">
          <UploadCloud size={24} />
        </div>
        <div>
          <span className="gradient-text">Droply</span>
          <span style={{ fontSize: '0.75rem', display: 'block', fontWeight: 400, color: 'var(--text-muted)' }}>
            Instant File Sharing
          </span>
        </div>
      </a>

      <div className="nav-tabs">
        <button
          className={`nav-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          <UploadCloud size={18} />
          Drop File
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'claim' ? 'active' : ''}`}
          onClick={() => setActiveTab('claim')}
        >
          <Download size={18} />
          Claim Code
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'drops' ? 'active' : ''}`}
          onClick={() => setActiveTab('drops')}
        >
          <HardDrive size={18} />
          My Drops
          {activeCount > 0 && (
            <span style={{
              background: 'var(--color-primary)',
              color: '#000',
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '2px 7px',
              borderRadius: '10px'
            }}>
              {activeCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
