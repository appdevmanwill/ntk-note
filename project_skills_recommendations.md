# Project Custom Skills Recommendations (NTK-note / Simple Notes)

This file contains the detailed recommendations for custom agent skills to optimize work on the **React + Vite + Tailwind + Firebase** note-taking application.

---

## 1. Firebase Security & Schema Validator
*   **Purpose**: Automatically audit, test, and deploy Firebase security rules and Firestore indexes.
*   **What it does**:
    *   Fires up the local Firestore Emulator to run security rules assertions.
    *   Compares the local `firestore.rules` against common security vulnerabilities (e.g., unauthorized read/write, missing user authentication checks).
    *   Prepares deployment commands via Firebase CLI.
*   **Why it helps**: Ensures database operations are secure without needing manual validation or trial-and-error deployments.

---

## 2. Tailwind UI Component Builder
*   **Purpose**: Design and generate premium, responsive React components conforming to your existing Tailwind CSS utility configuration.
*   **What it does**:
    *   Uses your current styling tokens (e.g., `@tailwindcss/vite` configuration) to maintain consistent padding, margins, colors, and fonts.
    *   Includes design templates for glassmorphic elements, modern dark mode toggles, cards, sidebar items, and modal dialogs.
    *   Leverages `lucide-react` for standard iconography and `clsx`/`tailwind-merge` for safe conditional classes.
*   **Why it helps**: Guarantees that any new features are styled beautifully, responsively, and seamlessly integrate with your design.

---

## 3. PWA & Offline Sync Auditor
*   **Purpose**: Inspect, test, and debug offline-first sync mechanisms and PWA service workers.
*   **What it does**:
    *   Audits `vite-plugin-pwa` and Workbox service worker caching strategies.
    *   Checks the Zustand sync queue mechanism (`src/store/index.ts` lines 717-761) to ensure offline edits are queued correctly and synced to Firestore when online status changes.
    *   Validates local storage/IndexedDB persistence strategies.
*   **Why it helps**: Makes the app robust under unstable network connections and ensures seamless synchronization with Cloud Firestore.
