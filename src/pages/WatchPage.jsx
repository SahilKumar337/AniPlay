import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate }            from 'react-router-dom';
import {
  ArrowLeft, ChevronLeft, ChevronRight, List,
  AlertCircle, RefreshCw, Wifi, WifiOff, Loader, Tv
} from 'lucide-react';
import { getAnimeDetail, getTitle, getCover } from '../api/anilist';
import { getAniNekoServers, getCachedServers, checkProxy } from '../api/stream';
import Navbar      from '../components/Navbar';
import AniPlayer   from '../components/AniPlayer';
import IframePlayer from '../components/IframePlayer';
import { scrapeEmbedNative } from '../api/embedScraper';
import { useApp }  from '../context/AppContext';

// Way 4: Pure client-side scraping — native hidden WebView (like Cloudstream/Aniyomi).
const IS_NATIVE = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

export default function WatchPage() {
  const { id, ep } = useParams();
  const navigate   = useNavigate();
  const { setEpisodeProgress, addToRecentlyViewed } = useApp();

  const [anime,       setAnime]       = useState(null);
  const [loadAnime,   setLoadAnime]   = useState(true);
  const [animeErr,    setAnimeErr]    = useState(null);

  const [servers,     setServers]     = useState([]);
  const [activeUrl,   setActiveUrl]   = useState('');
  const [activeName,  setActiveName]  = useState('');
  const [activeType,  setActiveType]  = useState('sub'); // 'sub' or 'dub'
  const [audioTrack,  setAudioTrack]  = useState(() => localStorage.getItem('anilab_preferred_track') || 'sub'); // 'sub' or 'dub'
  const [loadStream,  setLoadStream]  = useState(false);
  const [streamErr,   setStreamErr]   = useState(null);
  
  const [showEps,     setShowEps]     = useState(true);
  const [proxyUp,     setProxyUp]     = useState(null);
  const [isActiveHLS, setIsActiveHLS] = useState(false);
  const [extracting,  setExtracting]  = useState(false); // Puppeteer extraction in progress

  const [activeServer, setActiveServer] = useState(null);

  const episode = Math.max(1, parseInt(ep) || 1);



  // Check proxy status
  useEffect(() => { checkProxy().then(setProxyUp); }, []);

  // Fetch Anime details
  useEffect(() => {
    setLoadAnime(true); setAnimeErr(null);
    getAnimeDetail(Number(id))
      .then(d  => { setAnime(d); setLoadAnime(false); })
      .catch(e => { setAnimeErr(e.message); setLoadAnime(false); });
  }, [id]);

  // Auto-redirect if trying to watch an unreleased episode
  useEffect(() => {
    if (anime) {
      const max = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1)
        ? anime.nextAiringEpisode.episode - 1 
        : (anime.episodes || 999);
      if (episode > max) {
        console.log(`[WatchPage] Episode ${episode} is unreleased (max is ${max}). Redirecting to latest episode ${max}...`);
        navigate(`/watch/${id}/${max}`, { replace: true });
      }
    }
  }, [anime, episode, id, navigate]);

  // Robust server selection with automatic fallback to next server on error
  const selectServer = useCallback(async (srv, srvList) => {
    setActiveServer(srv);
    setStreamErr(null);
    setExtracting(false);

    const listToUse = srvList || [];
    const sameTypeServers = srv.type === 'dub' 
      ? listToUse.filter(s => s.type === 'dub') 
      : listToUse.filter(s => s.type === 'sub');
    
    const currentIndex = sameTypeServers.findIndex(s => s.videoUrl === srv.videoUrl);

    const tryNext = () => {
      if (currentIndex !== -1 && currentIndex < sameTypeServers.length - 1) {
        const nextSrv = sameTypeServers[currentIndex + 1];
        console.log(`[WatchPage] Server ${srv.name} failed. Falling back to: ${nextSrv.name}`);
        selectServer(nextSrv, listToUse);
      } else {
        setStreamErr('All available servers failed to load. Please try another episode.');
      }
    };

    // ── Embed servers (Waves / Neko) ─────────────────────────────────
    const isEmbedServer = !srv.isHLS && srv.embedUrl;
    if (isEmbedServer) {
      const embedUrl = srv.embedUrl;
      const referer  = srv.referer || 'https://aniwaves.ru/';

      if (IS_NATIVE) {
        // ── TRUE Way 4 (Android): Hidden native WebView with correct Referer ──
        // Same technique as Cloudstream/Aniyomi — sets Referer header so
        // Vidplay/echovideo decrypt the video source correctly.
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);
        setActiveUrl(''); // clear previous player
        setExtracting(true); // show loading spinner

        scrapeEmbedNative(embedUrl, referer, 40000)
          .then(m3u8Url => {
            console.log('[WatchPage] Native scraper captured:', m3u8Url.slice(0, 80));
            setExtracting(false);
            setActiveUrl(m3u8Url);
            setIsActiveHLS(true);
          })
          .catch(err => {
            console.warn('[WatchPage] Native scraper failed:', err.message);
            setExtracting(false);
            tryNext();
          });
        return;
      } else {
        // ── Desktop dev: Use IframePlayer with blob-URL injection ──
        setActiveName(srv.name);
        setActiveType(srv.type || 'sub');
        setIsActiveHLS(false);
        setActiveUrl(embedUrl);
        setExtracting(false);
        return;
      }
    }

    // ── Direct HLS servers (AniHD1, AniNeko with isHLS=true) ───────────
    setActiveUrl(srv.videoUrl);
    setActiveName(srv.name);
    setActiveType(srv.type || 'sub');
    setIsActiveHLS(!!srv.isHLS);
    setExtracting(false);
  }, []);


  const fetchStream = useCallback(async () => {
    if (!anime) return;

    // Check synchronous cache first to achieve instant rendering
    const cachedResult = getCachedServers(anime, episode);
    if (cachedResult?.servers?.length) {
      console.log('[WatchPage] [Instant Cache Hit] Bypassing loading state transition');
      setStreamErr(null);
      setServers(cachedResult.servers);
      
      const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
      let matchingServers = cachedResult.servers.filter(s => s.type === preferredTrack);
      if (matchingServers.length === 0) {
        matchingServers = cachedResult.servers.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
      }
      const preferred = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
                     || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name))
                     || matchingServers[0]
                     || cachedResult.servers[0];
      
      setActiveType(preferred.type || 'sub');
      setAudioTrack(preferred.type || 'sub');
      
      // Select server directly
      selectServer(preferred, cachedResult.servers);

      // Trigger background prefetch for the next episode
      const nextEp = episode + 1;
      const maxEps = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : (anime.episodes || 999);
      if (nextEp <= maxEps) {
        getAniNekoServers(anime, nextEp).catch(() => {});
      }
      
      setLoadStream(false);
      return;
    }

    setLoadStream(true);
    setStreamErr(null);
    setServers([]);
    setActiveUrl('');
    setActiveName('');
    setActiveServer(null);

    const handleFound = (currentServers) => {
      setServers(currentServers);
      
      setActiveServer(prev => {
        // Only auto-select if nothing is playing yet
        if (prev) return prev;
        
        const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
        let matchingServers = currentServers.filter(s => s.type === preferredTrack);
        if (matchingServers.length === 0) {
          matchingServers = currentServers.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
        }
        const preferred = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
                       || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name))
                       || matchingServers[0]
                       || currentServers[0];
        
        if (preferred) {
          setActiveType(preferred.type || 'sub');
          setAudioTrack(preferred.type || 'sub');
          selectServer(preferred, currentServers);
          // ⚡ First server found — stop the loading spinner immediately!
          // AniHD and other scrapers keep running in background and will appear in the server list.
          setLoadStream(false);
          setStreamErr(null);
        }
        return preferred;
      });
    };

    try {
      const result = await getAniNekoServers(anime, episode, handleFound);
      if (!result?.servers?.length) {
        setStreamErr('No streaming servers available for this episode.');
      } else {
        const nextEp = episode + 1;
        const maxEps = (anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) ? anime.nextAiringEpisode.episode - 1 : (anime.episodes || 999);
        if (nextEp <= maxEps) {
          getAniNekoServers(anime, nextEp).catch(() => {});
        }
      }
    } catch (e) {
      setServers(prev => {
        if (prev.length === 0) {
          setStreamErr(e.message || 'Failed to fetch streaming links.');
        }
        return prev;
      });
    } finally {
      setLoadStream(false);
    }
  }, [anime, episode, selectServer]);

  useEffect(() => { fetchStream(); }, [fetchStream]);
  
  useEffect(() => {
    if (anime) {
      setEpisodeProgress(anime.id, episode);
      addToRecentlyViewed(anime, episode);
    }
  }, [anime, episode, setEpisodeProgress, addToRecentlyViewed]);

  const goEp = n => {
    const max = (anime?.nextAiringEpisode && anime.nextAiringEpisode.episode > 1) 
      ? anime.nextAiringEpisode.episode - 1 
      : (anime?.episodes || 999);
    if (n < 1 || n > max) return;
    // Use push (not replace) so back button returns to previous episode
    navigate(`/watch/${id}/${n}`);
    window.scrollTo(0, 0);
  };

  const subServers = servers.filter(s => s.type === 'sub');
  const dubServers = servers.filter(s => s.type === 'dub');
  const hasDub     = dubServers.length > 0;


  if (!loadAnime && (animeErr || !anime)) return (
    <div className="page" style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24 }}>
      <AlertCircle size={52} color="#e50914" style={{ marginBottom:12 }}/>
      <p style={{ fontWeight:700, fontSize:17, marginBottom:8 }}>Couldn't load anime</p>
      <p style={{ color:'var(--text-secondary)', fontSize:13, marginBottom:20, textAlign:'center' }}>{animeErr}</p>
      <button className="btn btn-primary" onClick={() => navigate(-1)}>Go Back</button>
      <Navbar/>
    </div>
  );

  const title    = anime ? getTitle(anime) : '…';
  const cover    = anime ? getCover(anime)  : '';
  const totalEps = anime
    ? ((anime.nextAiringEpisode && anime.nextAiringEpisode.episode > 1)
        ? anime.nextAiringEpisode.episode - 1
        : (anime.episodes || 0))
    : 0;

  // ── Guard: anime not yet released ───────────────────────────────
  if (!loadAnime && anime && (anime.status === 'NOT_YET_RELEASED' || totalEps === 0)) {
    return (
      <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎬</div>
        <p style={{ fontSize: 20, fontWeight: 800, marginBottom: 8, textAlign: 'center' }}>Coming Soon</p>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 280, marginBottom: 24, lineHeight: 1.6 }}>
          {getTitle(anime)} hasn't aired yet. Check back when it releases!
        </p>
        {anime.nextAiringEpisode && (
          <p style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginBottom: 24 }}>
            Episode {anime.nextAiringEpisode.episode} airs {new Date(anime.nextAiringEpisode.airingAt * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        )}
        <button className="btn btn-primary" onClick={() => navigate(`/anime/${id}`)}>
          <ArrowLeft size={15} /> View Details
        </button>
        <Navbar />
      </div>
    );
  }

  return (
    <div style={{ background:'var(--bg-primary)', minHeight:'100vh', paddingBottom:80 }}>

      {/* ── Status bar ────────────────────────────────────────── */}
      {proxyUp === false && (
        <div style={{ background:'rgba(229,9,20,0.1)', borderBottom:'1px solid rgba(229,9,20,0.3)', padding:'9px 16px', display:'flex', gap:8, alignItems:'center' }}>
          <WifiOff size={13} color="#e50914"/>
          <span style={{ fontSize:11, color:'#e50914', fontWeight:600 }}>
            Proxy offline — run <code style={{ background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:4 }}>npm run dev</code> in <code style={{ background:'rgba(255,255,255,0.08)', padding:'1px 5px', borderRadius:4 }}>E:\Anilab</code>
          </span>
        </div>
      )}


      {/* ── Player area ────────────────────────────────────────── */}
      <div style={{ position:'relative', background:'#000' }}>

        {/* Loading state */}
        {(loadAnime || loadStream) && (
          <div style={{ aspectRatio:'16/9', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
            {/* Back button on loading screen */}
            <button onClick={() => navigate(`/anime/${id}`, { replace: true })} id="watch-back"
              style={{ position:'absolute', top:12, left:12, width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff', zIndex: 10 }}
            ><ArrowLeft size={17} color="#fff"/></button>
            <Loader size={38} color="rgba(255,255,255,0.7)" style={{ animation:'spin 1s linear infinite' }}/>
          </div>
        )}

        {/* Error state */}
        {!loadAnime && !loadStream && streamErr && (
          <div style={{ aspectRatio:'16/9', background:'#070707', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, padding:28, position:'relative' }}>
            <button onClick={() => navigate(`/anime/${id}`, { replace: true })}
              style={{ position:'absolute', top:12, left:12, width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff' }}
            ><ArrowLeft size={17} color="#fff"/></button>
            <AlertCircle size={44} color="#e50914" style={{ opacity:0.7 }}/>
            <p style={{ color:'#fff', fontSize:15, fontWeight:700 }}>Stream not found</p>
            <p style={{ color:'var(--text-secondary)', fontSize:12, textAlign:'center', maxWidth:280, lineHeight:1.7 }}>{streamErr}</p>
            <button id="btn-retry" className="btn btn-primary btn-sm" onClick={fetchStream}>
              <RefreshCw size={12}/> Retry Search
            </button>
          </div>
        )}

        {/* Extracting state (Puppeteer running) */}
        {!loadAnime && !loadStream && extracting && !streamErr && (
          <div style={{ aspectRatio:'16/9', background:'#000', display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
            <button onClick={() => navigate(`/anime/${id}`, { replace: true })}
              style={{ position:'absolute', top:12, left:12, width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff', zIndex: 10 }}
            ><ArrowLeft size={17} color="#fff"/></button>
            <Loader size={38} color="rgba(255,255,255,0.7)" style={{ animation:'spin 1s linear infinite' }}/>
          </div>
        )}

        {/* ── Native HLS Player (AniPlayer) ───────────────── */}
        {!loadAnime && !loadStream && !extracting && activeUrl && isActiveHLS && !streamErr && (
          <AniPlayer
            url={activeUrl}
            title={activeName ? `${anime.title.english || anime.title.romaji} - ${activeName}` : (anime.title.english || anime.title.romaji)}
            subtitles={activeServer?.subtitles || []}
            referer={activeServer?.referer}
            embedUrl={activeServer?.embedUrl}
            onBack={() => navigate(`/anime/${id}`, { replace: true })}
          />
        )}

        {/* ── Sandboxed Ad-Free Iframe Player ───────────────── */}
        {!loadAnime && !loadStream && activeUrl && !isActiveHLS && !streamErr && (
          <IframePlayer
            key={activeUrl}
            src={activeUrl}
            onBack={() => navigate(`/anime/${id}`, { replace: true })}
            onStreamCaptured={(m3u8Url, referer, meta) => {
              // Embed page reported an error (file deleted, copyright, etc.)
              if (meta?.error) {
                console.warn('[WatchPage] Embed error detected, trying next server:', meta.reason);
                // Find the next server that is NOT the current one
                const current = servers.find(s => s.videoUrl === activeUrl || s.name === activeName);
                const fallbacks = servers.filter(s =>
                  s.videoUrl !== activeUrl &&
                  s.name !== activeName &&
                  s.type === (current?.type || activeType)
                );
                const next = fallbacks[0] || servers.find(s => s.videoUrl !== activeUrl && s.name !== activeName);
                if (next) {
                  console.log('[WatchPage] Auto-switching to:', next.name);
                  selectServer(next, servers);
                  setActiveServer(next);
                } else {
                  setStreamErr('All servers for this episode have been removed. Try a different source.');
                }
                return;
              }

              // Way 4: WebView captured the real m3u8 — play it directly, no server proxy.
              console.log('[WatchPage] WebView captured stream, playing directly:', m3u8Url.slice(0, 80));
              setActiveUrl(m3u8Url);
              setIsActiveHLS(true);
            }}
          />
        )}

      </div>


      {/* ── Controls ──────────────────────────────────────────── */}
      <div style={{ padding:'14px 16px 0' }}>

        {/* Title */}
        <p style={{ fontSize:17, fontWeight:700, marginBottom:4, lineHeight:1.3 }}>{title}</p>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Episode {episode} of {totalEps}</span>
        </div>

        {/* Server selection: grouped SUB / DUB tabs */}
        {servers.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>
              Select Server
            </p>

            {/* Segmented Control for Sub / Dub */}
            <div style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 24,
              padding: 3,
              marginBottom: 14,
              border: '1px solid var(--border)'
            }}>
              <button
                disabled={subServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'sub');
                  setAudioTrack('sub');
                  if (subServers.length > 0) selectServer(subServers[0]);
                }}
                style={{
                  flex: 1, padding: '7px 0', border: 'none',
                  background: audioTrack === 'sub' ? 'var(--accent)' : 'transparent',
                  color: subServers.length === 0 
                    ? 'rgba(255,255,255,0.15)' 
                    : (audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)'),
                  opacity: subServers.length === 0 ? 0.35 : 1,
                  fontSize: 12, fontWeight: 700, borderRadius: 20,
                  cursor: subServers.length === 0 ? 'not-allowed' : 'pointer', 
                  transition: 'all 0.2s'
                }}
              >
                Subtitled (SUB)
              </button>
              <button
                disabled={dubServers.length === 0}
                onClick={() => {
                  localStorage.setItem('anilab_preferred_track', 'dub');
                  setAudioTrack('dub');
                  if (dubServers.length > 0) selectServer(dubServers[0]);
                }}
                style={{
                  flex: 1, padding: '7px 0', border: 'none',
                  background: audioTrack === 'dub' ? 'var(--accent)' : 'transparent',
                  color: dubServers.length === 0 
                    ? 'rgba(255,255,255,0.15)' 
                    : (audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)'),
                  opacity: dubServers.length === 0 ? 0.35 : 1,
                  fontSize: 12, fontWeight: 700, borderRadius: 20,
                  cursor: dubServers.length === 0 ? 'not-allowed' : 'pointer', 
                  transition: 'all 0.2s'
                }}
              >
                Dubbed (DUB)
              </button>
            </div>

            {/* Active Track Server List */}
            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
              {(audioTrack === 'sub' ? subServers : dubServers).map((s, idx) => {
                const active = activeServer?.videoUrl === s.videoUrl;
                return (
                  <button
                    key={idx}
                    onClick={() => selectServer(s, servers)}
                    style={{
                      padding: '8px 16px', borderRadius: 20,
                      background: active ? 'var(--accent)' : 'var(--bg-card)',
                      border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      color: active ? '#fff' : 'var(--text-secondary)',
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                      transition: 'all 0.25s'
                    }}
                  >
                    {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', flexShrink: 0 }} />}
                    {s.name}
                  </button>
                );
              })}
            </div>



          </div>
        )}

        {/* Prev / Current / Next */}
        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
          <button id="ep-prev" onClick={() => goEp(episode - 1)} disabled={episode <= 1}
            style={{ flex:1, padding:12, borderRadius:12, background:'var(--bg-card)', border:'1px solid var(--border)', color: episode <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', fontSize:13, fontWeight:700, cursor: episode <= 1 ? 'not-allowed' : 'pointer', opacity: episode <= 1 ? 0.35 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}
          ><ChevronLeft size={16}/> Prev</button>

          <div style={{ flex:1, padding:12, borderRadius:12, background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', color:'#fff', fontSize:13, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' }}>
            Episode {episode}
          </div>

          <button id="ep-next" onClick={() => goEp(episode + 1)} disabled={episode >= totalEps}
            style={{ flex:1, padding:12, borderRadius:12, background:'var(--bg-card)', border:'1px solid var(--border)', color: episode >= totalEps ? 'var(--text-muted)' : 'var(--text-primary)', fontSize:13, fontWeight:700, cursor: episode >= totalEps ? 'not-allowed' : 'pointer', opacity: episode >= totalEps ? 0.35 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}
          >Next <ChevronRight size={16}/></button>
        </div>

        {/* Episode list toggle */}
        <button id="ep-toggle" onClick={() => setShowEps(v => !v)}
          style={{ width:'100%', padding:12, borderRadius:12, border:'1px solid var(--border)', background:'var(--bg-card)', color:'var(--text-primary)', fontSize:13, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:12 }}
        >
          <List size={15}/> {showEps ? 'Hide' : 'Show'} All Episodes ({totalEps})
        </button>

        {showEps && (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:6, marginBottom:18 }}>
            {Array.from({ length: totalEps }, (_, i) => i + 1).map(n => (
              <button key={n} id={`ep-${n}`} onClick={() => goEp(n)}
                style={{ padding:'11px 4px', borderRadius:10, fontSize:13, fontWeight:700, background: n === episode ? 'var(--accent)' : 'var(--bg-card)', border: `1px solid ${n === episode ? 'var(--accent)' : 'var(--border)'}`, color: n === episode ? '#fff' : 'var(--text-secondary)', cursor:'pointer', transition:'all 0.15s' }}
              >{n}</button>
            ))}
          </div>
        )}

        {/* Anime card */}
        {anime && (
          <div onClick={() => navigate(`/anime/${id}`)} role="button" tabIndex={0} id="anime-card-link"
            style={{ display:'flex', gap:12, background:'var(--bg-card)', borderRadius:14, padding:14, cursor:'pointer', border:'1px solid var(--border)', marginBottom:16 }}
          >
            <img src={cover} alt={title}
              style={{ width:54, height:76, borderRadius:8, objectFit:'cover', flexShrink:0 }}
              onError={e => { e.target.style.display = 'none'; }}
            />
            <div>
              <p style={{ fontSize:14, fontWeight:700, marginBottom:4, lineHeight:1.3 }}>{title}</p>
              <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:6 }}>
                {anime.genres?.slice(0, 3).join(', ')}
              </p>
              <span style={{ fontSize:12, color:'var(--accent)', fontWeight:600 }}>View Details →</span>
            </div>
          </div>
        )}
      </div>

      <Navbar/>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
