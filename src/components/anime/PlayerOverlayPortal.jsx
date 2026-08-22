import { createPortal } from 'react-dom';
import { ArrowLeft, Play, AlertCircle, Loader } from 'lucide-react';
import AniPlayer from '../AniPlayer';
import IframePlayer from '../IframePlayer';
import { getTitle } from '../../api/anilist';

export default function PlayerOverlayPortal({
  anime,
  epParam,
  totalEps,
  servers = [],
  subServers = [],
  dubServers = [],
  activeServer,
  activeName = '',
  activeUrl,
  isActiveHLS,
  loadStream,
  extracting,
  streamErr,
  audioTrack,
  onAudioTrackChange,
  onSelectServer,
  onRetryFetch,
  onBack,
  onEpisodeChange,
  allSubtitleTracks = [],
  fsActive,
  setFsActive,
  fsActiveRef,
  epTransitionFs,
  setEpTransitionFs,
  keepFsRef,
  settings,
  allEps = [],
  prog,
  sessionDownloadedEps = new Set(),
  setActiveUrl,
  setIsActiveHLS,
  handleScrapeError,
}) {
  const title = getTitle(anime);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: '#000000',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: fsActive ? 0 : 'max(env(safe-area-inset-top), var(--sb-height, 0px))',
        paddingBottom: fsActive ? 0 : 'var(--android-safe-bottom, env(safe-area-inset-bottom))',
        boxSizing: 'border-box',
      }}
      className="page-slide-in"
    >
      {/* 1. Player Box */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: fsActive ? '100%' : 'min(calc(100vw * 9 / 16 * 1.45), 52vh)',
          flex: fsActive ? 1 : '0 0 auto',
          background: '#000',
          overflow: fsActive ? 'visible' : 'hidden',
        }}
      >
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
            <button className="btn btn-primary" onClick={onRetryFetch} style={{ padding: '6px 16px', borderRadius: 20, fontSize: 12, marginTop: 6 }}>
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
              onBack={onBack}
              onFullscreenChange={(isFs) => {
                setFsActive(isFs);
                if (fsActiveRef) fsActiveRef.current = isFs;
                if (isFs && setEpTransitionFs) setEpTransitionFs(false);
              }}
              currentEpisode={epParam}
              totalEpisodes={totalEps}
              onEpisodeChange={onEpisodeChange}
              autoplay={settings?.autoplay !== false}
              subtitleSettings={settings || null}
              loading={loadStream}
              startInFs={epTransitionFs}
              keepFsOnEpChange={keepFsRef}
              onStreamExpired={() => {
                const fallbackServer = servers.find(s => s.name !== activeServer?.name && s.type === (activeServer?.type || 'sub'));
                if (fallbackServer) {
                  onSelectServer(fallbackServer, servers);
                } else if (activeServer) {
                  onSelectServer(activeServer, servers);
                }
              }}
            />
          ) : (
            <IframePlayer
              src={activeUrl}
              onBack={onBack}
              onStreamCaptured={(m3u8Url) => {
                if (m3u8Url) {
                  setActiveUrl?.(m3u8Url);
                  setIsActiveHLS?.(true);
                } else {
                  handleScrapeError?.();
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
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.01)',
            }}
          >
            <button onClick={onBack} className="floating-btn" style={{ width: 32, height: 32 }}>
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
              {/* Segmented Control for Sub / Dub */}
              <div
                style={{
                  display: 'flex',
                  position: 'relative',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 24,
                  padding: 3,
                  marginBottom: 8,
                  border: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 3,
                    bottom: 3,
                    left: 3,
                    width: 'calc(50% - 3px)',
                    borderRadius: 20,
                    background: 'var(--accent)',
                    boxShadow: '0 2px 12px color-mix(in srgb, var(--accent) 40%, transparent)',
                    transform: audioTrack === 'sub' ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
                    transition: 'transform 0.34s cubic-bezier(0.2, 0.9, 0.28, 1)',
                    pointerEvents: 'none',
                    willChange: 'transform',
                  }}
                />
                <button
                  disabled={subServers.length === 0}
                  onClick={() => onAudioTrackChange('sub')}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    border: 'none',
                    background: 'transparent',
                    position: 'relative',
                    zIndex: 1,
                    color: subServers.length === 0 ? 'rgba(255,255,255,0.15)' : (audioTrack === 'sub' ? '#fff' : 'var(--text-secondary)'),
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 20,
                    transition: 'color 0.25s ease',
                  }}
                >
                  Subtitled (SUB)
                </button>
                <button
                  disabled={dubServers.length === 0}
                  onClick={() => onAudioTrackChange('dub')}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    border: 'none',
                    background: 'transparent',
                    position: 'relative',
                    zIndex: 1,
                    color: dubServers.length === 0 ? 'rgba(255,255,255,0.15)' : (audioTrack === 'dub' ? '#fff' : 'var(--text-secondary)'),
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: 20,
                    transition: 'color 0.25s ease',
                  }}
                >
                  Dubbed (DUB)
                </button>
              </div>

              {/* Active Track Server List */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 60, overflowY: 'auto' }}>
                {(audioTrack === 'sub' ? subServers : dubServers).map((s, idx) => {
                  const active = (activeName && activeName === s.name) || (activeServer?.name === s.name);
                  return (
                    <button
                      key={idx}
                      onClick={() => onSelectServer(s, servers)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        background: active ? 'var(--accent)' : 'var(--bg-card)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        color: active ? '#fff' : 'var(--text-secondary)',
                        fontSize: 10,
                        fontWeight: 600,
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
                    onClick={() => onEpisodeChange(n)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 12px',
                      background: isCurrent ? 'rgba(108, 99, 255, 0.12)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: isCurrent ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                        color: isCurrent ? '#fff' : 'var(--text-secondary)',
                        flexShrink: 0,
                      }}
                    >
                      {isCurrent ? <Play size={12} fill="#fff" strokeWidth={0} /> : n}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: isCurrent ? 700 : 500, color: isCurrent ? '#fff' : 'var(--text-primary)' }}>
                        Episode {n}
                      </div>
                      {isWatched && !isCurrent && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Watched</div>
                      )}
                    </div>
                    {(sessionDownloadedEps.has(`${n}_sub`) || sessionDownloadedEps.has(`${n}_dub`)) && (
                      <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 700 }}>✓ Downloaded</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
