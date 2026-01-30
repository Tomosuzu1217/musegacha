import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableMultiTabIndexedDbPersistence } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCIlu-Lj40XK8_g7DErSJwFvi0RglDMbf4",
  authDomain: "mental-sync.firebaseapp.com",
  projectId: "mental-sync",
  storageBucket: "mental-sync.firebasestorage.app",
  messagingSenderId: "147681542302",
  appId: "1:147681542302:web:8632ec18bed820e57afb8f",
  measurementId: "G-FQ5KB494Z2"
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
