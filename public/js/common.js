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
// Google 翻译挂件（用户端多语言）+ 备用语言列表
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

    // Client priority: English first, then Chinese (original), then others
    var FALLBACK_LANGUAGES = [
        { code: 'en', label: 'English' },
        { code: '', label: 'Chinese (Original)' },
        { code: 'vi', label: 'Tiếng Việt' },
        { code: 'th', label: 'ไทย' },
        { code: 'id', label: 'Bahasa Indonesia' },
        { code: 'hi', label: 'हिन्दी' },
        { code: 'pt', label: 'Português' },
        { code: 'es', label: 'Español' },
        { code: 'zh-TW', label: '繁體中文' }
    ];

    function setGoogleTransCookie(targetLang) {
        var value = targetLang ? '/' + GOOGLE_TRANSLATE_CONFIG.pageLanguage + '/' + targetLang : '';
        document.cookie = 'googtrans=' + value + '; path=/; max-age=31536000';
    }

    function showFallbackLanguagePanel() {
        var body = document.body;
        if (!body) {
            if (typeof showToast === 'function') showToast('Please try again.');
            return;
        }
        var existing = document.getElementById('google_translate_fallback');
        if (existing) {
            existing.style.display = existing.style.display === 'none' ? 'block' : 'none';
            return;
        }
        var panel = document.createElement('div');
        panel.id = 'google_translate_fallback';
        panel.className = 'notranslate';
        panel.setAttribute('translate', 'no');
        panel.setAttribute('lang', 'en');
        panel.setAttribute('style',
            'position:fixed;bottom:max(80px,env(safe-area-inset-bottom));right:max(20px,env(safe-area-inset-right));' +
            'z-index:10001;min-width:200px;max-width:280px;background:#fff;border:1px solid #e2e8f0;' +
            'border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:0;max-height:70vh;overflow-y:auto;');
        var title = document.createElement('div');
        title.className = 'notranslate';
        title.setAttribute('translate', 'no');
        title.setAttribute('lang', 'en');
        title.setAttribute('style', 'padding:12px 14px;font-size:14px;font-weight:600;color:#4a5568;border-bottom:1px solid #e2e8f0;');
        title.textContent = 'Select Language';
        panel.appendChild(title);
        function applyLang(code) {
            setGoogleTransCookie(code);
            if (typeof showToast === 'function') showToast('Applying language…');
            if (panel.parentNode) panel.parentNode.removeChild(panel);
            setTimeout(function () { window.location.reload(); }, 300);
        }
        FALLBACK_LANGUAGES.forEach(function (item) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'notranslate';
            btn.setAttribute('translate', 'no');
            btn.setAttribute('lang', 'en');
            btn.setAttribute('style', 'display:block;width:100%;padding:14px 14px;font-size:14px;color:#2d3748;text-align:left;border:none;background:none;cursor:pointer;-webkit-tap-highlight-color:transparent;');
            btn.textContent = item.label;
            btn.setAttribute('data-lang', item.code);
            btn.onmouseover = function () { btn.style.background = '#f7fafc'; };
            btn.onmouseout = function () { btn.style.background = 'none'; };
            btn.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                applyLang(item.code);
            };
            btn.ontouchend = function (e) {
                e.preventDefault();
                e.stopPropagation();
                applyLang(item.code);
            };
            panel.appendChild(btn);
        });
        panel.onclick = function (e) { e.stopPropagation(); };
        panel.ontouchend = function (e) { e.stopPropagation(); };
        try {
            body.appendChild(panel);
        } catch (e) {
            if (typeof showToast === 'function') showToast('Cannot show panel.');
            return;
        }
        setTimeout(function () {
            function closeFallback(e) {
                if (!panel.parentNode) return;
                if (panel.contains(e.target)) return;
                var langBtn = document.getElementById('headerLangBtn');
                if (langBtn && langBtn.contains(e.target)) return;
                if (panel.parentNode) panel.parentNode.removeChild(panel);
                document.removeEventListener('click', closeFallback);
            }
            document.addEventListener('click', closeFallback, false);
        }, 150);
    }

    window.showLanguage = function () {
        var existing = document.getElementById('google_translate_fallback');
        if (existing) {
            existing.style.display = existing.style.display === 'none' ? 'block' : 'none';
            return;
        }
        showFallbackLanguagePanel();
    };

    function initGoogleTranslate() {
        if (document.getElementById('google_translate_element')) return;
        var body = document.body;
        var head = document.head;
        if (!body || !head) return;

        var bottom = 'max(' + GOOGLE_TRANSLATE_CONFIG.widgetBottom + 'px, env(safe-area-inset-bottom, 0px))';
        var right = 'max(' + GOOGLE_TRANSLATE_CONFIG.widgetRight + 'px, env(safe-area-inset-right, 0px))';
        var el = document.createElement('div');
        el.id = 'google_translate_element';
        el.style.cssText = 'position:fixed;bottom:' + bottom + ';right:' + right + ';z-index:9999;display:none;';
        body.appendChild(el);
        if (document.cookie.indexOf('googtrans=') === -1) {
            var lang = (navigator.language || navigator.userLanguage || '').toLowerCase();
            var code = 'en';
            if (lang.indexOf('vi') === 0) code = 'vi';
            else if (lang.indexOf('th') === 0) code = 'th';
            else if (lang.indexOf('id') === 0) code = 'id';
            else if (lang.indexOf('hi') === 0) code = 'hi';
            else if (lang.indexOf('pt') === 0) code = 'pt';
            else if (lang.indexOf('es') === 0) code = 'es';
            else if (lang.indexOf('zh-tw') === 0 || lang.indexOf('zh_tw') === 0) code = 'zh-TW';
            document.cookie = 'googtrans=/zh-CN/' + code + '; path=/; max-age=31536000; SameSite=Lax';
        }

        var style = document.createElement('style');
        style.id = 'google-translate-styles';
        style.textContent = [
            'body { top: 0 !important; }',
            '#google_translate_element { display: none !important; }',
            '.notranslate, [translate="no"] { font-family: inherit !important; }',
            '/* Hide ALL Google Translate UI – user only sees our custom panel */',
            '.goog-te-banner-frame { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }',
            'body > .skiptranslate { display: none !important; visibility: hidden !important; height: 0 !important; overflow: hidden !important; }',
            '.skiptranslate iframe { display: none !important; visibility: hidden !important; }',
            '#goog-gt-tt { display: none !important; }',
            '.goog-tooltip { display: none !important; }',
            '.goog-te-gadget-simple {',
            '  background-color: rgba(255,255,255,0.9) !important;',
            '  border: 1px solid #e2e8f0 !important;',
            '  padding: 8px !important;',
            '  border-radius: 20px !important;',
            '  box-shadow: 0 4px 6px rgba(0,0,0,0.1) !important;',
            '}',
            '.goog-te-gadget-icon { display: none !important; }',
            '#google_translate_fallback { position: fixed; bottom: max(80px, env(safe-area-inset-bottom)); right: max(20px, env(safe-area-inset-right)); z-index: 10000; min-width: 180px; max-width: 260px; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); padding: 8px 0; max-height: 70vh; overflow-y: auto; }',
            '#google_translate_fallback .gt-fb-title { padding: 10px 14px; font-size: 13px; font-weight: 600; color: #4a5568; border-bottom: 1px solid #e2e8f0; }',
            '#google_translate_fallback .gt-fb-item { display: block; width: 100%; padding: 10px 14px; font-size: 14px; color: #2d3748; text-align: left; border: none; background: none; cursor: pointer; transition: background 0.2s; }',
            '#google_translate_fallback .gt-fb-item:hover { background: #f7fafc; }',
            '#google_translate_fallback .gt-fb-item.active { background: #ebf8ff; color: #2b6cb0; font-weight: 600; }'
        ].join('\n');
        head.appendChild(style);

        function hideGoogleTranslateUI() {
            var sel = ['body > .skiptranslate', '.goog-te-banner-frame', '#goog-gt-tt', '.goog-te-balloon-frame', 'iframe.goog-te-banner-frame'];
            sel.forEach(function (s) {
                try {
                    document.querySelectorAll(s).forEach(function (el) {
                        el.style.setProperty('display', 'none', 'important');
                        el.style.setProperty('visibility', 'hidden', 'important');
                        el.style.setProperty('height', '0', 'important');
                        el.style.setProperty('overflow', 'hidden', 'important');
                    });
                } catch (e) {}
            });
            if (document.body) document.body.style.setProperty('top', '0', 'important');
        }
        window.googleTranslateElementInit = function () {
            if (typeof google === 'undefined' || !google.translate || !google.translate.TranslateElement) return;
            new google.translate.TranslateElement({
                pageLanguage: GOOGLE_TRANSLATE_CONFIG.pageLanguage,
                includedLanguages: GOOGLE_TRANSLATE_CONFIG.includedLanguages,
                layout: google.translate.TranslateElement.InlineLayout.SIMPLE,
                autoDisplay: false
            }, 'google_translate_element');
            hideGoogleTranslateUI();
            var t = 0;
            var tid = setInterval(function () {
                hideGoogleTranslateUI();
                t += 200;
                if (t >= 3000) clearInterval(tid);
            }, 200);
        };

        var script = document.createElement('script');
        script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
        script.async = true;
        script.onerror = function () {
            console.warn('Google Translate failed to load');
            if (typeof showToast === 'function') showToast(GOOGLE_TRANSLATE_CONFIG.msgLoadFail, 'warning');
        };
        body.appendChild(script);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initGoogleTranslate);
    } else {
        initGoogleTranslate();
    }
})();
