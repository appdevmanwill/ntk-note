import { initializeApp } from "firebase/app";
import { 
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";

const requiredEnv = (key: keyof ImportMetaEnv) => {
  const envObj = (typeof import.meta !== 'undefined' && import.meta.env)
    ? import.meta.env
    : (typeof process !== 'undefined' && process.env ? process.env : {});
  const value = (envObj as Record<string, string | undefined>)[key];
  if (!value) {
    if (typeof process !== 'undefined') {
      return 'test-mock-firebase-val';
    }
    throw new Error(`Missing Firebase environment variable: ${key}`);
  }
  return value;
};

const firebaseConfig = {
  apiKey: requiredEnv("VITE_FIREBASE_API_KEY"),
  authDomain: requiredEnv("VITE_FIREBASE_AUTH_DOMAIN"),
  projectId: requiredEnv("VITE_FIREBASE_PROJECT_ID"),
  storageBucket: requiredEnv("VITE_FIREBASE_STORAGE_BUCKET"),
  messagingSenderId: requiredEnv("VITE_FIREBASE_MESSAGING_SENDER_ID"),
  appId: requiredEnv("VITE_FIREBASE_APP_ID"),
  measurementId: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_FIREBASE_MEASUREMENT_ID) || undefined
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore with modern modular multi-tab offline persistence
let db: ReturnType<typeof getFirestore>;
try {
  if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
    db = initializeFirestore(app, {
      ...(import.meta.env?.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'
        ? { experimentalForceLongPolling: true } : {}),
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager()
      })
    });
  } else {
    db = getFirestore(app);
  }
} catch {
  db = getFirestore(app);
}

// Initialize Auth
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// The browser suite uses only local emulators and a demo project. Production
// builds cannot enable this branch, even when a test variable is left set.
if (import.meta.env?.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  if (!firebaseConfig.projectId.startsWith('demo-')) throw new Error('Emulator tests require a demo Firebase project.');
  connectFirestoreEmulator(db, '127.0.0.1', 8089);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

export { app, db, auth, googleProvider };

