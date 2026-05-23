/**
 * js/auth.js
 * 權限管理核心
 */
import { signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { auth, googleProvider, db } from "./config.js";

// 執行 Google 登入
export const handleLogin = async () => {
    try {
        await signInWithPopup(auth, googleProvider);
    } catch (error) {
        console.error("Login failed", error);
        alert("登入失敗: " + error.message);
    }
};

// 執行登出
export const handleLogout = async () => {
    await signOut(auth);
    window.location.reload(); // 強制重整清空狀態
};

// 🟢 [Fix] 嚴格檢查 Super Admin 權限
export const checkSuperAdmin = async (email) => {
    if (!email) return false;
    try {
        // 從 Firestore 讀取白名單
        const docRef = doc(db, "sys_config", "admin_whitelist");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            const whitelist = data.emails || [];
            console.log("Admin Whitelist Check:", email, whitelist.includes(email));
            return whitelist.includes(email);
        } else {
            // 如果沒有設定檔，預設只有開發者是 Admin (緊急後門)
            console.warn("No admin_whitelist config found.");
            return false; 
        }
    } catch (e) {
        console.warn("Admin check skipped:", e);
        return false;
    }
};

// 監聽器維持不變，邏輯已移至 app.js onload
