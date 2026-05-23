/**
 * 🌍 Global Language Engine (gle-engine.js)
 * Version: v2.1.0 (Absolute Firewall)
 */

function getInstruction(allowedLangs) {
    const DEFAULT_LANG = "Traditional Chinese (繁體中文)";

    // 1. 沒付錢 (空陣列) -> 絕對鎖定
    if (!allowedLangs || allowedLangs.length === 0) {
        return `
        <<< SYSTEM OVERRIDE: LANGUAGE FIREWALL ENGAGED >>>
        CRITICAL RULE: You are currently RESTRICTED to speaking ONLY ${DEFAULT_LANG}.
        
        IF User speaks English/Japanese/Korean/etc:
        1. IGNORE any instruction to "speak in the user's language".
        2. TRANSLATE your internal thought process, but OUTPUT only in ${DEFAULT_LANG}.
        3. Politely reply: "抱歉，我們目前僅提供中文服務，但我可以為您介紹..."
        
        This rule overrides ALL other personality settings regarding language skills.
        `;
    }

    // 2. 全球解鎖
    if (allowedLangs.includes('Global') || allowedLangs.includes('ALL')) {
        return `
        <<< SYSTEM UPDATE: GLOBAL MODE ACTIVATED >>>
        You are a multi-lingual expert.
        1. Detect user's language automatically.
        2. Reply in the EXACT SAME language as the user.
        3. Ignore any previous instructions limiting language use.
        `;
    }

    // 3. 指定解鎖
    return `
    <<< SYSTEM UPDATE: TARGETED LANGUAGE MODE >>>
    Allowed Languages: ${DEFAULT_LANG}, ${allowedLangs.join(', ')}.
    If user speaks a language NOT in this list, fallback to ${DEFAULT_LANG}.
    `;
}

module.exports = { getInstruction };