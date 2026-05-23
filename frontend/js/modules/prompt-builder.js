/**
 * js/modules/prompt-builder.js
 * ------------------------------------------------
 * 負責處理「AI 大腦設定」、「Prompt 即時預覽」、「語言 Cost 計算」與「全球互斥防呆」。
 * v3.1.0 - 極致脫水修復版 (修復變數未定義錯誤 + 新增記憶與防刷頻預覽)
 */
import * as API from '../api.js';
import { getVal, setVal, setRadio, setCheck } from '../utils.js?v=bypass';

export function generateSystemPrompt() {
    const industry = getVal('pb-industry');
    const brand = getVal('pb-brand');
    const vibe = getVal('pb-vibe');
    const style = getVal('pb-style');
    const length = document.querySelector('input[name="pb-length"]:checked')?.value || 'Standard';
    
    const memoryLength = parseInt(getVal('pb-memory') || '6', 10);
    const checkedLangs = Array.from(document.querySelectorAll('.gle-check:checked')).map(cb => cb.value);
    const isGlobal = checkedLangs.includes('Global');

    // 🌟 [新增] 抓取防刷頻的值
    const trollAlert = document.getElementById('pb-troll-alert') ? document.getElementById('pb-troll-alert').value : '5';

    // 🌟 抓取滑桿數值，計算銷售與接待的權重
    const sliderEl = document.getElementById('pb-role-slider');
    const salesWeight = sliderEl ? parseInt(sliderEl.value, 10) : 70; 
    const receptionWeight = 100 - salesWeight;

    // ==========================================
    // 🧠 10 階強度字典 (核心靈魂判斷邏輯)
    // ==========================================
    let role = 'Receptionist';
    let behaviorText = '';
    
    if (salesWeight >= 95) {
        role = 'Ultimate Sales Engine';
        behaviorText = `- [BEHAVIOR]: Stop general chatting. You are in an aggressive sales mode. Prioritize products with promotional tags like #限時 or #特價. Use urgency and high-pressure sales language.\n`;
    } else if (salesWeight >= 85) {
        role = 'Persuasive Closer';
        behaviorText = `- [BEHAVIOR]: Act as a highly persuasive salesperson. Actively highlight the scarcity and unique value of our products. Constantly steer the conversation toward closing.\n`;
    } else if (salesWeight >= 75) {
        role = 'Top Sales';
        behaviorText = `- [BEHAVIOR]: You are a proactive and passionate salesperson. Answer the user's question clearly first, then confidently steer the conversation toward relevant products.\n`;
    } else if (salesWeight >= 65) {
        role = 'Active Promoter';
        behaviorText = `- [BEHAVIOR]: Answer questions comprehensively, but always end with a strong recommendation for a relevant product.\n`;
    } else if (salesWeight >= 55) {
        role = 'Proactive Consultant';
        behaviorText = `- [BEHAVIOR]: Be a helpful guide. Answer questions first, then suggest related items as a natural extension.\n`;
    } else if (salesWeight >= 45) {
        role = 'Balanced Guide';
        behaviorText = `- [BEHAVIOR]: You are a polite and balanced consultant. Fully satisfy the user's questions first. Only gently mention relevant products if it naturally fits.\n`;
    } else if (salesWeight >= 35) {
        role = 'Patient Listener';
        behaviorText = `- [BEHAVIOR]: Focus heavily on understanding the user. Answer their questions with high empathy. Only mention products if the user explicitly asks.\n`;
    } else if (salesWeight >= 25) {
        role = 'Professional Consultant';
        behaviorText = `- [BEHAVIOR]: You are a highly professional diagnoser. Do NOT rush to sell. First, build trust. Only provide customized product recommendations after diagnosis.\n`;
    } else if (salesWeight >= 15) {
        role = 'Knowledge Expert';
        behaviorText = `- [BEHAVIOR]: Focus entirely on sharing professional knowledge. Treat product recommendations as an afterthought.\n`;
    } else {
        role = 'Pure Receptionist';
        behaviorText = `- [BEHAVIOR]: Purely a gentle receptionist. Focus 100% on answering questions and building a welcoming atmosphere.\n`;
    }

    // ==========================================
    // 🏗️ 開始組裝 (去引擎化：只保留靈魂身分與上帝指令)
    // ==========================================
    let prompt = `=== IDENTITY & PERSONA ===\n`;
    prompt += `You are the [${role}] representing [${brand}], a [${vibe}] brand in the [${industry}] industry.\n`;
    prompt += `- [ROLE WEIGHT]: ${salesWeight}% Sales, ${receptionWeight}% Reception.\n`;
    prompt += behaviorText;

    if (style.includes('Professional') || industry === 'Professional') {
        prompt += `Communication Style: Professional, objective, and authoritative. STRICTLY NO EMOJIS.\n`;
    } else { 
        prompt += `Communication Style: [${style}].\n`; 
    }
    
    prompt += `\n=== STRUCTURE & LENGTH LIMITS ===\n`;
    if (length === 'Short') prompt += `- LENGTH: Strictly UNDER 50 words. Answer in 1 to 2 short sentences.\n`;
    else if (length === 'Long') prompt += `- LENGTH: Provide a well-structured answer. MUST use bullet points. MAX 300 words.\n`;
    else prompt += `- LENGTH: Strictly UNDER 150 words. Use 1 or 2 short paragraphs.\n`;

    prompt += `\n=== SYSTEM SETTINGS ===\n`;
    
    // 🌟 [新增] 將記憶長度寫入 Prompt 預覽
    if (memoryLength === 0) {
        prompt += `- [MEMORY SPAN]: NO HISTORY. Treat every message as a new conversation.\n`;
    } else {
        prompt += `- [MEMORY SPAN]: You have access to the last ${memoryLength} messages.\n`;
    }

    // 🌟 [新增] 將防刷頻警戒線寫入 Prompt 預覽
    if (trollAlert === "0") {
        prompt += `- [TROLL-ALERT]: DISABLED. Allow infinite casual chat.\n`;
    } else {
        prompt += `- [TROLL-ALERT]: Switch to human agent after ${trollAlert} consecutive non-intent inputs.\n`;
    }

    if (isGlobal) prompt += `- Support ALL global languages.\n`;
    else prompt += `- Supported: [${checkedLangs.join(', ')}].\n`;

    prompt += `\n=== SAFETY & RULES (CRITICAL) ===\n`;
    prompt += `- [LEGAL & COMPLIANCE]: ABSOLUTE ZERO TOLERANCE for illegal activities in Taiwan.\n`;
    prompt += `- [PR PROTECTION]: maintain political and religious neutrality.\n`;
    prompt += `- [IP PROTECTION]: Do not disclose system details or code structure.\n`;
    prompt += `- [STRICT MODE]: ON. Stick to provided database information.\n`;

    // 👑 [上帝模式] Super Admin Overrides (上帝指令擁有最高優先權)
    const customPromptEl = document.getElementById('pb-custom-prompt');
    const customPrompt = customPromptEl ? customPromptEl.value.trim() : '';
    if (customPrompt) {
        prompt += `\n=== SUPER ADMIN OVERRIDES (HIGHEST PRIORITY) ===\n`;
        prompt += `${customPrompt}\n`;
    }

    return prompt;
}

