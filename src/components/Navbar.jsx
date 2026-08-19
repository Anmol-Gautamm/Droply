import React from 'react';
import { UploadCloud, Download, HardDrive, Shield } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, activeCount }) {
  return (
    <nav className="glass-panel navbar" role="navigation" aria-label="Main navigation">
      <a
        href="#"
        className="brand-logo"
        aria-label="Droply Homepage"
        onClick={(e) => { e.preventDefault(); setActiveTab('upload'); }}
      >
        <div className="logo-icon" aria-hidden="true">
          <UploadCloud size={24} />
        </div>
        <div>
          <span className="gradient-text">Droply</span>
          <span style={{ fontSize: '0.75rem', display: 'block', fontWeight: 400, color: 'var(--text-muted)' }}>
            Instant File Sharing
          </span>
        </div>
      </a>

      <div className="nav-tabs" role="tablist" aria-label="Droply navigation options">
        <button
          role="tab"
          aria-selected={activeTab === 'upload'}
          aria-label="Drop File tab"
          className={`nav-tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
          onClick={() => setActiveTab('upload')}
        >
          <UploadCloud size={18} aria-hidden="true" />
          Drop File
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'claim'}
          aria-label="Claim Code tab"
          className={`nav-tab-btn ${activeTab === 'claim' ? 'active' : ''}`}
          onClick={() => setActiveTab('claim')}
        >
          <Download size={18} aria-hidden="true" />
          Claim Code
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'drops'}
          aria-label={`My Drops tab${activeCount > 0 ? `, ${activeCount} active` : ''}`}
          className={`nav-tab-btn ${activeTab === 'drops' ? 'active' : ''}`}
          onClick={() => setActiveTab('drops')}
        >
          <HardDrive size={18} aria-hidden="true" />
          My Drops
          {activeCount > 0 && (
            <span
              aria-label={`${activeCount} active drops`}
              style={{
                background: 'var(--color-primary)',
                color: '#000',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: '10px'
              }}
            >
              {activeCount}
            </span>
          )}
        </button>
      </div>
    </nav>
  );
}
