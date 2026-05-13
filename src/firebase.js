// ───────────────────────────────────────────────────────────────
// FIREBASE CONFIG
// ───────────────────────────────────────────────────────────────
// Replace the values below with the ones from your Firebase project.
// See FIREBASE_SETUP.md for step-by-step instructions on where to
// find these values.
//
// IMPORTANT: These values are safe to commit to a public repo.
// They identify your project but don't grant any permissions on
// their own — security comes from the Firestore rules you set up
// in the Firebase console.
// ───────────────────────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDq_31sylJDyMiMxlZgPfkSeJS9_6V4Mw0",
  authDomain: "parents-retirement-dashboard.firebaseapp.com",
  projectId: "parents-retirement-dashboard",
  storageBucket: "parents-retirement-dashboard.firebasestorage.app",
  messagingSenderId: "334153870679",
  appId: "1:334153870679:web:0c01612bcce2f7628ba212",
};

// Check if Firebase is configured. If not, we fall back to localStorage.
export const isFirebaseConfigured =
  !firebaseConfig.apiKey.startsWith('PASTE_') &&
  !firebaseConfig.projectId.startsWith('PASTE_');

let db = null;
if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

// The household ID — everyone with this app shares this one document.
// You can change this if you ever want to "reset" to a fresh shared dataset.
const HOUSEHOLD_ID = 'household_v1';

export async function cloudLoad(key, fallback) {
  if (!db) return fallback;
  try {
    const ref = doc(db, 'households', HOUSEHOLD_ID);
    const snap = await getDoc(ref);
    if (!snap.exists()) return fallback;
    const data = snap.data();
    return key in data ? data[key] : fallback;
  } catch (e) {
    console.error('Cloud load failed:', e);
    return fallback;
  }
}

export async function cloudSave(key, value) {
  if (!db) return;
  try {
    const ref = doc(db, 'households', HOUSEHOLD_ID);
    await setDoc(ref, { [key]: value, updatedAt: Date.now() }, { merge: true });
  } catch (e) {
    console.error('Cloud save failed:', e);
  }
}

// Subscribe to real-time changes from the cloud. Returns an unsubscribe fn.
export function cloudSubscribe(onUpdate) {
  if (!db) return () => {};
  const ref = doc(db, 'households', HOUSEHOLD_ID);
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) onUpdate(snap.data());
  }, (err) => {
    console.error('Cloud subscribe failed:', err);
  });
}
