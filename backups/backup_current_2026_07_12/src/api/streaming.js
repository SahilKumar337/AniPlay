/**
 * Streaming embed URL builder
 * Uses publicly accessible embed sources — same approach as Anilab
 *
 * Primary:   VidSrc   (uses MAL ID — most reliable for anime)
 * Secondary: GogoEmbed (uses anime title slug)
 * Tertiary:  AniWatch  (uses anime title)
 */

/**
 * Build a streaming embed URL for a given source
 * @param {Object} anime - AniList anime object (with idMal, title)
 * @param {number} episode
 * @param {string} source - 'vidsrc' | 'gogo' | 'aniwatch' | 'yugen'
 */
export function buildEmbedUrl(anime, episode, source = 'vidsrc') {
  const malId = anime?.idMal;
  const title = (anime?.title?.romaji || anime?.title?.english || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

  switch (source) {
    case 'vidsrc':
      // VidSrc — indexes by MAL ID, very reliable
      if (malId) return `https://vidsrc.to/embed/anime/${malId}/${episode}`;
      return `https://vidsrc.to/embed/anime/${title}/${episode}`;

    case 'vidsrc2':
      // VidSrc.xyz — alternative instance
      if (malId) return `https://vidsrc.xyz/embed/anime/mal/${malId}/${episode}`;
      return buildEmbedUrl(anime, episode, 'gogo');

    case 'gogo':
      // GogoAnime embed (uses slug-episode-N format)
      return `https://emb.anitaku.bz/${title}-episode-${episode}`;

    case 'aniwatch':
      // AniWatch embed
      return `https://aniwatch.to/watch/${title}-1?ep=${episode}`;

    case 'yugen':
      // YugenAnime embed
      return `https://yugenanime.tv/embed/${title}-episode-${episode}/`;

    case 'animekhor':
      return `https://animekhor.xyz/embed/${title}-episode-${episode}`;

    default:
      return buildEmbedUrl(anime, episode, 'vidsrc');
  }
}

export const SERVERS = [
  { id: 'vidsrc',   label: 'Server 1',  badge: 'VidSrc' },
  { id: 'vidsrc2',  label: 'Server 2',  badge: 'VS2'    },
  { id: 'gogo',     label: 'Server 3',  badge: 'Gogo'   },
  { id: 'aniwatch', label: 'Server 4',  badge: 'AniWatch' },
];
