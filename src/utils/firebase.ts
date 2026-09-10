import { initializeApp } from "firebase/app";
import { 
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

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

export { app, db, auth, googleProvider };

