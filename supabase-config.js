;(function () {
  'use strict'

  // ┌───────────────────────────────────────────────────────────────────────────┐
  // │  FREE SETUP — takes 5 minutes                                             │
  // │  1. Go to https://supabase.com  → "Start your project" (free, no card)   │
  // │  2. Create a new project                                                  │
  // │  3. Settings → API → copy "Project URL" and "anon public" key below      │
  // └───────────────────────────────────────────────────────────────────────────┘
  const SUPABASE_URL  = 'https://twokhpqypztkerqzxnnx.supabase.co'
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3b2tocHF5cHp0a2VycXp4bm54Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTk4OTMsImV4cCI6MjA5NDkzNTg5M30.MmhZTimC0iqwiMDGWzq7EmiM53q2K3bMcTxHTVa6KzI'

  async function req(method, path, body, token) {
    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body !== undefined && method !== 'GET') opts.body = JSON.stringify(body)
    const r = await fetch(`${SUPABASE_URL}${path}`, opts)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.error_description || d.msg || d.message || `HTTP ${r.status}`)
    return d
  }

  async function dbReq(method, table, body, token, qs = '') {
    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON,
      Prefer: 'return=minimal',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const opts = { method, headers }
    if (body && method !== 'GET') opts.body = JSON.stringify(body)
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${qs}`, opts)
    if (method === 'GET') {
      if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.message || `DB ${r.status}`) }
      return r.json()
    }
    if (!r.ok) { const d = await r.json().catch(()=>({})); throw new Error(d.message || `DB ${r.status}`) }
    return true
  }

  window.SB = {
    // ── Auth ──────────────────────────────────────────────────────────────────
    signUp:         (email, pw, meta)       => req('POST', '/auth/v1/signup',                         { email, password: pw, data: meta || {} }),
    signIn:         (email, pw)             => req('POST', '/auth/v1/token?grant_type=password',      { email, password: pw }),
    signInPhone:    (phone, pw)             => req('POST', '/auth/v1/token?grant_type=password',      { phone, password: pw }),
    signOut:        (tok)                   => req('POST', '/auth/v1/logout',                         {}, tok),
    sendEmailOtp:   (email)                 => req('POST', '/auth/v1/otp',                            { email }),
    sendPhoneOtp:   (phone)                 => req('POST', '/auth/v1/otp',                            { phone }),
    verifyEmailOtp: (email, token, type)    => req('POST', '/auth/v1/verify',                         { type: type || 'email', email, token }),
    verifyPhoneOtp: (phone, token)          => req('POST', '/auth/v1/verify',                         { type: 'sms', phone, token }),
    getUser:        (tok)                   => req('GET',  '/auth/v1/user',                           undefined, tok),
    refresh:        (rt)                    => req('POST', '/auth/v1/token?grant_type=refresh_token', { refresh_token: rt }),
    resetPassword:  (email)                 => req('POST', '/auth/v1/recover',                       { email }),
    googleAuthUrl:  ()                      => `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(SUPABASE_URL + '/auth/v1/callback')}`,

    // ── Profiles table ────────────────────────────────────────────────────────
    upsertProfile:    (tok, p)  => dbReq('POST', 'profiles',      p,    tok),
    getProfile:       (tok, id) => dbReq('GET',  'profiles',      null, tok, `?id=eq.${id}&select=*`),
    checkUsername:    (name)    => dbReq('GET',  'profiles',      null, SUPABASE_ANON, `?username=eq.${encodeURIComponent(name)}&select=username`).then(r => Array.isArray(r) && r.length === 0),

    // ── Login history table ───────────────────────────────────────────────────
    addLoginLog:  (tok, entry) => dbReq('POST', 'login_history', entry, tok),
    getLoginLog:  (tok, uid)   => dbReq('GET',  'login_history', null, tok, `?user_id=eq.${uid}&order=created_at.desc&limit=5&select=*`),

    URL:  SUPABASE_URL,
    ANON: SUPABASE_ANON,
  }
})()
