import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  User, Info, Shield, LogOut, ChevronRight, Heart, Bookmark, Clock,
  Save, Check, X, AlertTriangle, Cloud, CloudLightning,
  Play, SkipForward, Server, Moon, Palette, LayoutGrid,
  Type, Sliders, Captions, Download, Upload,
  Settings, ChevronDown, Camera, Bell, RefreshCw, Sparkles, ShieldAlert,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useNavigate, useLocation } from "react-router-dom";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { registerBackButtonHandler } from "../utils/backButton";
import { cloudSignOut, supabase, fetchUserProfile, saveAvatarToProfile } from "../api/supabase";
import { getTitle } from "../api/anilist";
import LoadingWheel from "../components/ui/LoadingWheel";

const APKUpdater = registerPlugin("APKUpdater");

/* ── Avatar Utilities ────────────────────────────────────────────────────── */
const AVATAR_PRESETS = {
  "preset-violet": "linear-gradient(135deg, #7c3aed, #4f46e5)",
  "preset-rose": "linear-gradient(135deg, #e11d48, #be123c)",
  "preset-emerald": "linear-gradient(135deg, #10b981, #047857)",
  "preset-sky": "linear-gradient(135deg, #0ea5e9, #0369a1)",
  "preset-amber": "linear-gradient(135deg, #f59e0b, #b45309)",
  "preset-pink": "linear-gradient(135deg, #ec4899, #be185d)",
};

const getAvatarBackground = (val) => {
  return AVATAR_PRESETS[val] || "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #ff6b35))";
};

const renderAvatarContent = (val, name) => {
  if (val && (val.startsWith("data:image") || val.startsWith("http"))) {
    return <img src={val} alt="Avatar" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />;
  }
  const initial = name ? name.charAt(0).toUpperCase() : "?";
  return <span style={{ fontWeight: 800, fontSize: "clamp(20px, 38%, 36px)", color: "#fff" }}>{initial}</span>;
};

