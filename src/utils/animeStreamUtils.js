import { fetchM3U8Playlist, getServerSortPriority } from '../api/stream.js';

export const sortServers = (list) => {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => getServerSortPriority(a.name) - getServerSortPriority(b.name));
};

/**
 * Calculates the true number of currently released & watchable episodes for ANY anime.
 * For currently releasing anime, AniList gives `episodes` as the total planned count (e.g. 24),
 * but only episodes up to `nextAiringEpisode.episode - 1` (e.g. 23) have actually aired!
 * For unreleased anime, returns 0.
 * For finished anime, returns the total episode count.
 */
export function getAiredEpisodeCount(anime) {
  if (!anime) return 0;
  if (anime.status === 'NOT_YET_RELEASED') return 0;

  const isAiring = anime.status === 'RELEASING';
  const nextEp = anime.nextAiringEpisode?.episode;

  if (isAiring && nextEp && nextEp > 1) {
    return nextEp - 1;
  }
  if (isAiring && nextEp === 1) {
    return 0;
  }
  return anime.episodes || 0;
}

export const isDownloadable = (srv) => {
  if (!srv) return false;
  const name = (srv.name || '').toLowerCase();
  const embedUrl = (srv.embedUrl || '').toLowerCase();
  const videoUrl = (srv.videoUrl || '').toLowerCase();

  // 1. Block known dead, broken, or unextractable iframe hosts
  // - WavesHD is iframe-only via echovideo unless already resolved to direct HLS
  // - AniVid is iframe-only via vidplay
  // - dood / playmogo are dead/parked
  // - vivibebe / ibyteimg are 403 domain forbidden
  // - bibiemb / vibevibe are 500 account trouble
  if (name.includes('anivid') || embedUrl.includes('anivid') || videoUrl.includes('anivid') || embedUrl.includes('vidplay') || videoUrl.includes('vidplay')) return false;
  if ((name.includes('waves') || embedUrl.includes('echovideo') || videoUrl.includes('echovideo')) && !srv.isHLS && !videoUrl.includes('.m3u8')) return false;
  if (name.includes('dood') || name.includes('playmogo') || embedUrl.includes('dood') || embedUrl.includes('playmogo') || videoUrl.includes('dood') || videoUrl.includes('playmogo')) return false;
  if (embedUrl.includes('vivibebe') || videoUrl.includes('vivibebe') || videoUrl.includes('ibyteimg') || videoUrl.includes('byteimg')) return false;
  // 2. Already confirmed direct HLS or video streams
  if (srv.isHLS || videoUrl.includes('.m3u8') || videoUrl.includes('.mp4')) {
    return true;
  }

  // 3. Known downloadable & decryptable providers that can be resolved on-demand:
  // - AniHD, NekoHD, MegaPlay, Neko-VidStream, VidStream, StreamHG, Earnvids, Otaku, etc.
  const isSupportedProvider = 
    name.includes('anihd') ||
    name.includes('neko') ||
    name.includes('megaplay') ||
    name.includes('vidstream') ||
    name.includes('streamhg') ||
    name.includes('earnvids') ||
    name.includes('otaku') ||
    name.includes('gogo') ||
    name.includes('anitaku');

  if (isSupportedProvider) return true;

  // 4. Supported embed/video domains that can be decrypted on-demand
  const isSupportedUrl = 
    embedUrl.includes('megaplay') ||
    embedUrl.includes('megacloud') ||
    embedUrl.includes('anineko') ||
    embedUrl.includes('otakuhg') ||
    embedUrl.includes('otakuvid') ||
    videoUrl.includes('megaplay') ||
    videoUrl.includes('megacloud') ||
    videoUrl.includes('anineko');

  return isSupportedUrl;
};

export const enrichDubSubtitles = (list) => {
  if (!list || !list.length) return list;

  // Find all subtitle tracks available across any server for this episode
  const allAvailableSubs = [];
  const seenUrls = new Set();
  for (const s of list) {
    const low = (s.name || '').toLowerCase();
    // Do not borrow subtitles from hardsub or waves servers
    if (low.includes('hardsub') || low.includes('hard') || low.includes('waves')) continue;
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

    // Do NOT attach external subtitles to HardSub or WavesHD servers (they use burned-in subtitles)
    const low = (s.name || '').toLowerCase();
    if (low.includes('hardsub') || low.includes('hard') || low.includes('waves')) {
      return s;
    }

    // Otherwise, attach all available subtitles from other servers for this episode
    return { ...s, subtitles: allAvailableSubs };
  });
};

/**
 * Builds a merged, deduplicated list of subtitle tracks across all servers.
 * Deduplicates by normalized language label — so only ONE "English" track shows
 * up even when NekoHD, AniHD, and Waves all provide their own English VTT.
 * Server priority: AniHD > NekoHD > Waves > others (prefer higher-quality sources).
 */
