import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import './Landing.css';

gsap.registerPlugin(ScrollTrigger);

// ─── Particle Canvas (fixed background) ──────────────────────────────────────
function ParticleCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    let raf;
    const pts = Array.from({ length: 180 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.4 + 0.3,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      hue: 270 + Math.random() * 90,
      a: Math.random() * 0.6 + 0.1,
    }));
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pts.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `hsla(${p.hue},100%,70%,${p.a})`);
        g.addColorStop(1, `hsla(${p.hue},100%,70%,0)`);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="ap-particle-bg" />;
}

// ─── Phone Mockup with switchable screens ─────────────────────────────────────
function PhoneMockup({ screen }) {
  const screens = {
    home: (
      <div className="phone-screen-home">
        <div className="ps-header">
          <span className="ps-logo">▶ AniPlay</span>
          <div className="ps-icons"><span>🔍</span><span>🔔</span></div>
        </div>
        <div className="ps-hero-banner">
          <div className="ps-hero-tags">
            <span className="ps-tag red">ADVENTURE</span>
            <span className="ps-tag red">DRAMA</span>
            <span className="ps-tag gold">★ 8.4</span>
          </div>
          <div className="ps-hero-title">Mushoku Tensei: Jobless Reincarnation Season 3</div>
          <div className="ps-hero-desc">The epic third season of the beloved Isekai saga.</div>
          <div className="ps-hero-btns">
            <button className="ps-play-btn">▶ Play</button>
            <button className="ps-plus-btn">+</button>
          </div>
        </div>
        <div className="ps-section-label">Continue Watching</div>
        <div className="ps-cw-row">
          <div className="ps-cw-card" style={{ background: 'linear-gradient(135deg,#3b82f6,#1e1b4b)' }}>
            <div className="ps-cw-bar" style={{ width: '68%' }} />
            <span>Tomb Raider King</span>
          </div>
          <div className="ps-cw-card" style={{ background: 'linear-gradient(135deg,#ec4899,#4c0519)' }}>
            <div className="ps-cw-bar" style={{ width: '42%' }} />
            <span>Exiled Knight...</span>
          </div>
          <div className="ps-cw-card" style={{ background: 'linear-gradient(135deg,#a855f7,#2e1065)' }}>
            <div className="ps-cw-bar" style={{ width: '15%' }} />
            <span>JJK</span>
          </div>
        </div>
      </div>
    ),
    detail: (
      <div className="phone-screen-detail">
        <div className="pd-back">← Back</div>
        <div className="pd-banner">
          <div className="pd-banner-badge">4K ULTRA HD</div>
          <div className="pd-banner-glow" />
        </div>
        <div className="pd-title">The Exiled Heavy Knight Knows How to Game the System</div>
        <div className="pd-meta">
          <span className="pd-star">★ 6.7</span>
          <span>2026</span>
          <span className="pd-badge">PG-13</span>
          <span className="pd-badge red">HD</span>
          <span>26 eps</span>
        </div>
        <div className="pd-btns">
          <button className="ps-play-btn">▶ Play</button>
          <button className="pd-dl-btn">📥 Downloads</button>
          <button className="pd-heart">♥</button>
        </div>
        <div className="pd-genre">Action, Fantasy · Studio: GoHands</div>
        <div className="pd-tabs">
          <span className="pd-tab active">Episodes (26)</span>
          <span className="pd-tab">More like this</span>
        </div>
        <div className="pd-ep-row">
          {[1,2,3,4,5,6].map(n => <span key={n} className={`pd-ep ${n===1?'active':''}`}>EP {n}</span>)}
        </div>
      </div>
    ),
    schedule: (
      <div className="phone-screen-schedule">
        <div className="ps-header">
          <div>
            <div className="ps-logo">Schedule</div>
            <div className="ps-sub">AIRING CALENDAR</div>
          </div>
          <div className="ps-icons"><span>🔔</span><span>🔍</span></div>
        </div>
        <div className="psc-days">
          {['Fri 28','Sat 29','Sun 30','Mon 31','Tue 1'].map((d,i) => (
            <div key={i} className={`psc-day ${i===0?'active':''}`}>{d}</div>
          ))}
        </div>
        <div className="psc-items">
          {[
            { time:'08:00', title:'Link Click Season 3 (ONA)', ep:'Episode 4', color:'#3b82f6', inList:false },
            { time:'09:00', title:'Crowned in a Hundred Days', ep:'Episode 20', color:'#ec4899', inList:true },
            { time:'15:00', title:'Pokémon Horizons: The Series', ep:'Episode 147', color:'#10b981', inList:false },
            { time:'19:00', title:'I Became a Legend After...', ep:'Episode 9', color:'#f59e0b', inList:false },
          ].map((item,i) => (
            <div key={i} className="psc-row">
              <span className="psc-time">{item.time}</span>
              <div className={`psc-card ${item.inList?'in-list':''}`}>
                <div className="psc-thumb" style={{ background: item.color }} />
                <div className="psc-info">
                  <div className="psc-title">{item.title}</div>
                  <div className="psc-ep">{item.ep}</div>
                  <span className={item.inList ? 'psc-btn-in':'psc-btn-add'}>{item.inList?'✓ In List':'+ My List'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    ),
    list: (
      <div className="phone-screen-list">
        <div className="psl-header">
          <span className="psl-icon">🔖</span>
          <div>
            <div className="psl-title">My List</div>
            <div className="psl-sub">Your personal anime collection</div>
          </div>
          <span className="psl-count">● 11</span>
        </div>
        <div className="psl-filters">
          {['All 11','Watching 3','Plan 7','Done'].map((f,i)=>(
            <span key={i} className={`psl-filter ${i===0?'active':''}`}>{f}</span>
          ))}
        </div>
        <div className="psl-grid">
          {[
            { label:'Bakemonogatari', status:'WATCHING', c:'#6366f1,#312e81' },
            { label:'Holo no Graffiti', status:'PLAN', c:'#ec4899,#831843' },
            { label:'Jujutsu Kaisen 0', status:'DONE', c:'#06b6d4,#164e63' },
            { label:'Youjo Senki II', status:'WATCHING', c:'#10b981,#064e3b' },
            { label:'Tenkousaki...', status:'PLAN', c:'#f59e0b,#78350f' },
            { label:'Tsuihou Sareta...', status:'PLAN', c:'#a855f7,#581c87' },
          ].map((a,i) => (
            <div key={i} className="psl-card">
              <div className="psl-thumb" style={{ background:`linear-gradient(135deg,${a.c})` }} />
              <div className="psl-name">{a.label}</div>
              <span className={`psl-status ${a.status.toLowerCase()}`}>{a.status}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  };
  return (
    <div className="phone-mockup-wrapper">
      <div className="phone-frame">
        <div className="phone-notch" />
        <div className="phone-screen-body">
          <div className={`phone-screen-content ps-${screen}`} key={screen}>
            {screens[screen]}
          </div>
        </div>
        <div className="phone-home-pill" />
        <div className="phone-ambient" />
      </div>
    </div>
  );
}

// ─── Chapter data ─────────────────────────────────────────────────────────────
const CHAPTERS = [
  {
    screen: 'home',
    eyebrow: '01 — DISCOVERY',
    headline: 'Your entire\nAnime Universe.',
    sub: '10,000+ series and movies curated into a beautiful, personalized home feed. Trending. Seasonal. New drops. All instant.',
    accent: '#ff2e63',
  },
  {
    screen: 'detail',
    eyebrow: '02 — CINEMA',
    headline: '4K Streaming.\nZero Compromise.',
    sub: 'Multi-source failover means no dead links. Ever. Sub/Dub toggling, fast downloads, and episode tracking built-in.',
    accent: '#7c3aed',
  },
  {
    screen: 'schedule',
    eyebrow: '03 — LIVE SCHEDULE',
    headline: 'Never miss\na single drop.',
    sub: 'Synced with Tokyo broadcast stations in real-time. Push notifications fire the moment a new episode airs.',
    accent: '#10b981',
  },
  {
    screen: 'list',
    eyebrow: '04 — YOUR VAULT',
    headline: 'Your collection.\nPerfectly organized.',
    sub: 'Watching, Plan to Watch, Completed — your list is your identity. Synced, backed up, always with you.',
    accent: '#f59e0b',
  },
];

// ─── Feature cards data ────────────────────────────────────────────────────────
const FEATURES = [
  { icon:'⚡', title:'Lightning Fast', desc:'Six fallback scrapers ensure zero dead links. HLS native player at 60 FPS.' },
  { icon:'🔊', title:'Sub & Dub', desc:'Switch between Japanese sub and English dub with one tap, even mid-episode.' },
  { icon:'📥', title:'Offline Downloads', desc:'Download episodes natively to device storage. Watch anywhere, anytime.' },
  { icon:'🔔', title:'Push Alerts', desc:'Real-time push notification when new episodes air from your list.' },
  { icon:'🎨', title:'Personalized', desc:'Custom accent colors, dark/light mode, and a beautiful adaptive UI.' },
  { icon:'🛡', title:'No Ads. Ever.', desc:'100% free, 100% ad-free. No account required to start watching.' },
];

// ─── Main Landing ─────────────────────────────────────────────────────────────
export default function Landing() {
  const rootRef = useRef(null);
  const heroRef = useRef(null);
  const pinSectionRef = useRef(null);
  const phoneRef = useRef(null);
  const textColRef = useRef(null);
  const [activeChapter, setActiveChapter] = useState(0);
  const chapterRef = useRef(0);

  useEffect(() => {
    // ── Lenis smooth scroll ──
    const lenis = new Lenis({ duration: 1.3, easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(time => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {

      // ── HERO entrance ──
      const heroTL = gsap.timeline({ defaults: { ease: 'power4.out' } });
      heroTL
        .from('.ap-nav', { y: -80, opacity: 0, duration: 1, delay: 0.1 })
        .from('.hero-eyebrow', { y: 30, opacity: 0, duration: 0.8 }, '-=0.5')
        .from('.hero-word', { y: 120, opacity: 0, stagger: 0.12, duration: 1.1 }, '-=0.5')
        .from('.hero-sub-text', { y: 30, opacity: 0, duration: 0.8 }, '-=0.5')
        .from('.hero-cta-row', { y: 30, opacity: 0, duration: 0.7 }, '-=0.4')
        .from('.hero-scroll-cue', { opacity: 0, duration: 0.6 }, '-=0.2');

      // ── Hero parallax exit ──
      gsap.to(heroRef.current, {
        opacity: 0,
        y: -60,
        ease: 'none',
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'bottom 70%',
          end: 'bottom 20%',
          scrub: true,
        },
      });

      // ── PINNED PHONE SECTION — use sticky position, detect scroll progress ──
      const showcaseArea = document.querySelector('.ap-showcase-scroll-area');
      ScrollTrigger.create({
        trigger: showcaseArea,
        start: 'top top',
        end: 'bottom bottom',
        onUpdate: (self) => {
          const chapter = Math.min(
            CHAPTERS.length - 1,
            Math.floor(self.progress * CHAPTERS.length)
          );
          if (chapter !== chapterRef.current) {
            chapterRef.current = chapter;
            setActiveChapter(chapter);

            // Animate text out → in
            gsap.to('.chapter-eyebrow, .chapter-headline, .chapter-sub', {
              opacity: 0, y: -24, duration: 0.22, ease: 'power2.in',
              onComplete: () => {
                gsap.fromTo(
                  '.chapter-eyebrow, .chapter-headline, .chapter-sub',
                  { opacity: 0, y: 40 },
                  { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: 0.07 }
                );
              },
            });

            // Phone snap rotation per chapter
            const rotations = [8, -8, 6, -6];
            const scales = [1, 1.04, 0.97, 1.02];
            gsap.to(phoneRef.current, {
              rotateY: rotations[chapter],
              rotateX: chapter % 2 === 0 ? 2 : -2,
              scale: scales[chapter],
              duration: 0.8,
              ease: 'power3.out',
            });

            // Progress dots
            gsap.to('.progress-dot', { scale: 0.7, opacity: 0.35, duration: 0.3 });
            gsap.to(`.progress-dot:nth-child(${chapter + 1})`, { scale: 1.3, opacity: 1, duration: 0.4, ease: 'back.out' });
          }
        },
      });

      // Phone: initial float animation
      gsap.from(phoneRef.current, {
        y: 80,
        opacity: 0,
        scale: 0.85,
        rotateY: 25,
        duration: 1.2,
        ease: 'power4.out',
        scrollTrigger: {
          trigger: '.ap-showcase-scroll-area',
          start: 'top 90%',
          toggleActions: 'play none none reverse',
        },
      });

      // Phone: continuous idle float
      gsap.to(phoneRef.current, {
        y: '-=18',
        duration: 3.5,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1,
        delay: 1.5,
      });

      // ── Feature cards stagger ──
      gsap.utils.toArray('.feat-card').forEach((card, i) => {
        gsap.from(card, {
          y: 80,
          opacity: 0,
          scale: 0.9,
          rotateX: 15,
          duration: 0.9,
          delay: (i % 3) * 0.1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: card,
            start: 'top 88%',
            toggleActions: 'play none none none',
          },
        });
      });

      // ── Stats counter ──
      gsap.utils.toArray('.stat-num').forEach(el => {
        const end = parseInt(el.dataset.val);
        ScrollTrigger.create({
          trigger: el,
          start: 'top 85%',
          onEnter: () => {
            let cur = 0;
            const step = end / 60;
            const timer = setInterval(() => {
              cur = Math.min(end, cur + step);
              el.textContent = Math.floor(cur).toLocaleString() + (el.dataset.suffix || '');
              if (cur >= end) clearInterval(timer);
            }, 16);
          },
        });
      });

      // ── CTA section reveal ──
      gsap.from('.cta-inner-card', {
        scale: 0.88,
        opacity: 0,
        y: 60,
        duration: 1.1,
        ease: 'power4.out',
        scrollTrigger: {
          trigger: '.cta-inner-card',
          start: 'top 80%',
        },
      });

    }, rootRef);

    return () => { ctx.revert(); lenis.destroy(); };
  }, []);

  const ch = CHAPTERS[activeChapter];

  return (
    <div ref={rootRef} className="ap-root">
      <ParticleCanvas />

      {/* Ambient orbs */}
      <div className="ap-orb ap-orb-1" />
      <div className="ap-orb ap-orb-2" />
      <div className="ap-orb ap-orb-3" />

      {/* ════════════════════ NAVIGATION ════════════════════ */}
      <nav className="ap-nav">
        <div className="ap-nav-inner">
          <a href="/landing" className="ap-nav-logo">
            <div className="ap-logo-box">▶</div>
            <div>
              <div className="ap-logo-name">AniPlay</div>
              <div className="ap-logo-tag">STREAM ENGINE</div>
            </div>
          </a>
          <div className="ap-nav-links">
            <a href="#showcase">Showcase</a>
            <a href="#features">Features</a>
            <a href="#download">Download</a>
          </div>
          <a href="/AniPlay.apk" download className="ap-nav-cta">
            Download APK
          </a>
        </div>
      </nav>

      {/* ════════════════════ HERO ════════════════════ */}
      <section ref={heroRef} className="ap-hero" id="hero">
        <div className="ap-hero-inner">
          <div className="hero-eyebrow">
            <span className="eyebrow-dot" />
            The Premium Anime Streaming Experience
          </div>
          <h1 className="ap-hero-headline">
            <span className="hero-word grad-red">Watch.</span>
            <span className="hero-word"> Discover.</span>
            <span className="hero-word grad-cyan"> Obsess.</span>
          </h1>
          <p className="hero-sub-text">
            10,000+ anime titles. Zero ads. Zero buffering. <br />
            The streaming platform built for fans who refuse to compromise.
          </p>
          <div className="hero-cta-row">
            <a href="/AniPlay.apk" download className="btn-primary-hero">
              <span className="btn-icon-wrap">📥</span>
              <div>
                <div className="btn-eyebrow">FREE · NO SIGNUP REQUIRED</div>
                <div className="btn-label">Download Android APK</div>
              </div>
              <div className="btn-shimmer" />
            </a>
            <a href="/" className="btn-secondary-hero">Open Web App ↗</a>
          </div>
          <div className="hero-scroll-cue">
            <div className="scroll-mouse">
              <div className="scroll-dot" />
            </div>
            <span>Scroll to explore</span>
          </div>
        </div>
      </section>

      {/* ════════════════════ PINNED 3D PHONE SCROLL SECTION ════════════════════ */}
      {/* CSS sticky: section is sticky inside a 500vh scroll area */}
      <div className="ap-showcase-scroll-area" id="showcase">
        <section ref={pinSectionRef} className="ap-pin-section">
          {/* Left: chapter text */}
          <div ref={textColRef} className="pin-text-col">
            <div className="chapter-progress">
              {CHAPTERS.map((_, i) => (
                <div
                  key={i}
                  className={`progress-dot ${i === activeChapter ? 'active' : ''}`}
                  style={{ '--dot-color': CHAPTERS[i].accent }}
                />
              ))}
            </div>
            <div className="chapter-eyebrow" style={{ color: ch.accent }}>
              {ch.eyebrow}
            </div>
            <h2 className="chapter-headline">
              {ch.headline.split('\n').map((line, i) => (
                <span key={i} className="headline-line">{line}<br /></span>
              ))}
            </h2>
            <p className="chapter-sub">{ch.sub}</p>

            <div className="chapter-nav-btns">
              {CHAPTERS.map((c, i) => (
                <button
                  key={i}
                  className={`chapter-nav-btn ${i === activeChapter ? 'active' : ''}`}
                  style={{ '--btn-color': c.accent }}
                  onClick={() => {
                    // Scroll to the right position
                    const section = pinSectionRef.current;
                    const sectionTop = section.getBoundingClientRect().top + window.scrollY;
                    window.scrollTo({ top: sectionTop + (i / CHAPTERS.length) * window.innerHeight * CHAPTERS.length + 10, behavior: 'smooth' });
                  }}
                >
                  <span className="nav-btn-num">0{i + 1}</span>
                  <span>{c.eyebrow.split('— ')[1]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: 3D Phone */}
          <div className="pin-phone-col">
            <div className="phone-3d-stage">
              <div ref={phoneRef} className="phone-3d-transform">
                <PhoneMockup screen={ch.screen} />
              </div>
              {/* Floating UI chips around phone */}
              <div className="floating-chip chip-1" style={{ '--chip-color': ch.accent }}>
                <span className="chip-icon">⚡</span>
                <span>Multi-source HLS</span>
              </div>
              <div className="floating-chip chip-2" style={{ '--chip-color': ch.accent }}>
                <span className="chip-icon">🛡</span>
                <span>CF Bypass Active</span>
              </div>
              <div className="floating-chip chip-3" style={{ '--chip-color': ch.accent }}>
                <span className="chip-icon">🎯</span>
                <span>60 FPS Native</span>
              </div>
            </div>
          </div>
        </section>
      </div>
      {/* ════════════════════ STATS BAR ════════════════════ */}
      <section className="ap-stats-section">
        <div className="ap-stats-inner">
          {[
            { val: 10480, suffix: '+', label: 'Anime Titles' },
            { val: 500000, suffix: '+', label: 'Active Users' },
            { val: 40, suffix: '+', label: 'Genres' },
            { val: 99, suffix: '%', label: 'Uptime' },
          ].map((s, i) => (
            <div key={i} className="stat-item">
              <div className="stat-num" data-val={s.val} data-suffix={s.suffix}>0{s.suffix}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════════ FEATURES ════════════════════ */}
      <section className="ap-features-section" id="features">
        <div className="ap-section-header">
          <div className="section-eyebrow">✦ FEATURES</div>
          <h2 className="section-title">
            Built for fans<br />
            <span className="grad-red">who demand more.</span>
          </h2>
          <p className="section-sub">
            Every pixel, every millisecond, every detail — obsessively crafted.
          </p>
        </div>
        <div className="ap-feat-grid">
          {FEATURES.map((f, i) => (
            <div key={i} className="feat-card">
              <div className="feat-icon">{f.icon}</div>
              <h3 className="feat-title">{f.title}</h3>
              <p className="feat-desc">{f.desc}</p>
              <div className="feat-card-glow" />
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════════ QUOTE ════════════════════ */}
      <section className="ap-quote-section">
        <div className="ap-quote-inner">
          <div className="quote-mark">"</div>
          <blockquote className="ap-quote-text">
            Anime is the art of the impossible made emotionally real.<br />
            AniPlay puts that world in your pocket — instantly.
          </blockquote>
          <div className="quote-attr">— Crafted with 💜 for the anime community</div>
        </div>
      </section>

      {/* ════════════════════ DOWNLOAD CTA ════════════════════ */}
      <section className="ap-cta-section" id="download">
        <div className="cta-inner-card">
          <div className="cta-bg-glow" />
          <div className="cta-flag">🎌</div>
          <h2 className="cta-title">
            Your universe awaits.<br />
            <span className="grad-red">Start watching now.</span>
          </h2>
          <p className="cta-sub">Free. No ads. No account required. Just anime.</p>
          <div className="cta-btn-row">
            <a href="/AniPlay.apk" download className="btn-primary-hero lg">
              <span className="btn-icon-wrap">📥</span>
              <div>
                <div className="btn-eyebrow">ANDROID · FREE · v1.5.5</div>
                <div className="btn-label">Download APK</div>
              </div>
              <div className="btn-shimmer" />
            </a>
            <a href="/" className="btn-secondary-hero lg">Open Web App →</a>
          </div>
          <div className="cta-badges">
            <span>✓ Android 9+</span>
            <span>✓ 100% Free</span>
            <span>✓ Auto Updates</span>
            <span>✓ 60 FPS HLS</span>
          </div>
        </div>
      </section>

      {/* ════════════════════ FOOTER ════════════════════ */}
      <footer className="ap-footer">
        <div className="ap-footer-inner">
          <div className="footer-logo">
            <div className="ap-logo-box sm">▶</div>
            <div>
              <div className="ap-logo-name">AniPlay</div>
              <div className="ap-logo-tag">STREAM ENGINE</div>
            </div>
          </div>
          <div className="footer-links-col">
            <a href="#showcase">Showcase</a>
            <a href="#features">Features</a>
            <a href="/">Web App</a>
            <a href="/AniPlay.apk" download>Download APK</a>
          </div>
          <p className="footer-copy">© 2026 AniPlay. Made with 💜 for anime fans.<br />
            <span className="footer-tech">Built with React · Three.js · GSAP · Framer Motion · Lenis</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
