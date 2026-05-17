import { initializeApp } from "firebase/app";
import { 
  getFirestore, 
  enableIndexedDbPersistence 
} from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCHZYPqkc-Jaa8JcYWUi7f1AbW9YrzDWEc",
  authDomain: "ntk-note.firebaseapp.com",
  projectId: "ntk-note",
  storageBucket: "ntk-note.firebasestorage.app",
  messagingSenderId: "979936887998",
  appId: "1:979936887998:web:355ea2023e0d069d988aef",
  measurementId: "G-XEBLRDG7YR"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Initialize Auth
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Enable offline persistence
enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
    } else if (err.code == 'unimplemented') {
      console.warn('The current browser does not support all of the features required to enable persistence');
    }
  });

export { app, db, auth, googleProvider };
