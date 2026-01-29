import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyByoJrmYT3_DjDedd4rREEMXveLqCme-1w",
  authDomain: "radio-studio-b11c1.firebaseapp.com",
  projectId: "radio-studio-b11c1",
  storageBucket: "radio-studio-b11c1.firebasestorage.app",
  messagingSenderId: "716405032428",
  appId: "1:716405032428:web:e6509f01d9b6300ae2acc9",
  measurementId: "G-4RCX448XR4"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Enable offline persistence for multi-tab support
enableMultiTabIndexedDbPersistence(db).catch((err: any) => {
  if (err.code === 'failed-precondition') {
    console.warn('Firestore persistence: Multiple tabs open, persistence enabled in first tab only.');
  } else if (err.code === 'unimplemented') {
    console.warn('Firestore persistence: Browser does not support persistence.');
  }
});
