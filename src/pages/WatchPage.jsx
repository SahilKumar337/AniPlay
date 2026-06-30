import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate }            from 'react-router-dom';
import {
  ArrowLeft, ChevronLeft, ChevronRight, List,
  AlertCircle, RefreshCw, Wifi, WifiOff, Loader, Tv
} from 'lucide-react';
import { getAnimeDetail, getTitle, getCover } from '../api/anilist';
import { getAniNekoServers, checkProxy, formatServerUrl, PROXY } from '../api/stream';
import Navbar      from '../components/Navbar';
import AniPlayer   from '../components/AniPlayer';
import IframePlayer from '../components/IframePlayer';
import { useApp }  from '../context/AppContext';



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
        console.log(`[WatchPage] Server ${srv.name} failed. Falling back to next server: ${nextSrv.name}...`);
        selectServer(nextSrv, listToUse);
      } else {
        setStreamErr('All available servers failed to load. Please try another episode.');
      }
    };

    // For AniWaves iframe-proxy servers: try Puppeteer extraction first,
    // but fall back to iframe quickly (Render free tier may not have Chrome)
    if (srv.videoUrl && srv.videoUrl.includes('iframe-proxy')) {
      let embedUrl = srv.videoUrl;
      try {
        const proxyUrlObj = new URL(srv.videoUrl, window.location.origin);
        embedUrl = proxyUrlObj.searchParams.get('url') || srv.videoUrl;
      } catch {}

      setActiveName(srv.name);
      setActiveType(srv.type || 'sub');
      setIsActiveHLS(false);
      // Show the iframe immediately — JS injection will fire postMessage when m3u8 is found
      setActiveUrl(srv.videoUrl);
      setExtracting(false);

      // Also fire a background extraction attempt — if it succeeds, switch to native player
      // Use a short timeout so it doesn't hang forever
      const extractController = new AbortController();
      const extractTimeout = setTimeout(() => extractController.abort(), 20000);
      fetch(formatServerUrl(`/api/extract-stream?url=${encodeURIComponent(embedUrl)}`), {
        signal: extractController.signal
      })
        .then(r => r.json())
        .then(data => {
          if (data.ok && data.url) {
            console.log('[WatchPage] Background extraction succeeded, switching to native player');
            setActiveUrl(formatServerUrl(data.url));
            setIsActiveHLS(true);
            setActiveName(srv.name);
          }
        })
        .catch(e => console.log('[WatchPage] Background extraction skipped:', e.message))
        .finally(() => clearTimeout(extractTimeout));
      return;
    }

    // Regular servers (AniNeko direct HLS or other iframes)
    setActiveUrl(srv.videoUrl);
    setActiveName(srv.name);
    setActiveType(srv.type || 'sub');
    setIsActiveHLS(!!srv.isHLS);
    setExtracting(false);
  }, []);

  // Fetch streaming servers
  const fetchStream = useCallback(async () => {
    if (!anime) return;

    if (anime.status === 'NOT_YET_RELEASED') {
      setStreamErr('This anime has not been released yet.');
      return;
    }

    setLoadStream(true);
    setStreamErr(null);
    setServers([]);
    setActiveUrl('');
    setActiveName('');
    setActiveServer(null);

    try {
      const result = await getAniNekoServers(anime, episode);
      if (result?.servers?.length) {
        setServers(result.servers);
        // Auto-select based on preferred track from localStorage
        const preferredTrack = localStorage.getItem('anilab_preferred_track') || 'sub';
        let matchingServers = result.servers.filter(s => s.type === preferredTrack);
        
        // Fallback to the other track if the preferred track is not available for this episode
        if (matchingServers.length === 0) {
          matchingServers = result.servers.filter(s => s.type === (preferredTrack === 'sub' ? 'dub' : 'sub'));
        }

        const preferred  = matchingServers.find(s => /vidstream/i.test(s.name) || /vidplay/i.test(s.name) || /hd1/i.test(s.name))
                        || matchingServers.find(s => /mycloud/i.test(s.name) || /hd2/i.test(s.name))
                        || matchingServers[0]
                        || result.servers[0];

        setActiveType(preferred.type || 'sub');
        setAudioTrack(preferred.type || 'sub');

        // Let selectServer handle the resolution & extraction automatically
        selectServer(preferred, result.servers);

        // Background prefetch next episode for instant loading
        const nextEp = episode + 1;
        const maxEps = anime.episodes || 999;
        if (nextEp <= maxEps) {
          getAniNekoServers(anime, nextEp).catch(() => {});
        }
      } else {
        setStreamErr('No streaming servers available for this episode.');
      }
    } catch (e) {
      setStreamErr(e.message || 'Failed to fetch streaming links.');
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
    const max = anime?.episodes || 999;
    if (n < 1 || n > max) return;
    navigate(`/watch/${id}/${n}`, { replace: true });
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
  const totalEps = anime?.episodes || 12;

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
          <div style={{ aspectRatio:'16/9', background:'#070707', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:18, padding:24, position:'relative' }}>
            {/* Back button on loading screen */}
            <button onClick={() => navigate(`/anime/${id}`, { replace: true })} id="watch-back"
              style={{ position:'absolute', top:12, left:12, width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff' }}
            ><ArrowLeft size={17} color="#fff"/></button>
            <Loader size={44} color="#e50914" style={{ animation:'spin 0.9s linear infinite' }}/>
            <p style={{ color:'#fff', fontSize:14, fontWeight:600 }}>Loading...</p>
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
          <div style={{ aspectRatio:'16/9', background:'#070707', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:18, padding:24, position:'relative' }}>
            <button onClick={() => navigate(`/anime/${id}`, { replace: true })}
              style={{ position:'absolute', top:12, left:12, width:36, height:36, borderRadius:'50%', background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#fff' }}
            ><ArrowLeft size={17} color="#fff"/></button>
            <Loader size={44} color="#e50914" style={{ animation:'spin 0.9s linear infinite' }}/>
            <p style={{ color:'#fff', fontSize:14, fontWeight:600 }}>Loading...</p>
          </div>
        )}

        {/* ── Native HLS Player (AniPlayer) ───────────────── */}
        {!loadAnime && !loadStream && !extracting && activeUrl && isActiveHLS && !streamErr && (
          <AniPlayer
            url={activeUrl}
            title={`${title} – Episode ${episode}`}
            onBack={() => navigate(`/anime/${id}`, { replace: true })}
          />
        )}

        {/* ── Sandboxed Ad-Free Iframe Player ───────────────── */}
        {!loadAnime && !loadStream && activeUrl && !isActiveHLS && !streamErr && (
          <IframePlayer
            key={activeUrl}
            src={activeUrl}
            onBack={() => navigate(`/anime/${id}`, { replace: true })}
            onStreamCaptured={(m3u8Url, referer) => {
              // CRITICAL: always route through our proxy to bypass CORS restrictions
              const proxied = `${PROXY}/api/stream/hls?url=${encodeURIComponent(m3u8Url)}&referer=${encodeURIComponent(referer)}`;
              console.log('[WatchPage] IframePlayer captured stream, switching to native player');
              setActiveUrl(proxied);
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

            {/* Segmented Control for Sub / Dub if both are available */}
            {hasDub && (
              <div style={{
                display: 'flex',
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 24,
                padding: 3,
                marginBottom: 14,
                border: '1px solid var(--border)'
              }}>
                <button
                  onClick={() => {
                    localStorage.setItem('anilab_preferred_track', 'sub');
                    setAudioTrack('sub');
                    if (subServers.length > 0) selectServer(subServers[0]);
                  }}
                  style={{
                    flex: 1, padding: '7px 0', border: 'none',
                    background: audioTrack === 'sub' ? 'var(--accent)' : 'transparent',
                    color: audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 700, borderRadius: 20,
                    cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  Subtitled (SUB)
                </button>
                <button
                  onClick={() => {
                    localStorage.setItem('anilab_preferred_track', 'dub');
                    setAudioTrack('dub');
                    if (dubServers.length > 0) selectServer(dubServers[0]);
                  }}
                  style={{
                    flex: 1, padding: '7px 0', border: 'none',
                    background: audioTrack === 'dub' ? 'var(--accent)' : 'transparent',
                    color: audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 700, borderRadius: 20,
                    cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  Dubbed (DUB)
                </button>
              </div>
            )}

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
