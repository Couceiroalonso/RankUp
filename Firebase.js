import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";
 
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
