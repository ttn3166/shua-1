// ============================================
// TaskMall 公共组件库
// ============================================

/**
 * 显示Toast提示
 */
function showToast(message, type = 'info') {
    // 移除已存在的toast
    const existingToast = document.getElementById('global-toast');
    if (existingToast) {
        existingToast.remove();
    }

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

    setTimeout(() => {
        toast.style.animation = 'slideUp 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

/**
 * 格式化货币
 */
function formatCurrency(amount, decimals = 2) {
    if (amount == null || isNaN(amount)) return '0.00';
    return Number(amount).toFixed(decimals);
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
// Google 翻译挂件（用户端多语言）
// ============================================
(function () {
    var GOOGLE_TRANSLATE_CONFIG = {
        pageLanguage: 'zh-CN',
        includedLanguages: 'en,vi,th,id,hi,pt,es,zh-TW',
        widgetBottom: 80,
        widgetRight: 20,
        msgLoadFail: 'Translation temporarily unavailable. Please check your network or try again later.',
        msgLoading: 'Loading language options…'
    };

    if (document.getElementById('google_translate_element')) return;

    var bottom = 'max(' + GOOGLE_TRANSLATE_CONFIG.widgetBottom + 'px, env(safe-area-inset-bottom, 0px))';
    var right = 'max(' + GOOGLE_TRANSLATE_CONFIG.widgetRight + 'px, env(safe-area-inset-right, 0px))';
    var el = document.createElement('div');
    el.id = 'google_translate_element';
    el.style.cssText = 'position:fixed;bottom:' + bottom + ';right:' + right + ';z-index:9999;display:none;';
    document.body.appendChild(el);

    var style = document.createElement('style');
    style.id = 'google-translate-styles';
    style.textContent = [
        'body { top: 0 !important; }',
        '.goog-te-banner-frame { display: none !important; }',
        '.goog-tooltip { display: none !important; }',
        '.goog-te-gadget-simple {',
        '  background-color: rgba(255,255,255,0.9) !important;',
        '  border: 1px solid #e2e8f0 !important;',
        '  padding: 8px !important;',
        '  border-radius: 20px !important;',
        '  box-shadow: 0 4px 6px rgba(0,0,0,0.1) !important;',
        '}',
        '.goog-te-gadget-icon { display: none !important; }'
    ].join('\n');
    document.head.appendChild(style);

    window.googleTranslateElementInit = function () {
        if (typeof google === 'undefined' || !google.translate || !google.translate.TranslateElement) return;
        new google.translate.TranslateElement({
            pageLanguage: GOOGLE_TRANSLATE_CONFIG.pageLanguage,
            includedLanguages: GOOGLE_TRANSLATE_CONFIG.includedLanguages,
            layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
            autoDisplay: false
        }, 'google_translate_element');
    };

    var script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    script.async = true;
    script.onerror = function () {
        console.warn('Google Translate failed to load');
        if (typeof showToast === 'function') showToast(GOOGLE_TRANSLATE_CONFIG.msgLoadFail, 'warning');
    };
    document.body.appendChild(script);

    window.showLanguage = function () {
        var widget = document.getElementById('google_translate_element');
        if (!widget) {
            if (typeof showToast === 'function') showToast(GOOGLE_TRANSLATE_CONFIG.msgLoading, 'info');
            return;
        }
        widget.style.display = (widget.style.display === 'none' || widget.style.display === '') ? 'block' : 'none';
    };
})();
