import { fetchM3U8Playlist, getServerSortPriority } from '../api/stream.js';

export const sortServers = (list) => {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    // 1. Authoritative CDN & server priority (Vidstream #1, HD-1 #2, ..., WavesHD fallback)
    const pA = getServerSortPriority(a.name);
    const pB = getServerSortPriority(b.name);
    if (pA !== pB) return pA - pB;

    // 2. Tie-breaker only: Favor pre-resolved HLS streams
    const aDirect = (a.isHLS && a.videoUrl && !a.videoUrl.includes('proxy/placeholder') && !a.videoUrl.includes('megaplay.buzz/stream/')) ? 0 : 1;
    const bDirect = (b.isHLS && b.videoUrl && !b.videoUrl.includes('proxy/placeholder') && !b.videoUrl.includes('megaplay.buzz/stream/')) ? 0 : 1;
    return aDirect - bDirect;
  });
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

  const currentYear = new Date().getFullYear();
  const startYear = anime.startDate?.year;

  if (anime.status === 'NOT_YET_RELEASED') {
    // If start date is in the past, it's an AniList database anomaly (e.g. older unlisted OVA/hentai)
    if (startYear && startYear <= currentYear) {
      return anime.episodes || 1;
    }
    return 0;
  }

  const isAiring = anime.status === 'RELEASING';
  const nextEp = anime.nextAiringEpisode?.episode;

  if (isAiring && nextEp && nextEp > 1) {
    return nextEp - 1;
  }
  if (isAiring && nextEp === 1) {
    return 0;
  }
  // RELEASING with no nextAiringEpisode (AniList data gap for long-running anime or ongoing OVAs):
  // Trust anime.episodes if present; otherwise return 1 so the UI never shows "0 episodes"
  // for a show that is actively streaming content.
  if (isAiring && !nextEp) {
    return anime.episodes || 1;
  }
  return anime.episodes || (anime.status === 'FINISHED' ? 1 : 0);
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
    name.includes('anitaku') ||
    name.includes('hstream') ||
    name.includes('hentaicity');

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

export const enrichDubSubtitles = (list, extraSubs = []) => {
  if (!list || !list.length) return list;

  // Find all subtitle tracks available across any server for this episode, or passed via extraSubs
  const allAvailableSubs = [];
  const seenUrls = new Set();

  // Add extraSubs (e.g. from cached episode subtitles)
  if (Array.isArray(extraSubs)) {
    for (const sub of extraSubs) {
      const url = sub.file || sub.url;
      if (url && !seenUrls.has(url)) {
        seenUrls.add(url);
        allAvailableSubs.push(sub);
      }
    }
  }

  // Add subtitles from non-hardsub SUB servers
  for (const s of list) {
    const low = (s.name || '').toLowerCase();
    const isDub = s.type === 'dub' || low.includes('dub');
    // Do not borrow subtitles from hardsub or waves servers
    if (low.includes('hardsub') || low.includes('hard') || low.includes('waves')) continue;
    if (s.subtitles?.length) {
      for (const sub of s.subtitles) {
        const url = sub.file || sub.url;
        if (url && !seenUrls.has(url)) {
          seenUrls.add(url);
          allAvailableSubs.push({ ...sub, isFromSub: !isDub });
        }
      }
    }
  }

  if (allAvailableSubs.length === 0) return list;

  return list.map(s => {
    // Do NOT attach external subtitles to HardSub or WavesHD servers (they use burned-in subtitles)
    const low = (s.name || '').toLowerCase();
    if (low.includes('hardsub') || low.includes('hard') || low.includes('waves')) {
      return s;
    }

    const isDub = s.type === 'dub' || low.includes('dub');
    if (isDub) {
      // For DUB servers: always ensure full dialogue SUB subtitles are shared!
      // Keep any existing dub tracks (like Signs & Songs) and merge full dialogue tracks.
      const existing = Array.isArray(s.subtitles) ? [...s.subtitles] : [];
      const cleanedExisting = existing.map(track => {
        const lbl = (track.label || '').toLowerCase();
        if (/sign|song|s&s/i.test(lbl)) {
          return { ...track, label: 'English (Signs & Songs)' };
        }
        return track;
      });
      const existingUrls = new Set(cleanedExisting.map(t => t.file || t.url));
      const mergedSubs = [...cleanedExisting];

      for (const sub of allAvailableSubs) {
        const url = sub.file || sub.url;
        if (url && !existingUrls.has(url)) {
          existingUrls.add(url);
          mergedSubs.push(sub);
        }
      }
      return { ...s, subtitles: mergedSubs };
    }

    // For SUB servers: if this server has no subtitles, populate with available subtitles
    if (!s.subtitles || s.subtitles.length === 0) {
      return { ...s, subtitles: allAvailableSubs };
    }

    return s;
  });
};

