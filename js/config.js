/**
 * js/config.js
 * 負責 Firebase 初始化與連線設定
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-functions.js";

const firebaseConfig = {
    apiKey: "AIzaSyAQ9vBNu6amWmOG9o-fQa0ft6dO1kumt5c",
    authDomain: "lllcnd.firebaseapp.com",
    projectId: "lllcnd",
    storageBucket: "lllcnd.firebasestorage.app",
    messagingSenderId: "217800246535",
    appId: "1:217800246535:web:ecb1f386c5bbf4ed6771a2"
};

// 初始化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// 保留您原本指定的資料庫 ID "branddecoder-saas-db"
const db = getFirestore(app, "branddecoder-saas-db"); 
const googleProvider = new GoogleAuthProvider();

// [V13.0] 新增：初始化 Functions 實例 
const functions = getFunctions(app);

// 匯出讓其他檔案使用 (加入 functions)
export { auth, db, googleProvider, functions };
