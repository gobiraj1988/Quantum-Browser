'use strict'
// Free AI providers — no user API key required. Auto-fallback in order.
;(function () {

// ── OPTIONAL: Groq free tier (fastest) ────────────────────────────────────────
// 1. Go to https://console.groq.com/keys  (free account, no credit card)
// 2. Create a key and paste it below
// 3. You get 14,400 free requests / day
// Leave empty to use Pollinations + HuggingFace only (still works great).
const GROQ_KEY = ''   // ← paste your free Groq key here (optional)

const PROVIDERS = [

  // ── 1. Pollinations AI (OpenAI-powered) — completely free, no key ever ─────
  {
    id:    'pollinations-openai',
    label: 'Pollinations AI',
    async call (messages) {
      const ctrl  = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 22000)
      try {
        const res = await fetch('https://text.pollinations.ai/', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            messages,
            model:   'openai',
            seed:    Math.floor(Math.random() * 99999),
            private: true,
          }),
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const text = await res.text()
        if (!text || text.length < 2) throw new Error('Empty response')
        return text.trim()
      } finally { clearTimeout(timer) }
    },
  },

  // ── 2. HuggingFace Inference — free (Mistral-7B, no key needed) ───────────
  {
    id:    'huggingface',
    label: 'HuggingFace AI',
    async call (messages) {
      // Build Mistral [INST] format
      const sys  = messages.find(m => m.role === 'system')?.content || ''
      const conv = messages.filter(m => m.role !== 'system')
      let prompt = sys ? '[INST] ' + sys + '\n\n' : '[INST] '
      conv.forEach((m, i) => {
        if (m.role === 'user')
          prompt += (i === 0 && sys) ? m.content + ' [/INST]' : '[INST] ' + m.content + ' [/INST]'
        else
          prompt += ' ' + m.content + ' </s>'
      })
      const ctrl  = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 35000)
      try {
        const res = await fetch(
          'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2',
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              inputs:     prompt,
              parameters: { max_new_tokens: 600, return_full_text: false, temperature: 0.7 },
            }),
            signal: ctrl.signal,
          }
        )
        if (res.status === 503) throw new Error('Model loading')
        if (!res.ok)            throw new Error('HTTP ' + res.status)
        const data = await res.json()
        if (Array.isArray(data) && data[0]?.generated_text)
          return data[0].generated_text.trim()
        if (data.error) throw new Error(data.error)
        throw new Error('Unexpected HF response')
      } finally { clearTimeout(timer) }
    },
  },

  // ── 3. Pollinations Mistral — free second Pollinations model ──────────────
  {
    id:    'pollinations-mistral',
    label: 'Pollinations Mistral',
    async call (messages) {
      const ctrl  = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 25000)
      try {
        const res = await fetch('https://text.pollinations.ai/', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            messages,
            model:   'mistral',
            seed:    Math.floor(Math.random() * 99999),
            private: true,
          }),
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const text = await res.text()
        if (!text || text.length < 2) throw new Error('Empty response')
        return text.trim()
      } finally { clearTimeout(timer) }
    },
  },

  // ── 4. Groq — fastest model, free tier (only active when key is set) ──────
  ...(GROQ_KEY ? [{
    id:    'groq',
    label: 'Groq Llama 3',
    async call (messages) {
      const ctrl  = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': 'Bearer ' + GROQ_KEY,
          },
          body: JSON.stringify({
            model:       'llama3-8b-8192',
            messages,
            temperature: 0.7,
            max_tokens:  800,
          }),
          signal: ctrl.signal,
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        const text = data.choices?.[0]?.message?.content
        if (!text) throw new Error('No content')
        return text.trim()
      } finally { clearTimeout(timer) }
    },
  }] : []),

]

// ── Auto-fallback engine ───────────────────────────────────────────────────────

let currentIdx = 0

async function callAI (messages) {
  for (let i = 0; i < PROVIDERS.length; i++) {
    const idx      = (currentIdx + i) % PROVIDERS.length
    const provider = PROVIDERS[idx]
    try {
      const text = await provider.call(messages)
      currentIdx = idx   // remember what worked last
      return { text, label: provider.label }
    } catch (err) {
      console.warn('[AI:' + provider.id + '] failed:', err.message)
    }
  }
  throw new Error('AI temporarily unavailable, try again')
}

function getCurrentLabel () { return PROVIDERS[currentIdx]?.label || 'AI' }

window.AiConfig = { callAI, getCurrentLabel, providerCount: PROVIDERS.length }

})()
