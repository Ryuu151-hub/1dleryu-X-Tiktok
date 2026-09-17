/**
 * GET /api/check-tiktok?url=...
 * Proxies TikWM so the API key never hits the browser.
 *
 * Env (set in Vercel → Project → Settings → Environment Variables):
 *   TIKWM_API_KEY   — your TikWM / TikWM API key
 *   TIKWM_BASE_URL  — optional, default https://api.tikwmapi.com
 *                     (use https://tikwm.com/api for the free public endpoint)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const url = (req.query.url || '').toString().trim();
  if (!url) {
    res.status(400).json({ ok: false, error: 'Missing url parameter' });
    return;
  }

  // Accept full TikTok URL or raw video id
  const isId = /^\d{15,25}$/.test(url);
  const isTikTok =
    isId ||
    /tiktok\.com/i.test(url) ||
    /vm\.tiktok\.com/i.test(url) ||
    /vt\.tiktok\.com/i.test(url);

  if (!isTikTok) {
    res.status(400).json({ ok: false, error: 'Provide a TikTok video URL or video ID' });
    return;
  }

  const apiKey = process.env.TIKWM_API_KEY || '';
  const base =
    (process.env.TIKWM_BASE_URL || 'https://api.tikwmapi.com').replace(/\/$/, '');

  try {
    let apiUrl;
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'IdleryuChecker/1.0',
    };

    // Paid TikWM API (tikwmapi.com) uses header key + GET /
    // Free tikwm.com uses query param on /api/
    if (base.includes('tikwmapi.com')) {
      apiUrl = `${base}/?url=${encodeURIComponent(url)}&hd=1`;
      if (apiKey) headers['x-tikwmapi-key'] = apiKey;
    } else {
      // Public-style: https://tikwm.com/api/?url=...
      apiUrl = `${base}${base.endsWith('/api') ? '' : '/api'}/?url=${encodeURIComponent(url)}&hd=1`;
      if (apiKey) {
        // some deployments accept key as query
        apiUrl += `&key=${encodeURIComponent(apiKey)}`;
      }
    }

    const upstream = await fetch(apiUrl, { headers, method: 'GET' });
    const text = await upstream.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      res.status(502).json({
        ok: false,
        error: 'Invalid response from TikWM',
        status: upstream.status,
      });
      return;
    }

    // Normalize both response shapes: { code, msg, data } or direct data
    const code = json.code ?? (json.data ? 0 : -1);
    const data = json.data || json;

    if (code !== 0 && code !== '0') {
      res.status(200).json({
        ok: false,
        error: json.msg || json.message || 'TikWM returned an error',
        code,
      });
      return;
    }

    // Map to the fields the UI expects
    const createTs = data.create_time ? Number(data.create_time) * 1000 : null;
    const durationSec = data.duration != null ? Number(data.duration) : null;
    const sizeBytes =
      data.hd_size || data.size || data.wm_size || null;

    // Shadow ban is not officially exposed by TikWM — heuristic only
    const views = Number(data.play_count ?? 0);
    const likes = Number(data.digg_count ?? 0);
    const comments = Number(data.comment_count ?? 0);
    const shares = Number(data.share_count ?? 0);
    let shadowBan = 'Unknown';
    if (views === 0 && likes === 0 && data.id) shadowBan = 'Possible (0 engagement)';
    else if (views > 0 && likes / Math.max(views, 1) < 0.001 && views > 5000)
      shadowBan = 'Possible (very low engagement ratio)';
    else if (views > 100) shadowBan = 'Unlikely';
    else shadowBan = 'Unknown';

    // Quality fields — TikWM often does not return FPS/bitrate/resolution
    // We surface what we can; rest marked —
    const result = {
      ok: true,
      information: {
        id: data.id || '—',
        date: createTs
          ? new Date(createTs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
          : '—',
        region: data.region || '—',
        shadowBan,
      },
      statistics: {
        views: formatNum(data.play_count),
        likes: formatNum(data.digg_count),
        comments: formatNum(data.comment_count),
        favorites: formatNum(data.collect_count),
        shares: formatNum(data.share_count),
        downloads: formatNum(data.download_count),
      },
      quality: {
        resolution: '—', // not in standard TikWM payload
        fps: '—',
        bitrate: '—',
        duration: durationSec != null ? formatDuration(durationSec) : '—',
        size: sizeBytes != null ? formatSize(Number(sizeBytes)) : '—',
        format: 'MP4',
      },
      raw: {
        title: data.title || '',
        author: data.author?.unique_id || data.author?.nickname || '',
        cover: data.cover || data.origin_cover || '',
      },
    };

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message || 'Upstream request failed',
    });
  }
}

function formatNum(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return '—';
  return x.toLocaleString('en-US');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatDuration(sec) {
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
        }
  