/**
 * Builds a merged, deduplicated list of subtitle tracks across all servers.
 * Deduplicates by normalized language label — so only ONE "English" track shows
 * up even when NekoHD, AniHD, and Waves all provide their own English VTT.
 * Server priority: AniHD > NekoHD > Waves > others (prefer higher-quality sources).
 * SUB servers ALWAYS take precedence over DUB servers for dialogue tracks.
 */
export const buildAllSubtitleTracks = (list) => {
  if (!list || !list.length) return [];

  // Server priority — lower number = preferred when same language exists on multiple servers
  const getServerPriority = (serverName, isDub) => {
    const n = (serverName || '').toLowerCase();
    let base = 5;
    if (n.includes('anihd')) base = 1;
    else if (n.includes('neko')) base = 2;
    else if (n.includes('waves')) base = 3;
    else if (n.includes('anivid')) base = 4;
    // CRITICAL: DUB servers should NOT take priority over SUB servers for full-dialogue subtitles!
    if (isDub || n.includes('dub')) base += 20;
    return base;
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

  const isForcedTrack = (label, file) => {
    const raw = (label || '').toLowerCase();
    const f = (file || '').toLowerCase();
    return /forced/i.test(raw) || /forced[\._\-]/i.test(f);
  };

  const isSignsTrack = (label, file) => {
    const raw = (label || '').toLowerCase();
    const f = (file || '').toLowerCase();
    return /sign|song|s&s|dubtitle/i.test(raw) || /signs?[\._\-]/i.test(f);
  };

  // Normalize label → canonical language key for dedup
  const normalizeLabel = (label, file) => {
    const raw = (label || '').toLowerCase();
    const f = (file || '').toLowerCase();
    if (isSignsTrack(raw, f)) {
      return 'english (signs & songs)';
    }
    if (isForcedTrack(raw, f)) {
      return 'english (forced)';
    }
    if (!label) {
      return guessLangFromFile(file) || 'unknown';
    }
    const clean = raw
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
    const isDub = srv.type === 'dub' || (srv.name || '').toLowerCase().includes('dub');
    const priority = getServerPriority(srv.name, isDub);

    for (const sub of srv.subtitles) {
      const url = sub.file || sub.url;
      if (!url) continue;
      const lang = normalizeLabel(sub.label, url);
      if (!byLang[lang]) byLang[lang] = [];
      byLang[lang].push({ sub: { ...sub, file: url }, priority, serverName: srv.name });
    }
  }

  // For each language, pick the single best candidate (lowest priority number)
  const tracks = [];
  let idCounter = 1000;

  // Define display order: English dialogue first, then Signs & Songs, then Forced, then alphabetical
  const langOrder = (lang) => {
    if (lang === 'english') return '0';
    if (lang === 'english (signs & songs)') return '1';
    if (lang === 'english (forced)') return '2';
    return lang;
  };
  const sortedLangs = Object.keys(byLang).sort((a, b) =>
    langOrder(a).localeCompare(langOrder(b)));

  for (const lang of sortedLangs) {
    const candidates = byLang[lang];
    // Sort by: prefer non-forced/non-signs tracks for dialogue, then server priority
    candidates.sort((a, b) => {
      const aIsForced = isForcedTrack(a.sub.label, a.sub.file) || isSignsTrack(a.sub.label, a.sub.file);
      const bIsForced = isForcedTrack(b.sub.label, b.sub.file) || isSignsTrack(b.sub.label, b.sub.file);
      if (!aIsForced && bIsForced) return -1;
      if (aIsForced && !bIsForced) return 1;
      return a.priority - b.priority;
    });
    const best = candidates[0];
    const sub = best.sub;

    // Build a clean human-readable label: capitalize properly
    let displayLabel = sub.label
      ? sub.label.replace(/\b\w/g, c => c.toUpperCase())
      : lang.replace(/\b\w/g, c => c.toUpperCase());
    if (lang === 'english') {
      displayLabel = 'English';
    } else if (lang === 'english (signs & songs)') {
      displayLabel = 'English (Signs & Songs)';
    } else if (lang === 'english (forced)') {
      displayLabel = 'English (Forced)';
    }

    tracks.push({
      id: idCounter++,
      label: displayLabel,
      file: sub.file,
      referer: sub.referer || '',
      default: lang === 'english' ? true : (lang.includes('forced') ? false : !!sub.default),
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