/* ── Image Resizer & Compressor ────────────────────────────────────────── */
const compressAvatar = (file, callback) => {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 128; // 128x128px is perfect for avatar
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      // Draw centered square crop
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      const base64 = canvas.toDataURL("image/jpeg", 0.75); // 75% quality JPEG
      callback(base64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
};

/* ── Global keyframes injected once ─────────────────────────────────────── */
const GLOBAL_STYLES = `
  @keyframes slideUp   { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes fadeInUp  { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
  @keyframes dropIn    { from { transform: translateY(-8px) scale(0.95); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
  @keyframes fadeInOverlay {
    0% { opacity: 0; }
    100% { opacity: 1; }
  }
  @keyframes spinSlow {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .btn-press-anim {
    transition: transform 0.16s cubic-bezier(0.4, 0, 0.2, 1), background 0.2s, box-shadow 0.2s, filter 0.2s !important;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  .btn-press-anim:active {
    transform: scale(0.94) !important;
    filter: brightness(0.9) !important;
  }

  .settings-card-anim { animation: fadeInUp 0.4s cubic-bezier(0.34,1.2,0.64,1) both; }
  .settings-card-anim:nth-child(1) { animation-delay: 0.05s; }
  .settings-card-anim:nth-child(2) { animation-delay: 0.13s; }
  .settings-card-anim:nth-child(3) { animation-delay: 0.21s; }
  .settings-card-anim:nth-child(4) { animation-delay: 0.29s; }
  .settings-card-anim:nth-child(5) { animation-delay: 0.37s; }

  .srow:active { background: rgba(0,0,0,0.04); }

  .pill-opt {
    padding: 5px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
    cursor: pointer; transition: all 0.2s; white-space: nowrap;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .pill-opt.active {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    box-shadow: 0 0 14px -3px var(--accent);
  }

  .dd-btn {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 10px; padding: 7px 11px;
    font-size: 12px; font-weight: 700; color: var(--text-primary);
    cursor: pointer; transition: all 0.2s; white-space: nowrap;
    min-width: 110px; justify-content: space-between;
  }
  .dd-btn:hover, .dd-btn.open { background: var(--bg-hover); border-color: var(--border); }
  .dd-menu {
    position: absolute; right: 0; top: calc(100% + 6px); min-width: 148px;
    background: var(--bg-secondary); backdrop-filter: blur(24px);
    border: 1px solid var(--border); border-radius: 14px;
    overflow: hidden; z-index: 300;
    animation: dropIn 0.22s cubic-bezier(0.34,1.2,0.64,1);
    box-shadow: 0 20px 48px rgba(0,0,0,0.25), 0 0 0 1px var(--border);
  }
  .dd-item {
    padding: 10px 14px; font-size: 13px; font-weight: 600;
    color: var(--text-secondary); cursor: pointer;
    transition: all 0.14s; display: flex; align-items: center; gap: 9px;
    border-bottom: 1px solid var(--border);
  }
  .dd-item:last-child { border-bottom: none; }
  .dd-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .dd-item.sel { color: var(--accent); background: var(--accent-dim); }
  .dd-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); opacity: 0; flex-shrink: 0; transition: opacity 0.15s; }
  .dd-item.sel .dd-dot { opacity: 1; }

  .prem-btn {
    display: flex; align-items: center; gap: 6px;
    border-radius: 10px; padding: 8px 13px; font-size: 12px; font-weight: 700;
    cursor: pointer; transition: all 0.2s; white-space: nowrap; border: 1px solid;
  }
  .prem-btn:active { transform: scale(0.95); }

  /* ── Settings panel light mode overrides ── */
  body.theme-light .settings-panel-wrap {
    background: var(--bg-primary) !important;
  }
  body.theme-light .settings-card-inner {
    background: var(--bg-secondary) !important;
    border-color: var(--border) !important;
  }
`;

/* ── Custom Dropdown ─────────────────────────────────────────────────────── */
function Dropdown({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, []);
  const sel = options.find(o => o.value === value);
  return (
    <div style={{ position: "relative", flexShrink: 0 }} ref={ref}>
      <button className={`dd-btn ${open ? "open" : ""}`} onClick={() => setOpen(o => !o)}>
        <span>{sel?.label || value}</span>
        <ChevronDown size={12} style={{ transition: "transform 0.22s", transform: open ? "rotate(180deg)" : "rotate(0)", opacity: 0.5 }} />
      </button>
      {open && (
        <div className="dd-menu">
          {options.map(o => (
            <div key={o.value} className={`dd-item ${o.value === value ? "sel" : ""}`}
              onClick={() => { onChange(o.value); setOpen(false); }}>
              <span className="dd-dot" />
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Toggle ──────────────────────────────────────────────────────────────── */
function Toggle({ value, onChange }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      width: 50, height: 28, borderRadius: 14, flexShrink: 0, cursor: "pointer",
      background: value ? "var(--accent)" : "rgba(255,255,255,0.1)",
      position: "relative",
      transition: "background 0.28s cubic-bezier(0.2, 0.9, 0.28, 1)",
      boxShadow: value ? "0 0 16px -4px var(--accent)" : "inset 0 1px 3px rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.08)",
      touchAction: 'manipulation',
      transform: 'translateZ(0)',
    }}>
      <div style={{
        position: "absolute", top: 4,
        left: 4,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
        transform: value ? 'translate3d(22px, 0, 0)' : 'translate3d(0, 0, 0)',
        transition: "transform 0.26s cubic-bezier(0.2, 0.9, 0.28, 1)",
        willChange: 'transform',
      }} />
    </div>
  );
}

/* ── Pill Selector ───────────────────────────────────────────────────────── */
function PillSelector({ value, options, onChange }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {options.map(o => (
        <button key={o.value} className={`pill-opt ${o.value === value ? "active" : ""}`}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/* ── Setting Row ─────────────────────────────────────────────────────────── */
function SettingRow({ icon: Icon, label, sub, children, iconColor = "var(--accent)", last, onClick }) {
  return (
    <div
      className="srow"
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "13px 8px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        borderRadius: 10, transition: "background 0.15s, transform 0.1s",
        cursor: onClick ? "pointer" : "default",
        WebkitTapHighlightColor: "transparent",
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 11, flexShrink: 0,
        background: `${iconColor}18`,
        border: `1px solid ${iconColor}2a`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: `0 4px 12px ${iconColor}14`,
      }}>
        <Icon size={16} color={iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Settings Card ───────────────────────────────────────────────────────── */
function SettingsCard({ title, emoji, children, zIndex = 1 }) {
  return (
    <div className="settings-card-anim" style={{
      background: "var(--bg-card)",
      borderRadius: 20, border: "1px solid var(--border)",
      padding: "0 16px 6px", marginBottom: 14,
      boxShadow: "0 4px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
      position: "relative", zIndex,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 10.5, fontWeight: 800, color: "var(--accent)",
        letterSpacing: "0.12em", textTransform: "uppercase",
        paddingTop: 16, paddingBottom: 10,
        borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 2,
      }}>
        <span style={{ fontSize: 15 }}>{emoji}</span>
        {title}
      </div>
      {children}
    </div>
  );
}


/* ── Full Settings Panel ─────────────────────────────────────────────────── */
function SettingsPanel({ onBack }) {
  const { settings, updateSettings, watchlist, favorites, progress } = useApp();
  const [showAdultModal, setShowAdultModal] = useState(false);

  useEffect(() => {
    const cleanup = registerBackButtonHandler(() => {
      onBack();
      return true;
    });
    return cleanup;
  }, [onBack]);

  const ACCENT_COLORS = [
    { value: "#7c3aed", label: "Violet" }, { value: "#e11d48", label: "Rose" },
    { value: "#0ea5e9", label: "Sky" }, { value: "#10b981", label: "Emerald" },
    { value: "#f59e0b", label: "Amber" }, { value: "#ec4899", label: "Pink" },
    { value: "#6366f1", label: "Indigo" }, { value: "#14b8a6", label: "Teal" },
  ];

  const exportData = async () => {
    const data = { version: 1, exportedAt: new Date().toISOString(), watchlist, favorites, progress, settings };
    const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
    if (isNative) {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        const OfflineDownloader = registerPlugin('OfflineDownloader');
        await OfflineDownloader.exportBackup({ data: JSON.stringify(data) });
      } catch (e) {
        alert("Failed to export backup: " + (e.message || String(e)));
      }
    } else {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `aniplay-backup-${new Date().toISOString().split("T")[0]}.json`; a.click();
      URL.revokeObjectURL(url);
    }
  };

  const importData = () => {
    const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
    if (isNative) {
      (async () => {
        try {
          const { registerPlugin } = await import('@capacitor/core');
          const OfflineDownloader = registerPlugin('OfflineDownloader');
          const res = await OfflineDownloader.importBackup();
          if (res && res.data) {
            const data = JSON.parse(res.data);
            if (data.version !== 1) { alert("Unsupported format"); return; }

            const { Preferences } = await import('@capacitor/preferences');
            if (data.watchlist) await Preferences.set({ key: 'aniplay_watchlist', value: JSON.stringify(data.watchlist) });
            if (data.favorites) await Preferences.set({ key: 'aniplay_favorites', value: JSON.stringify(data.favorites) });
            if (data.progress) await Preferences.set({ key: 'aniplay_progress', value: JSON.stringify(data.progress) });
            if (data.recentlyViewed) await Preferences.set({ key: 'aniplay_recently_viewed', value: JSON.stringify(data.recentlyViewed) });
            if (data.settings) await Preferences.set({ key: 'aniplay_settings', value: JSON.stringify(data.settings) });

            alert("Import successful! The app will now reload to apply the data.");
            window.location.reload();
          }
        } catch (e) {
          alert("Import failed: " + (e.message || String(e)));
        }
      })();
    } else {
      const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
      input.onchange = async e => {
        const file = e.target.files?.[0]; if (!file) return;
        try {
          const text = await file.text(); const data = JSON.parse(text);
          if (data.version !== 1) { alert("Unsupported format"); return; }

          const { Preferences } = await import('@capacitor/preferences');
          if (data.watchlist) await Preferences.set({ key: 'aniplay_watchlist', value: JSON.stringify(data.watchlist) });
          if (data.favorites) await Preferences.set({ key: 'aniplay_favorites', value: JSON.stringify(data.favorites) });
          if (data.progress) await Preferences.set({ key: 'aniplay_progress', value: JSON.stringify(data.progress) });
          if (data.recentlyViewed) await Preferences.set({ key: 'aniplay_recently_viewed', value: JSON.stringify(data.recentlyViewed) });
          if (data.settings) await Preferences.set({ key: 'aniplay_settings', value: JSON.stringify(data.settings) });

          alert("Import successful! The app will now reload to apply the data.");
          window.location.reload();
        } catch { alert("Failed to read file."); }
      };
      input.click();
    }
  };

  const handleOpenDirectoryPicker = async () => {
    const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
    if (isNative) {
      try {
        const { registerPlugin } = await import('@capacitor/core');
        const OfflineDownloader = registerPlugin('OfflineDownloader');
        const res = await OfflineDownloader.selectDownloadLocation();
        if (res && res.folderName) {
          updateSettings({ downloadLocation: res.folderName });
        }
      } catch (e) {
        console.warn('Directory selection failed:', e);
      }
    } else {
      const name = prompt("Enter subfolder name:", settings.downloadLocation || 'AniPlay');
      if (name !== null) {
        updateSettings({ downloadLocation: name.replace(/[^a-zA-Z0-9_\-]/g, '') });
      }
    }
  };

  const subColor = settings.subtitleColor || "#ffffff";
  const subSz = settings.subtitleFontSize || "medium";
  const subOp = settings.subtitleBgOpacity ?? 0.5;
  const subPos = settings.subtitlePosition || "bottom";

  return (
    <div className="page" style={{ background: "var(--bg-primary)", paddingTop: 'calc(var(--sat) + 62px)' }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Fixed Header — never scrolls away, like Home AniPlay bar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 480,
        zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px',
        paddingTop: 'var(--sat)',
        background: 'rgba(12, 12, 14, 0.96)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.09)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'var(--text-primary)', cursor: 'pointer',
          padding: '8px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700,
          touchAction: 'manipulation',
          transition: 'background-color 0.2s ease, transform 0.15s ease',
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 5,
        }}>← Back</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 11,
            background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 65%, #818cf8))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 18px -3px var(--accent)',
          }}>
            <Settings size={17} color="#fff" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 900, margin: 0, letterSpacing: '-0.03em' }}>App Settings</h2>
        </div>
      </div>


      <div style={{ padding: "10px 16px 80px" }}>

        {/* 🎬 Player */}
        <SettingsCard title="Player" emoji="🎬" zIndex={10}>
          <SettingRow icon={Play} label="Autoplay Next Episode" sub="Auto-navigate to next episode when current ends" iconColor="#818cf8">
            <Toggle value={settings.autoplay} onChange={v => updateSettings({ autoplay: v })} />
          </SettingRow>
          <SettingRow icon={Server} label="Preferred Server" sub="Stream source priority when multiple are available" iconColor="#60a5fa" last>
            <Dropdown value={settings.preferredServer} onChange={v => updateSettings({ preferredServer: v })}
              options={[
                { value: "auto",     label: "Auto (Best)" },
                { value: "neko",     label: "NekoHD" },
                { value: "waveshd",  label: "WavesHD" },
                { value: "anihd",    label: "AniHD" },
              ]} />
          </SettingRow>
        </SettingsCard>

        {/* 🎨 Appearance */}
        <SettingsCard title="Appearance" emoji="🎨" zIndex={9}>
          <SettingRow icon={Moon} label="Dark Mode" sub="Always-on dark theme for night watching" iconColor="#6366f1">
            <Toggle value={settings.darkMode} onChange={v => updateSettings({ darkMode: v })} />
          </SettingRow>
          <SettingRow icon={Palette} label="Accent Color" sub="Theme highlight applied across the app" iconColor={settings.accentColor} last>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 190 }}>
              {ACCENT_COLORS.map(c => (
                <div key={c.value} title={c.label} onClick={() => updateSettings({ accentColor: c.value })}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", background: c.value, cursor: "pointer", flexShrink: 0,
                    touchAction: 'manipulation',
                    transition: "transform 0.22s cubic-bezier(0.34,1.3,0.64,1), box-shadow 0.22s ease, border-color 0.22s ease",
                    border: settings.accentColor === c.value ? "2.5px solid #fff" : "2px solid rgba(255,255,255,0.1)",
                    boxShadow: settings.accentColor === c.value ? `0 0 12px 2px ${c.value}88` : "none",
                    transform: settings.accentColor === c.value ? "scale(1.25)" : "scale(1)",
                  }} />
              ))}
            </div>
          </SettingRow>
        </SettingsCard>

        {/* 💬 Subtitles */}
        <SettingsCard title="Subtitles" emoji="💬" zIndex={8}>
          <SettingRow icon={Type} label="Font Size" sub="Caption text size during playback" iconColor="#f59e0b">
            <PillSelector value={subSz} onChange={v => updateSettings({ subtitleFontSize: v })}
              options={[{ value: "small", label: "S" }, { value: "medium", label: "M" }, { value: "large", label: "L" }, { value: "xlarge", label: "XL" }]} />
          </SettingRow>
          <SettingRow icon={Palette} label="Text Color" sub="Caption color during playback" iconColor="#fb7185">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, background: subColor,
                border: "2px solid rgba(255,255,255,0.15)", overflow: "hidden",
                cursor: "pointer", position: "relative",
                boxShadow: `0 4px 14px ${subColor}55`, transition: "box-shadow 0.2s",
              }}>
                <input type="color" value={subColor} onChange={e => updateSettings({ subtitleColor: e.target.value })}
                  style={{ position: "absolute", inset: "-4px", width: "calc(100% + 8px)", height: "calc(100% + 8px)", opacity: 0, cursor: "pointer" }} />
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>{subColor.toUpperCase()}</span>
            </div>
          </SettingRow>
          <SettingRow icon={Sliders} label="Background Opacity" sub={`Shadow darkness: ${Math.round(subOp * 100)}%`} iconColor="#34d399">
            <div style={{ width: 100 }}>
              <input type="range" min={0} max={1} step={0.05} value={subOp}
                onChange={e => updateSettings({ subtitleBgOpacity: parseFloat(e.target.value) })}
                style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer" }} />
            </div>
          </SettingRow>
          <SettingRow icon={Captions} label="Position" sub="Where captions appear on screen" iconColor="#38bdf8">
            <PillSelector value={subPos} onChange={v => updateSettings({ subtitlePosition: v })}
              options={[{ value: "bottom", label: "Bottom" }, { value: "top", label: "Top" }]} />
          </SettingRow>

          {/* Live preview */}
          <div style={{ padding: "10px 0 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Live Preview</div>
            <div style={{
              borderRadius: 14, height: 90, position: "relative", overflow: "hidden",
              display: "flex",
              alignItems: subPos === "bottom" ? "flex-end" : "flex-start",
              justifyContent: "center",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "inset 0 0 40px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)",
              /* Colorful anime-style scene so opacity is visually meaningful */
              background: "linear-gradient(160deg, #1a0533 0%, #0d1a3a 40%, #0a2a1a 75%, #1a1000 100%)",
            }}>
              {/* Stars / ambient dots */}
              <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,255,255,0.18) 1px, transparent 1px)", backgroundSize: "14px 14px", opacity: 0.6 }} />
              {/* Foreground silhouette */}
              <div style={{
                position: "absolute", bottom: 0, left: 0, right: 0, height: 30,
                background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)"
              }} />
              {/* Glowing orb accent */}
              <div style={{
                position: "absolute", top: 6, right: 16, width: 28, height: 28, borderRadius: "50%",
                background: "radial-gradient(circle, #f59e0b 0%, transparent 70%)", opacity: 0.7,
              }} />
              <div style={{
                position: "absolute", top: 10, left: 20, width: 18, height: 18, borderRadius: "50%",
                background: "radial-gradient(circle, #818cf8 0%, transparent 70%)", opacity: 0.5,
              }} />
              {/* Preview text */}
              <div style={{
                fontSize: { small: 11, medium: 13, large: 16, xlarge: 20 }[subSz] || 13,
                color: subColor,
                background: `rgba(0,0,0,${subOp})`,
                padding: "3px 10px", borderRadius: 5, margin: 8,
                fontWeight: 600, textAlign: "center",
                textShadow: "0 1px 4px rgba(0,0,0,0.95)",
                position: "relative", zIndex: 1,
                transition: "all 0.2s",
              }}>
                Demo subtitle preview text here
              </div>
            </div>
          </div>
        </SettingsCard>

        {/* 💾 Data */}
        <SettingsCard title="Data & Backup" emoji="💾" zIndex={7}>
          <SettingRow icon={Cloud} label="Auto Cloud Backup" sub="Sync watchlist and progress when signed in" iconColor="#38bdf8">
            <Toggle value={settings.autoBackup} onChange={v => updateSettings({ autoBackup: v })} />
          </SettingRow>
          <SettingRow icon={Download} label="Export Backup" sub="Download all your data as a JSON file" iconColor="#10b981">
            <button className="prem-btn" onClick={exportData}
              style={{ background: "rgba(16,185,129,0.12)", borderColor: "rgba(16,185,129,0.3)", color: "#10b981" }}>
              <Download size={13} /> Export
            </button>
          </SettingRow>
          <SettingRow icon={Upload} label="Import Backup" sub="Restore your data from a JSON file" iconColor="#f59e0b">
            <button className="prem-btn" onClick={importData}
              style={{ background: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.3)", color: "#f59e0b" }}>
              <Upload size={13} /> Import
            </button>
          </SettingRow>
          <SettingRow
            icon={Download}
            label="Download Folder"
            sub="Subfolder inside your Downloads directory"
            iconColor="#a855f7"
            last
          >
            <div
              onClick={handleOpenDirectoryPicker}
              style={{
                background: 'var(--bg-hover)',
                border: '1.5px solid var(--border)',
                borderRadius: 8,
                padding: '6px 14px',
                color: '#fff',
                minWidth: 90,
                textAlign: 'right',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
                display: 'inline-block',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.background = 'var(--bg-hover)';
              }}
            >
              {settings.downloadLocation || 'AniPlay'}
            </div>
          </SettingRow>
        </SettingsCard>

        {/* 🔞 Adult Content (18+) - Temporarily disabled */}
        {false && (
          <SettingsCard title="Adult Content (18+)" emoji="🔞" zIndex={6}>
            <SettingRow
              icon={ShieldAlert}
              label="18+ Adult Mode"
              sub="Unlock Hentai & adult anime streaming servers"
              iconColor="#f43f5e"
              last
            >
              <Toggle
                value={!!settings.adultMode}
                onChange={v => {
                  if (v) {
                    setShowAdultModal(true);
                  } else {
                    updateSettings({ adultMode: false });
                    try {
                      localStorage.setItem('anilab_adult_mode', 'false');
                    } catch (_) {}
                  }
                }}
              />
            </SettingRow>
          </SettingsCard>
        )}

        {/* 🔞 Age Verification Modal */}
        {showAdultModal && (
          <Modal title="18+ Age Confirmation" onClose={() => setShowAdultModal(false)}>
            <div style={{ textAlign: "center", padding: "10px 0 10px" }}>
              <div style={{
                width: 60, height: 60, borderRadius: "50%",
                background: "rgba(244,63,94,0.12)", border: "1.5px solid rgba(244,63,94,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 14px", fontSize: 26
              }}>
                🔞
              </div>
              <h3 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 8px", color: "#fff" }}>
                Adult (18+) Content Confirmation
              </h3>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: "0 0 20px" }}>
                This setting unlocks explicit adult (18+) anime and dedicated Hentai streaming servers.
                You must be at least 18 years of age or the age of legal majority in your jurisdiction to view this material.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => setShowAdultModal(false)}
                  style={{
                    flex: 1, padding: "12px 14px", borderRadius: 12,
                    background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", fontWeight: 700, fontSize: 13, cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    updateSettings({ adultMode: true });
                    try {
                      localStorage.setItem('anilab_adult_mode', 'true');
                    } catch (_) {}
                    setShowAdultModal(false);
                  }}
                  style={{
                    flex: 1, padding: "12px 14px", borderRadius: 12,
                    background: "linear-gradient(135deg, #f43f5e, #e11d48)", border: "none",
                    color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer",
                    boxShadow: "0 4px 18px rgba(244,63,94,0.4)"
                  }}
                >
                  I am 18 or Older
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

