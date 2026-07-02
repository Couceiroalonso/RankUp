import { initializeApp, deleteApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updatePassword,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD5g7Pqf3AYuf3TOnmyjhoH4gcjlVQTSFg",
  authDomain: "rankup-c8c59.firebaseapp.com",
  databaseURL: "https://rankup-c8c59-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "rankup-c8c59",
  storageBucket: "rankup-c8c59.firebasestorage.app",
  messagingSenderId: "726734884078",
  appId: "1:726734884078:web:6698c3650a32f20fc4b7ff"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export const fbSet = (path, data) =>
  set(ref(db, path), data).catch(e => console.log("FB write error:", e));

export const fbGet = async (path) => {
  try {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
  } catch(e) {
    console.log("FB read error:", e);
    return null;
  }
};

// Same as fbGet but RE-THROWS on failure instead of swallowing it.
// Used in the handful of places (like re-registering an account) where it's
// critical to tell "genuinely no data" apart from "couldn't check right now" —
// mistaking the second for the first is what can wipe someone's progress.
export const fbGetStrict = async (path) => {
  const snap = await get(ref(db, path));
  return snap.exists() ? snap.val() : null;
};

// ─── AUTH ──────────────────────────────────────────────────────────────────
// Real Firebase Authentication. Replaces the old client-side base64 "hash"
// check — Firebase now verifies credentials server-side and issues an ID
// token that the Realtime Database security rules can require (auth != null).

export const fbLogin = (email, password) =>
  signInWithEmailAndPassword(auth, email, password);

export const fbSignup = (email, password) =>
  createUserWithEmailAndPassword(auth, email, password);

export const fbLogout = () => signOut(auth).catch(()=>{});

export const fbResetPassword = (email) =>
  sendPasswordResetEmail(auth, email);

// Lets the currently signed-in user change their own password.
export const fbUpdateOwnPassword = (newPassword) =>
  updatePassword(auth.currentUser, newPassword);

// Admin creates a brand-new account for someone else. Firebase's client SDK
// normally signs you in AS the account you just created, which would kick
// the admin out of their own session — so this spins up a throwaway
// secondary Firebase App instance just for the create call, then tears it
// down immediately. The admin's real session in `auth` is never touched.
export const fbAdminCreateUser = async (email, password) => {
  const secondaryApp = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    await createUserWithEmailAndPassword(secondaryAuth, email, password);
  } finally {
    await signOut(secondaryAuth).catch(()=>{});
    await deleteApp(secondaryApp).catch(()=>{});
  }
};
