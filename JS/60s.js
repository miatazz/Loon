// ================== 增强版 60s 新闻脚本（适配 Loon） =====================
const SCRIPT_NAME = "60s新闻增强版";
const VERSION = "v1.2";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = [
    "https://60s.viki.moe/v2/60s",
    "https://60s.lzw.me/?type=60s&e=json"
];

// ---------- 工具函数 ----------
function log(msg) {
    console.log(`[${SCRIPT_NAME}] ${msg}`);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 解析 $argument（支持 JSON 数组或键值对）
function parseArgument(arg) {
    if (!arg) return {};
    try {
        const parsed = JSON.parse(arg);
        if (Array.isArray(parsed)) {
            return {
                type: parsed[0] || '60s',
                maxNews: parsed[1],
                chunkSize: parsed[2]
            };
        }
        return parsed;
    } catch (e) {
        return { type: String(arg).trim() || '60s' };
    }
}

// 从 $argument 获取配置
function getConfig(argument) {
    const cfg = parseArgument(argument);
    return {
        type: cfg.type || '60s',
        maxNews: parseInt(cfg.maxNews, 10) || 5,
        chunkSize: parseInt(cfg.chunkSize, 10) || 5,
        multiNotify: cfg.multiNotify === true || cfg.multiNotify === 'true',
        openImage: cfg.openImage !== false,
        dedupe: cfg.dedupe !== false,
    };
}

// 去重检查
function shouldSkip(date) {
    if (!date) return false;
    try {
        const last = $persistentStore.read(STORE_KEY);
        if (last === date) {
            log(`今日 ${date} 已推送过，跳过`);
            return true;
        }
    } catch (e) {
        log(`读取去重标记失败: ${e.message}`);
    }
    return false;
}

// 保存去重标记
function markPushed(date) {
    if (!date) return;
    try {
        $persistentStore.write(date, STORE_KEY);
        log(`已记录今日推送 ${date}`);
    } catch (e) {
        log(`写入去重标记失败: ${e.message}`);
    }
}

// 构建通知内容（分块）
function buildChunk(newsChunk, startIndex, tip) {
    const lines = newsChunk.map((item, i) => {
        let text = typeof item === 'string' ? item : (item.title || item.text || String(item));
        text = text.replace(/^\s*\d+\s*[\.．、:：]\s*/, '');
        return `${startIndex + i + 1}. ${text}`;
    });
    if (tip) {
        lines.push('');
        const cleanTip = tip.replace(/^\s*【\s*微语\s*】\s*/, '');
        lines.push(`【微语】${cleanTip}`);
    }
    return lines.join('\n') || '暂无新闻';
}

// 获取新闻（支持多 API 回退）
async function fetchNews(apiUrl) {
    log(`请求: ${apiUrl}`);
    const resp = await $http.get({
        url: apiUrl,
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Loon-60s'
        },
        timeout: 20,
    });
    if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
    const json = JSON.parse(resp.body);
    if (json.code === 200 && json.data) return json;
    if (json.data) return json;
    throw new Error('返回数据格式错误');
}

// 主函数
(async () => {
    const config = getConfig($argument);
    log(`开始获取新闻 (type=${config.type})`);

    let apiUrl = DEFAULT_API;
    if (config.type !== '60s') {
        if (config.type === 'bing') {
            apiUrl = 'https://60s.lzw.me/?type=bing&e=json';
        } else if (config.type === 'history') {
            apiUrl = 'https://60s.lzw.me/?type=history&e=json';
        } else {
            apiUrl = DEFAULT_API;
        }
    }

    let json = null;
    let lastError = null;
    const urls = [apiUrl, ...FALLBACK_APIS];
    for (const url of urls) {
        try {
            json = await fetchNews(url);
            break;
        } catch (e) {
            lastError = e;
            log(`请求失败: ${e.message}`);
        }
    }

    if (!json) {
        await $notification.post('❌ 新闻获取失败', '', lastError?.message || '未知错误');
        return;
    }

    const data = json.data || {};
    const date = data.date || '';
    const news = data.news || [];
    const tip = data.tip || '';
    const image = data.image || data.cover || '';
    const dow = data.day_of_week || '';
    const lunar = data.lunar_date || '';

    if (config.dedupe && shouldSkip(date)) {
        await $notification.post('📰 60s 已推送', '', `今日 ${date} 已推送过，不再重复`);
        return;
    }

    let newsSlice = news;
    if (config.maxNews > 0) {
        newsSlice = news.slice(0, config.maxNews);
    }

    const multi = config.multiNotify;
    let chunks = [];
    if (multi) {
        const size = Math.max(1, config.chunkSize);
        for (let i = 0; i < newsSlice.length; i += size) {
            chunks.push(newsSlice.slice(i, i + size));
        }
    } else {
        chunks = [newsSlice];
    }

    const mainTitle = '📰 每日60S · 读懂世界';
    const subTitle = [date, dow, lunar].filter(Boolean).join('  ·  ');

    let openUrl = '';
    if (config.openImage && image) {
        openUrl = image.startsWith('//') ? 'https:' + image : image;
    }

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isLast = i === chunks.length - 1;
        const startIdx = multi ? i * config.chunkSize : 0;
        const body = buildChunk(chunk, startIdx, isLast ? tip : '');
        const title = chunks.length > 1 ? `${mainTitle} (${i+1}/${chunks.length})` : mainTitle;
        const url = isLast ? openUrl : '';

        if (url) {
            $notification.post(title, subTitle, body, { 'open-url': url });
        } else {
            $notification.post(title, subTitle, body);
        }
        log(`通知 ${i+1}/${chunks.length} 发送`);
        if (!isLast) await sleep(300);
    }

    if (config.dedupe && date) {
        markPushed(date);
    }
    log('全部推送完成');
})();