import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate }            from 'react-router-dom';
import {
  ArrowLeft, ChevronLeft, ChevronRight, List,
  AlertCircle, RefreshCw, Wifi, WifiOff, Loader, Tv
} from 'lucide-react';
import { getAnimeDetail, getTitle, getCover } from '../api/anilist';
import { getAniNekoServers, checkProxy }      from '../api/stream';
import Navbar      from '../components/Navbar';
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
  const [loadStream,  setLoadStream]  = useState(false);
  const [streamErr,   setStreamErr]   = useState(null);
  
  const [showEps,     setShowEps]     = useState(true);
  const [proxyUp,     setProxyUp]     = useState(null);

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

  // Fetch streaming servers
  const fetchStream = useCallback(async () => {
    if (!anime) return;
    setLoadStream(true);
    setStreamErr(null);
    setServers([]);
    setActiveUrl('');
    setActiveName('');

    try {
      const result = await getAniNekoServers(anime, episode);
      if (result?.servers?.length) {
        setServers(result.servers);
        // Auto-select first SUB server (prefer Vidstream or Mycloud)
        const subServers = result.servers.filter(s => s.type === 'sub');
        const preferred  = subServers.find(s => /vidstream/i.test(s.name))
                        || subServers.find(s => /mycloud/i.test(s.name))
                        || subServers[0]
                        || result.servers[0];
        setActiveUrl(preferred.videoUrl);
        setActiveName(preferred.name);
        setActiveType(preferred.type || 'sub');
      } else {
        setStreamErr('No streaming servers available for this episode.');
      }
    } catch (e) {
      setStreamErr(e.message || 'Failed to fetch streaming links.');
    } finally {
      setLoadStream(false);
    }
  }, [anime, episode]);

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

  const selectServer = srv => {
    setActiveUrl(srv.videoUrl);
    setActiveName(srv.name);
    setActiveType(srv.type || 'sub');
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

        {/* Back button */}
        <button onClick={() => navigate(`/anime/${id}`, { replace: true })} id="watch-back"
          style={{ position:'absolute', top:10, left:10, zIndex:20, width:36, height:36, borderRadius:'50%', background:'rgba(0,0,0,0.7)', border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', backdropFilter:'blur(6px)' }}
        ><ArrowLeft size={17} color="#fff"/></button>

        {/* Loading state */}
        {(loadAnime || loadStream) && (
          <div style={{ aspectRatio:'16/9', background:'#070707', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:18, padding:24 }}>
            <Loader size={44} color="#e50914" style={{ animation:'spin 0.9s linear infinite' }}/>
            <div style={{ textAlign:'center' }}>
              <p style={{ color:'#fff', fontSize:14, fontWeight:600, marginBottom:6 }}>
                {loadAnime ? 'Loading anime…' : 'Finding stream…'}
              </p>
              <p style={{ color:'var(--text-secondary)', fontSize:12 }}>
                Searching and resolving fast servers...
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {!loadAnime && !loadStream && streamErr && (
          <div style={{ aspectRatio:'16/9', background:'#070707', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, padding:28 }}>
            <AlertCircle size={44} color="#e50914" style={{ opacity:0.7 }}/>
            <p style={{ color:'#fff', fontSize:15, fontWeight:700 }}>Stream not found</p>
            <p style={{ color:'var(--text-secondary)', fontSize:12, textAlign:'center', maxWidth:280, lineHeight:1.7 }}>{streamErr}</p>
            <button id="btn-retry" className="btn btn-primary btn-sm" onClick={fetchStream}>
              <RefreshCw size={12}/> Retry Search
            </button>
          </div>
        )}

        {/* ── Sandboxed Ad-Free Iframe Player ───────────────── */}
        {!loadAnime && !loadStream && activeUrl && !streamErr && (
          <div style={{ aspectRatio:'16/9', position:'relative', background:'#000' }}>
            <iframe
              key={`player-${activeUrl}`}
              src={activeUrl}
              allowFullScreen
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              // Sandbox blocks popups and redirects but allows video scripts to run!
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              style={{ width:'100%', height:'100%', border:'none' }}
              title={`${title} – Episode ${episode}`}
            />
          </div>
        )}
      </div>

      {/* ── Controls ──────────────────────────────────────────── */}
      <div style={{ padding:'14px 16px 0' }}>

        {/* Title */}
        <p style={{ fontSize:17, fontWeight:700, marginBottom:3, lineHeight:1.3 }}>{title}</p>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Episode {episode} of {totalEps}</span>
          {activeName && (
            <span style={{ background:'rgba(76,175,80,0.12)', color:'#4caf50', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:10, border:'1px solid rgba(76,175,80,0.3)' }}>
              ✓ {activeName} (Ad-Blocked)
            </span>
          )}
        </div>

        {/* Server selection: grouped SUB / DUB tabs */}
        {servers.length > 0 && (
          <>
            <p style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>
              Select Server
            </p>

            {/* SUB servers */}
            {subServers.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize:9, fontWeight:700, color:'#4fc3f7', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
                  🔤 SUB
                </p>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {subServers.map((s, idx) => {
                    const active = activeUrl === s.videoUrl;
                    return (
                      <button key={`sub-${idx}`} onClick={() => selectServer(s)}
                        style={{ padding:'8px 14px', borderRadius:24, background: active ? '#4fc3f7' : 'var(--bg-card)', border:`1.5px solid ${active ? '#4fc3f7' : 'var(--border)'}`, color: active ? '#000' : 'var(--text-secondary)', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:5, transition:'all 0.2s' }}
                      >
                        {active && <span style={{ width:5, height:5, borderRadius:'50%', background:'#000', flexShrink:0 }}/>}
                        {s.name.replace(' (SUB)', '')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DUB servers */}
            {hasDub && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize:9, fontWeight:700, color:'#ffb74d', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>
                  🔊 DUB
                </p>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {dubServers.map((s, idx) => {
                    const active = activeUrl === s.videoUrl;
                    return (
                      <button key={`dub-${idx}`} onClick={() => selectServer(s)}
                        style={{ padding:'8px 14px', borderRadius:24, background: active ? '#ffb74d' : 'var(--bg-card)', border:`1.5px solid ${active ? '#ffb74d' : 'var(--border)'}`, color: active ? '#000' : 'var(--text-secondary)', fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:5, transition:'all 0.2s' }}
                      >
                        {active && <span style={{ width:5, height:5, borderRadius:'50%', background:'#000', flexShrink:0 }}/>}
                        {s.name.replace(' (DUB)', '')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Prev / Current / Next */}
        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
          <button id="ep-prev" onClick={() => goEp(episode - 1)} disabled={episode <= 1}
            style={{ flex:1, padding:12, borderRadius:12, background:'var(--bg-card)', border:'1px solid var(--border)', color: episode <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', fontSize:13, fontWeight:700, cursor: episode <= 1 ? 'not-allowed' : 'pointer', opacity: episode <= 1 ? 0.35 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}
          ><ChevronLeft size={16}/> Prev</button>

          <div style={{ flex:1, padding:12, borderRadius:12, background:'rgba(229,9,20,0.15)', border:'1.5px solid rgba(229,9,20,0.4)', color:'#e50914', fontSize:14, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center' }}>
            Ep {episode}
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
