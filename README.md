# ⚡ Droply - Instant, Secure & Ephemeral File Sharing

<div align="center">

![Droply Banner](https://img.shields.io/badge/Droply-Instant%20File%20Sharing-06b6d4?style=for-the-badge&logo=cloud&logoColor=white)

[![React](https://img.shields.io/badge/React-18.3.1-61dafb?style=flat-square&logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0.7-646cff?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Security](https://img.shields.io/badge/Encryption-AES--256--GCM-8b5cf6?style=flat-square&logo=lock&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
[![Storage](https://img.shields.io/badge/Storage-IndexedDB%20%2B%20BroadcastChannel-10b981?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![License](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](LICENSE)

<p align="center">
  <b>Drop files. Share instantly. Zero servers required.</b><br>
  A modern, high-speed, privacy-first temporary file sharing application built with client-side Web Crypto encryption, IndexedDB persistence, and real-time cross-tab synchronization.
</p>

[Key Features](#-key-features) • [Architecture](#-architecture--security-model) • [Project Structure](#-project-structure) • [Tech Stack](#-technology-stack) • [Getting Started](#-getting-started) • [Usage Guide](#-usage-guide) • [Security](#-security--privacy-guarantees)

</div>

---

## 📖 Overview

**Droply** simplifies temporary file sharing without requiring account registration, cloud subscription lock-in, or exposing unencrypted private data over third-party servers. 

Users can drag and drop up to **5 files simultaneously**, configure self-destruct timers or burn-after-reading policies, lock bundles with military-grade **AES-GCM 256-bit encryption**, and generate instant **6-character short codes** (`DROP-XXXX`) or direct shareable deep links.

---

## ✨ Key Features

### 📁 Multi-File Bundling & Drag-and-Drop
- Drag-and-drop or file picker support for up to **5 files per drop** (documents, images, videos, audio, archives, source code) up to 500MB total.
- Aggregated file size calculation with individual item management and removal before sharing.

### 🔐 Zero-Knowledge End-to-End Encryption (E2EE)
- Client-side encryption powered by the **Web Crypto API (`crypto.subtle`)**.
- **PBKDF2** key derivation with 100,000 SHA-256 iterations and a cryptographically secure random 16-byte salt.
- **AES-GCM 256-bit** encryption with a 12-byte initialization vector (IV).
- Passwords are never stored or transmitted; decryption occurs strictly in-memory on the recipient's machine.

### ⏱️ Flexible Expiry & Self-Destruct Modes
- **Configurable Expiration Timers**: 10 Minutes, 1 Hour, 24 Hours (Default), 7 Days, 30 Days, 1 Year, or Permanent.
- **Burn After Reading (1-Time Download)**: Automatic instantaneous deletion from storage as soon as the recipient downloads the drop.
- **Automatic Garbage Collection**: Expired drops are automatically pruned during database reads and dashboard polling.

### 🚀 Instant Claim Codes & Deep Links
- Easy-to-share **6-character short codes** formatted as `DROP-XXXX` using an unambiguous alphanumeric charset (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- **Direct Shareable URL**: Generate links with auto-fill query parameters (`?code=DROP-XXXX`) that automatically launch the claim flow.
- Standalone Base64 payload encoding for lightweight files (<800KB) directly inside URL hashes.

### 👁️ Rich In-Browser File Previews
- Native multimedia previewing before downloading:
  - 🖼️ **Images**: Direct image rendering (PNG, JPG, SVG, WebP, GIF).
  - 🎥 **Videos**: HTML5 interactive video player with controls (MP4, WebM, OGG).
  - 🎵 **Audio**: HTML5 interactive audio player (MP3, WAV, AAC, FLAC).
  - 📄 **PDFs**: Embedded PDF preview frame.
  - 💻 **Code & Text**: Syntax-safe preview of code files, JSON, Markdown, and plain text.
- Individual download or **"Download All"** multi-file download stream with staggered triggers.

### 📊 "My Drops" Local Management Dashboard
- Real-time monitoring of all files dropped from the local device.
- Live download counters, remaining time countdowns, one-click code/link copying, and manual deletion controls.

### ⚡ Real-Time Cross-Tab Sync & Micro-Animations
- Multi-tab synchronization utilizing the **BroadcastChannel API** (`DROP_CREATED`, `DROP_UPDATED`, `DROP_DELETED`).
- Confetti celebration effects on creation (`canvas-confetti`), floating toast notifications, and password show/hide toggles.
- Premium **Cyberpunk Glassmorphic Dark UI** with responsive layout for mobile, tablet, and desktop.

---

## 🏗 Architecture & Security Model

### 1. Cryptographic Pipeline (AES-GCM + PBKDF2)

```
[ User File (ArrayBuffer/Blob) ] + [ User Password ]
                 │
                 ├──► Generate 16-byte Crypto Random Salt
                 ├──► Generate 12-byte Crypto Random IV
                 ├──► PBKDF2 (100,000 Iterations, SHA-256) ──► 256-bit AES Key
                 └──► AES-GCM Encrypt(Data, Key, IV)
                                 │
                                 ▼
       [ Packed Payload: 16B Salt + 12B IV + Encrypted Data ]
                                 │
                                 ▼
                     Stored in Local IndexedDB
```

When claiming:
1. The 28-byte header (`Salt` + `IV`) is sliced from the encrypted payload.
2. The user enters the password, deriving the symmetric key via PBKDF2 with the extracted salt.
3. `crypto.subtle.decrypt` recovers the original Blob and restores its MIME type.

### 2. Storage & Sync Architecture

```
┌────────────────────────────────────────────────────────┐
│                      Droply Client                     │
├──────────────────────────┬─────────────────────────────┤
│      React App (UI)      │       Storage Service       │
│  - DropZone (Upload)     │  - IndexedDB (DroplyDB)     │
│  - ClaimFile (Download)  │  - Expiration Garbage Coll. │
│  - MyDrops (Dashboard)   │  - BroadcastChannel Sync    │
│  - FilePreview (Render)  │  - URL Hash Encoder         │
└──────────────────────────┴─────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
  [ IndexedDB (drops) ]           [ BroadcastChannel ]
  - code (Primary Key)            - Cross-tab notifications
  - files (Array of Blobs)        - Real-time active counts
  - expiresAt & expiryType        - Instant delete sync
  - downloadsCount
```

---

## 📂 Project Structure

```
Droply/
├── public/                     # Static assets
├── src/
│   ├── components/
│   │   ├── ClaimFile.jsx       # Drop claiming, password decryptor & multi-file viewer
│   │   ├── DropZone.jsx        # Multi-file drag & drop, encryption & expiry settings
│   │   ├── FilePreview.jsx     # Multimedia preview engine (Images, Video, Audio, PDF, Text)
│   │   ├── MyDrops.jsx         # Active drops dashboard, metrics & management
│   │   ├── Navbar.jsx          # Top navigation bar with active count badge
│   │   ├── ShareModal.jsx      # Modal with share code, copy link & confetti
│   │   └── Toast.jsx           # Animated floating notifications
│   ├── services/
│   │   ├── crypto.js           # Web Crypto API wrapper (PBKDF2 & AES-256-GCM)
│   │   └── storage.js          # IndexedDB manager, BroadcastChannel & URL hash utilities
│   ├── App.jsx                 # Root component with URL query handling & routing state
│   ├── index.css               # Core CSS variables, glassmorphism system & animations
│   └── main.jsx                # React DOM root entry point
├── index.html                  # HTML entry point with font preloads & meta tags
├── package.json                # Project dependencies and npm scripts
├── vite.config.js              # Vite bundler configuration
└── README.md                   # Project documentation
```

---

## 🛠 Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend Framework** | [React 18](https://reactjs.org/) (Hooks, StrictMode, Functional Components) |
| **Build Tool & Dev Server** | [Vite 6](https://vitejs.dev/) |
| **Cryptography** | Native [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) (`SubtleCrypto` AES-GCM 256-bit, PBKDF2) |
| **Local Persistence** | Native [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) |
| **Inter-Process Sync** | Native [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) |
| **Icons & Visuals** | [Lucide React](https://lucide.dev/), [Canvas Confetti](https://www.npmjs.com/package/canvas-confetti) |
| **Styling & Theme** | Modern Glassmorphism CSS Design System + Tailwind CSS Utilities |
| **Typography** | `Plus Jakarta Sans`, `Inter`, `JetBrains Mono` |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v18.0.0 or higher recommended)
- **npm** or **yarn** / **pnpm**

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Anmol-Gautamm/Droply.git
   cd Droply
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local development server:**
   ```bash
   npm run dev
   ```
   The application will be running at `http://localhost:5173`.

4. **Build for production:**
   ```bash
   npm run build
   ```
   The production-ready bundle will be output to the `dist/` directory.

5. **Preview production build:**
   ```bash
   npm run preview
   ```

---

## 🎯 Usage Guide

### 1. Dropping & Sharing Files
1. Navigate to the **Drop File** tab.
2. Drag and drop up to 5 files into the drop area or click to browse.
3. Choose an **Expiration Timer** (e.g. 10m, 24h, or *Delete after 1 download*).
4. *(Optional)* Toggle **Password Protection** and enter a secret password.
5. Click **Share Files**. A modal appears displaying your unique `DROP-XXXX` code and direct link.

### 2. Claiming Files
1. Navigate to the **Claim Code** tab (or open a direct link like `https://droply.app/?code=DROP-8492`).
2. Enter the 6-character short code and click **Claim**.
3. If the drop is encrypted, enter the password and click **Unlock All**.
4. Use the in-browser media preview to inspect files, switch between bundled files, or click **Download File** / **Download All**.

### 3. Managing Drops
1. Navigate to the **My Drops** tab.
2. View all active drops, expiration status, and download counters.
3. Quick copy codes, copy share links, or permanently delete drops immediately.

---

## 🔒 Security & Privacy Guarantees

- **Zero Cloud Transmission**: Files are processed locally on the client's device.
- **True End-to-End Encryption**: Encrypted blobs can only be decrypted with the original password using high-iteration PBKDF2 key derivation.
- **Ephemeral By Design**: Expirations and single-download deletion policies guarantee that files do not linger past their intended lifecycle.
- **No Trackers or Analytics**: No user tracking, no session cookies, and no third-party telemetry.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/Anmol-Gautamm/Droply/issues).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

<div align="center">
  <sub>Built with 💙 for secure and seamless file sharing.</sub>
</div>