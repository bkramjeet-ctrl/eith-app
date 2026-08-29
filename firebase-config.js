// ------------------------------------------------------------------
// This reuses the same Firebase project already set up for the
// NoMercyZone-App (see ../NoMercyZone-App/firebase-config.js) — Eith
// just stores its data under a different path ("eith/...") in the
// same Realtime Database, so no new Firebase project is needed.
//
// If you'd rather give Eith its own project, replace this with your
// own config from the Firebase console (see README.md).
// ------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyCKmaVNmO0wqbjRkp3P03ueheqyDM1rI1g",
  authDomain: "aop-of-yt.firebaseapp.com",
  databaseURL: "https://aop-of-yt-default-rtdb.firebaseio.com",
  projectId: "aop-of-yt",
  storageBucket: "aop-of-yt.firebasestorage.app",
  messagingSenderId: "414413260210",
  appId: "1:414413260210:web:ca92b556a79371741c90ab",
  measurementId: "G-0MMTDNXLBW"
};

export const isFirebaseConfigured = firebaseConfig.apiKey !== "YOUR_API_KEY";
