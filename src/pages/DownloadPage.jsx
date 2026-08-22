import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Download as DownloadIcon, Trash2, CheckCircle2, Film, AlertCircle, X, Play } from "lucide-react";
import { ScreenOrientation } from "@capacitor/screen-orientation";
import { registerPlugin, Capacitor } from "@capacitor/core";
import { downloadManager } from "../utils/DownloadManager";
import { registerBackButtonHandler } from "../utils/backButton";
import AniPlayer from "../components/AniPlayer";

const EmbedScraper = registerPlugin("EmbedScraper");

function ProgressRing({ progress, size = 52, stroke = 3.5 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (progress / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="var(--accent)" strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: "stroke-dashoffset 0.4s cubic-bezier(0.4,0,0.2,1)" }}
      />
    </svg>
  );
}

function LocalPlayerOverlay({ item, onClose }) {
  const [playerData, setPlayerData] = useState(null);
  const [error, setError] = useState(null);

  // Lock to landscape + immersive fullscreen mode immediately on mount
  useEffect(() => {
    const isNative = Capacitor.isNativePlatform();
    if (isNative) {
      if (EmbedScraper?.setOrientation) {
        EmbedScraper.setOrientation({ orientation: "sensor-landscape" }).catch(() => {});
      }
      ScreenOrientation.lock({ orientation: "sensor-landscape" })
        .catch(() => ScreenOrientation.lock({ orientation: "landscape" }).catch(() => {}));
      if (EmbedScraper?.setImmersiveMode) {
        EmbedScraper.setImmersiveMode({ enabled: true }).catch(() => {});
      }
    }

    // Handle Android hardware/gesture back button to exit video player cleanly
    const unregisterBack = registerBackButtonHandler(() => {
      onClose();
      return true;
    });

    return () => {
      unregisterBack();
      if (isNative) {
        // Restore portrait orientation and navigation bar when player closes
        if (EmbedScraper?.setOrientation) {
          EmbedScraper.setOrientation({ orientation: "portrait" }).catch(() => {});
        }
        ScreenOrientation.lock({ orientation: "portrait" })
          .then(() => ScreenOrientation.unlock())
          .catch(() => {});
        if (EmbedScraper?.setImmersiveMode) {
          EmbedScraper.setImmersiveMode({ enabled: false }).catch(() => {});
        }
      }
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        // getLocalFileUri returns http://localhost/_capacitor_file_/... URLs
        // via Capacitor.convertFileSrc — the WebView can stream these directly
        // with byte-range support (needed for seeking in large video files).
        const uris = await downloadManager.getLocalFileUri(item.animeTitle, item.episode, item.track);
        if (cancelled) return;
        if (!uris.videoUri) {
          setError("Video file not found. It may have been deleted from your Downloads folder.");
          return;
        }
        setPlayerData({
          videoUri: uris.videoUri,
          subtitleUri: uris.subtitleUri || null,
          subtitleContent: uris.subtitleContent || null
        });
      } catch (e) {
        if (!cancelled) setError(e.message || "Failed to open video");
      }
    };
    load();
    return () => { cancelled = true; };
  }, [item]);

  const subtracks = playerData && (playerData.subtitleContent || playerData.subtitleUri)
    ? [{
        id: 0,
        file: playerData.subtitleUri || 'local://subtitles.vtt',
        content: playerData.subtitleContent || null,
        label: "English",
        kind: "captions",
        default: true
      }]
    : [];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {error && (
        <div style={{ padding: 32, textAlign: "center", maxWidth: 320 }}>
          <AlertCircle size={48} color="#e50914" style={{ marginBottom: 16, opacity: 0.9 }} />
          <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Cannot Open Video</p>
          <p style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.5, marginBottom: 24 }}>{error}</p>
          <button onClick={onClose} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "10px 28px", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>Close</button>
        </div>
      )}
      {!error && !playerData && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", border: "3px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent)", animation: "spin 0.8s linear infinite" }} />
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>Opening video…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {!error && playerData && (
        <AniPlayer
          url={playerData.videoUri}
          isLocal={true}
          title={`${item.animeTitle} — Ep ${item.episode} (${(item.track || "sub").toUpperCase()})`}
          subtitles={subtracks}
          currentEpisode={Number(item.episode) || 1}
          totalEpisodes={Number(item.episode) || 1}
          onBack={onClose}
          startInFs={true}
          autoplay={true}
        />
      )}
    </div>
  );
}

