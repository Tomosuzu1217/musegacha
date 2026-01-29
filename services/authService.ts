import { auth } from './firebaseConfig';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  User,
} from 'firebase/auth';

const provider = new GoogleAuthProvider();

export const signInWithGoogle = () => signInWithPopup(auth, provider);

export const signOut = () => firebaseSignOut(auth);

export const onAuthStateChanged = (cb: (user: User | null) => void) =>
  firebaseOnAuthStateChanged(auth, cb);

export const getCurrentUser = (): User | null => auth.currentUser;

export type { User };
