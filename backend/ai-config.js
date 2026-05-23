/**
 * ai-config.js
 * ------------------------------------------------
 * 全域 AI 模型版本控管中心
 */

module.exports = {
    // 💡 文字與視覺分析 (大小腦主力)
    MODEL_PRIMARY: "gemini-2.5-flash",
    
    // 🛡️ 備援模型 (主力斷線時自動切換)
    MODEL_FALLBACK: "gemini-3-flash-preview",
    
    // 🎨 沉浸展示間算圖模型 (🌟 補上 -preview 後綴)
    MODEL_IMAGE: "gemini-3.1-flash-image-preview", 
    
    // 🧠 向量轉換模型 (RAG 用)
    MODEL_EMBEDDING: "gemini-embedding-001"
};