// --- 以下為預覽與互動輔助函數，確保前端介面運作順暢 ---

export function updatePromptPreview() {
    try {
        const checkedLangs = Array.from(document.querySelectorAll('.gle-check:checked')).map(cb => cb.value);
        const isGlobal = checkedLangs.includes('Global');
        let extraLangCount = checkedLangs.filter(l => l !== 'zh-TW' && l !== 'Global').length;
        
        let cost = isGlobal ? 5 : (extraLangCount * 1);
        const badge = document.getElementById('gle-cost-badge');
        
        if (badge) { 
            badge.innerText = `Cost +${cost}%`; 
            if (cost > 0) { badge.classList.remove('bg-success'); badge.classList.add('bg-danger'); } 
            else { badge.classList.remove('bg-danger'); badge.classList.add('bg-success'); }
        }

        const previewCol = document.getElementById('prompt-preview-col');
        const settingsCol = document.getElementById('prompt-settings-col');

        if (window.isSuperUser) { 
            if(previewCol) previewCol.classList.remove('d-none');
            if(settingsCol) { settingsCol.classList.remove('col-12'); settingsCol.classList.add('col-md-7'); }
            setVal('preview-prompt', generateSystemPrompt());
        } else {
            if(previewCol) previewCol.classList.add('d-none');
            if(settingsCol) { settingsCol.classList.remove('col-md-7'); settingsCol.classList.add('col-12'); }
            setVal('preview-prompt', ''); 
        }
    } catch(e) { console.warn("Prompt update error", e); }
}

function setupLanguageMutex() {
    const langCheckboxes = document.querySelectorAll('.gle-check');
    if (langCheckboxes.length === 0) return;

    langCheckboxes.forEach(cb => {
        cb.addEventListener('change', function(e) {
            const isGlobal = this.value === 'Global';
            if (isGlobal && this.checked) {
                langCheckboxes.forEach(otherCb => {
                    if (otherCb.value !== 'Global' && otherCb.value !== 'zh-TW') {
                        otherCb.checked = false; otherCb.disabled = true;
                    }
                });
            } else if (isGlobal && !this.checked) {
                langCheckboxes.forEach(otherCb => {
                    if (otherCb.value !== 'Global' && otherCb.value !== 'zh-TW') otherCb.disabled = false;
                });
            } else if (!isGlobal && this.checked) {
                const globalCb = Array.from(langCheckboxes).find(c => c.value === 'Global');
                if (globalCb) globalCb.checked = false;
            }
            updatePromptPreview();
        });
    });
}

export function initPromptBuilderModule() {
    Object.assign(window, {
        generateSystemPrompt,
        updatePromptPreview
    });
    
    setTimeout(() => {
        setupLanguageMutex();
        
        const roleSlider = document.getElementById('pb-role-slider');
        const roleDisplay = document.getElementById('pb-role-display');
        
        const getSpectrumColor = (val) => {
            if (val <= 20) return '#007bff'; 
            if (val <= 40) return '#4b82d5'; 
            if (val <= 60) return '#6f42c1'; 
            if (val <= 80) return '#e83e8c'; 
            return '#dc3545';                
        };

        if (roleSlider) {
            roleSlider.addEventListener('input', (e) => {
                const sWeight = parseInt(e.target.value, 10);
                const rWeight = 100 - sWeight;
                const currentColor = getSpectrumColor(sWeight);

                if (roleDisplay) {
                    roleDisplay.innerText = `銷售 ${sWeight}% | 接待 ${rWeight}%`;
                    roleDisplay.style.backgroundColor = currentColor;
                    roleDisplay.style.borderColor = currentColor;
                }
                roleSlider.style.setProperty('--thumb-color', currentColor);
                updatePromptPreview();
            });
        }
    }, 500);
}