/* ── Modal ───────────────────────────────────────────────────────────────── */
function Modal({ title, children, onClose }) {
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px 16px",
    }} onClick={onClose}>
      <style>{GLOBAL_STYLES}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 380,
        background: "linear-gradient(160deg, rgba(22,18,38,0.99), rgba(14,12,26,0.99))",
        borderRadius: "24px", padding: "22px 20px 24px",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
        animation: "dropIn 0.22s cubic-bezier(0.34,1.2,0.64,1)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-muted)", cursor: "pointer", padding: "6px", borderRadius: 8,
            display: "flex", alignItems: "center",
          }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ── Main Profile ────────────────────────────────────────────────────────── */
export default function Profile() {
  const { watchlist, favorites, progress, recentlyViewed, user, userProfile, syncWithCloud, showToast, flushSync } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [showSettings, setShowSettings] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [showCloudLogOut, setShowCloudLogOut] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [appVersion, setAppVersion] = useState("1.0.0");
  const [devTaps, setDevTaps] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Handle Android hardware/gesture back button for Settings and Modals
  useEffect(() => {
    const cleanup = registerBackButtonHandler(() => {
      if (showEditProfile) {
        setShowEditProfile(false);
        return true;
      }
      if (showReleaseNotes) {
        setShowReleaseNotes(false);
        return true;
      }
      if (showAbout) {
        setShowAbout(false);
        return true;
      }
      if (showPrivacy) {
        setShowPrivacy(false);
        return true;
      }
      if (showSignOut) {
        setShowSignOut(false);
        return true;
      }
      if (showCloudLogOut) {
        setShowCloudLogOut(false);
        return true;
      }
      if (showSettings) {
        setShowSettings(false);
        return true;
      }
      return false;
    });
    return cleanup;
  }, [showSettings, showEditProfile, showAbout, showPrivacy, showSignOut, showCloudLogOut]);

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await syncWithCloud(user);
      showToast("Cloud sync completed successfully! ✓");
    } catch (err) {
      showToast("Sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  // Profile Edit fields
  const [editNickname, setEditNickname] = useState("");
  const [editAvatar, setEditAvatar] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileDbData, setProfileDbData] = useState(null);

  // Fetch user_profiles row from DB (for avatar/nickname fallback)
  useEffect(() => {
    if (!user?.id) return;
    fetchUserProfile(user.id)
      .then(d => setProfileDbData(d))
      .catch(() => { });
  }, [user?.id]);

  useEffect(() => {
    const getVersion = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const v = await APKUpdater.getAppVersion();
          setAppVersion(v.versionName);
          if (v.packageName?.endsWith(".beta")) localStorage.setItem("anilab_test_updates", "true");
        } catch { try { const i = await CapApp.getInfo(); setAppVersion(i.version); } catch { } }
      }
    };
    getVersion();
  }, []);

  const handleVersionTap = () => {
    const n = devTaps + 1;
    if (n >= 7) {
      const isTest = localStorage.getItem("anilab_test_updates") === "true";
      localStorage.setItem("anilab_test_updates", isTest ? "false" : "true");
      alert(`Developer Mode: Test updates ${!isTest ? "ENABLED" : "DISABLED"}.`);
      window.location.reload(); setDevTaps(0);
    } else setDevTaps(n);
  };

  const handleSignOut = async () => {
    try {
      setIsLoggingOut(true);
      setShowSignOut(false);
      await flushSync();
      localStorage.clear();
      sessionStorage.clear();
      setTimeout(() => {
        window.location.href = "/";
      }, 700);
    } catch (e) {
      setIsLoggingOut(false);
      console.warn('[LogOut] flush failed:', e.message);
      window.location.reload();
    }
  };

  const handleCloudLogOut = async () => {
    try {
      setIsLoggingOut(true);
      setShowCloudLogOut(false);

      // Best-effort flush — never block logout if network is unreachable or slow
      try {
        await Promise.race([
          flushSync(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
        ]);
      } catch (flushErr) {
        console.warn('[Profile] Logout flush skipped or timed out:', flushErr?.message);
      }

      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key: 'aniplay_cloud_credentials' }).catch(() => {});
      await cloudSignOut();
      localStorage.removeItem('aniplay_last_sync_at');

      showToast('Logged out successfully');
      setTimeout(() => {
        window.location.href = "/";
      }, 500);
    } catch (e) {
      console.warn('[Profile] Error during cloud logout, forcing local logout:', e?.message);
      await cloudSignOut().catch(() => {});
      window.location.href = "/";
    }
  };

  const wlCount = Object.keys(watchlist || {}).length;
  const favCount = Object.keys(favorites || {}).length;

  const historyCount = useMemo(() => {
    const isValid = (a) => {
      if (!a) return false;
      const t = getTitle(a);
      return typeof t === 'string' && t.trim().length > 0 && t.toLowerCase() !== 'unknown';
    };

    const completedIds = new Set(
      Object.values(watchlist || {})
        .filter(i => i?.status === 'completed' && isValid(i?.anime))
        .map(i => String(i.anime.id))
    );

    const activeSet = new Set();
    (recentlyViewed || []).forEach(item => {
      if (item?.anime?.id && isValid(item.anime) && !completedIds.has(String(item.anime.id))) {
        activeSet.add(String(item.anime.id));
      }
    });
    Object.entries(progress || {}).forEach(([id, prog]) => {
      if (!completedIds.has(String(id)) && prog?.episode && !activeSet.has(String(id))) {
        const anime = watchlist?.[id]?.anime || favorites?.[id];
        if (isValid(anime)) {
          activeSet.add(String(id));
        }
      }
    });

    return completedIds.size + activeSet.size;
  }, [recentlyViewed, progress, watchlist, favorites]);

  if (showSettings) return <SettingsPanel onBack={() => setShowSettings(false)} />;

  const MENU = [
    { icon: Sparkles, label: "What's New (v1.5.6)", action: () => setShowReleaseNotes(true), color: "#f59e0b" },
    { icon: Settings, label: "Settings", action: () => setShowSettings(true), color: "var(--accent)" },
    { icon: Bell, label: "Notifications", action: () => navigate('/notifications') },
    { icon: Info, label: "About AniPlay", action: () => setShowAbout(true) },
    { icon: Shield, label: "Privacy Policy", action: () => setShowPrivacy(true) },
    user ? { icon: CloudLightning, label: "Log Out from Cloud", action: () => setShowCloudLogOut(true), color: "#38bdf8" } : null,
    { icon: LogOut, label: "Clear Cache & Reset", action: () => setShowSignOut(true), color: "#ef4444" },
  ].filter(Boolean);

  // avatar: prefer user_metadata → then userProfile → then user_profiles DB row → then localStorage
  const avatar = user
    ? (user.user_metadata?.avatar || userProfile?.avatar || userProfile?.avatar_url || profileDbData?.avatar || profileDbData?.avatar_url || "")
    : (localStorage.getItem("user_avatar") || "");

  // displayName: prefer user_metadata → then userProfile → then user_profiles DB → email prefix → localStorage
  const displayName = user
    ? (user.user_metadata?.nickname || userProfile?.nickname || profileDbData?.nickname || user.email?.split("@")[0] || "User")
    : (localStorage.getItem("user_nickname") || "Anime Fan");

  // Pre-fill edit fields when editing modal opens
  const openEditModal = () => {
    setEditNickname(displayName);
    setEditAvatar(avatar);
    setShowEditProfile(true);
  };

  const saveProfile = async () => {
    const cleanNick = editNickname.trim();
    if (!cleanNick) return;
    setSavingProfile(true);
    try {
      if (user) {
        // 1. Save to Supabase Auth user_metadata (primary)
        const { error } = await supabase.auth.updateUser({
          data: { nickname: cleanNick, avatar: editAvatar }
        });
        if (error) throw error;
        // 2. Persist both nickname AND avatar to user_profiles DB table (recovery / fallback)
        await updateUserNickname(cleanNick).catch(() => { });
        await saveAvatarToProfile(editAvatar).catch(() => { });
        // 3. Refresh local cached state
        setProfileDbData(prev => ({
          ...prev,
          nickname: cleanNick,
          avatar: editAvatar,
          avatar_url: editAvatar
        }));
        // Trigger background cloud sync
        syncWithCloud(user).catch(console.error);
      } else {
        // Save to local guest storage
        localStorage.setItem("user_nickname", cleanNick);
        localStorage.setItem("user_avatar", editAvatar);
      }
      setShowEditProfile(false);
    } catch (e) {
      alert(e.message || "Failed to update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="page fade-in-up">
      <style>{GLOBAL_STYLES}</style>

      {/* ── Floating Profile Header — portaled to body, visible ONLY on /profile ── */}
      {location.pathname === '/profile' && createPortal(
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        maxWidth: 480,
        marginLeft: 'auto',
        marginRight: 'auto',
        /* ── Glassmorphism ── */
        background: 'rgba(16,16,20,0.55)',
        backdropFilter: 'blur(48px) saturate(200%)',
        WebkitBackdropFilter: 'blur(48px) saturate(200%)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 32px rgba(0,0,0,0.3)',
        paddingTop:    'calc(var(--sat, 0px) + 14px)',
        paddingBottom: 12,
        paddingLeft:   16,
        paddingRight:  16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Avatar */}
          <div onClick={openEditModal} style={{
            width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
            background: getAvatarBackground(avatar),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2.5px solid rgba(255,255,255,0.12)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            cursor: 'pointer', position: 'relative', overflow: 'hidden',
          }}>
            {renderAvatarContent(avatar, displayName)}
          </div>

          {/* Name & status */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.025em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayName}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: user ? '#10b981' : '#6b7280', flexShrink: 0 }} />
              {user ? 'Cloud Synced Member' : 'Local Guest Mode'}
            </div>
          </div>

          {/* Edit button */}
          <button
            onClick={openEditModal}
            style={{
              width: 36, height: 36, borderRadius: 11,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0,
              transition: 'background 0.18s',
            }}
            onTouchStart={e => e.currentTarget.style.background = 'rgba(255,255,255,0.13)'}
            onTouchEnd={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'rgba(255,255,255,0.45)' }}>
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        </div>
      </div>,
      document.body
      )}

      {/* ── Scrollable content — paddingTop accounts for fixed header height ── */}
      {/*   Header: var(--sat) + 10px top + 46px avatar + 12px bottom = ~68px + sat  */}
      <div style={{
        paddingTop:    'calc(var(--sat, 0px) + 80px)',
        paddingLeft:   16,
        paddingRight:  16,
        paddingBottom: 12,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 'calc(100vh - var(--nav-height) - 40px - env(safe-area-inset-bottom))',
        boxSizing: 'border-box',
      }}>



        {/* Cloud banner / status */}
        {!user ? (
          <div style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(99,102,241,0.05))",
            border: "1px solid rgba(124,58,237,0.18)", borderRadius: 16,
            padding: "14px", marginBottom: 14, textAlign: "center",
          }}>
            <h4 style={{ margin: "0 0 5px 0", fontSize: 13, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Cloud size={14} color="var(--accent)" /> Backup & Sync
            </h4>
            <p style={{ margin: "0 0 12px 0", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>
              Keep your watchlist and progress safe across devices.
            </p>
            <button onClick={() => navigate('/auth', { state: { mode: 'login' } })} style={{
              background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 65%, #818cf8))",
              color: "#fff", border: "none", borderRadius: 10, padding: "10px 0",
              fontSize: 13, fontWeight: 800, cursor: "pointer", width: "100%",
              boxShadow: "0 4px 18px -3px var(--accent)",
            }}>Sign Up / Log In</button>
          </div>
        ) : (
          <div style={{
            background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.16)",
            borderRadius: 14, padding: "10px 14px", marginBottom: 14,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(56,189,248,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Cloud size={14} color="#38bdf8" />
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", display: "block" }}>Cloud Active</span>
                <span style={{ fontSize: 10, color: "#38bdf8" }}>{user.email}</span>
              </div>
            </div>
            <button
              disabled={syncing}
              onClick={handleManualSync}
              className="btn-press-anim"
              style={{
                background: syncing ? "rgba(56,189,248,0.15)" : "rgba(56,189,248,0.1)",
                border: syncing ? "1px solid rgba(56,189,248,0.4)" : "1px solid rgba(56,189,248,0.22)",
                borderRadius: 10, padding: "6px 13px", fontSize: 11,
                color: "#38bdf8", fontWeight: 700, cursor: syncing ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: syncing ? "0 0 16px rgba(56,189,248,0.35)" : "none",
                transition: "all 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
              }}
            >
              <RefreshCw
                size={12}
                color="#38bdf8"
                style={{
                  animation: syncing ? "spinSlow 0.75s linear infinite" : "none",
                  flexShrink: 0
                }}
              />
              <span>{syncing ? "Syncing..." : "Sync"}</span>
            </button>
          </div>
        )}

        {/* Stats — 3 cards: My List · Favorites · History */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { icon: Bookmark, label: 'My List', value: wlCount, to: '/mylist', color: '#818cf8' },
            { icon: Heart, label: 'Favorites', value: favCount, to: '/favorites', color: '#f43f5e' },
            { icon: Clock, label: 'History', value: historyCount, to: '/history', color: '#38bdf8' },
          ].map(s => (
            <div key={s.label} onClick={() => navigate(s.to)} className="btn-press-anim" style={{
              background: 'linear-gradient(145deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
              borderRadius: 16,
              padding: '14px 6px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
              cursor: 'pointer', border: '1px solid rgba(255,255,255,0.07)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.05)',
              transition: 'transform 0.15s',
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 11,
                background: `${s.color}18`,
                border: `1px solid ${s.color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <s.icon size={17} color={s.color} />
              </div>
              <span style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.05em', color: 'var(--text-primary)' }}>{s.value}</span>
              <span style={{ fontSize: 9.5, color: 'var(--text-muted)', fontWeight: 700, textAlign: 'center', letterSpacing: '0.02em' }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Menu list — with press animation feedback */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          {MENU.map((item, i) => (
            <button key={item.label} id={`profile-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={item.action}
              className="btn-press-anim"
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                background: i === 0
                  ? "linear-gradient(135deg, rgba(124,58,237,0.14), rgba(99,102,241,0.07))"
                  : "linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018))",
                borderRadius: 15,
                border: i === 0 ? "1px solid rgba(124,58,237,0.22)" : "1px solid rgba(255,255,255,0.07)",
                cursor: "pointer", textAlign: "left",
                boxShadow: "0 2px 10px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: `${item.color || "#fff"}18`,
                border: `1px solid ${item.color || "#fff"}2a`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <item.icon size={16} color={item.color || "var(--text-secondary)"} />
              </div>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: item.color || "var(--text-primary)", letterSpacing: "-0.01em" }}>
                {item.label}
              </span>
              <ChevronRight size={15} color="rgba(255,255,255,0.18)" />
            </button>
          ))}
        </div>

        {/* Version & attribution pushed to the bottom */}
        <div onClick={handleVersionTap} style={{
          textAlign: "center",
          marginTop: "auto",
          paddingTop: "16px",
          color: "var(--text-muted)",
          fontSize: 11,
          cursor: "pointer",
          userSelect: "none",
          lineHeight: 1.8
        }}>
          AniPlay v{appVersion} {localStorage.getItem("anilab_test_updates") === "true" && "· Beta Test"}
          <br /><span style={{ opacity: 0.45 }}>Made with ❤ for anime fans</span>
        </div>
      </div>

      {/* Smooth Fullscreen Glassmorphic Logout Overlay */}
      {isLoggingOut && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999999,
          background: "rgba(10, 10, 15, 0.88)",
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, animation: "fadeInOverlay 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards"
        }}>
          <LoadingWheel size={56} text="Logging Out Safely..." />
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500, marginTop: -8 }}>
            Syncing local progress & ending session
          </div>
        </div>
      )}

      {showReleaseNotes && (
        <Modal title="What's New in v1.5.6" onClose={() => setShowReleaseNotes(false)}>
          <div style={{ maxHeight: "65vh", overflowY: "auto", paddingRight: 4, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ textAlign: "center", paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--accent)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                Grand Release · Ultra-Stability Update
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                Version 1.5.6 · The Most Stable AniPlay Ever
              </div>
            </div>

            {[
              {
                icon: "🛡️",
                title: "Anti-Random-Anime Shield",
                desc: "Strict 60%+ significant keyword coverage eliminates wrong anime or random titles when streaming or downloading DUB."
              },
              {
                icon: "🧊",
                title: "Silent Video Freeze Watchdog",
                desc: "Auto-detects GPU hardware decoder stalls where picture froze while sound continued, instantly recovering playback without interruption."
              },
              {
                icon: "📺",
                title: "Adaptive Low-Network Engine",
                desc: "Intelligent YouTube & Netflix inspired stream loader automatically falls back to lower resolutions on slow networks for instant startup."
              },
              {
                icon: "⚡",
                title: "Mega-Series 1000+ Ep Acceleration",
                desc: "Direct provider ID mapping and cached episode manifests enable sub-second episode jumping for giant anime like One Piece."
              },
              {
                icon: "🎧",
                title: "Unified DUB Availability Parity",
                desc: "Dynamic 3-state DUB discovery ensures download drawers and player controls reflect genuine DUB availability with auto-fallback."
              },
              {
                icon: "📅",
                title: "Airing Episode Synchronizer",
                desc: "Strict global airing validation prevents unreleased future episodes or unreleased sequel seasons from triggering scraper errors."
              },
              {
                icon: "✨",
                title: "120Hz Fluid Animations & Persistence",
                desc: "Seamless fullscreen orientation persistence when switching episodes and ultra-smooth glassmorphic transitions."
              }
            ].map((item, idx) => (
              <div key={idx} style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
                padding: "10px 12px",
                display: "flex",
                gap: 10,
                alignItems: "flex-start"
              }}>
                <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>{item.icon}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{item.title}</span>
                  <span style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{item.desc}</span>
                </div>
              </div>
            ))}

            <button
              onClick={() => setShowReleaseNotes(false)}
              className="btn-press-anim"
              style={{
                background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 65%, #818cf8))",
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "11px 0",
                fontSize: 13,
                fontWeight: 800,
                cursor: "pointer",
                marginTop: 4,
                width: "100%",
                boxShadow: "0 4px 18px -3px var(--accent)"
              }}
            >
              Got it!
            </button>
          </div>
        </Modal>
      )}

      {showAbout && (
        <Modal title="About AniPlay" onClose={() => setShowAbout(false)}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", padding: "8px 0" }}>
            <div style={{ width: 68, height: 68, borderRadius: 18, background: "linear-gradient(135deg,#818cf8,#a78bfa)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 28px rgba(129,140,248,0.4)" }}>
              <Play size={28} fill="white" color="white" />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-0.02em" }}>AniPlay</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Version {appVersion}</div>
            </div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.75, maxWidth: 300, margin: 0 }}>
              A modern anime streaming app. Watch favorites in HD, track your progress, and discover new series.
            </p>
            <div style={{ fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, width: "100%" }}>
              Made with love for anime fans 🌸
            </div>
          </div>
        </Modal>
      )}

      {showPrivacy && (
        <Modal title="Privacy Policy" onClose={() => setShowPrivacy(false)}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.8, maxHeight: "60vh", overflowY: "auto" }}>
            <p><b>Data We Collect</b><br />AniPlay stores your watchlist, favorites, and progress locally. No personal data is sent externally.</p>
            <p><b>Local Storage</b><br />All preferences use device storage. Clearing app data removes this.</p>
            <p><b>Streaming Content</b><br />AniPlay aggregates publicly available anime streams. We do not host content directly.</p>
            <p><b>Third-Party Services</b><br />We use the AniList API for metadata. Their privacy policy applies.</p>
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Last updated: August 2026</p>
          </div>
        </Modal>
      )}

      {showSignOut && (
        <Modal title="Clear Cache & Reset" onClose={() => setShowSignOut(false)}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <AlertTriangle size={28} color="#ef4444" />
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 20 }}>
              This will permanently clear your <b>watchlist</b>, <b>favorites</b>, and <b>progress</b>. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowSignOut(false)} className="btn-press-anim" style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSignOut} className="btn-press-anim" style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 16px rgba(239,68,68,0.3)" }}>Clear & Reset</button>
            </div>
          </div>
        </Modal>
      )}

      {showCloudLogOut && (
        <Modal title="Log Out from Cloud" onClose={() => setShowCloudLogOut(false)}>
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(56,189,248,0.1)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Cloud size={28} color="#38bdf8" />
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 20 }}>
              Sign out from cloud sync? Your local data stays safe on this device.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowCloudLogOut(false)} className="btn-press-anim" style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleCloudLogOut} className="btn-press-anim" style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#38bdf8,#0ea5e9)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 16px rgba(56,189,248,0.3)" }}>Log Out</button>
            </div>
          </div>
        </Modal>
      )}

      {showEditProfile && (
        <Modal title="Edit Profile" onClose={() => setShowEditProfile(false)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "6px 0 0" }}>
            {/* Avatar preview & change overlay */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 80, height: 80, borderRadius: "50%",
                background: getAvatarBackground(editAvatar),
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "3px solid rgba(255,255,255,0.12)",
                boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
                position: "relative", overflow: "hidden",
              }}>
                {renderAvatarContent(editAvatar, editNickname)}
              </div>
              <label style={{
                background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                color: "#fff", borderRadius: 8, padding: "5px 12px",
                fontSize: 11, fontWeight: 700, cursor: "pointer", display: "inline-flex",
                alignItems: "center", gap: 4, transition: "background 0.2s",
              }}
                onTouchStart={e => e.currentTarget.style.background = "rgba(255,255,255,0.15)"}
                onTouchEnd={e => e.currentTarget.style.background = "rgba(255,255,255,0.08)"}
              >
                <Camera size={12} /> Upload Custom Photo
                <input
                  type="file" accept="image/*" style={{ display: "none" }}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    if (file) compressAvatar(file, setEditAvatar);
                  }}
                />
              </label>
            </div>

            {/* Presets grid */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Avatar Gradients</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
                {Object.keys(AVATAR_PRESETS).map(key => (
                  <div
                    key={key}
                    onClick={() => setEditAvatar(key)}
                    style={{
                      aspectRatio: "1/1", borderRadius: "50%",
                      background: AVATAR_PRESETS[key],
                      cursor: "pointer", transition: "all 0.2s",
                      border: editAvatar === key ? "3.5px solid #fff" : "2px solid rgba(255,255,255,0.08)",
                      boxShadow: editAvatar === key ? `0 0 10px var(--accent)` : "none",
                      transform: editAvatar === key ? "scale(1.12)" : "scale(1)",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Nickname input */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Nickname</div>
              <input
                type="text"
                value={editNickname}
                onChange={e => setEditNickname(e.target.value)}
                maxLength={20}
                placeholder="Enter nickname..."
                style={{
                  width: "100%", background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12,
                  padding: "12px 14px", color: "#fff", fontSize: 14, fontWeight: 600,
                  outline: "none", boxSizing: "border-box", transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = "var(--accent)"}
                onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
              />
            </div>

            {/* Modal Actions */}
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button
                disabled={savingProfile}
                onClick={() => setShowEditProfile(false)}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)",
                  color: "var(--text-primary)", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                disabled={savingProfile}
                onClick={saveProfile}
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, #818cf8))",
                  color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer",
                  boxShadow: "0 4px 16px rgba(124,58,237,0.3)",
                }}
              >
                {savingProfile ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
