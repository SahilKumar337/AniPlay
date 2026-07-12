import React, { useState, useRef, useEffect } from "react";
import {
  User, Info, Shield, LogOut, ChevronRight, Heart, Bookmark, Clock,
  Save, Check, X, AlertTriangle, Cloud, CloudLightning,
  Play, SkipForward, Server, Moon, Palette, LayoutGrid,
  Type, Sliders, Captions, Download, Upload,
  Settings, ChevronDown, Camera,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { useNavigate } from "react-router-dom";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import AuthModal from "../components/AuthModal";
import { cloudSignOut, supabase } from "../api/supabase";

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
  return <span style={{ fontWeight: 800, fontSize: 36, color: "#fff" }}>{initial}</span>;
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
      transition: "background 0.28s cubic-bezier(0.4,0,0.2,1)",
      boxShadow: value ? "0 0 16px -4px var(--accent)" : "inset 0 1px 3px rgba(0,0,0,0.3)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{
        position: "absolute", top: 4,
        left: value ? 24 : 4,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
        transition: "left 0.26s cubic-bezier(0.34,1.5,0.64,1)",
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

  const ACCENT_COLORS = [
    { value: "#7c3aed", label: "Violet" }, { value: "#e11d48", label: "Rose" },
    { value: "#0ea5e9", label: "Sky" },    { value: "#10b981", label: "Emerald" },
    { value: "#f59e0b", label: "Amber" },  { value: "#ec4899", label: "Pink" },
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
  const subSz    = settings.subtitleFontSize || "medium";
  const subOp    = settings.subtitleBgOpacity ?? 0.5;
  const subPos   = settings.subtitlePosition || "bottom";

  return (
    <div className="page" style={{ background: "var(--bg-primary)" }}>
      <style>{GLOBAL_STYLES}</style>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "16px 16px 16px",
        paddingTop: "max(32px, env(safe-area-inset-top))",
        background: "linear-gradient(to bottom, rgba(0,0,0,0.3), transparent)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        marginBottom: 4,
      }}>
        <button onClick={onBack} style={{
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
          color: "var(--text-primary)", cursor: "pointer",
          padding: "7px 14px", borderRadius: 10, fontSize: 13, fontWeight: 700,
          transition: "all 0.2s", flexShrink: 0,
        }}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 11,
            background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 65%, #818cf8))",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 4px 18px -3px var(--accent)",
          }}>
            <Settings size={17} color="#fff" />
          </div>
          <h2 style={{ fontSize: 19, fontWeight: 900, margin: 0, letterSpacing: "-0.025em" }}>App Settings</h2>
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
                { value: "auto", label: "Auto (Best)" },
                { value: "neko", label: "NekoHD" },
                { value: "waveshd", label: "WavesHD" },
                { value: "anikoto", label: "AniKoto" }
              ]} />
          </SettingRow>
        </SettingsCard>

        {/* 🎨 Appearance */}
        <SettingsCard title="Appearance" emoji="🎨" zIndex={9}>
          <SettingRow icon={Moon} label="Dark Mode" sub="Always-on dark theme for night watching" iconColor="#6366f1">
            <Toggle value={settings.darkMode} onChange={v => updateSettings({ darkMode: v })} />
          </SettingRow>
          <SettingRow icon={LayoutGrid} label="Compact Cards" sub="Smaller anime cards — more per row" iconColor="#14b8a6">
            <Toggle value={settings.compactCards} onChange={v => updateSettings({ compactCards: v })} />
          </SettingRow>
          <SettingRow icon={Palette} label="Accent Color" sub="Theme highlight applied across the app" iconColor={settings.accentColor} last>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 190 }}>
              {ACCENT_COLORS.map(c => (
                <div key={c.value} title={c.label} onClick={() => updateSettings({ accentColor: c.value })}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", background: c.value, cursor: "pointer", flexShrink: 0,
                    transition: "all 0.22s cubic-bezier(0.34,1.3,0.64,1)",
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
      </div>
    </div>
  );
}

/* ── Modal ───────────────────────────────────────────────────────────────── */
function Modal({ title, children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.82)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      padding: "0 16px calc(var(--nav-height) + env(safe-area-inset-bottom, 16px) + 16px) 16px",
    }} onClick={onClose}>
      <style>{GLOBAL_STYLES}</style>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 480,
        background: "linear-gradient(160deg, rgba(22,18,38,0.99), rgba(14,12,26,0.99))",
        borderRadius: "24px", padding: "22px 20px 24px",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 8px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)",
        animation: "slideUp 0.3s cubic-bezier(0.34,1.1,0.64,1)",
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
    </div>
  );
}