export default function DownloadPage() {
  const navigate = useNavigate();
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [localPlayer, setLocalPlayer] = useState(null);

  const fetchDownloads = async () => {
    try {
      const list = await downloadManager.getDownloadsList();
      setDownloads(list);
    } catch (e) {
      console.error("[DownloadPage] Error loading downloads:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Request storage read permission immediately on mount (needed for offline playback).
    // Without this, File.exists() returns false on Android 10+ for Downloads folder.
    const requestStoragePermission = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { registerPlugin } = await import('@capacitor/core');
        const OfflineDownloader = registerPlugin('OfflineDownloader');
        // Trigger a dummy lookup — the Java side requests permission as a side-effect
        await OfflineDownloader.getLocalVideoUri({ displayName: '__perm_check__.mp4' }).catch(() => {});
      } catch (_) {}
    };
    requestStoragePermission();
    fetchDownloads();
    const unsubscribe = downloadManager.subscribe(() => fetchDownloads());
    return () => unsubscribe();
  }, []);

  const handleDelete = async (animeId, episode, track) => {
    try {
      setDownloads(prev => prev.filter(d => !(String(d.animeId) === String(animeId) && String(d.episode) === String(episode) && (d.track || "sub") === (track || "sub"))));
      await downloadManager.cancelDownload(animeId, episode, track || "sub");
      fetchDownloads();
    } catch (e) { console.error("[DownloadPage] Failed to cancel download:", e); }
  };

  const activeCount = downloads.filter(d => d.status !== "completed" && d.status !== "error").length;
  const completedCount = downloads.filter(d => d.status === "completed").length;

  return (
    <>
      {localPlayer && <LocalPlayerOverlay item={localPlayer} onClose={() => setLocalPlayer(null)} />}

      <div className="page fade-in-up" style={{
        paddingTop: "calc(var(--sat) + 56px)",
        paddingBottom: "calc(var(--nav-height, 60px) + max(var(--android-safe-bottom, 0px), env(safe-area-inset-bottom, 0px), 32px) + 48px)",
        minHeight: "100vh",
      }}>

        <div style={{
          position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)",
          zIndex: 90, width: "100%", maxWidth: 480,
          background: "rgba(0,0,0,0.88)",
          backdropFilter: "blur(40px) saturate(200%)",
          WebkitBackdropFilter: "blur(40px) saturate(200%)",
          borderBottom: "0.5px solid rgba(255,255,255,0.07)",
          padding: "0 16px 12px", paddingTop: "var(--sat)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 12,
              background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 60%, #818cf8))",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px -2px color-mix(in srgb, var(--accent) 60%, transparent)", flexShrink: 0,
            }}>
              <DownloadIcon size={16} color="#fff" />
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: 19, fontWeight: 900, margin: 0, letterSpacing: "-0.03em" }}>Download Center</h1>
              <p style={{ fontSize: 11, color: "var(--text-tertiary)", margin: 0 }}>
                {loading ? "Loading…" : downloads.length === 0 ? "No downloads yet" : `${completedCount} saved · ${activeCount} active`}
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 84, borderRadius: 16, animationDelay: `${i * 80}ms` }} />)}
          </div>
        ) : downloads.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 32px 40px", gap: 16, textAlign: "center" }}>
            <div style={{ width: 88, height: 88, borderRadius: 28, background: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(139,92,246,0.08))", border: "1.5px solid rgba(99,102,241,0.18)", display: "flex", alignItems: "center", justifyContent: "center", animation: "downloadPulse 3s cubic-bezier(0.4,0,0.2,1) infinite" }}>
              <Film size={36} color="var(--accent)" strokeWidth={1.5} style={{ opacity: 0.8 }} />
            </div>
            <div>
              <p style={{ fontSize: 17, fontWeight: 800, margin: "0 0 6px", letterSpacing: "-0.02em" }}>No Downloads Yet</p>
              <p style={{ fontSize: 13, color: "var(--text-tertiary)", margin: 0, lineHeight: 1.5 }}>Go to any anime episode and tap the<br />download icon to save for offline viewing.</p>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 8, borderRadius: 14, padding: "10px 24px", fontWeight: 700 }} onClick={() => navigate("/")} id="download-browse-btn">Browse Anime</button>
            <style>{`@keyframes downloadPulse { 0%,100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 20%, transparent); } 50% { box-shadow: 0 0 0 16px transparent; } }`}</style>
          </div>
        ) : (
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {downloads.map((item, idx) => {
              const isCompleted = item.status === "completed";
              const isError = item.status === "error";
              const isActive = !isCompleted && !isError;
              const progress = isCompleted ? 100 : (item.progress || 0);
              return (
                <div key={idx} className="card-entrance" style={{
                  display: "flex", gap: 12, background: "var(--bg-card)",
                  borderRadius: 18, padding: "12px 12px", border: "1px solid var(--border)",
                  alignItems: "center", animationDelay: `${idx * 40}ms`,
                  boxShadow: isCompleted ? "0 2px 12px rgba(76,175,80,0.07)" : isError ? "0 2px 12px rgba(229,9,20,0.07)" : "0 2px 12px rgba(0,0,0,0.2)",
                }}>
                  <div style={{ position: "relative", flexShrink: 0, width: 52, height: 72, borderRadius: 10, overflow: "hidden" }}>
                    {item.cover ? (
                      <img src={item.cover} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} onError={e => { e.currentTarget.style.display = "none"; }} />
                    ) : (
                      <div style={{ width: "100%", height: "100%", background: "rgba(99,102,241,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Film size={20} color="var(--accent)" />
                      </div>
                    )}
                    {isActive && (
                      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <ProgressRing progress={progress} size={38} stroke={3} />
                        <span style={{ position: "absolute", fontSize: 9, fontWeight: 900, color: "var(--accent)" }}>{Math.round(progress)}%</span>
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 13, fontWeight: 800, margin: "0 0 2px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {item.animeTitle && item.animeTitle !== "Anime" ? item.animeTitle : `Anime #${item.animeId}`}
                    </h3>
                    <p style={{ fontSize: 12, color: "var(--text-tertiary)", margin: "0 0 6px" }}>
                      Episode {item.episode}
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, background: "var(--bg-elevated)", borderRadius: 4, padding: "1px 5px", color: "var(--text-tertiary)" }}>{(item.track || "sub").toUpperCase()}</span>
                    </p>
                    {isCompleted ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <CheckCircle2 size={12} color="#4caf50" />
                        <span style={{ fontSize: 11, color: "#4caf50", fontWeight: 600 }}>Saved to device</span>
                        {item.remuxError && <span style={{ fontSize: 10, color: "var(--text-tertiary)", opacity: 0.75 }}>· Use VLC if playback fails</span>}
                      </div>
                    ) : isError ? (
                      <span style={{ fontSize: 11, color: "#e50914", fontWeight: 600 }}>⚠ {item.error ? item.error.slice(0, 38) : "Download failed"}</span>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                          <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #818cf8))", transition: "width 0.4s cubic-bezier(0.4,0,0.2,1)", borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontWeight: 700, flexShrink: 0 }}>{Math.round(progress)}%</span>
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                    {isCompleted && (
                      <button onClick={() => setLocalPlayer(item)} aria-label="Play offline" id={`play-offline-${item.taskId}`}
                        style={{ background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #818cf8))", border: "none", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", cursor: "pointer", boxShadow: "0 2px 10px -2px color-mix(in srgb, var(--accent) 50%, transparent)", transition: "transform 0.15s" }}
                        onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.08)"; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; }}
                      >
                        <Play size={15} fill="#fff" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(item.animeId, item.episode, item.track)} aria-label="Delete download"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", cursor: "pointer", transition: "background 0.2s, color 0.2s" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(229,9,20,0.12)"; e.currentTarget.style.color = "#e50914"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "var(--text-tertiary)"; }}
                    >
                      {isActive ? <X size={14} /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
