import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft, Share2, Bookmark, Star, Play, Download, X,
  Plus, Check, ChevronDown, ChevronUp, RefreshCw,
  AlertCircle, Search as SearchIcon, ChevronLeft, ChevronRight,
  Clock, CheckCircle, Tv, Wifi, WifiOff, Loader, Heart,
  MessageSquare, Send, User, ThumbsUp
} from 'lucide-react';
import { getAnimeDetail, getTitle, getCover, getDisplayGenresOrTags } from '../api/anilist';
import { useApp } from '../context/AppContext';
import { fetchCloudComments, postCloudComment, toggleCommentLike, updateUserNickname, createNotification } from '../api/supabase';
import AnimeCard from '../components/AnimeCard';
import { getAniNekoServers, getCachedServers, checkProxy, fetchM3U8Playlist, parseMasterPlaylist, resolvePlaceholderServer, invalidateStreamCache } from '../api/stream';
import AniPlayer from '../components/AniPlayer';
import IframePlayer from '../components/IframePlayer';
import { scrapeEmbedNative } from '../api/embedScraper';
import { downloadManager } from '../utils/DownloadManager';
import { registerBackButtonHandler } from '../utils/backButton';

const isDownloadable = (srv) => {
  if (!srv) return false;
  const name = (srv.name || '').toLowerCase();

  // NekoHD is always downloadable for both sub and dub.
  // The subtitle requirement was removed because subtitles load asynchronously
  // and may not be populated at the time this filter runs, silently excluding
  // valid NekoHD servers from the download list.
  if (name.includes('neko')) return true;

  if (name === 'anihd' || name === 'anivid') return true;

  return false;
};

