import { fetchM3U8Playlist } from '../api/stream';

export const isDownloadable = (srv) => {
  if (!srv) return false;
  const name = (srv.name || '').toLowerCase();
  const embedUrl = (srv.embedUrl || '').toLowerCase();
  const videoUrl = (srv.videoUrl || '').toLowerCase();

  // Explicitly block StreamHG, Earnvids, otakuhg, dood, playmogo, vivibebe from downloads
  if (name.includes('streamhg') || name.includes('earnvids') || name.includes('dood') || name.includes('vivibebe')) return false;
  if (embedUrl.includes('otakuhg') || embedUrl.includes('streamhg') || embedUrl.includes('earnvids') || embedUrl.includes('dood') || embedUrl.includes('playmogo') || embedUrl.includes('vivibebe') || embedUrl.includes('ibyteimg')) return false;
  if (videoUrl.includes('otakuhg') || videoUrl.includes('streamhg') || videoUrl.includes('earnvids') || videoUrl.includes('dood') || videoUrl.includes('playmogo') || videoUrl.includes('vivibebe') || videoUrl.includes('ibyteimg')) return false;

  // Support AniNeko (Neko-HD-2), AniHD, WavesHD, and AniVid for downloads
  return name.startsWith('neko') || name.includes('anihd') || name.includes('waves') || name.includes('anivid');
};

export const enrichDubSubtitles = (list) => {
  if (!list || !list.length) return list;

  // Find all subtitle tracks available across any server for this episode
  const allAvailableSubs = [];
  const seenUrls = new Set();
  for (const s of list) {
    if (s.subtitles?.length) {
      for (const sub of s.subtitles) {
        if (sub.file && !seenUrls.has(sub.file)) {
          seenUrls.add(sub.file);
          allAvailableSubs.push(sub);
        }
      }
    }
  }

  if (allAvailableSubs.length === 0) return list;

  return list.map(s => {
    // If this server already has subtitles, keep them
    if (s.subtitles && s.subtitles.length > 0) return s;

    // Otherwise, attach all available subtitles from other servers for this episode
    return { ...s, subtitles: allAvailableSubs };
  });
};

/**
 * Builds a merged list of all subtitle tracks from all sub servers,
 * tagged with a source label so the user can pick their preferred source.
 */
export const buildAllSubtitleTracks = (list) => {
  if (!list || !list.length) return [];

  const getSourceLabel = (serverName) => {
    const n = (serverName || '').toLowerCase();
    if (n.includes('neko')) return 'NekoHD';
    if (n.includes('waves')) return 'Waves';
    if (n.includes('anihd')) return 'AniHD';
    if (n.includes('anivid')) return 'AniVid';
    return serverName || 'Subtitles';
  };

  const seen = new Set();
  const tracks = [];
  let idCounter = 1000;

  for (const srv of list) {
    if (!srv.subtitles?.length) continue;
    const source = getSourceLabel(srv.name);
    if (!source) continue;

    for (const sub of srv.subtitles) {
      if (!sub.file || seen.has(sub.file)) continue;
      const labelLower = (sub.label || 'english').toLowerCase();
      if (!labelLower.includes('english') && !labelLower.includes('eng')) continue;
      seen.add(sub.file);
      tracks.push({
        id: idCounter++,
        label: 'English',
        file: sub.file,
        referer: sub.referer || '',
        _source: source,
      });
    }
  }

  return tracks;
};

/**
 * Parses qualities from an HLS master playlist URL and its content
 */
export const parseMasterPlaylistQualities = async (masterUrl, playlistContent) => {
  try {
    const playlist = playlistContent || await fetchM3U8Playlist(masterUrl);
    if (!playlist) return [];

    const lines = playlist.split('\n');
    const qualities = [];
    const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);

    let masterQuery = '';
    try {
      const u = new URL(masterUrl);
      masterQuery = u.search;
    } catch (_) {}

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.includes('#EXT-X-STREAM-INF')) {
        const resMatch = line.match(/RESOLUTION=\d+x(\d+)/);
        let name = 'Auto';
        if (resMatch) {
          const h = parseInt(resMatch[1]);
          if (h >= 1080) name = '1080p';
          else if (h >= 720) name = '720p';
          else if (h >= 480) name = '480p';
          else name = '360p';
        }

        let urlLine = '';
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !lines[j].startsWith('#')) {
            urlLine = lines[j].trim();
            break;
          }
        }

        if (urlLine) {
          let absoluteUrl = urlLine.startsWith('http')
            ? urlLine
            : (urlLine.startsWith('/') ? new URL(masterUrl).origin + urlLine : base + urlLine);

          if (masterQuery && !absoluteUrl.includes('?')) {
            absoluteUrl += masterQuery;
          }
          qualities.push({ name, url: absoluteUrl });
        }
      }
    }
    return qualities;
  } catch (e) {
    console.error('Error parsing qualities:', e);
    return [];
  }
};

/**
 * Validates that a resolved m3u8 URL has real (non-ad) video segments.
 */
export const validateM3U8 = async (m3u8Url, referer) => {
  try {
    const AD_CDN_DOMAINS = ['doubleclick.net', 'googleads', 'adserver', 'popads'];
    const playlist = await fetchM3U8Playlist(m3u8Url, referer);
    if (!playlist || !playlist.includes('#EXTM3U')) return 0;

    let mediaPlaylist = playlist;
    if (playlist.includes('#EXT-X-STREAM-INF')) {
      const lines = playlist.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('#EXT-X-STREAM-INF') && lines[i + 1]?.trim()) {
          let varUrl = lines[i + 1].trim();
          if (!varUrl.startsWith('http')) {
            const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
            varUrl = base + varUrl;
            try {
              const u = new URL(m3u8Url);
              if (u.search && !varUrl.includes('?')) varUrl += u.search;
            } catch (_) {}
          }
          try { mediaPlaylist = await fetchM3U8Playlist(varUrl, referer); } catch {}
          break;
        }
      }
    }

    const segLines = mediaPlaylist.split('\n')
      .map(l => l.trim())
      .filter(l => !l.startsWith('#') && l.length > 0);

    const cleanSegs = segLines.filter(seg => !AD_CDN_DOMAINS.some(d => seg.includes(d)));
    return cleanSegs.length;
  } catch (e) {
    console.warn('[Downloads] validateM3U8 failed:', e.message);
    return -1;
  }
};
