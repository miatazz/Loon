// ===================== 增强版 60s 新闻脚本（适配 Loon） =====================
const SCRIPT_NAME = "60s新闻增强版";
const VERSION = "v1.2";
const STORE_KEY = "60s_last_date";
const DEFAULT_API = "https://60s-api.viki.moe/v2/60s";
const FALLBACK_APIS = [
  "https://60s.viki.moe/v2/60s",
  "https://60s.lzw.me/?type=60s&e=json"   // 如果支持 JSON 格式
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
    // 尝试 JSON 解析（数组或对象）
    const parsed = JSON.parse(arg);
    if (Array.isArray(parsed)) {
      // 如果是数组，按顺序映射： [type, maxNews, chunkSize, ...]
      return { type: parsed[0] || '60s', maxNews: parsed[1], chunkSize: parsed[2] };
    }
    return parsed;
  } catch (e) {
    // 如果不是 JSON，当作 type 字符串
    return { type: String(arg).trim() || '60s' };
  }
}

// 从 $argument 获取配置（优先），其次使用默认值
function getConfig(argument) {
  const cfg = parseArgument(argument);
  // 环境变量可覆盖（Loon 中可用 $env，但这里简化，全部从 argument 取）
  return {
    type: cfg.type || '60s',
    maxNews: parseInt(cfg.maxNews, 10) || 5,
    chunkSize: parseInt(cfg.chunkSize, 10) || 5,
    multiNotify: cfg.multiNotify === true || cfg.multiNotify === 'true',
    openImage: cfg.openImage !== false,  // 默认开启图片链接
    dedupe: cfg.dedupe !== false,        // 默认去重
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
    // 去除原有序号
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
    headers: { 'Accept': 'application/json', 'User-Agent': 'Loon-60s' },
    timeout: 20,
  });
  if (resp.status !== 200) throw new Error(`HTTP ${resp.status}`);
  const json = JSON.parse(resp.body);
  if (json.code === 200 && json.data) return json;
  if (json.data) return json; // 兼容不同格式
  throw new Error('返回数据格式错误');
}

// 主函数
(async () => {
  const config = getConfig($argument);
  log(`开始获取新闻 (type=${config.type})`);

  // 构建 API URL
  let apiUrl = DEFAULT_API;
  // 如果用户指定了 type，尝试拼接（仅当 type 不是默认 60s 时）
  if (config.type !== '60s') {
    // 对于 viki.moe 接口，可能支持 type 参数？实际上它的 60s 接口固定，不支持其它类型。
    // 我们保留默认，但可以通过 API_URL 环境变量覆盖（但 Loon 中 argument 传参有限）
    // 这里简单处理：如果 type 是其他，尝试用 lzw.me 接口
    if (config.type === 'bing') apiUrl = 'https://60s.lzw.me/?type=bing&e=json';
    else if (config.type === 'history') apiUrl = 'https://60s.lzw.me/?type=history&e=json';
    else apiUrl = DEFAULT_API; // 默认
  }

  // 尝试多个 API
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

  // 去重检查
  if (config.dedupe && shouldSkip(date)) {
    await $notification.post('📰 60s 已推送', '', `今日 ${date} 已推送过，不再重复`);
    return;
  }

  // 截取新闻条数
  let newsSlice = news;
  if (config.maxNews > 0) {
    newsSlice = news.slice(0, config.maxNews);
  }

  // 分块
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

  // 构建标题和副标题
  const mainTitle = '📰 每日60S · 读懂世界';
  const subTitle = [date, dow, lunar].filter(Boolean).join('  ·  ');

  // 图片链接（用于点击通知打开）
  let openUrl = '';
  if (config.openImage && image) {
    openUrl = image.startsWith('//') ? 'https:' + image : image;
  }

  // 发送通知（分块）
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const startIdx = multi ? i * config.chunkSize : 0;
    const body = buildChunk(chunk, startIdx, isLast ? tip : '');
    const title = chunks.length > 1 ? `${mainTitle} (${i+1}/${chunks.length})` : mainTitle;
    const url = isLast ? openUrl : '';

    // Loon 发送通知（支持点击打开 URL）
    if (url) {
      // 使用 $notification.post 扩展方式（Loon 支持 action 参数）
      $notification.post(title, subTitle, body, { 'open-url': url });
    } else {
      $notification.post(title, subTitle, body);
    }
    log(`通知 ${i+1}/${chunks.length} 发送`);
    if (!isLast) await sleep(300);
  }

  // 记录去重
  if (config.dedupe && date) {
    markPushed(date);
  }

  log('全部推送完成');
})();