/* ── Main Profile ────────────────────────────────────────────────────────── */
export default function Profile() {
  const { watchlist, favorites, progress, user, syncWithCloud, showToast, flushSync } = useApp();
  const navigate = useNavigate();
  const [showSettings,    setShowSettings]    = useState(false);
  const [showAbout,       setShowAbout]       = useState(false);
  const [showPrivacy,     setShowPrivacy]     = useState(false);
  const [showSignOut,     setShowSignOut]     = useState(false);
  const [showCloudLogOut, setShowCloudLogOut] = useState(false);
  const [showAuthModal,   setShowAuthModal]   = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [appVersion,      setAppVersion]      = useState("1.0.0");
  const [devTaps,         setDevTaps]         = useState(0);
  const [syncing,         setSyncing]         = useState(false);

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

  useEffect(() => {
    const getVersion = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const v = await APKUpdater.getAppVersion();
          setAppVersion(v.versionName);
          if (v.packageName?.endsWith(".beta")) localStorage.setItem("anilab_test_updates", "true");
        } catch { try { const i = await CapApp.getInfo(); setAppVersion(i.version); } catch {} }
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

  const handleSignOut     = async () => {
    try { await flushSync(); } catch (e) { console.warn('[LogOut] flush failed:', e.message); }
    localStorage.clear(); sessionStorage.clear(); window.location.reload();
  };
  const handleCloudLogOut = async () => {
    try {
      await flushSync();
      await cloudSignOut();
      setShowCloudLogOut(false);
      window.location.reload();
    }
    catch (e) { alert(e.message || "Failed to log out"); }
  };

  if (showSettings) return <SettingsPanel onBack={() => setShowSettings(false)} />;

  const wlCount = Object.keys(watchlist).length;
  const favCount = Object.keys(favorites).length;
  const proCount = Object.keys(progress).length;

  const MENU = [
    { icon: Settings,      label: "Settings",            action: () => setShowSettings(true),     color: "var(--accent)" },
    { icon: Info,          label: "About AniPlay",       action: () => setShowAbout(true) },
    { icon: Shield,        label: "Privacy Policy",      action: () => setShowPrivacy(true) },
    user ? { icon: CloudLightning, label: "Log Out from Cloud", action: () => setShowCloudLogOut(true), color: "#38bdf8" } : null,
    { icon: LogOut,        label: "Clear Cache & Reset", action: () => setShowSignOut(true),      color: "#ef4444" },
  ].filter(Boolean);

  const displayName = user
    ? (user.user_metadata?.nickname || user.email.split("@")[0])
    : (localStorage.getItem("user_nickname") || "Anime Fan");

  const avatar = user
    ? (user.user_metadata?.avatar || "")
    : (localStorage.getItem("user_avatar") || "");

  // Pre-fill edit fields when editing modal opens
  const openEditModal = () => {
    setEditNickname(displayName);
    setEditAvatar(avatar);
    setShowEditProfile(true);
  };

  const saveProfile = async () => {
    if (!editNickname.trim()) return;
    setSavingProfile(true);
    try {
      if (user) {
        // Save to Supabase Cloud
        const { error } = await supabase.auth.updateUser({
          data: { nickname: editNickname.trim(), avatar: editAvatar }
        });
        if (error) throw error;
        // Trigger background sync
        syncWithCloud(user).catch(console.error);
      } else {
        // Save to local guest storage
        localStorage.setItem("user_nickname", editNickname.trim());
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
      <div style={{ padding: "24px 16px 16px" }}>

        {/* Avatar */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div onClick={openEditModal} style={{
            width: 86, height: 86, borderRadius: "50%",
            background: getAvatarBackground(avatar),
            display: "flex", alignItems: "center", justifyContent: "center",
            border: "3px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 36px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.04)",
            cursor: "pointer", position: "relative",
            overflow: "hidden",
          }}>
            {renderAvatarContent(avatar, displayName)}
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0, transition: "opacity 0.2s",
            }}
            className="avatar-hover-overlay"
            onTouchStart={e => e.currentTarget.style.opacity = 1}
            onTouchEnd={e => e.currentTarget.style.opacity = 0}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0}
            >
              <Camera size={20} color="#fff" />
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div onClick={openEditModal} style={{ fontSize: 21, fontWeight: 900, letterSpacing: "-0.02em", cursor: "pointer", display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
              {displayName}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: user ? "#10b981" : "#6b7280" }} />
              {user ? "Cloud Synced Member" : "Local Guest Mode"}
            </div>
          </div>
        </div>

        {/* Cloud banner / status */}
        {!user ? (
          <div style={{
            background: "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(99,102,241,0.05))",
            border: "1px solid rgba(124,58,237,0.18)", borderRadius: 20,
            padding: "18px", marginBottom: 22, textAlign: "center",
          }}>
            <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 800, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Cloud size={15} color="var(--accent)" /> Backup & Sync
            </h4>
            <p style={{ margin: "0 0 14px 0", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
              Keep your watchlist and progress safe across devices.
            </p>
            <button onClick={() => setShowAuthModal(true)} style={{
              background: "linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 65%, #818cf8))",
              color: "#fff", border: "none", borderRadius: 12, padding: "11px 0",
              fontSize: 13, fontWeight: 800, cursor: "pointer", width: "100%",
              boxShadow: "0 4px 18px -3px var(--accent)",
            }}>Sign Up / Log In</button>
          </div>
        ) : (
          <div style={{
            background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.16)",
            borderRadius: 18, padding: "12px 16px", marginBottom: 22,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(56,189,248,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Cloud size={16} color="#38bdf8" />
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", display: "block" }}>Cloud Active</span>
                <span style={{ fontSize: 10, color: "#38bdf8" }}>{user.email}</span>
              </div>
            </div>
            <button
              disabled={syncing}
              onClick={handleManualSync}
              style={{
                background: syncing ? "rgba(255,255,255,0.05)" : "rgba(56,189,248,0.1)",
                border: syncing ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(56,189,248,0.22)",
                borderRadius: 10, padding: "6px 12px", fontSize: 11,
                color: syncing ? "var(--text-muted)" : "#38bdf8",
                fontWeight: 700, cursor: syncing ? "not-allowed" : "pointer",
              }}
            >
              {syncing ? "Syncing..." : "Sync"}
            </button>
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 22 }}>
          {[
            { icon: Bookmark, label: "My List",   value: wlCount,  to: "/mylist",    color: "#818cf8" },
            { icon: Heart,    label: "Favorites", value: favCount, to: "/favorites", color: "#f43f5e" },
            { icon: Clock,    label: "Watched",   value: proCount, to: "/watched",   color: "#10b981" },
          ].map(s => (
            <div key={s.label} onClick={() => navigate(s.to)} style={{
              background: "linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018))",
              borderRadius: 18, padding: "14px 8px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              cursor: "pointer", border: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "0 2px 16px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.05)",
              transition: "transform 0.18s",
            }}
            onTouchStart={e => e.currentTarget.style.transform = "scale(0.96)"}
            onTouchEnd={e => e.currentTarget.style.transform = "scale(1)"}
            >
              <s.icon size={20} color={s.color} />
              <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: "-0.04em" }}>{s.value}</span>
              <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600 }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Menu list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {MENU.map((item, i) => (
            <button key={item.label} id={`profile-menu-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
              onClick={item.action}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                background: i === 0
                  ? "linear-gradient(135deg, rgba(124,58,237,0.14), rgba(99,102,241,0.07))"
                  : "linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.018))",
                borderRadius: 18,
                border: i === 0 ? "1px solid rgba(124,58,237,0.22)" : "1px solid rgba(255,255,255,0.07)",
                cursor: "pointer", textAlign: "left",
                boxShadow: "0 2px 14px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.05)",
                transition: "all 0.2s",
              }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: 11,
                background: `${item.color || "#fff"}18`,
                border: `1px solid ${item.color || "#fff"}2a`,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <item.icon size={18} color={item.color || "var(--text-secondary)"} />
              </div>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: item.color || "var(--text-primary)", letterSpacing: "-0.01em" }}>
                {item.label}
              </span>
              <ChevronRight size={16} color="rgba(255,255,255,0.18)" />
            </button>
          ))}
        </div>

        <div onClick={handleVersionTap} style={{ textAlign: "center", marginTop: 30, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", userSelect: "none", lineHeight: 1.8 }}>
          AniPlay v{appVersion} {localStorage.getItem("anilab_test_updates") === "true" && "· Beta Test"}
          <br /><span style={{ opacity: 0.45 }}>Made with ❤ for anime fans</span>
        </div>
      </div>

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
              A premium anime streaming app. Watch favorites in HD, track your progress, and discover new series.
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
            <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Last updated: July 2025</p>
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
              <button onClick={() => setShowSignOut(false)} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleSignOut} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 16px rgba(239,68,68,0.3)" }}>Clear & Reset</button>
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
              <button onClick={() => setShowCloudLogOut(false)} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={handleCloudLogOut} style={{ flex: 1, padding: "12px 0", borderRadius: 12, border: "none", background: "linear-gradient(135deg,#38bdf8,#0ea5e9)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 4px 16px rgba(56,189,248,0.3)" }}>Log Out</button>
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

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
}
