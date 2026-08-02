"use strict";

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrDKu-SjLQr7QDCzTNXDnQmnFaMViS2FQ",
  authDomain: "lifelensai-9b717.firebaseapp.com",
  databaseURL: "https://lifelensai-9b717-default-rtdb.firebaseio.com",
  projectId: "lifelensai-9b717",
  storageBucket: "lifelensai-9b717.firebasestorage.app",
  messagingSenderId: "818301597013",
  appId: "1:818301597013:web:409e1a651efbfc86c72bdc",
  measurementId: "G-W7WVWSJJ4H"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