export const buildAllSubtitleTracks = (list) => {
  if (!list || !list.length) return [];

  // Server priority — lower number = preferred when same language exists on multiple servers
  const getServerPriority = (serverName) => {
    const n = (serverName || '').toLowerCase();
    if (n.includes('anihd')) return 1;
    if (n.includes('neko')) return 2;
    if (n.includes('waves')) return 3;
    if (n.includes('anivid')) return 4;
    return 5;
  };

  const guessLangFromFile = (file) => {
    if (!file) return '';
    const f = file.toLowerCase();
    if (f.includes('/ar.') || f.includes('_ara') || f.includes('arabic')) return 'arabic';
    if (f.includes('/es.') || f.includes('_spa') || f.includes('spanish')) return 'spanish';
    if (f.includes('/fr.') || f.includes('_fre') || f.includes('french')) return 'french';
    if (f.includes('/de.') || f.includes('_ger') || f.includes('german')) return 'german';
    if (f.includes('/it.') || f.includes('_ita') || f.includes('italian')) return 'italian';
    if (f.includes('/pt.') || f.includes('_por') || f.includes('portuguese')) return 'portuguese';
    if (f.includes('/ru.') || f.includes('_rus') || f.includes('russian')) return 'russian';
    if (f.includes('/ja.') || f.includes('_jpn') || f.includes('japanese')) return 'japanese';
    if (f.includes('/en.') || f.includes('_eng') || f.includes('english')) return 'english';
    return '';
  };

  // Normalize label → canonical language key for dedup
  const normalizeLabel = (label, file) => {
    if (!label) {
      return guessLangFromFile(file) || 'unknown';
    }
    const clean = label.toLowerCase()
      .replace(/\s*[\(\[].*?[\)\]]/g, '') // strip (CC), [SDH], etc.
      .replace(/\s*-\s*\w+$/, '')          // strip "- SDH", "- HI" suffixes
      .trim();
    if (clean.startsWith('eng')) return 'english';
    if (clean.startsWith('ara')) return 'arabic';
    if (clean.startsWith('spa') || clean.startsWith('esp')) return 'spanish';
    if (clean.startsWith('fre') || clean.startsWith('fra')) return 'french';
    if (clean.startsWith('ger') || clean.startsWith('deu')) return 'german';
    if (clean.startsWith('ita')) return 'italian';
    if (clean.startsWith('por')) return 'portuguese';
    if (clean.startsWith('rus')) return 'russian';
    if (clean.startsWith('jpn') || clean.startsWith('jap')) return 'japanese';
    return clean || 'unknown';
  };

  // Collect all candidates grouped by normalized language key
  const byLang = {}; // { 'english': [{sub, priority, serverName}, ...] }

  for (const srv of list) {
    if (!srv.subtitles?.length) continue;
    const priority = getServerPriority(srv.name);

    for (const sub of srv.subtitles) {
      if (!sub.file) continue;
      const lang = normalizeLabel(sub.label, sub.file);
      if (!byLang[lang]) byLang[lang] = [];
      byLang[lang].push({ sub, priority, serverName: srv.name });
    }
  }

  // For each language, pick the single best candidate (lowest priority number)
  const tracks = [];
  let idCounter = 1000;

  // Define display order: English first, then alphabetical
  const langOrder = (lang) => lang === 'english' ? '0' : lang;
  const sortedLangs = Object.keys(byLang).sort((a, b) =>
    langOrder(a).localeCompare(langOrder(b)));

  for (const lang of sortedLangs) {
    const candidates = byLang[lang];
    // Sort by server priority, then pick the first (best) one
    candidates.sort((a, b) => a.priority - b.priority);
    const best = candidates[0];
    const sub = best.sub;

    // Build a clean human-readable label: capitalize properly
    const displayLabel = sub.label
      ? sub.label.replace(/\b\w/g, c => c.toUpperCase())
      : lang.replace(/\b\w/g, c => c.toUpperCase());

    tracks.push({
      id: idCounter++,
      label: displayLabel,
      file: sub.file,
      referer: sub.referer || '',
      default: !!sub.default,
      alternatives: candidates.map(c => ({
        file: c.sub.file,
        referer: c.sub.referer || '',
        serverName: c.serverName,
        label: displayLabel,
      }))
    });
  }

  return tracks;
};


/**
 * Parses qualities from an HLS master playlist URL and its content
 */
export const parseMasterPlaylistQualities = async (masterUrl, playlistContent, referer) => {
  try {
    const playlist = playlistContent || await fetchM3U8Playlist(masterUrl, referer);
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