const enrichDubSubtitles = (list) => {
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
 * Labels: "English (Neko)", "English (AniHD)", "English (Waves)"
 */
const buildAllSubtitleTracks = (list) => {
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
  let idCounter = 1000; // start from 1000 to avoid collisions with server-local IDs

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


export default function AnimePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    watchlist, addToWatchlist, removeFromWatchlist, isInWatchlist, updateWatchlistStatus,
    toggleFavorite, isFavorite, getEpisodeProgress,
    setEpisodeProgress, addToRecentlyViewed, showToast, settings, user, userProfile,
    likedComments, toggleLikeComment: contextToggleLikeComment
  } = useApp();
  // Always-fresh ref — avoids stale closure issues inside fetchStream useCallback
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const [anime, setAnime] = useState(null);
  const [state, setState] = useState('loading');
  const [errMsg, setErrMsg] = useState('');
  const [tab, setTab] = useState('episodes');
  const [synOpen, setSynOpen] = useState(false);
  const [epQuery, setEpQuery] = useState('');
  const [epPage, setEpPage] = useState(1); // pagination for episode list
  const [scrolled, setScrolled] = useState(false);
  const EP_PER_PAGE = 50;

  // Search parameters for inline watching
  const [searchParams, setSearchParams] = useSearchParams();
  const playParam = searchParams.get('play') === 'true';
  const epParam = parseInt(searchParams.get('ep')) || null;

  // Stream/Player State
  const [servers, setServers] = useState([]);
  const [allSubtitleTracks, setAllSubtitleTracks] = useState([]);
  const [activeUrl, setActiveUrl] = useState('');
  const [activeName, setActiveName] = useState('');
  const [activeType, setActiveType] = useState('sub');
  const [audioTrack, setAudioTrack] = useState(() => localStorage.getItem('anilab_preferred_track') || 'sub');
  const [loadStream, setLoadStream] = useState(false);
  const [streamErr, setStreamErr] = useState(null);
  const [isActiveHLS, setIsActiveHLS] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [activeServer, setActiveServer] = useState(null);
  const [fsActive, setFsActive] = useState(false);
  const [scraperErrors, setScraperErrors] = useState([]);
  const hasAutoSelectedRef = useRef(false);
  const lastFetchedRef = useRef(null);
  const lastEpRef = useRef(null);
  // Fullscreen-across-episode: tracks if we were in FS when user triggered next episode
  const keepFsRef = useRef(false);         // signals AniPlayer unmount to skip orientation restore
  const [epTransitionFs, setEpTransitionFs] = useState(false); // tells new AniPlayer to startInFs
  const fsActiveRef = useRef(false);        // mirror of fsActive for use inside callbacks (avoids stale closures)

  // Secure Downloads State
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [sessionDownloadedEps, setSessionDownloadedEps] = useState(new Set());
  const [serverPickerData, setServerPickerData] = useState(null); // { episode, servers, loading }
  const [qualityPickerData, setQualityPickerData] = useState(null); // { episode, variants, onSelect, onCancel }
  const [downloadAudioTrack, setDownloadAudioTrack] = useState('sub');

  // ── Back button closes popups instead of navigating away ──
  useEffect(() => {
    if (!downloadModalOpen && !serverPickerData && !qualityPickerData) return;
    return registerBackButtonHandler(() => {
      if (qualityPickerData) { setQualityPickerData(null); return true; }
      if (serverPickerData) { setServerPickerData(null); return true; }
      if (downloadModalOpen) { setDownloadModalOpen(false); return true; }
      return false;
    });
  }, [downloadModalOpen, serverPickerData, qualityPickerData]);

  // Comments Section State & Logic
  const [scraperEps, setScraperEps] = useState(0);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentTotal, setCommentTotal] = useState(0);     // total count from DB
  const [commentOffset, setCommentOffset] = useState(0);   // current pagination offset
  const [loadingMore, setLoadingMore] = useState(false);   // "Show More" loading state
  const [newComment, setNewComment] = useState('');
  const [username, setUsername] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyCommentText, setReplyCommentText] = useState('');
  // likedComments is now provided from AppContext and synced to cloud

  const COMMENTS_API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== ''
    ? `http://${window.location.hostname}:4000`
    : 'https://anilab-backend.onrender.com';

  const animeId = anime?.id || anime?.idMal || anime?.title?.romaji || 'unknown';
  const episodeNumber = epParam || 1;

  const getRandomAnimeName = () => {
    const names = ['Luffy', 'Zoro', 'Nami', 'Sanji', 'Goku', 'Vegeta', 'Naruto', 'Sasuke', 'Sakura', 'Kakashi', 'Deku', 'Bakugo', 'Todoroki', 'Tanjiro', 'Nezuko', 'Zenitsu', 'Inosuke', 'Gojo', 'Itadori', 'Megumi', 'Nobara', 'Eren', 'Mikasa', 'Armin', 'Levi', 'Subaru', 'Rem', 'Emilia', 'Rimuru', 'Saitama', 'Mob', 'Reigen'];
    const num = Math.floor(Math.random() * 1000);
    const name = names[Math.floor(Math.random() * names.length)];
    return `${name}_${num}`;
  };

  const getAvatarColor = (name) => {
    const colors = ['#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308', '#f97316'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  const formatRelativeTime = (dateStr) => {
    if (!dateStr) return 'recently';
    try {
      let normalized = dateStr;
      if (typeof dateStr === 'string') {
        normalized = dateStr.trim();
        if (normalized.includes(' ')) {
          normalized = normalized.replace(' ', 'T');
        }
        if (!normalized.endsWith('Z') && !normalized.includes('+') && !normalized.includes('-')) {
          normalized += 'Z';
        }
      }

      const past = new Date(normalized);
      if (isNaN(past.getTime())) {
        return 'recently';
      }

      const diffMs = Date.now() - past.getTime();
      const diffSecs = Math.floor(diffMs / 1000);
      if (diffSecs < 60) return 'just now';
      const diffMins = Math.floor(diffSecs / 60);
      if (diffMins < 60) return `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}d ago`;
    } catch {
      return 'recently';
    }
  };

  const buildCommentTree = (flatComments) => {
    // Deduplicate flatComments first to prevent any duplicate comment rendering
    const seenIds = new Set();
    const seenSignatures = new Set();
    const uniqueComments = flatComments.filter(c => {
      if (c.id && seenIds.has(c.id)) return false;
      if (c.id) seenIds.add(c.id);

      const sig = `${c.user_id || c.username || ''}_${(c.content || '').trim()}_${c.parent_id || ''}_${c.created_at ? new Date(c.created_at).toISOString().slice(0, 16) : ''}`;
      if (seenSignatures.has(sig)) return false;
      seenSignatures.add(sig);

      return true;
    });

    const parentComments = uniqueComments.filter(c => !c.parent_id);
    const replyMap = {};

    uniqueComments.forEach(c => {
      if (c.parent_id) {
        if (!replyMap[c.parent_id]) replyMap[c.parent_id] = [];
        replyMap[c.parent_id].push(c);
      }
    });

    Object.keys(replyMap).forEach(parentId => {
      replyMap[parentId].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });

    return { parentComments, replyMap };
  };

  /**
   * Load comments — if offset===0 it's a fresh load (replaces list).
   * If offset>0 it appends the next page ("Show More").
   */
  const fetchComments = async (offset = 0) => {
    if (!animeId) return;
    const isFirstPage = offset === 0;
    if (isFirstPage) setCommentsLoading(true);
    else setLoadingMore(true);
    try {
      const { data: rawData, count } = await fetchCloudComments(animeId, offset);
      const data = Array.isArray(rawData) ? rawData : [];  // SAFETY: never let data be undefined
      setCommentTotal(count || 0);
      setCommentOffset(offset);
      setComments(prev => {
        if (isFirstPage) return data;
        const existingIds = new Set((prev || []).map(c => c.id));
        const newRows = data.filter(c => !existingIds.has(c.id));
        return [...(prev || []), ...newRows];
      });
    } catch (e) {
      console.warn('[Comments Fetch Error]', e.message);
    } finally {
      if (isFirstPage) setCommentsLoading(false);
      else setLoadingMore(false);
    }
  };

  const handlePostComment = async (e, parentId = null) => {
    e.preventDefault();
    const commentBody = parentId ? replyCommentText.trim() : newComment.trim();
    if (!commentBody || submittingComment) return;

    setSubmittingComment(true);
    try {
      // postCloudComment(animeId, username, content, parentId) — no episode param
      await postCloudComment(animeId, username.trim() || 'Anonymous', commentBody, parentId);
      if (parentId) {
        // Send reply notification to the parent comment's owner
        const parentComment = comments.find(c => c.id === parentId);
        if (parentComment?.user_id && parentComment.user_id !== user?.id) {
          createNotification({
            targetUserId: parentComment.user_id,
            actorName: username || 'Someone',
            type: 'reply',
            commentPreview: commentBody.slice(0, 80),
            animeId: animeId ? String(animeId) : null,
          }).catch(() => { });
        }
        setReplyCommentText('');
        setReplyingTo(null);
      } else {
        setNewComment('');
      }
      // After posting, reset to page 0 so the new comment is visible at top
      await fetchComments(0);
      setCommentOffset(0);
    } catch (e) {
      alert(e.message || 'Failed to post comment');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleSaveNickname = async () => {
    if (!nicknameInput.trim()) return;
    const clean = nicknameInput.trim().slice(0, 25);
    setUsername(clean);
    localStorage.setItem('user_nickname', clean);
    setEditingNickname(false);

    try {
      await updateUserNickname(clean);
    } catch (e) {
      console.warn('[Supabase Profile Sync Error]', e.message);
    }
  };

  const toggleLikeComment = async (commentId) => {
    // isLiking = we are ADDING a like (not already liked)
    const isLiking = contextToggleLikeComment(commentId); // updates local liked state, returns bool

    // Optimistically update the likes_count in local comment state
    setComments(prev => prev.map(c => {
      if (c.id === commentId) {
        return { ...c, likes_count: Math.max(0, (c.likes_count || 0) + (isLiking ? 1 : -1)) };
      }
      return c;
    }));

    // Send like notification to comment owner
    if (isLiking) {
      const comment = comments.find(c => c.id === commentId);
      if (comment?.user_id && comment.user_id !== user?.id) {
        createNotification({
          targetUserId: comment.user_id,
          actorName: username || 'Someone',
          type: 'like',
          commentPreview: comment.content?.slice(0, 80),
          animeId: animeId ? String(animeId) : null,
        }).catch(() => { });
      }
    }

    // Atomic RPC update on Supabase (fire-and-forget, local state already updated)
    toggleCommentLike(commentId, isLiking).catch(err => {
      console.warn('[Like RPC Error]', err.message);
      // Revert optimistic update on failure
      setComments(prev => prev.map(c => {
        if (c.id === commentId) {
          return { ...c, likes_count: Math.max(0, (c.likes_count || 0) + (isLiking ? -1 : 1)) };
        }
        return c;
      }));
      contextToggleLikeComment(commentId); // revert local liked state too
    });
  };

  useEffect(() => {
    const activeUsername = user
      ? (userProfile?.nickname || user.user_metadata?.nickname || (user.email ? user.email.split("@")[0] : null))
      : localStorage.getItem("user_nickname");

    if (activeUsername) {
      setUsername(activeUsername);
      setNicknameInput(activeUsername);
    } else {
      const randomName = getRandomAnimeName();
      setUsername(randomName);
      setNicknameInput(randomName);
      localStorage.setItem('user_nickname', randomName);
    }
  }, [user, userProfile]);

  useEffect(() => {
    fetchComments(0);
  }, [animeId]);

  // Initialize already downloaded episodes from current session & subscribe to updates
  useEffect(() => {
    const fetchExisting = async () => {
      try {
        const list = await downloadManager.getDownloadsList();
        const epsSet = new Set();
        for (const item of list) {
          if (String(item.animeId) === String(id) && item.status === 'completed') {
            epsSet.add(`${item.episode}_${item.track}`);
          }
        }
        setSessionDownloadedEps(epsSet);
      } catch (e) {
        console.warn('[AnimePage] Failed to fetch existing session downloads:', e);
      }
    };
    fetchExisting();

    const unsubscribe = downloadManager.subscribe((data) => {
      if (data.taskId) {
        const parts = data.taskId.split('_');
        const animeId = parts[0];
        const epNum = parts[1] ? Number(parts[1]) : null;
        const track = parts[2] || 'sub';

        if (data.status === 'completed') {
          if (String(animeId) === String(id) && epNum !== null) {
            setSessionDownloadedEps(prev => {
              const next = new Set(prev);
              next.add(`${epNum}_${track}`);
              return next;
            });
          }
        }
        setDownloadProgress(prev => ({
          ...prev,
          [data.taskId]: data.status === 'completed' ? 100 : data.status === 'error' ? 'error' : data.progress
        }));
      }
    });

    return () => unsubscribe();
  }, [id]);

  const parseM3U8Qualities = async (masterUrl, referer) => {
    try {
      // Use fetchM3U8Playlist which uses CapacitorHttp on Android (bypasses CORS)
      // and falls back to browser fetch on desktop
      const text = await fetchM3U8Playlist(masterUrl, referer);
      if (!text.includes('#EXT-X-STREAM-INF')) return [];

      const lines = text.split('\n');
      const qualities = [];
      const base = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          let resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
          let name = 'SD';
          if (resMatch) {
            const h = parseInt(resMatch[2]);
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
            const absoluteUrl = urlLine.startsWith('http') ? urlLine : (urlLine.startsWith('/') ? new URL(masterUrl).origin + urlLine : base + urlLine);
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

  const handleDownloadClick = async (epNum) => {
    setServerPickerData({ episode: epNum, servers: [], slug: '', loading: true });
    try {
      // Always fetch fresh servers for downloads — never use stream cache.
      // Stream cache may have stale data from a previous AniKoto/AniWaves session
      // that only contains AniHD/AniVid servers, missing the Neko-StreamHG/Earnvids entries.
      const result = await getAniNekoServers(anime, epNum);

      if (result && result.servers && result.servers.length > 0) {
        const enriched = enrichDubSubtitles(result.servers);
        const downloadable = enriched.filter(isDownloadable);

        if (downloadable.length === 0) {
          showToast('No downloadable servers found for this episode.');
          setServerPickerData(null);
          return;
        }

        // ── 3. Show servers immediately — DO NOT pre-scrape embed URLs here.
        // AniNeko embeds are Cloudflare-protected and require a single WebView scrape.
        // Running parallel WebViews breaks the plugin (only one scrapeWebView exists).
        // The actual scraping happens in startDownload() when user picks a server.
        setServerPickerData({
          episode: epNum,
          servers: downloadable,
          slug: result.slug || '',
          loading: false
        });
      } else {
        showToast('No servers available for download.');
        setServerPickerData(null);
      }
    } catch (e) {
      console.error('[Downloads]', e);
      showToast('Failed to find servers. Please try again.');
      setServerPickerData(null);
    }
  };


  /**
   * Validates that a resolved m3u8 URL has real (non-ad) video segments.
   * Returns the segment count if valid, or 0 if all segments are ads/empty.
   */
  const validateM3U8 = async (m3u8Url, referer) => {
    try {
      const AD_CDN_DOMAINS = ['ibyteimg.com', 'bytedance', 'tiktokcdn', 'tiktok.com'];
      const playlist = await fetchM3U8Playlist(m3u8Url, referer);
      if (!playlist || !playlist.includes('#EXTM3U')) return 0;

      // If master playlist, pick the best variant
      let mediaPlaylist = playlist;
      if (playlist.includes('#EXT-X-STREAM-INF')) {
        const lines = playlist.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('#EXT-X-STREAM-INF') && lines[i+1]?.trim()) {
            let varUrl = lines[i+1].trim();
            if (!varUrl.startsWith('http')) {
              const base = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
              varUrl = base + varUrl;
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
      console.log(`[Downloads] validateM3U8: ${cleanSegs.length}/${segLines.length} clean segments`);
      return cleanSegs.length;
    } catch (e) {
      console.warn('[Downloads] validateM3U8 failed:', e.message);
      return -1; // Unknown — proceed anyway
    }
  };

  const startDownload = async (epNum, selectedServer, isExternal = false, targetPackage = '', allServers = null) => {
    setServerPickerData(null);

    // ── Step 1: Show quality picker IMMEDIATELY (before any WebView or network call) ──
    // This gives instant quality selection — no Cloudflare wait needed.
    // The selection will be used to pick the right variant from the master playlist.
    let preferredQuality = 'auto'; // default: best available

    if (!isExternal) {
      const QUALITY_OPTS = [
        { label: '✨  Auto — Best Available', url: 'auto' },
        { label: '🎬  1080p  Full HD', url: '1080' },
        { label: '📺  720p  HD', url: '720' },
        { label: '📱  480p  SD', url: '480' },
        { label: '⚡  360p  Low', url: '360' },
      ];
      const chosen = await new Promise((resolve) => {
        setQualityPickerData({
          episode: epNum,
          variants: QUALITY_OPTS,
          onSelect: (v) => resolve(v.url),
          onCancel: () => resolve(null),
        });
      });
      setQualityPickerData(null);
      if (chosen === null) {
        showToast('Download cancelled.');
        return;
      }
      preferredQuality = chosen; // 'auto' | '1080' | '720' | '480' | '360'
    }

    const taskId = `${anime.id}_${epNum}_${downloadAudioTrack}`;

    // Build a fallback server queue: [selectedServer, ...rest of allServers excluding selected]
    const serverQueue = [
      selectedServer,
      ...(allServers || []).filter(s => s.name !== selectedServer.name && s.type === (selectedServer.type || 'sub'))
    ];

    let lastError = null;

    for (let attempt = 0; attempt < serverQueue.length; attempt++) {
      const srv = serverQueue[attempt];
      const isRetry = attempt > 0;

      try {
        if (isRetry) {
          showToast(`⚠️ Retrying with ${srv.name}...`);
        } else {
          showToast(`🔍 Resolving download link...`);
        }
        setDownloadProgress(prev => ({ ...prev, [taskId]: 0 }));

        let finalUrl = srv.videoUrl;
        let referer = srv.referer || '';

        // Resolve placeholder link if needed
        const isPlaceholder = finalUrl && finalUrl.includes('proxy/placeholder');
        if (isPlaceholder) {
          showToast('Resolving direct stream links...');
          const resolved = await resolvePlaceholderServer(anime, epNum, srv.name, srv.type || 'sub');
          finalUrl = resolved.videoUrl;
          srv.videoUrl = resolved.videoUrl;
          srv.embedUrl = resolved.embedUrl;
          srv.isHLS = resolved.isHLS;
          srv.subtitles = resolved.subtitles || [];
          referer = resolved.referer || '';
        }

        // If it is an embed server, scrape it first to get direct stream url
        const isEmbed = !srv.isHLS && srv.embedUrl;
        if (isEmbed) {
          if (Capacitor.isNativePlatform()) {
            showToast(`🔓 Opening ${srv.name}... (solving security, may take 10-30s)`);
            finalUrl = await scrapeEmbedNative(srv.embedUrl, referer, 45000);
            // NOTE: Do NOT update referer here. The CDN uses the anime site referer
            // (e.g. https://anineko.to/) NOT the embed page URL.
          } else {
            finalUrl = srv.embedUrl;
          }
        } else if (srv.isHLS && srv.embedUrl && srv.embedUrl.includes('.m3u8')) {
          finalUrl = srv.embedUrl;
        }

        if (!finalUrl) {
          throw new Error(`No stream URL resolved from ${srv.name}`);
        }

        const animeTitle = anime.title?.english || anime.title?.romaji || 'Anime';

        if (isExternal) {
          showToast(targetPackage === 'com.hub.splayer' ? "Opening in SPlayer..." : "Opening in external downloader...");
          const title = `${animeTitle} - Ep ${epNum}`;
          await downloadManager.openExternalDownloader(finalUrl, referer, title, targetPackage);
          setDownloadProgress(prev => {
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
          return;
        }

        // Sniff HLS stream type
        let isHLS = finalUrl.includes('.m3u8') || srv.isHLS === true;
        if (!isHLS && srv.isHLS !== false && !finalUrl.includes('.mp4')) {
          try {
            const checkRes = await fetch(finalUrl, {
              method: 'HEAD',
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': referer }
            });
            const ct = checkRes.headers.get('Content-Type') || '';
            if (ct.includes('mpegurl') || ct.includes('x-mpegURL') || ct.includes('application/vnd.apple.mpegurl')) {
              isHLS = true;
            }
          } catch (e) {
            try {
              const checkText = await clientFetch(finalUrl, { headers: { 'Range': 'bytes=0-500' }, referer, timeout: 5000 });
              isHLS = checkText.trim().startsWith('#EXTM3U');
            } catch {}
          }
        }

        // ── Validate: make sure the m3u8 has real (non-ad) video segments ────────
        if (isHLS) {
          showToast(`✅ Stream found! Preparing download...`);
          const segCount = await validateM3U8(finalUrl, referer);
          if (segCount === 0) {
            throw new Error(`${srv.name} playlist has no valid video segments (ad-only stream)`);
          }
          console.log(`[Downloads] ${srv.name} validated: ${segCount} clean segments`);
        }

        // ── Step 2: Apply preferred quality to master playlist (if available) ──────
        // We try to fetch the master playlist from JS. On Neko servers this usually
        // fails (CDN requires WebView cookies), so we fall back to Java's OkHttp
        // which shares WebView cookies and will handle quality selection natively.
        if (isHLS && preferredQuality !== 'auto') {
          try {
            const masterText = await fetchM3U8Playlist(finalUrl, referer);
            if (masterText && masterText.includes('#EXT-X-STREAM-INF')) {
              const variants = parseMasterPlaylist(finalUrl, masterText);
              if (variants && variants.length > 0) {
                // Match user's preferred quality (find closest)
                const qNum = parseInt(preferredQuality, 10); // e.g. 1080, 720, 480, 360
                const sorted = [...variants].sort((a, b) => {
                  const getQ = (label) => {
                    const m = label.match(/(\d+)p/);
                    return m ? parseInt(m[1], 10) : 0;
                  };
                  return getQ(b.label) - getQ(a.label); // descending: best first
                });
                const match = sorted.find(v => {
                  const m = v.label.match(/(\d+)p/);
                  return m && parseInt(m[1], 10) <= qNum;
                }) || sorted[sorted.length - 1]; // fallback: lowest available
                if (match) {
                  finalUrl = match.url;
                  showToast(`Downloading at ${match.label}`);
                }
              }
            }
          } catch (e) {
            // Master playlist unavailable via JS — Java will use the captured m3u8 as-is.
            // For Neko servers, Java's OkHttp has WebView cookies and can auto-select quality.
            console.warn('[Downloads] Master playlist via JS failed, Java will handle quality:', e.message);
          }
        }

        // Pre-fetch media playlist so Java doesn't need to re-auth
        let mediaPlaylistContent = '';
        if (isHLS && finalUrl) {
          try {
            mediaPlaylistContent = await fetchM3U8Playlist(finalUrl, referer);
            console.log('[Downloads] Pre-fetched media playlist:', mediaPlaylistContent.length, 'chars');
          } catch (e) {
            console.warn('[Downloads] Media playlist pre-fetch failed (Java will retry):', e);
          }
        }

        showToast(`⬇️ Downloading Episode ${epNum}...`);
        await downloadManager.downloadEpisode(
          anime, epNum, finalUrl, referer, downloadAudioTrack,
          srv.subtitles || [], isHLS, mediaPlaylistContent
        );
        return; // ✅ Success — stop retrying

      } catch (e) {
        lastError = e;
        console.error(`[Downloads] Server ${srv.name} failed (attempt ${attempt + 1}/${serverQueue.length}):`, e.message);
        if (attempt < serverQueue.length - 1) {
          console.log(`[Downloads] Trying next server: ${serverQueue[attempt + 1]?.name}`);
        }
      }
    }

    // All servers failed
    console.error('[Downloads] All servers exhausted. Last error:', lastError?.message);
    showToast(`❌ Download failed: ${lastError?.message || 'All servers unavailable'}`);
    setDownloadProgress(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  };


  useEffect(() => {
    const handleScroll = () => {
      setScrolled((window.scrollY || document.documentElement.scrollTop) > 60);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('touchmove', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('touchmove', handleScroll);
    };
  }, []);

  // Lock body scroll and prevent viewport shifts during video playback
  useEffect(() => {
    if (playParam && epParam) {
      document.body.style.overflow = 'hidden';
      document.body.style.height = '100vh';
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.height = '100vh';
    } else {
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    }
    return () => {
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
    };
  }, [playParam, epParam]);

  const load = useCallback(async () => {
    // Player-first path: when navigating from Continue Watching (?play=true),
    // immediately begin server loading while AniList fetch runs in the background.
    // This eliminates the AnimePage flash (no more waiting for AniList before player shows).
    if (playParam) {
      setState('done'); // treat as 'done' so player portal renders immediately
    } else {
      setState('loading');
    }
    try {
      const data = await getAnimeDetail(Number(id));
      setAnime(data);
      setState('done');
    } catch (e) {
      console.warn('[AnimePage] Failed to fetch details from AniList:', e);
      if (!playParam) {
        setErrMsg('You are offline. Streaming requires an internet connection. You can play your downloaded videos directly from your device\'s Gallery.');
        setState('error');
      }
    }
  }, [id, playParam]);

  useEffect(() => { window.scrollTo(0, 0); load(); }, [load]);


  // Robust server selection
  const selectServer = useCallback(async (srv, srvList) => {
    setActiveServer(srv);
    setStreamErr(null);
    setExtracting(false);

    const listToUse = srvList || [];
    const sameTypeServers = srv.type === 'dub'
      ? listToUse.filter(s => s.type === 'dub')
      : listToUse.filter(s => s.type === 'sub');

    const currentIndex = sameTypeServers.findIndex(s => s.videoUrl === srv.videoUrl);

    const handleScrapeError = () => {
      if (currentIndex !== -1 && currentIndex < sameTypeServers.length - 1) {
        const nextSrv = sameTypeServers[currentIndex + 1];
        console.log(`[AnimePage] Server ${srv.name} failed. Falling back to: ${nextSrv.name}`);
        selectServer(nextSrv, listToUse);
      } else {
        setStreamErr('Unable to load stream. Please tap retry or select another server.');
      }
    };

    // Resolve placeholder link if needed
    const isPlaceholder = srv.videoUrl && srv.videoUrl.includes('proxy/placeholder');
    if (isPlaceholder) {
      setExtracting(true);
      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      try {
        console.log(`[AnimePage] Resolving placeholder for: ${srv.name}`);
        const resolved = await resolvePlaceholderServer(anime, epParam, srv.name, srv.type || 'sub');
        setExtracting(false);
        const updatedList = listToUse.map(s => {
          if (s.name === srv.name && s.type === srv.type) {
            return { ...s, ...resolved };
          }
          return s;
        });
        setServers(updatedList);
        selectServer({ ...srv, ...resolved }, updatedList);
        return;
      } catch (err) {
        console.error(`[AnimePage] Failed to resolve placeholder:`, err.message);
        setExtracting(false);
        handleScrapeError();
        return;
      }
    }

    const isEmbedServer = !srv.isHLS && srv.embedUrl;
    if (isEmbedServer) {
      const embedUrl = srv.embedUrl;
      const referer = srv.referer || 'https://aniwaves.ru/';
      // isIframe=true means the server is known to be an iframe-based player
      // For these, if native scraping fails we fall back to IframePlayer rather than showing an error
      const isIframeServer = !!srv.isIframe;

      // Helper: always restore immersive mode OFF after scraping finishes (Fix 6)
      // Prevents Android nav bar from staying permanently hidden after Waves scraping
      const resetImmersive = () => {
        try {
          const EmbedScraper = window.Capacitor?.registerPlugin?.('EmbedScraper');
          if (EmbedScraper?.setImmersiveMode) {
            EmbedScraper.setImmersiveMode({ enabled: false }).catch(() => { });
          }
        } catch (_) { }
      };

      if (Capacitor.isNativePlatform()) {
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);
        setActiveUrl('');
        setExtracting(true);

        scrapeEmbedNative(embedUrl, referer, isIframeServer ? 22000 : 15000)
          .then(m3u8Url => {
            resetImmersive(); // always restore nav bar visibility
            setExtracting(false);
            setActiveUrl(m3u8Url);
            setIsActiveHLS(true);
          })
          .catch(err => {
            console.warn('[AnimePage] Native scraper failed:', err.message);
            resetImmersive(); // always restore nav bar visibility even on failure
            setExtracting(false);
            if (isIframeServer) {
              console.log('[AnimePage] isIframe server — falling back to IframePlayer:', srv.name);
              setActiveUrl(embedUrl);
              setIsActiveHLS(false);
            } else {
              handleScrapeError();
            }
          });
        return;
      } else {
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);
        setActiveUrl(embedUrl);
        setExtracting(false);
        return;
      }
    }

    setActiveUrl(srv.videoUrl);
    setActiveName(srv.name);
    setActiveType(srv.type || 'sub');
    setIsActiveHLS(!!srv.isHLS);
    setExtracting(false);
  }, []);

  const fetchStream = useCallback(async () => {
    if (!anime || !epParam) return;

    hasAutoSelectedRef.current = false;

    // Prevent redundant scraper runs for the same anime + episode combination
    const currentKey = `${anime.id}_${epParam}`;
    if (lastFetchedRef.current === currentKey && servers.length > 0) {
      console.log('[AnimePage] Stream servers already resolved/resolving for: ' + currentKey + '. Skipping duplicate fetch.');
      return;
    }
    lastFetchedRef.current = currentKey;

    const cachedResult = getCachedServers(anime, epParam);
    if (cachedResult?.servers?.length) {
      setStreamErr(null);
      const enriched = enrichDubSubtitles(cachedResult.servers);
      setServers(enriched);
      setAllSubtitleTracks(buildAllSubtitleTracks(enriched)); // ← use enriched so AniHD/AniVid get inherited subs

      const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
      let matchingServers = enriched.filter(s => s.type === preferredTrack);
      if (matchingServers.length === 0) {
        matchingServers = enriched.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
      }
      // Respect preferredServer setting
      const preferredSrv = settingsRef.current?.preferredServer || 'auto';
      let preferred;
      if (preferredSrv === 'gogoanime' || preferredSrv === 'neko') {
        preferred = matchingServers.find(s => /neko|gogo/i.test(s.name)) || matchingServers[0] || enriched[0];
      } else if (preferredSrv === 'waveshd' || preferredSrv === 'waves') {
        preferred = matchingServers.find(s => /waves/i.test(s.name)) || matchingServers[0] || enriched[0];
      } else if (preferredSrv === 'anihd') {
        preferred = matchingServers.find(s => /^AniHD$/i.test(s.name)) || matchingServers[0] || enriched[0];
      } else {
        preferred = matchingServers[0] || enriched[0];
      }

      if (preferred) {
        hasAutoSelectedRef.current = true;
        setActiveType(preferred.type || 'sub');
        setAudioTrack(preferred.type || 'sub');
        selectServer(preferred, enriched);
      }

      const nextEp = epParam + 1;
      const isAiring = anime.status === 'RELEASING';
      const airedCount = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : 0;
      const maxEps = isAiring ? Math.max(1, scraperEps, airedCount) : Math.max(anime.episodes || 0, scraperEps, 1);
      if (nextEp <= maxEps) {
        getAniNekoServers(anime, nextEp).catch(() => { });
      }
      setLoadStream(false);
      return;
    }

    setLoadStream(true);
    setStreamErr(null);
    setScraperErrors([]);

    // Only clear servers and active player if the episode actually changed or we don't have one running,
    // which prevents the player from unmounting, losing fullscreen status, or layout flashing.
    const epChanged = lastEpRef.current !== epParam;
    lastEpRef.current = epParam;

    if (epChanged || !activeUrl) {
      setServers([]);
      setActiveUrl('');
      setActiveName('');
      setActiveServer(null);
    }

    const handleFound = (currentServers) => {
      const enriched = enrichDubSubtitles(currentServers);
      setServers(enriched);
      setAllSubtitleTracks(buildAllSubtitleTracks(enriched)); // ← use enriched so AniHD/AniVid get inherited subs

      if (!hasAutoSelectedRef.current) {
        const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
        let matchingServers = enriched.filter(s => s.type === preferredTrack);
        if (matchingServers.length === 0) {
          matchingServers = enriched.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
        }
        // Respect preferredServer setting
        const preferredSrv2 = settingsRef.current?.preferredServer || 'auto';
        let preferred;
        if (preferredSrv2 === 'gogoanime' || preferredSrv2 === 'neko') {
          preferred = matchingServers.find(s => /neko|gogo/i.test(s.name)) || matchingServers[0] || enriched[0];
        } else if (preferredSrv2 === 'waveshd' || preferredSrv2 === 'waves') {
          preferred = matchingServers.find(s => /waves/i.test(s.name)) || matchingServers[0] || enriched[0];
        } else if (preferredSrv2 === 'anihd') {
          preferred = matchingServers.find(s => /^AniHD$/i.test(s.name)) || matchingServers[0] || enriched[0];
        } else {
          preferred = matchingServers[0] || enriched[0];
        }

        if (preferred) {
          hasAutoSelectedRef.current = true;
          setActiveType(preferred.type || 'sub');
          setAudioTrack(preferred.type || 'sub');
          selectServer(preferred, enriched);
          setLoadStream(false);
          setStreamErr(null);
        }
      }
    };

    try {
      const result = await getAniNekoServers(anime, epParam, handleFound);
      if (result?.errors) {
        setScraperErrors(result.errors);
      }
      if (!result?.servers?.length) {
        setStreamErr('No streaming servers available for this episode.');
      } else {
        const nextEp = epParam + 1;
        const isAiring = anime.status === 'RELEASING';
        const airedCount = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : 0;
        const maxEps = isAiring ? Math.max(1, scraperEps, airedCount) : Math.max(anime.episodes || 0, scraperEps, 1);
        if (nextEp <= maxEps) {
          getAniNekoServers(anime, nextEp).catch(() => { });
        }
      }
    } catch (e) {
      setServers(prev => {
        if (prev.length === 0) {
          setStreamErr('Unable to connect to streaming servers. Please try again.');
        }
        return prev;
      });
    } finally {
      setLoadStream(false);
    }
  }, [anime, epParam, selectServer, scraperEps]);

  // Load stream when epParam changes
  useEffect(() => {
    if (playParam && epParam) {
      fetchStream();
    }
  }, [epParam, playParam, fetchStream]);

  // Re-select preferred server immediately when settings.preferredServer changes
  // (while servers are already loaded for the current episode)
  useEffect(() => {
    if (!servers.length) return;
    const preferredSrv = settings?.preferredServer || 'auto';
    const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
    let matchingServers = servers.filter(s => s.type === preferredTrack);
    if (matchingServers.length === 0) {
      matchingServers = servers.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
    }

    let preferred;
    if (preferredSrv === 'gogoanime' || preferredSrv === 'neko') {
      preferred = matchingServers.find(s => /neko|gogo/i.test(s.name));
    } else if (preferredSrv === 'waveshd' || preferredSrv === 'waves') {
      preferred = matchingServers.find(s => /waves/i.test(s.name));
    } else if (preferredSrv === 'anihd') {
      preferred = matchingServers.find(s => /^AniHD$/i.test(s.name));
    } else {
      preferred = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
        || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name));
    }

    // Only switch if we found a specific match (not just any fallback)
    if (preferred) {
      setActiveType(preferred.type || 'sub');
      setAudioTrack(preferred.type || 'sub');
      selectServer(preferred, servers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.preferredServer]);

  // Track episode watch history progress
  useEffect(() => {
    if (anime && epParam) {
      setEpisodeProgress(anime.id, epParam);
      addToRecentlyViewed(anime, epParam);

      // If all episodes watched, mark as completed
      const totalEps = Math.max(
        anime.episodes || 0,
        scraperEps,
        (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : 0
      );

      if (totalEps > 0 && epParam === totalEps) {
        const currentItem = watchlist[anime.id];
        if (!currentItem) {
          addToWatchlist(anime, 'completed');
          showToast('Completed! 🎉');
        } else if (currentItem.status !== 'completed') {
          updateWatchlistStatus(anime.id, 'completed');
          showToast('Completed! 🎉');
        }
      }
    }
  }, [anime, epParam, watchlist, addToWatchlist, updateWatchlistStatus, setEpisodeProgress, addToRecentlyViewed, showToast, scraperEps]);

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');

  /* ── Loading ───────────────────────────────────────────────── */
  if (state === 'loading') return <DetailSkeleton />;

  /* ── Error ─────────────────────────────────────────────────── */
  if (state === 'error') {
    return (
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <AlertCircle size={52} color="#e50914" style={{ marginBottom: 12, opacity: 0.8 }} />
        <p style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Couldn't load anime</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 260, marginBottom: 20 }}>{errMsg}</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={load}><RefreshCw size={15} /> Retry</button>
          <button className="btn btn-outline" onClick={() => navigate(-1)}>Go Back</button>
        </div>
      </div>
    );
  }

  /* ── Data ──────────────────────────────────────────────────── */
  const title = getTitle(anime);
  const cover = getCover(anime);
  const banner = cover; // Use same cover/poster image as search & home cards (not bannerImage which face-crops)
  const score = anime.averageScore ? (anime.averageScore / 10).toFixed(1) : null;
  const eps = anime.episodes || 0;
  const studios = anime.studios?.nodes?.map(s => s.name).join(', ') || '';
  const desc = (anime.description || 'No description available.')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
  const inList = isInWatchlist(anime.id);
  const fav = isFavorite(anime.id);
  const prog = getEpisodeProgress(anime.id);
  // ── Fix: isNotReleased was hardcoded false — now checks real status ──
  const isNotReleased = anime.status === 'NOT_YET_RELEASED' || (eps === 0 && !anime.nextAiringEpisode);

  const isAiring = anime.status === 'RELEASING';
  const airedCount = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1)
    ? anime.nextAiringEpisode.episode - 1
    : 0;

  const totalEps = isAiring
    ? Math.max(1, scraperEps, airedCount)
    : Math.max(eps || 0, scraperEps, 1);

  const allEps = Array.from({ length: totalEps }, (_, i) => i + 1);

  const resumeEp = prog?.episode ? Math.min(prog.episode, Math.max(totalEps, 1)) : 1;
  const filtered = epQuery ? allEps.filter(n => String(n).includes(epQuery.trim())) : allEps;
  // Pagination
  const totalPages = Math.ceil(filtered.length / EP_PER_PAGE);
  const filteredPage = filtered.slice((epPage - 1) * EP_PER_PAGE, epPage * EP_PER_PAGE);
  const recs = anime.recommendations?.nodes?.map(n => n.mediaRecommendation).filter(Boolean) || [];
  const chars = (anime.characters?.edges || []).map(e => ({ ...e.node, voiceActors: e.voiceActors || [] }));

  return (
    <div className="page" style={{ position: 'relative' }}>

      <div style={{
        position: 'fixed', top: 0, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 90,
        width: '100%', maxWidth: 480,
        padding: '12px 16px 12px',
        paddingTop: 'var(--sat)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: scrolled ? 'rgba(15, 15, 15, 0.75)' : 'rgba(15, 15, 15, 0)',
        backdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
        WebkitBackdropFilter: scrolled ? 'blur(20px) saturate(180%)' : 'blur(0px) saturate(100%)',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid rgba(255, 255, 255, 0)',
        transition: 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'none',
      }}>
        <button
          onClick={() => navigate(-1)} id="detail-back"
          className="floating-btn"
          style={{ pointerEvents: 'all' }}
          aria-label="Go back"
        ><ArrowLeft size={18} /></button>

        {/* Title visible only when scrolled */}
        <div style={{
          flex: 1, textAlign: 'center', padding: '0 12px',
          opacity: scrolled ? 1 : 0,
          transform: scrolled ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          fontWeight: 800, fontSize: 15, color: '#fff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          fontFamily: 'var(--font-brand)'
        }}>
          {title}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', pointerEvents: 'all' }}>
          <button
            onClick={() => inList ? removeFromWatchlist(anime.id) : addToWatchlist(anime)} id={`fav-${anime.id}`}
            aria-label="Bookmark"
            className="floating-btn"
          >
            <Bookmark size={18} color={inList ? '#e50914' : '#fff'} fill={inList ? '#e50914' : 'none'} />
          </button>
          <button
            id="share-btn"
            aria-label="Share"
            className="floating-btn"
          >
            <Share2 size={18} />
          </button>
        </div>
      </div>

      {/* ── Content Wrapper with Entrance Animation ────────────────── */}
      <div className="fade-in-up">
        {/* ════════════════════════════════════════
            HERO — Immersive full-bleed cinematic banner
        ════════════════════════════════════════ */}
        <div style={{ position: 'relative', width: '100%', height: 320, overflow: 'hidden', background: '#060610' }}>
          {/* Blurred atmospheric background — extracts color palette from poster */}
          <img
            src={cover} alt="" aria-hidden="true"
            style={{
              position: 'absolute', inset: '-10px',
              width: 'calc(100% + 20px)', height: 'calc(100% + 20px)',
              objectFit: 'cover', objectPosition: 'center top',
              filter: 'blur(36px) brightness(0.25) saturate(1.7)',
            }}
          />
          {/* Top vignette */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '40%',
            zIndex: 2, pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(4,4,10,0.75) 0%, transparent 100%)',
          }} />
          {/* Bottom fade into page */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%',
            zIndex: 2, pointerEvents: 'none',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(4,4,10,0.85) 70%, rgba(4,4,10,1) 100%)',
          }} />
          {/* Poster — CENTERED, tall, with premium shadow */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 3,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src={cover} alt={title}
              style={{
                height: '86%',
                width: 'auto',
                maxWidth: '58%',
                objectFit: 'cover',
                borderRadius: 18,
                boxShadow: '0 24px 80px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.08) inset',
              }}
            />
          </div>
        </div>

        {/* ════════════════════════════════════════
            SERVER SELECTION ROW
        ════════════════════════════════════════ */}
        {playParam && epParam && servers.length > 0 && (
          <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Select Server
            </p>

            {/* Segmented Control for Sub / Dub — Sliding Pill */}
            <div style={{
              display: 'flex',
              position: 'relative',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 24,
              padding: 3,
              marginBottom: 10,
              border: '1px solid var(--border)'
            }}>
              {/* Sliding pill background */}
              <div style={{
                position: 'absolute',
                top: 3, bottom: 3,
                left: audioTrack === 'sub' ? 3 : '50%',
                width: 'calc(50% - 3px)',
                borderRadius: 20,
                background: 'var(--accent)',
                boxShadow: '0 2px 12px color-mix(in srgb, var(--accent) 40%, transparent)',
                transition: 'left 0.35s cubic-bezier(0.25, 1, 0.3, 1)',
                pointerEvents: 'none',
              }} />
              <button
                disabled={subServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'sub');
                  setAudioTrack('sub');
                  if (subServers.length > 0) selectServer(subServers[0], servers);
                }}
                style={{
                  flex: 1, padding: '6px 0', border: 'none',
                  background: 'transparent',
                  position: 'relative', zIndex: 1,
                  color: subServers.length === 0
                    ? 'rgba(255,255,255,0.15)'
                    : (audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)'),
                  opacity: subServers.length === 0 ? 0.35 : 1,
                  fontSize: 11, fontWeight: 700, borderRadius: 20,
                  cursor: subServers.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'color 0.25s ease'
                }}
              >
                Subtitled (SUB)
              </button>
              <button
                disabled={dubServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'dub');
                  setAudioTrack('dub');
                  if (dubServers.length > 0) selectServer(dubServers[0], servers);
                }}
                style={{
                  flex: 1, padding: '6px 0', border: 'none',
                  background: 'transparent',
                  position: 'relative', zIndex: 1,
                  color: dubServers.length === 0
                    ? 'rgba(255,255,255,0.15)'
                    : (audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)'),
                  opacity: dubServers.length === 0 ? 0.35 : 1,
                  fontSize: 11, fontWeight: 700, borderRadius: 20,
                  cursor: dubServers.length === 0 ? 'not-allowed' : 'pointer',
                  transition: 'color 0.25s ease'
                }}
              >
                Dubbed (DUB)
              </button>
            </div>

            {/* Active Track Server List */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(audioTrack === 'sub' ? subServers : dubServers).map((s, idx) => {
                const active = activeServer?.name === s.name;
                return (
                  <button
                    key={idx}
                    onClick={() => selectServer(s, servers)}
                    style={{
                      padding: '6px 12px', borderRadius: 20,
                      background: active ? 'var(--accent)' : 'var(--bg-card)',
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      color: active ? '#fff' : 'var(--text-secondary)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                      boxShadow: active ? '0 2px 12px color-mix(in srgb, var(--accent) 35%, transparent)' : 'none',
                      transform: active ? 'scale(1.02)' : 'scale(1)',
                      transition: 'all 0.3s cubic-bezier(0.25, 1, 0.3, 1)',
                    }}
                  >
                    {active && <span style={{
                      width: 4, height: 4, borderRadius: '50%', background: '#fff', flexShrink: 0,
                      animation: 'fadeScale 0.25s ease forwards',
                    }} />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════
            TITLE ROW
        ════════════════════════════════════════ */}
        <div style={{ padding: '12px 16px 0' }}>
          <h1 style={{ fontSize: 22, fontWeight: 900, fontFamily: 'var(--font-brand)', lineHeight: 1.2 }}>
            {title}
          </h1>
        </div>

        {/* META BADGES ROW */}
        <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {score && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 13, fontWeight: 700, color: '#f5c518' }}>
              <Star size={13} fill="#f5c518" color="#f5c518" />{score}
            </div>
          )}
          {score && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>›</span>}
          {anime.startDate?.year && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{anime.startDate.year}</span>}
          <span className="card-badge badge-pg">PG-13</span>
          <span className="card-badge badge-hd">HD</span>
          {anime.format && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>{anime.format.replace('_', ' ')}</span>
          )}
          {totalEps > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{totalEps} eps</span>}
        </div>

        {/* PLAY + DOWNLOAD BUTTONS */}
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 10 }}>
          {isNotReleased ? (
            <div style={{
              flex: 1, textAlign: 'center', padding: '13px',
              fontSize: 14, fontWeight: 700, borderRadius: 10,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}>
              <AlertCircle size={16} /> Not Yet Released
            </div>
          ) : (
            <>
              <button
                className="btn btn-primary"
                id={`play-${anime.id}`}
                style={{ flex: 1, justifyContent: 'center', padding: '13px', fontSize: 15, fontWeight: 700, borderRadius: 10 }}
                onClick={() => setSearchParams({ play: 'true', ep: String(resumeEp) }, { replace: true })}
              >
                <Play size={17} fill="#fff" />
                {prog && resumeEp > 0 ? `Resume Ep ${resumeEp}` : 'Play'}
              </button>
              <button
                className="btn btn-primary"
                id={`dl-${anime.id}`}
                style={{
                  flex: 1,
                  justifyContent: 'center',
                  padding: '13px',
                  fontSize: 15,
                  fontWeight: 700,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer'
                }}
                onClick={() => setDownloadModalOpen(true)}
              >
                <Download size={17} color="var(--accent)" fill="var(--accent)" />
                Downloads
              </button>
            </>
          )}
        </div>

        {/* ════════════════════════════════════════
          GENRE + SYNOPSIS WITH HEART BUTTON
      ════════════════════════════════════════ */}
        <div style={{ padding: '14px 16px 0', paddingTop: 'var(--sat)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Genre */}
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Genre:</span>{' '}
              {getDisplayGenresOrTags(anime).join(', ')}
              {studios ? ` · Studio: ${studios}` : ''}
            </p>

            {/* Description */}
            <p style={{
              fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75,
              display: '-webkit-box', WebkitBoxOrient: 'vertical',
              WebkitLineClamp: synOpen ? 'unset' : 4,
              overflow: 'hidden',
            }}>{desc}</p>
            <button onClick={() => setSynOpen(v => !v)} id="syn-toggle"
              style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginTop: 4, display: 'flex', alignItems: 'center', gap: 2, border: 'none', background: 'none' }}
            >
              {synOpen ? <>View Less <ChevronUp size={12} /></> : <>... View More <ChevronDown size={12} /></>}
            </button>
          </div>

          {/* Heart button */}
          <button
            onClick={() => toggleFavorite(anime.id, anime)}
            id={`fav-btn-syn-${anime.id}`}
            style={{
              background: fav ? 'rgba(229,9,20,0.1)' : 'rgba(255,255,255,0.05)',
              border: `1.5px solid ${fav ? '#e50914' : 'var(--border)'}`,
              borderRadius: 12, width: 44, height: 44,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s'
            }}
            aria-label="Add to favorites"
          >
            <Heart size={20} color={fav ? '#e50914' : '#fff'} fill={fav ? '#e50914' : 'none'} />
          </button>
        </div>

        {/* ════════════════════════════════════════
          TABS
      ════════════════════════════════════════ */}
        <div style={{ marginTop: 20, borderBottom: '1px solid var(--border)' }}>
          <div
            className="no-scrollbar"
            style={{
              display: 'flex',
              padding: '0 16px',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            <style>{`
            .no-scrollbar::-webkit-scrollbar {
              display: none;
            }
          `}</style>
            {[
              { k: 'episodes', l: 'Episodes' },
              { k: 'similar', l: `More like this` },
              { k: 'comments', l: `Comments (${commentTotal > 0 ? commentTotal : (comments || []).length})` },
              { k: 'characters', l: 'Characters' },
            ].map(t => (
              <button key={t.k} onClick={() => setTab(t.k)} id={`tab-${t.k}`}
                style={{
                  padding: '12px 12px',
                  fontSize: 13, fontWeight: tab === t.k ? 700 : 500,
                  color: tab === t.k ? 'var(--accent)' : 'var(--text-muted)',
                  border: 'none', background: 'none', cursor: 'pointer',
                  borderBottom: tab === t.k ? '2px solid var(--accent)' : '2px solid transparent',
                  transition: 'all 0.2s', whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >{t.l}</button>
            ))}
          </div>
        </div>

        {/* ════════════════════════════════════════
          TAB CONTENT
      ════════════════════════════════════════ */}
        <div style={{ padding: '16px 16px 0' }}>

          {/* ── EPISODES ─────────────────────────────────────────── */}
          {tab === 'episodes' && (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>
                  Episodes
                  {totalEps > 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>{totalEps} total</span>}
                </span>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'var(--bg-card)', borderRadius: 8, padding: '6px 10px',
                  border: '1px solid var(--border)',
                }}>
                  <SearchIcon size={12} color="var(--text-muted)" />
                  <input
                    type="number" placeholder="Go to ep..." value={epQuery} min={1}
                    onChange={e => { setEpQuery(e.target.value); setEpPage(1); }}
                    id="ep-search"
                    style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 12, width: 80 }}
                  />
                </div>
              </div>

              {/* Episode List — clean Netflix-style numbered rows */}
              {isNotReleased || totalEps === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
                  <AlertCircle size={32} style={{ marginBottom: 12, opacity: 0.5 }} />
                  <p>No episodes available yet.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {filteredPage.map(n => {
                    const isWatched = prog?.episode > n;
                    const isCurrent = prog?.episode === n;
                    return (
                      <div
                        key={n}
                        onClick={() => {
                          setSearchParams({ play: 'true', ep: String(n) });
                        }}
                        id={`ep-card-${n}`}
                        role="button" tabIndex={0}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 14,
                          padding: '12px 4px',
                          borderBottom: '1px solid rgba(255,255,255,0.05)',
                          cursor: 'pointer',
                          borderRadius: 8,
                          transition: 'background 0.15s',
                          background: isCurrent ? 'rgba(229,9,20,0.06)' : 'transparent',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                        onMouseLeave={e => e.currentTarget.style.background = isCurrent ? 'rgba(229,9,20,0.06)' : 'transparent'}
                      >
                        {/* Episode number */}
                        <span style={{
                          width: 40, textAlign: 'center', fontSize: 16, fontWeight: 800,
                          color: isCurrent ? 'var(--accent)' : isWatched ? 'rgba(255,255,255,0.2)' : 'var(--text-muted)',
                          flexShrink: 0,
                        }}>{n}</span>

                        {/* Status bar on left */}
                        <div style={{
                          width: 3, height: 32, borderRadius: 3, flexShrink: 0,
                          background: isCurrent ? 'var(--accent)' : isWatched ? 'rgba(76,175,80,0.6)' : 'rgba(255,255,255,0.08)',
                        }} />

                        {/* Label */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: isWatched ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                            Episode {n} {(sessionDownloadedEps.has(`${n}_sub`) || sessionDownloadedEps.has(`${n}_dub`)) && <span style={{ color: '#4caf50', marginLeft: 6, fontWeight: 800 }}>✓</span>}
                          </div>
                          {isCurrent && (
                            <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2, fontWeight: 600 }}>▶ Resume here</div>
                          )}
                          {isWatched && !isCurrent && (
                            <div style={{ fontSize: 11, color: 'rgba(76,175,80,0.8)', marginTop: 2 }}>✓ Watched</div>
                          )}
                        </div>

                        {/* Play icon */}
                        <div style={{
                          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                          background: isCurrent ? 'var(--accent)' : 'rgba(255,255,255,0.07)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}>
                          <Play size={13} fill={isCurrent ? '#fff' : 'rgba(255,255,255,0.6)'} color={isCurrent ? '#fff' : 'rgba(255,255,255,0.6)'} />
                        </div>
                      </div>
                    );
                  })}

                  {/* Pagination controls */}
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 16, paddingBottom: 8 }}>
                      <button
                        onClick={() => setEpPage(p => Math.max(1, p - 1))}
                        disabled={epPage <= 1}
                        style={{
                          padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                          background: epPage <= 1 ? 'rgba(255,255,255,0.03)' : 'var(--bg-card)',
                          border: '1px solid var(--border)', color: epPage <= 1 ? 'var(--text-muted)' : 'var(--text-primary)',
                          cursor: epPage <= 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        <ChevronLeft size={14} /> Prev
                      </button>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Page {epPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setEpPage(p => Math.min(totalPages, p + 1))}
                        disabled={epPage >= totalPages}
                        style={{
                          padding: '8px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                          background: epPage >= totalPages ? 'rgba(255,255,255,0.03)' : 'var(--bg-card)',
                          border: '1px solid var(--border)', color: epPage >= totalPages ? 'var(--text-muted)' : 'var(--text-primary)',
                          cursor: epPage >= totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        }}
                      >
                        Next <ChevronRight size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── MORE LIKE THIS ───────────────────────────────────── */}
          {tab === 'similar' && (
            <div style={{ paddingBottom: 16 }}>
              {!recs.length ? (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <p className="empty-sub">No recommendations yet</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {recs.map(r => <AnimeCard key={r.id} anime={r} width="100%" height={148} />)}
                </div>
              )}
            </div>
          )}

          {/* ── CHARACTERS ───────────────────────────────────────── */}
          {tab === 'characters' && (
            <div style={{ paddingBottom: 16 }}>
              {!chars.length ? (
                <div className="empty-state" style={{ padding: '32px 0' }}>
                  <p className="empty-sub">No character data</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {chars.map(c => {
                    const va = c.voiceActors?.[0];
                    return (
                      <div key={c.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'var(--bg-card)', borderRadius: 12, padding: '10px 12px',
                      }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <img src={c.image?.large} alt={c.name?.full}
                            style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: '#222', flexShrink: 0 }}
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name?.full}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Character</div>
                          </div>
                        </div>
                        {va && (
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 13, fontWeight: 600 }}>{va.name?.full}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Voice Actor</div>
                            </div>
                            <img src={va.image?.large} alt={va.name?.full}
                              style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', background: '#222', flexShrink: 0 }}
                              onError={e => { e.target.style.display = 'none'; }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── COMMENTS ─────────────────────────────────────────── */}
          {tab === 'comments' && (
            <div style={{ animation: 'fade-in 0.25s ease' }}>

              {/* ── Composer (always visible at top) ────────────────────── */}
              <div style={{ marginBottom: 20 }}>
                {/* Username row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: getAvatarColor(username), color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 11, flexShrink: 0
                  }}>
                    {username.charAt(0).toUpperCase()}
                  </div>
                  {editingNickname ? (
                    <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                      <input
                        value={nicknameInput}
                        onChange={e => setNicknameInput(e.target.value.slice(0, 25))}
                        placeholder="Your nickname"
                        autoFocus
                        style={{
                          flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                          borderRadius: 8, padding: '4px 10px', color: '#fff', fontSize: 12,
                          outline: 'none', fontFamily: 'inherit'
                        }}
                        onKeyDown={e => e.key === 'Enter' && handleSaveNickname()}
                      />
                      <button onClick={handleSaveNickname} style={{
                        background: 'var(--accent)', border: 'none', borderRadius: 8,
                        color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 10px', cursor: 'pointer'
                      }}>Save</button>
                      <button onClick={() => setEditingNickname(false)} style={{
                        background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
                        borderRadius: 8, color: 'var(--text-muted)', fontSize: 11, padding: '4px 10px', cursor: 'pointer'
                      }}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setNicknameInput(username); setEditingNickname(true); }}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 4
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{username}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>(edit)</span>
                    </button>
                  )}
                </div>

                {/* Comment input */}
                <form onSubmit={handlePostComment}>
                  <div style={{
                    display: 'flex', alignItems: 'flex-end', gap: 10,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 16, padding: '10px 12px'
                  }}>
                    <textarea
                      value={newComment}
                      onChange={e => setNewComment(e.target.value.slice(0, 500))}
                      placeholder="Share your thoughts on this anime..."
                      rows={1}
                      style={{
                        flex: 1, background: 'none', border: 'none', outline: 'none', resize: 'none',
                        color: '#fff', fontSize: 13, fontFamily: 'inherit', lineHeight: '1.5',
                        maxHeight: 120, overflowY: 'auto'
                      }}
                      onInput={e => {
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(e); }
                      }}
                    />
                    <button
                      type="submit"
                      disabled={submittingComment || !newComment.trim()}
                      style={{
                        background: newComment.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                        border: 'none', borderRadius: '50%', width: 34, height: 34, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: newComment.trim() ? 'pointer' : 'default', transition: 'all 0.2s'
                      }}
                    >
                      {submittingComment
                        ? <Loader size={14} className="spin" style={{ color: '#fff' }} />
                        : <Send size={13} style={{ color: newComment.trim() ? '#fff' : 'rgba(255,255,255,0.25)', transform: 'translate(1px,-1px)' }} />
                      }
                    </button>
                  </div>
                </form>
              </div>

              {/* ── Comments list ──────────────────────────────────── */}
              {commentsLoading && comments.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '32px 0', justifyContent: 'center' }}>
                  <Loader size={18} className="spin" style={{ color: 'var(--accent)' }} />
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading comments...</span>
                </div>
              ) : comments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                  <MessageSquare size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
                  <p style={{ margin: 0, fontSize: 13 }}>Be the first to comment</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 40 }}>
                  {(() => {
                    const { parentComments, replyMap } = buildCommentTree(comments);
                    return parentComments.map((c, i) => {
                      const isLiked = likedComments.includes(c.id);
                      const replies = replyMap[c.id] || [];
                      const isReplyingThis = replyingTo === c.id;
                      const likeCount = c.likes_count || 0;

                      return (
                        <div key={c.id || i} style={{ paddingBottom: 4 }}>

                          {/* ── Parent Comment Card ── */}
                          <div style={{ display: 'flex', gap: 10, padding: '12px 4px' }}>
                            {/* Avatar */}
                            <div style={{
                              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                              background: getAvatarColor(c.username), color: '#fff',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontWeight: 700, fontSize: 13
                            }}>
                              {(c.username || '?').charAt(0).toUpperCase()}
                            </div>

                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{c.username}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{formatRelativeTime(c.created_at)}</span>
                              </div>
                              <p style={{
                                margin: '0 0 8px 0', fontSize: 13, color: 'rgba(255,255,255,0.88)',
                                lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                              }}>{c.content}</p>

                              {/* Action row */}
                              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                                <button
                                  onClick={() => toggleLikeComment(c.id)}
                                  style={{
                                    background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 5,
                                    color: isLiked ? 'var(--accent)' : 'var(--text-muted)',
                                    fontSize: 11, cursor: 'pointer', padding: 0, fontWeight: isLiked ? 600 : 400
                                  }}
                                >
                                  <Heart size={12} fill={isLiked ? 'currentColor' : 'none'} />
                                  <span>{likeCount > 0 ? likeCount : 'Like'}</span>
                                </button>

                                <button
                                  onClick={() => { setReplyingTo(isReplyingThis ? null : c.id); setReplyCommentText(''); }}
                                  style={{
                                    background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 5,
                                    color: isReplyingThis ? 'var(--accent)' : 'var(--text-muted)',
                                    fontSize: 11, cursor: 'pointer', padding: 0
                                  }}
                                >
                                  <MessageSquare size={12} />
                                  <span>{replies.length > 0 ? `Reply (${replies.length})` : 'Reply'}</span>
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* ── Inline Reply Composer ── */}
                          {isReplyingThis && (
                            <form
                              onSubmit={e => handlePostComment(e, c.id)}
                              style={{ marginLeft: 44, marginBottom: 8, animation: 'fade-in 0.2s ease' }}
                            >
                              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                                <div style={{
                                  flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                                  borderRadius: 12, padding: '8px 12px', paddingTop: 'var(--sat)', display: 'flex', gap: 8, alignItems: 'flex-end'
                                }}>
                                  <div style={{ flex: 1 }}>
                                    <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                                      Replying to @{c.username}
                                    </span>

                                    <textarea
                                      value={replyCommentText}
                                      onChange={e => setReplyCommentText(e.target.value.slice(0, 300))}
                                      placeholder="Write a reply..."
                                      rows={1}
                                      autoFocus
                                      style={{
                                        width: '100%', background: 'none', border: 'none', outline: 'none',
                                        resize: 'none', color: '#fff', fontSize: 12, fontFamily: 'inherit',
                                        lineHeight: '1.4', maxHeight: 80, overflowY: 'auto'
                                      }}
                                      onInput={e => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
                                      }}
                                    />
                                  </div>
                                  <button
                                    type="submit"
                                    disabled={!replyCommentText.trim() || submittingComment}
                                    style={{
                                      background: replyCommentText.trim() ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                                      border: 'none', borderRadius: '50%', width: 28, height: 28, flexShrink: 0,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                                    }}
                                  >
                                    {submittingComment
                                      ? <Loader size={11} className="spin" style={{ color: '#fff' }} />
                                      : <Send size={11} style={{ color: replyCommentText.trim() ? '#fff' : 'rgba(255,255,255,0.25)', transform: 'translate(1px,-1px)' }} />
                                    }
                                  </button>
                                </div>
                              </div>
                              <button type="button" onClick={() => setReplyingTo(null)}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer', padding: '4px 0', marginTop: 2 }}
                              >Cancel</button>
                            </form>
                          )}

                          {/* ── Replies ── */}
                          {replies.length > 0 && (
                            <div style={{ marginLeft: 44, borderLeft: '1.5px solid rgba(255,255,255,0.06)', paddingLeft: 12, display: 'flex', flexDirection: 'column', gap: 0 }}>
                              {replies.map((r, ri) => {
                                const rIsLiked = likedComments.includes(r.id);
                                const rLikeCount = r.likes_count || 0;
                                return (
                                  <div key={r.id || ri} style={{ display: 'flex', gap: 8, padding: '10px 4px' }}>
                                    <div style={{
                                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                                      background: getAvatarColor(r.username), color: '#fff',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontWeight: 700, fontSize: 10
                                    }}>
                                      {(r.username || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{r.username}</span>
                                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatRelativeTime(r.created_at)}</span>
                                      </div>
                                      <p style={{
                                        margin: '0 0 6px 0', fontSize: 12, color: 'rgba(255,255,255,0.82)',
                                        lineHeight: '1.4', whiteSpace: 'pre-wrap', wordBreak: 'break-word'
                                      }}>{r.content}</p>
                                      <button
                                        onClick={() => toggleLikeComment(r.id)}
                                        style={{
                                          background: 'none', border: 'none', display: 'flex', alignItems: 'center', gap: 4,
                                          color: rIsLiked ? 'var(--accent)' : 'var(--text-muted)',
                                          fontSize: 10, cursor: 'pointer', padding: 0, fontWeight: rIsLiked ? 600 : 400
                                        }}
                                      >
                                        <Heart size={10} fill={rIsLiked ? 'currentColor' : 'none'} />
                                        <span>{rLikeCount > 0 ? rLikeCount : 'Like'}</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Subtle divider */}
                          {i < parentComments.length - 1 && (
                            <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', margin: '0 4px' }} />
                          )}
                        </div>
                      );
                    });
                  })()}

                  {/* Show More */}
                  {comments.length < commentTotal && (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12 }}>
                      <button
                        onClick={() => fetchComments(comments.length)}
                        disabled={loadingMore}
                        style={{
                          background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: 20, padding: '8px 20px', fontSize: 12, fontWeight: 600,
                          color: 'var(--text-secondary)', cursor: loadingMore ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 6, opacity: loadingMore ? 0.6 : 1
                        }}
                      >
                        {loadingMore ? <><Loader size={12} className="spin" /> Loading...</> : <>Load more ({commentTotal - comments.length})</>}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── PLAYER SCREEN / OVERLAY WINDOW (PORTAL) ──────────────── */}
      {playParam && epParam && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: '#000000', display: 'flex', flexDirection: 'column',
          // Use max() of safe-area-inset-top (notch) and --sb-height (status bar that couldn't be hidden)
          // This ensures the player is never hidden behind ANY type of system UI on any phone
          paddingTop: fsActive ? 0 : 'max(env(safe-area-inset-top), var(--sb-height, 0px))',
          // Pad bottom so episode list is never hidden behind gesture nav bar
          paddingBottom: fsActive ? 0 : 'var(--android-safe-bottom, env(safe-area-inset-bottom))',
          boxSizing: 'border-box',
        }} className="page-slide-in">

          {/* 1. Player Box — exact 16:9, no maxHeight cap */}
          <div style={{
            position: 'relative',
            width: '100%',
            // Taller player: ~45% bigger than pure 16:9, capped at 52vh so episodes stay visible
            height: fsActive ? '100%' : 'min(calc(100vw * 9 / 16 * 1.45), 52vh)',
            flex: fsActive ? 1 : '0 0 auto',
            background: '#000',
            overflow: fsActive ? 'visible' : 'hidden'
          }}>
            {loadStream && servers.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 12 }}>
                <Loader size={30} className="spin" color="var(--accent)" />
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Searching servers...</p>
              </div>
            ) : extracting ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 12 }}>
                <Loader size={30} className="spin" color="var(--accent)" />
                <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Resolving stream sources...</p>
              </div>
            ) : streamErr ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', gap: 12, padding: 20, overflowY: 'auto' }}>
                <AlertCircle size={32} color="#e50914" />
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 260 }}>{streamErr}</p>



                <button className="btn btn-primary" onClick={fetchStream} style={{ padding: '6px 16px', borderRadius: 20, fontSize: 12, marginTop: 6 }}>
                  ↺ Retry
                </button>
              </div>
            ) : activeUrl ? (
              isActiveHLS ? (
                <AniPlayer
                  url={activeUrl}
                  title={`${title} - Episode ${epParam}`}
                  referer={activeServer?.referer}
                  embedUrl={activeServer?.embedUrl}
                  subtitles={activeServer?.subtitles || []}
                  extraSubtitles={allSubtitleTracks}
                  onBack={() => navigate(-1)}
                  onFullscreenChange={(isFs) => {
                    setFsActive(isFs);
                    fsActiveRef.current = isFs;
                    // Once the new episode's player has entered fullscreen, we no longer
                    // need to force-start in FS — reset so future non-FS ep changes work correctly
                    if (isFs) setEpTransitionFs(false);
                  }}
                  currentEpisode={epParam}
                  totalEpisodes={totalEps}
                  onEpisodeChange={(newEp) => {
                    // Use ref to read latest FS state — avoids stale closure trapping old fsActive value
                    const wasFs = fsActiveRef.current;
                    if (wasFs) {
                      keepFsRef.current = true;  // tell the unmounting AniPlayer to skip orientation restore
                      setEpTransitionFs(true);   // tell the new AniPlayer to startInFs
                      // Reset the keepFs flag after the new player has mounted and taken over
                      setTimeout(() => { keepFsRef.current = false; }, 800);
                    } else {
                      setEpTransitionFs(false);
                    }
                    setSearchParams({ play: 'true', ep: String(newEp) }, { replace: true });
                    if (!wasFs) window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  autoplay={settings?.autoplay !== false}
                  subtitleSettings={settings || null}
                  loading={loadStream}
                  startInFs={epTransitionFs}
                  keepFsOnEpChange={keepFsRef}
                  onStreamExpired={() => {
                    // CDN token expired mid-play — bust stale cache and re-select same server
                    console.log('[AnimePage] Stream expired — invalidating cache and re-selecting server...');
                    if (anime && epParam) invalidateStreamCache(anime, epParam);
                    if (activeServer) selectServer(activeServer, servers);
                  }}
                />
              ) : (
                <IframePlayer
                  src={activeUrl}
                  onBack={() => navigate(-1)}
                  onStreamCaptured={(m3u8Url, ref) => {
                    if (m3u8Url) {
                      setActiveUrl(m3u8Url);
                      setIsActiveHLS(true);
                    } else {
                      handleScrapeError();
                    }
                  }}
                />
              )
            ) : null}
          </div>

          {/* 2. Controls & Episodes Area below video */}
          {!fsActive && (
            <div className="player-content-soft-fade" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              {/* Toolbar / Navigation */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 16px', borderBottom: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.01)'
              }}>
                <button
                  onClick={() => navigate(-1)}
                  className="floating-btn"
                  style={{ width: 32, height: 32 }}
                >
                  <ArrowLeft size={16} />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Now Playing
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    Episode {epParam} · {title}
                  </div>
                </div>
              </div>

              {/* Server Row & Audio selector inside player screen */}
              {servers.length > 0 && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                  {/* Segmented Control for Sub / Dub — Sliding Pill */}
                  <div style={{
                    display: 'flex',
                    position: 'relative',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 24,
                    padding: 3,
                    marginBottom: 8,
                    border: '1px solid var(--border)'
                  }}>
                    {/* Sliding pill background */}
                    <div style={{
                      position: 'absolute',
                      top: 3, bottom: 3,
                      left: audioTrack === 'sub' ? 3 : '50%',
                      width: 'calc(50% - 3px)',
                      borderRadius: 20,
                      background: 'var(--accent)',
                      boxShadow: '0 2px 12px color-mix(in srgb, var(--accent) 40%, transparent)',
                      transition: 'left 0.35s cubic-bezier(0.25, 1, 0.3, 1)',
                      pointerEvents: 'none',
                    }} />
                    <button
                      disabled={subServers.length === 0}
                      onClick={() => {
                        localStorage.setItem('anilab_preferred_track', 'sub');
                        setAudioTrack('sub');
                        if (subServers.length > 0) selectServer(subServers[0], servers);
                      }}
                      style={{
                        flex: 1, padding: '5px 0', border: 'none',
                        background: 'transparent',
                        position: 'relative', zIndex: 1,
                        color: subServers.length === 0 ? 'rgba(255,255,255,0.15)' : (audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)'),
                        fontSize: 10, fontWeight: 700, borderRadius: 20,
                        transition: 'color 0.25s ease',
                      }}
                    >
                      Subtitled (SUB)
                    </button>
                    <button
                      disabled={dubServers.length === 0}
                      onClick={() => {
                        localStorage.setItem('anilab_preferred_track', 'dub');
                        setAudioTrack('dub');
                        if (dubServers.length > 0) selectServer(dubServers[0], servers);
                      }}
                      style={{
                        flex: 1, padding: '5px 0', border: 'none',
                        background: 'transparent',
                        position: 'relative', zIndex: 1,
                        color: dubServers.length === 0 ? 'rgba(255,255,255,0.15)' : (audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)'),
                        fontSize: 10, fontWeight: 700, borderRadius: 20,
                        transition: 'color 0.25s ease',
                      }}
                    >
                      Dubbed (DUB)
                    </button>
                  </div>

                  {/* Active Track Server List */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 60, overflowY: 'auto' }}>
                    {(audioTrack === 'sub' ? subServers : dubServers).map((s, idx) => {
                      const active = activeServer?.name === s.name;
                      return (
                        <button
                          key={idx}
                          onClick={() => selectServer(s, servers)}
                          style={{
                            padding: '4px 10px', borderRadius: 20,
                            background: active ? 'var(--accent)' : 'var(--bg-card)',
                            border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                            color: active ? '#fff' : 'var(--text-secondary)',
                            fontSize: 10, fontWeight: 600,
                          }}
                        >
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Episodes Scrollable List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', minHeight: 0 }}>
                <h3 style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                  Episodes ({totalEps})
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {allEps.map(n => {
                    const isWatched = prog?.episode > n;
                    const isCurrent = epParam === n;
                    return (
                      <div
                        key={n}
                        onClick={() => {
                          setSearchParams({ play: 'true', ep: String(n) }, { replace: true });
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px', borderRadius: 8, cursor: 'pointer',
                          background: isCurrent ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.02)',
                          border: isCurrent ? '1px solid var(--accent)' : '1px solid transparent',
                        }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 800, color: isCurrent ? 'var(--accent)' : 'var(--text-muted)', width: 24, textAlign: 'center' }}>
                          {n}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Episode {n}</div>
                          {isWatched && <span style={{ fontSize: 10, color: '#4caf50' }}>✓ Watched</span>}
                        </div>
                        <Play size={12} fill={isCurrent ? 'var(--accent)' : 'rgba(255,255,255,0.4)'} color="transparent" />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

      {/* ── DOWNLOAD MODAL BOTTOM SHEET ── */}
      {downloadModalOpen && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        }} onClick={() => setDownloadModalOpen(false)}>
          <div style={{
            background: 'var(--bg-secondary)',
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            maxHeight: '82vh', display: 'flex', flexDirection: 'column',
            boxSizing: 'border-box',
            border: '1px solid rgba(255,255,255,0.10)',
            borderBottom: 'none',
            paddingBottom: 'max(24px, var(--android-safe-bottom, env(safe-area-inset-bottom)))',
            boxShadow: '0 -12px 60px rgba(0,0,0,0.8), 0 -1px 0 rgba(255,255,255,0.08) inset',
            animation: 'dlSheetUp 0.38s cubic-bezier(0.16, 1, 0.3, 1)',
          }} onClick={e => e.stopPropagation()}>
            <style>{`
              @keyframes dlSheetUp {
                from { transform: translateY(100%); opacity: 0.8; }
                to   { transform: translateY(0);    opacity: 1; }
              }
            `}</style>

            {/* ── Drag handle ── */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
              <div style={{
                width: 36, height: 4, borderRadius: 2,
                background: 'rgba(255,255,255,0.18)',
              }} />
            </div>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 20px 14px' }}>
              <div style={{
                width: 44, height: 44, borderRadius: 14, flexShrink: 0,
                background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px -4px var(--accent-glow)',
              }}>
                <Download size={20} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: 18, fontWeight: 900, margin: 0, letterSpacing: '-0.04em' }}>Download</h2>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>Save episodes for offline viewing</p>
              </div>
              <button
                onClick={() => setDownloadModalOpen(false)}
                style={{
                  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: '50%', width: 34, height: 34,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', color: 'var(--text-secondary)', flexShrink: 0,
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* ── Sub/Dub segmented control — Sliding Pill ── */}
            <div style={{
              display: 'flex', margin: '0 20px 14px',
              position: 'relative',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 14, padding: 4,
              border: '1px solid rgba(255,255,255,0.06)',
            }}>
              {/* Sliding pill background */}
              <div style={{
                position: 'absolute',
                top: 4, bottom: 4,
                left: downloadAudioTrack === 'sub' ? 4 : '50%',
                width: 'calc(50% - 4px)',
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                boxShadow: '0 2px 12px -2px var(--accent-glow)',
                transition: 'left 0.35s cubic-bezier(0.25, 1, 0.3, 1)',
                pointerEvents: 'none',
              }} />
              {['sub', 'dub'].map(track => (
                <button
                  key={track}
                  onClick={() => setDownloadAudioTrack(track)}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 10,
                    border: 'none',
                    background: 'transparent',
                    position: 'relative', zIndex: 1,
                    color: '#fff', fontSize: 13, fontWeight: 800,
                    cursor: 'pointer', letterSpacing: '-0.01em',
                    transition: 'color 0.25s ease',
                  }}
                >
                  {track === 'sub' ? '🎌 Subtitled' : '🎙 Dubbed'}
                </button>
              ))}
            </div>

            {/* ── Episode List ── */}
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '0 16px',
              paddingBottom: 'max(20px, var(--android-safe-bottom, env(safe-area-inset-bottom)))',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allEps.map(n => {
                  const taskId = `${anime.id}_${n}_${downloadAudioTrack}`;
                  const isDownloaded = sessionDownloadedEps.has(`${n}_${downloadAudioTrack}`);
                  const progress = downloadProgress[taskId];
                  const isDownloading = progress !== undefined && progress !== 100 && progress !== 'error';
                  const isFailed = progress === 'error';

                  return (
                    <div key={n} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '13px 16px',
                      background: isDownloaded
                        ? 'rgba(76,175,80,0.06)'
                        : isDownloading
                          ? 'rgba(108,99,255,0.06)'
                          : 'var(--bg-card)',
                      borderRadius: 16,
                      border: isDownloaded
                        ? '1px solid rgba(76,175,80,0.20)'
                        : isDownloading
                          ? '1px solid rgba(108,99,255,0.25)'
                          : '1px solid var(--border)',
                      transition: 'all 0.2s',
                    }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '-0.02em' }}>Episode {n}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 3, fontWeight: 500 }}>
                          {isDownloaded ? (
                            <span style={{ color: '#4caf50', fontWeight: 700 }}>✓ Saved offline</span>
                          ) : isDownloading ? (
                            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Downloading {progress}%</span>
                          ) : isFailed ? (
                            <span style={{ color: '#ff5252', fontWeight: 700 }}>✗ Failed — tap to retry</span>
                          ) : (
                            <span>Available for download</span>
                          )}
                        </div>
                        {isDownloading && typeof progress === 'number' && (
                          <div style={{
                            marginTop: 7, height: 3, borderRadius: 2,
                            background: 'rgba(255,255,255,0.08)', overflow: 'hidden', width: 160,
                          }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              background: 'linear-gradient(90deg, var(--accent), var(--accent2))',
                              width: `${progress}%`,
                              transition: 'width 0.4s ease',
                            }} />
                          </div>
                        )}
                      </div>

                      {isDownloaded ? (
                        <div style={{
                          width: 34, height: 34, borderRadius: 10,
                          background: 'rgba(76,175,80,0.15)',
                          border: '1px solid rgba(76,175,80,0.3)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <Check size={16} color="#4caf50" />
                        </div>
                      ) : isDownloading ? (
                        <div style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Loader size={18} className="spin" color="var(--accent)" />
                        </div>
                      ) : (
                        <button
                          onClick={() => handleDownloadClick(n)}
                          style={{
                            background: 'linear-gradient(135deg, var(--accent), var(--accent2))',
                            border: 'none', borderRadius: 10,
                            width: 34, height: 34, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', cursor: 'pointer',
                            boxShadow: '0 4px 14px -4px var(--accent-glow)',
                          }}
                        >
                          <Download size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── SERVER SELECTOR ── */}
      {serverPickerData && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        }} onClick={() => setServerPickerData(null)}>
          <div style={{
            background: 'var(--bg-secondary)',
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            width: '100%', maxWidth: 480,
            paddingBottom: 'max(24px, var(--android-safe-bottom, env(safe-area-inset-bottom)))',
            border: '1px solid rgba(255,255,255,0.10)', borderBottom: 'none',
            boxShadow: '0 -12px 60px rgba(0,0,0,0.8)',
            animation: 'dlSheetUp 0.38s cubic-bezier(0.16, 1, 0.3, 1)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 8px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
            </div>
            <div style={{ padding: '4px 20px 16px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 17, fontWeight: 900, margin: 0, letterSpacing: '-0.04em' }}>Select Server</h3>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0', fontWeight: 500 }}>
                Episode {serverPickerData.episode} · {downloadAudioTrack.toUpperCase()}
              </p>
            </div>
            <div style={{ padding: '12px 16px', maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {serverPickerData.loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '28px 0' }}>
                  <Loader size={26} className="spin" color="var(--accent)" />
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>Searching download links…</p>
                </div>
              ) : serverPickerData.servers.filter(s => s.type === downloadAudioTrack).filter(isDownloadable).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--text-muted)', fontSize: 13 }}>
                  No {downloadAudioTrack.toUpperCase()} servers found
                </div>
              ) : (
                serverPickerData.servers
                  .filter(s => s.type === downloadAudioTrack)
                  .filter(isDownloadable)
                  .map((srv, idx) => (
                    <button
                      key={idx}
                      onClick={() => startDownload(serverPickerData.episode, srv, false, '', serverPickerData.servers.filter(s => s.type === downloadAudioTrack).filter(isDownloadable))}
                      style={{
                        width: '100%', padding: '14px 16px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 14, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: 'var(--accent-dim)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Download size={16} color="var(--accent)" />
                        </div>
                        <div style={{ textAlign: 'left' }}>
                          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>{srv.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>Tap to download</div>
                        </div>
                      </div>
                      <div style={{
                        fontSize: 10, fontWeight: 800, color: 'var(--accent)',
                        background: 'var(--accent-dim)', padding: '3px 8px', borderRadius: 6,
                        textTransform: 'uppercase', letterSpacing: '0.06em',
                      }}>
                        {srv.type}
                      </div>
                    </button>
                  ))
              )}
            </div>
            <div style={{ padding: '8px 16px 0' }}>
              <button
                onClick={() => setServerPickerData(null)}
                style={{
                  width: '100%', padding: '13px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
                  color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── QUALITY SELECTOR ── */}
      {qualityPickerData && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        }} onClick={() => qualityPickerData.onCancel()}>
          <div style={{
            background: 'var(--bg-secondary)',
            borderTopLeftRadius: 28, borderTopRightRadius: 28,
            width: '100%', maxWidth: 480,
            paddingBottom: 'max(20px, var(--android-safe-bottom, env(safe-area-inset-bottom)))',
            border: '1px solid rgba(255,255,255,0.10)', borderBottom: 'none',
            boxShadow: '0 -12px 60px rgba(0,0,0,0.8)',
            animation: 'dlSheetUp 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 8px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.18)' }} />
            </div>
            <div style={{ padding: '4px 20px 16px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 17, fontWeight: 900, margin: 0, letterSpacing: '-0.04em' }}>Video Quality</h3>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '4px 0 0', fontWeight: 500 }}>
                Episode {qualityPickerData.episode}
              </p>
            </div>
            <div style={{ padding: '12px 16px', maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {qualityPickerData.variants.map((v, idx) => (
                <button
                  key={idx}
                  onClick={() => qualityPickerData.onSelect(v)}
                  style={{
                    width: '100%', padding: '14px 16px',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 14, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                    {v.label}
                  </span>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: 'var(--accent-dim)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Download size={13} color="var(--accent)" />
                  </div>
                </button>
              ))}
            </div>
            <div style={{ padding: '8px 16px 0' }}>
              <button
                onClick={() => qualityPickerData.onCancel()}
                style={{
                  width: '100%', padding: '13px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14,
                  color: 'var(--text-secondary)', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}  
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page">
      <div className="skeleton" style={{ height: 280, borderRadius: 0 }} />
      <div style={{ padding: '12px 16px' }}>
        <div className="skeleton" style={{ height: 28, width: '75%', borderRadius: 6, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 13, width: '50%', borderRadius: 4, marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div className="skeleton" style={{ flex: 1, height: 46, borderRadius: 10 }} />
          <div className="skeleton" style={{ flex: 1, height: 46, borderRadius: 10 }} />
        </div>
        <div className="skeleton" style={{ height: 72, borderRadius: 8, marginBottom: 20 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton" style={{ aspectRatio: '16/9', borderRadius: 10, marginBottom: 4 }} />
              <div className="skeleton" style={{ height: 10, borderRadius: 4, width: '60%' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
