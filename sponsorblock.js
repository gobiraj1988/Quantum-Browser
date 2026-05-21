'use strict'

// ═══════════════════════════════════════════════════════════════════════════════
//  sponsorblock.js — YouTube SponsorBlock integration
//
//  Fetches sponsor segment data from sponsor.ajay.app (free, no key required).
//  Fetch happens in the MAIN PROCESS using Electron's net module — this bypasses
//  YouTube's Content-Security-Policy so no blocked requests or CSP errors.
//
//  Skips: sponsor, selfpromo, interaction, intro, outro, preview, filler
//  Leaves video ads alone — those are handled by the Ghostery engine.
//  Does NOT modify the video player object — just seeks forward.
// ═══════════════════════════════════════════════════════════════════════════════

const { app, net } = require('electron')

const SB_API     = 'https://sponsor.ajay.app/api/skipSegments'
const CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler']

// ── Segment cache (per video ID, 30 min TTL) ──────────────────────────────────

const cache  = new Map()   // videoId → { ts, segments }
const CACHE_TTL = 30 * 60 * 1000

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractVideoId (url) {
  try {
    const u = new URL(url)
    return u.hostname.includes('youtube.com') ? (u.searchParams.get('v') || '') : ''
  } catch { return '' }
}

async function fetchSegments (videoId) {
  const hit = cache.get(videoId)
  if (hit && (Date.now() - hit.ts) < CACHE_TTL) return hit.segments

  try {
    const params = new URLSearchParams({
      videoID:    videoId,
      categories: JSON.stringify(CATEGORIES),
    })
    const res = await net.fetch(`${SB_API}?${params}`)
    if (res.status === 404) {              // no segments for this video
      cache.set(videoId, { ts: Date.now(), segments: [] })
      return []
    }
    if (!res.ok) return []
    const segments = await res.json()
    cache.set(videoId, { ts: Date.now(), segments })
    return segments
  } catch { return [] }
}

// ── Inject skip logic into the YouTube tab ────────────────────────────────────
// The script is built with the segment data baked in so the renderer never needs
// to make any external call.  A plain seek is all that happens.

function buildInjectScript (segments) {
  // Safety: JSON.stringify is safe here — segments come from our own API call
  const segJson = JSON.stringify(segments)
  return `;(function applySponsors(){
  'use strict';
  var segs=${segJson};
  if(!segs||!segs.length)return;

  function skipCheck(video){
    if(!video||video.paused)return;
    var t=video.currentTime;
    for(var i=0;i<segs.length;i++){
      var s=segs[i].segment;
      if(s&&t>=s[0]&&t<s[1]&&segs[i].actionType!=='mute'){
        video.currentTime=s[1];
        notify(segs[i].category);
        break;
      }
    }
  }

  function notify(cat){
    var n=document.getElementById('__sb_toast');
    if(!n){
      n=document.createElement('div');
      n.id='__sb_toast';
      Object.assign(n.style,{
        position:'fixed',bottom:'70px',right:'18px',
        background:'rgba(0,0,0,0.82)',color:'#fff',
        padding:'7px 14px',borderRadius:'6px',fontSize:'13px',
        fontFamily:'sans-serif',zIndex:'99999',pointerEvents:'none',
        transition:'opacity 0.35s',opacity:'0',
      });
      document.body&&document.body.appendChild(n);
    }
    n.textContent='SponsorBlock: skipped '+cat.replace(/([A-Z])/g,' $1').toLowerCase();
    n.style.opacity='1';
    clearTimeout(n.__t);
    n.__t=setTimeout(function(){n.style.opacity='0';},2200);
  }

  var video=document.querySelector('video');
  if(video&&!video.__sbBound){
    video.__sbBound=true;
    video.addEventListener('timeupdate',function(){skipCheck(this);},{passive:true});
  }
})();`
}

// ── Per-tab handling ──────────────────────────────────────────────────────────

async function handleUrl (wc, url) {
  const videoId = extractVideoId(url)
  if (!videoId) return

  const segments = await fetchSegments(videoId)
  if (!segments.length) return

  try {
    if (!wc.isDestroyed())
      await wc.executeJavaScript(buildInjectScript(segments))
  } catch (_) {}
}

// ── Public init ───────────────────────────────────────────────────────────────

let started = false

function init () {
  if (started) return
  started = true

  app.on('web-contents-created', (_, wc) => {
    // Full page load
    wc.on('dom-ready', () => {
      const url = wc.getURL()
      if (url.includes('youtube.com')) handleUrl(wc, url)
    })

    // SPA navigation — YouTube changes the URL without a full reload between videos
    wc.on('did-navigate-in-page', (_, url, isMainFrame) => {
      if (isMainFrame && url.includes('youtube.com')) handleUrl(wc, url)
    })
  })

  console.log('[SponsorBlock] Ready')
}

module.exports = { init }
