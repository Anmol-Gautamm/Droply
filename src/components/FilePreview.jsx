import React, { useState, useEffect } from 'react';
import { FileText, Image as ImageIcon, Music, Video, FileArchive, FileCode, File } from 'lucide-react';

export default function FilePreview({ fileBlob, fileName, fileType }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [textContent, setTextContent] = useState(null);

  useEffect(() => {
    if (!fileBlob) return;

    const url = URL.createObjectURL(fileBlob);
    setObjectUrl(url);

    // Read text/code preview if text file or json
    if (fileType?.startsWith('text/') || fileType?.includes('json') || fileType?.includes('javascript') || fileType?.includes('html')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        // Limit preview text length
        setTextContent(text.length > 2000 ? text.substring(0, 2000) + '\n... [preview truncated]' : text);
      };
      reader.readAsText(fileBlob.slice(0, 5000));
    }

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [fileBlob, fileType]);

  if (!fileBlob) return null;

  const isImage = fileType?.startsWith('image/');
  const isVideo = fileType?.startsWith('video/');
  const isAudio = fileType?.startsWith('audio/');
  const isPdf = fileType === 'application/pdf';
  const isText = Boolean(textContent);

  const renderIcon = () => {
    if (isImage) return <ImageIcon size={48} color="#06b6d4" />;
    if (isVideo) return <Video size={48} color="#8b5cf6" />;
    if (isAudio) return <Music size={48} color="#ec4899" />;
    if (isPdf) return <FileText size={48} color="#f59e0b" />;
    if (fileType?.includes('zip') || fileType?.includes('archive') || fileType?.includes('tar')) {
      return <FileArchive size={48} color="#10b981" />;
    }
    if (isText) return <FileCode size={48} color="#06b6d4" />;
    return <File size={48} color="#94a3b8" />;
  };

  return (
    <div className="preview-box">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {renderIcon()}
        <div>
          <h4 style={{ color: 'var(--text-main)', fontSize: '1rem', wordBreak: 'break-all' }}>{fileName}</h4>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {fileType || 'Unknown format'}
          </span>
        </div>
      </div>

      {/* Render actual media preview */}
      {isImage && objectUrl && (
        <img src={objectUrl} alt={fileName} className="preview-image" />
      )}

      {isVideo && objectUrl && (
        <video src={objectUrl} controls className="preview-video" />
      )}

      {isAudio && objectUrl && (
        <audio src={objectUrl} controls className="preview-audio" />
      )}

      {isPdf && objectUrl && (
        <iframe src={objectUrl} title={fileName} style={{ width: '100%', height: '240px', borderRadius: '8px', border: 'none' }} />
      )}

      {isText && (
        <pre className="preview-text">
          <code>{textContent}</code>
        </pre>
      )}
    </div>
  );
}
