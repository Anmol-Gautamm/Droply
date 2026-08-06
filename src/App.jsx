import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import DropZone from './components/DropZone';
import ShareModal from './components/ShareModal';
import ClaimFile from './components/ClaimFile';
import MyDrops from './components/MyDrops';
import Toast from './components/Toast';
import { getAllDrops, subscribeToBroadcast } from './services/storage';

export default function App() {
  const [activeTab, setActiveTab] = useState('upload');
  const [claimCode, setClaimCode] = useState('');
  const [createdDrop, setCreatedDrop] = useState(null);
  const [activeCount, setActiveCount] = useState(0);
  const [toasts, setToasts] = useState([]);

  // Check URL parameters for share code (e.g. ?code=DROP-8492)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      setClaimCode(codeParam.toUpperCase());
      setActiveTab('claim');
    }
  }, []);

  // Sync count of active drops
  const updateActiveCount = async () => {
    try {
      const drops = await getAllDrops();
      setActiveCount(drops.length);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    updateActiveCount();
    const unsubscribe = subscribeToBroadcast(() => {
      updateActiveCount();
    });
    return () => unsubscribe();
  }, []);

  const addToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      removeToast(id);
    }, 4000);
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const handleDropCreated = (dropRecord) => {
    setCreatedDrop(dropRecord);
    updateActiveCount();
  };

  return (
    <div className="app-container">
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeCount={activeCount}
      />

      <main>
        {activeTab === 'upload' && (
          <DropZone
            onDropCreated={handleDropCreated}
            addToast={addToast}
          />
        )}

        {activeTab === 'claim' && (
          <ClaimFile
            initialCode={claimCode}
            addToast={addToast}
          />
        )}

        {activeTab === 'drops' && (
          <MyDrops
            addToast={addToast}
          />
        )}
      </main>

      {/* Share Modal popup when file drop is completed */}
      {createdDrop && (
        <ShareModal
          drop={createdDrop}
          onClose={() => setCreatedDrop(null)}
          addToast={addToast}
        />
      )}

      {/* Toast Notification Container */}
      <Toast toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
