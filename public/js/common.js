// ============================================
// TaskMall 公共组件库
// ============================================

// 禁止浏览器自带「翻译此页面」条（Chrome 等），避免与本站语言切换混淆
(function () {
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    var meta = document.querySelector('meta[name="google"]');
    if (meta) { meta.setAttribute('content', 'notranslate'); return; }
    meta = document.createElement('meta');
    meta.name = 'google';
    meta.content = 'notranslate';
    head.insertBefore(meta, head.firstChild);
})();

/**
 * 显示Toast提示
 * @param {string} message - 提示文案
 * @param {string} type - 'info'|'success'|'warning'|'error'
 * @param {number} [duration] - 显示毫秒数，不传则 error 为 3500，其余 2500
 */
function showToast(message, type = 'info', duration) {
    const existingToast = document.getElementById('global-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.textContent = message;

    const colors = {
        success: '#48bb78',
        error: '#f56565',
        warning: '#ed8936',
        info: '#4299e1'
    };

    toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: ${colors[type] || colors.info};
        color: white;
        padding: 12px 24px;
        border-radius: 24px;
        font-size: 14px;
        font-weight: 500;
        z-index: 99999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideDown 0.3s ease-out;
    `;

    document.body.appendChild(toast);

    const ms = duration != null ? duration : (type === 'error' ? 3500 : 2500);
    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, ms);
}

/**
 * 格式化货币（无千分位）
 */
function formatCurrency(amount, decimals = 2) {
    if (amount == null || isNaN(amount)) return '0.00';
    return Number(amount).toFixed(decimals);
}

/**
 * 格式化金额（带千分位，用于展示）
 */
function formatMoney(amount, decimals = 2) {
    if (amount == null || isNaN(amount)) return '0.00';
    const n = Number(amount);
    const fixed = n.toFixed(decimals);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
}

/**
 * 格式化日期
 */
function formatDate(dateString, format = 'datetime') {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '-';

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    if (format === 'date') {
        return `${year}-${month}-${day}`;
    } else if (format === 'time') {
        return `${hours}:${minutes}`;
    } else {
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
}

/**
 * 检查登录状态
 */
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/views/user/index.html';
        return false;
    }
    return true;
}

/**
 * 统一的API调用
 */
async function apiCall(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        }
    };

    const finalOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };

    try {
        const response = await fetch(endpoint, finalOptions);
        const result = await response.json();

        // 处理401未授权
        if (response.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/views/user/index.html';
            return null;
        }

        return result;
    } catch (error) {
        console.error('API call error:', error);
        showToast('Network error', 'error');
        return null;
    }
}

// 添加CSS动画
if (!document.getElementById('common-animations')) {
    const style = document.createElement('style');
    style.id = 'common-animations';
    style.textContent = `
        @keyframes slideDown {
            from {
                opacity: 0;
                transform: translateX(-50%) translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
        }
        @keyframes slideUp {
            from {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
            }
            to {
                opacity: 0;
                transform: translateX(-50%) translateY(-20px);
            }
        }
    `;
    document.head.appendChild(style);
}

// ============================================
// 多语言：第一语言为德语，后续可接入 i18next / Vue-i18n
// ============================================
(function () {
    var STORAGE_KEY = 'app_lang';
    var LANGUAGES = [
        { code: 'de', label: 'Deutsch' },
        { code: 'en', label: 'English' },
        { code: 'zh-CN', label: '中文' },
        { code: 'vi', label: 'Tiếng Việt' },
        { code: 'th', label: 'ไทย' },
        { code: 'id', label: 'Bahasa Indonesia' },
        { code: 'fr', label: 'Français' },
        { code: 'es', label: 'Español' },
        { code: 'ru', label: 'Русский' },
        { code: 'ja', label: '日本語' }
    ];

    window.getAppLanguage = function () {
        return localStorage.getItem(STORAGE_KEY) || 'de';
    };

    window.setAppLanguage = function (code) {
        if (!code) return;
        localStorage.setItem(STORAGE_KEY, code);
        if (typeof window.dispatchEvent === 'function') {
            try { window.dispatchEvent(new CustomEvent('appLanguageChange', { detail: { lang: code } })); } catch (e) {}
        }
    };

    window.showLanguage = function () {
        var body = document.body;
        if (!body) return;
        var existing = document.getElementById('app_lang_panel');
        if (existing) {
            existing.style.display = existing.style.display === 'none' ? 'block' : 'none';
            return;
        }
        var panel = document.createElement('div');
        panel.id = 'app_lang_panel';
        panel.setAttribute('style', 'position:fixed;bottom:max(80px,env(safe-area-inset-bottom));right:max(20px,env(safe-area-inset-right));z-index:10001;min-width:200px;max-width:280px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:0;max-height:70vh;overflow-y:auto;');
        var title = document.createElement('div');
        title.setAttribute('style', 'padding:12px 14px;font-size:14px;font-weight:600;color:#4a5568;border-bottom:1px solid #e2e8f0;');
        title.textContent = 'Sprache wählen';
        panel.appendChild(title);
        var current = window.getAppLanguage();
        LANGUAGES.forEach(function (item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('style', 'display:block;width:100%;padding:14px 14px;font-size:14px;color:#2d3748;text-align:left;border:none;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;');
            btn.textContent = item.label + (item.code === current ? ' ✓' : '');
            btn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.setAppLanguage(item.code);
                if (panel.parentNode) panel.parentNode.removeChild(panel);
                if (typeof showToast === 'function') showToast('Sprache geändert. Seite wird neu geladen.');
                setTimeout(function () { window.location.reload(); }, 300);
            };
            panel.appendChild(btn);
        });
        panel.onclick = function (e) { e.stopPropagation(); };
        body.appendChild(panel);
        setTimeout(function () {
            function closePanel(e) {
                if (!panel.parentNode) return;
                if (panel.contains(e.target)) return;
                var lb = document.getElementById('headerLangBtn');
                if (lb && lb.contains(e.target)) return;
                if (panel.parentNode) panel.parentNode.removeChild(panel);
                document.removeEventListener('click', closePanel);
            }
            document.addEventListener('click', closePanel, false);
        }, 150);
    };
})();
