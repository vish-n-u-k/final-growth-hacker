'use client'

import { useState } from 'react'

const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', format: '4:5' },
  { key: 'tiktok', label: 'TikTok', format: '9:16' },
  { key: 'linkedin', label: 'LinkedIn', format: '1:1' },
  { key: 'twitter', label: 'X / Twitter', format: '1:1' },
  { key: 'facebook', label: 'Facebook', format: '1:1' },
  { key: 'youtube', label: 'YouTube', format: '1:1' },
]

const STYLES = [
  { value: '',                        label: 'Auto (AI picks)' },
  // Revelation
  { value: 'revelation::cinematic',   label: 'Revelation · Cinematic' },
  { value: 'revelation::statement',   label: 'Revelation · Statement' },
  { value: 'revelation::split',       label: 'Revelation · Split' },
  // Stat
  { value: 'stat::cinematic',         label: 'Stat · Cinematic' },
  { value: 'stat::bold',              label: 'Stat · Bold' },
  { value: 'stat::editorial',         label: 'Stat · Editorial' },
  { value: 'stat::minimal',           label: 'Stat · Minimal' },
  { value: 'stat::split',             label: 'Stat · Split' },
  // Quote
  { value: 'quote::bold',             label: 'Quote · Bold' },
  { value: 'quote::minimal',          label: 'Quote · Minimal' },
  { value: 'quote::attributed',       label: 'Quote · Attributed' },
  { value: 'quote::contrast',         label: 'Quote · Contrast' },
  { value: 'quote::ticker',           label: 'Quote · Ticker' },
  // Contrast
  { value: 'contrast::versus',        label: 'Contrast · Versus' },
  { value: 'contrast::split_screen',  label: 'Contrast · Split Screen' },
  { value: 'contrast::myth_reality',  label: 'Contrast · Myth vs Reality' },
  { value: 'contrast::before_after',  label: 'Contrast · Before / After' },
  { value: 'contrast::old_new',       label: 'Contrast · Old vs New' },
  // Question
  { value: 'question::rhetorical',    label: 'Question · Rhetorical' },
  { value: 'question::poll',          label: 'Question · Poll' },
  { value: 'question::challenge',     label: 'Question · Challenge' },
  { value: 'question::bold',          label: 'Question · Bold' },
  { value: 'question::minimal',       label: 'Question · Minimal' },
  // Myth
  { value: 'myth::bold',              label: 'Myth · Bold' },
  { value: 'myth::stack',             label: 'Myth · Stack' },
  { value: 'myth::minimal',           label: 'Myth · Minimal' },
  { value: 'myth::cinematic',         label: 'Myth · Cinematic' },
  { value: 'myth::split',             label: 'Myth · Split' },
  // Checklist
  { value: 'checklist::minimal',      label: 'Checklist · Minimal' },
  { value: 'checklist::bold',         label: 'Checklist · Bold' },
  { value: 'checklist::do_dont',      label: 'Checklist · Do / Don\'t' },
  { value: 'checklist::audit',        label: 'Checklist · Audit' },
  { value: 'checklist::score',        label: 'Checklist · Score' },
  // Trend
  { value: 'trend::rising',           label: 'Trend · Rising' },
  { value: 'trend::declining',        label: 'Trend · Declining' },
  { value: 'trend::watch',            label: 'Trend · Watch' },
  { value: 'trend::editorial',        label: 'Trend · Editorial' },
  { value: 'trend::data',             label: 'Trend · Data' },
  // Prediction
  { value: 'prediction::bold_call',   label: 'Prediction · Bold Call' },
  { value: 'prediction::cinematic',   label: 'Prediction · Cinematic' },
  { value: 'prediction::editorial',   label: 'Prediction · Editorial' },
  { value: 'prediction::minimal',     label: 'Prediction · Minimal' },
  { value: 'prediction::three_up',    label: 'Prediction · Three Up' },
  // Multi-slide
  { value: 'framework::ticker',       label: 'Framework · Ticker' },
  { value: 'journey::chapter',        label: 'Journey · Chapter' },
  // Media
  { value: 'media::overlay',          label: 'Media · Overlay' },
  { value: 'media::framed',           label: 'Media · Framed' },
  { value: 'media::split',            label: 'Media · Split' },
  { value: 'media::caption_bar',      label: 'Media · Caption Bar' },
  { value: 'media::montage',          label: 'Media · Montage' },
  { value: 'media::video_brand_bar',  label: 'Media · Video Brand Bar' },
  { value: 'media::video_gradient',   label: 'Media · Video Gradient' },
  { value: 'media::video_cinematic',  label: 'Media · Video Cinematic' },
  { value: 'media::video_minimal',    label: 'Media · Video Minimal' },
]

export default function FrektoTestPage() {
  const [apiKey, setApiKey] = useState('')
  const [platform, setPlatform] = useState('instagram')
  const [format, setFormat] = useState('4:5')
  const [outputFormat, setOutputFormat] = useState<'png' | 'mp4'>('png')
  const [style, setStyle] = useState('')
  const [topic, setTopic] = useState('')
  const [generating, setGenerating] = useState(false)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])

  const addLog = (msg: string) => setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev])

  const selectPlatform = (p: { key: string; format: string }) => {
    setPlatform(p.key)
    setFormat(p.format)
  }

  const handleGenerate = async () => {
    if (!apiKey.trim() || !topic.trim() || generating) return
    setGenerating(true)
    setError(null)
    setResultUrl(null)
    setJobId(null)
    addLog(`Submitting job — platform: ${platform}, format: ${format}, output: ${outputFormat}${style ? `, style: ${style}` : ''}`)

    try {
      const res = await fetch('/api/frekto/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          topic: topic.trim(),
          format,
          outputFormat,
          style: style || undefined,
        }),
      })

      const data = await res.json() as { outputUrl?: string; jobId?: string; error?: string }

      if (!res.ok || data.error) {
        const msg = data.error ?? `HTTP ${res.status}`
        setError(msg)
        addLog(`Error: ${msg}`)
      } else if (data.outputUrl) {
        setResultUrl(data.outputUrl)
        setJobId(data.jobId ?? null)
        addLog(`Done — job ${data.jobId ?? '?'} → ${data.outputUrl}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Network error'
      setError(msg)
      addLog(`Exception: ${msg}`)
    } finally {
      setGenerating(false)
    }
  }

  const reset = () => {
    setResultUrl(null)
    setJobId(null)
    setError(null)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'var(--font-body)',
      padding: '40px 24px',
    }}>
      <div style={{ maxWidth: '680px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <a
            href="/dashboard"
            style={{ fontSize: '12px', color: 'var(--text-dim)', textDecoration: 'none', marginBottom: '16px', display: 'inline-block' }}
          >
            ← Back to dashboard
          </a>
          <h1 style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-display)', margin: '8px 0 4px' }}>
            Frekto Test
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--text-dim)', margin: 0 }}>
            Test the content generation API directly. Enter your Frekto API key and a topic — the image or video will render in 15–90 seconds.
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: '12px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}>

          {/* API Key */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '6px' }}>
              Frekto API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="frekto_live_xxxxxxxxxxxxxxxxxxxx"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: '7px',
                border: '1px solid var(--line)', background: 'var(--input)',
                color: 'var(--text)', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px' }}>
              Get yours at app.frekto.ai → API Keys. Free tier: 10 renders/day.
            </p>
          </div>

          {/* Platform */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '8px' }}>
              Platform
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => selectPlatform(p)}
                  style={{
                    padding: '5px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                    cursor: 'pointer', border: '1px solid',
                    borderColor: platform === p.key ? 'var(--green)' : 'var(--line)',
                    background: platform === p.key ? 'rgba(47,191,113,0.12)' : 'transparent',
                    color: platform === p.key ? 'var(--green-bright)' : 'var(--text-dim)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Format controls */}
          <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '8px' }}>
                Aspect Ratio
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['4:5', '9:16', '1:1'].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    style={{
                      padding: '5px 12px', borderRadius: '5px', fontSize: '12px', fontWeight: 500,
                      cursor: 'pointer', border: '1px solid',
                      borderColor: format === f ? 'var(--green)' : 'var(--line)',
                      background: format === f ? 'rgba(47,191,113,0.1)' : 'transparent',
                      color: format === f ? 'var(--green-bright)' : 'var(--text-dim)',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '8px' }}>
                Output Format
              </label>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['png', 'mp4'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setOutputFormat(f)}
                    style={{
                      padding: '5px 12px', borderRadius: '5px', fontSize: '12px', fontWeight: 500,
                      cursor: 'pointer', border: '1px solid',
                      borderColor: outputFormat === f ? 'var(--green)' : 'var(--line)',
                      background: outputFormat === f ? 'rgba(47,191,113,0.1)' : 'transparent',
                      color: outputFormat === f ? 'var(--green-bright)' : 'var(--text-dim)',
                    }}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Style */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '6px' }}>
              Template Style
            </label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              style={{
                padding: '8px 12px', borderRadius: '7px',
                border: '1px solid var(--line)', background: 'var(--input)',
                color: 'var(--text)', fontSize: '12.5px', outline: 'none', cursor: 'pointer',
                minWidth: '200px',
              }}
            >
              {STYLES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Topic */}
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-dim)', marginBottom: '6px' }}>
              Topic <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(max 300 chars)</span>
            </label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 300))}
              placeholder="Describe what this post should be about… e.g. 'A bold announcement for our SaaS product launch targeting early-stage founders'"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: '7px',
                border: '1px solid var(--line)', background: 'var(--input)',
                color: 'var(--text)', fontSize: '13px', lineHeight: '1.55',
                resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ textAlign: 'right', fontSize: '11px', color: topic.length >= 280 ? 'var(--gold)' : 'var(--text-faint)', marginTop: '3px' }}>
              {topic.length}/300
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: '7px',
              border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.06)',
              fontSize: '12.5px', color: '#f87171',
            }}>
              {error}
            </div>
          )}

          {/* Generate button */}
          <button
            disabled={generating || !apiKey.trim() || !topic.trim()}
            onClick={handleGenerate}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              padding: '11px 24px', borderRadius: '8px', fontSize: '13.5px', fontWeight: 600,
              cursor: generating || !apiKey.trim() || !topic.trim() ? 'not-allowed' : 'pointer',
              border: 'none',
              background: generating || !apiKey.trim() || !topic.trim()
                ? 'rgba(47,191,113,0.2)'
                : 'var(--green)',
              color: generating || !apiKey.trim() || !topic.trim() ? 'var(--text-dim)' : '#ffffff',
              width: '100%',
            }}
          >
            {generating ? (
              <>
                <span style={{
                  display: 'inline-block', width: '14px', height: '14px',
                  border: '2px solid rgba(47,191,113,0.3)', borderTopColor: 'var(--green)',
                  borderRadius: '50%', animation: 'spin 0.7s linear infinite',
                }} />
                Generating… (15–90 seconds)
              </>
            ) : (
              'Generate content'
            )}
          </button>
        </div>

        {/* Result */}
        {resultUrl && (
          <div style={{
            marginTop: '24px',
            background: 'var(--card)',
            border: '1px solid rgba(47,191,113,0.3)',
            borderRadius: '12px',
            padding: '20px 24px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--green)' }}>RESULT</span>
                {jobId && (
                  <span style={{ marginLeft: '10px', fontSize: '11px', color: 'var(--text-faint)', fontFamily: 'monospace' }}>
                    {jobId}
                  </span>
                )}
              </div>
              <button
                onClick={reset}
                style={{
                  fontSize: '11px', color: 'var(--text-dim)', background: 'transparent',
                  border: '1px solid var(--line)', padding: '3px 10px', borderRadius: '5px', cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>

            {outputFormat === 'mp4' ? (
              <video
                src={resultUrl}
                controls
                style={{ width: '100%', maxHeight: '500px', borderRadius: '8px', marginBottom: '14px' }}
              />
            ) : (
              <img
                src={resultUrl}
                alt="Generated content"
                style={{ width: '100%', maxHeight: '500px', objectFit: 'contain', borderRadius: '8px', marginBottom: '14px' }}
              />
            )}

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <a
                href={resultUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '7px 16px', borderRadius: '7px',
                  border: '1px solid var(--green)', color: 'var(--green-bright)',
                  fontSize: '12.5px', fontWeight: 600, textDecoration: 'none',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Download
              </a>
              <input
                readOnly
                value={resultUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                style={{
                  flex: 1, minWidth: '160px', padding: '7px 10px', borderRadius: '7px',
                  border: '1px solid var(--line)', background: 'var(--input)',
                  color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'monospace', outline: 'none',
                }}
              />
            </div>
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-faint)', marginBottom: '6px', letterSpacing: '0.05em' }}>
              LOG
            </div>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--line)', borderRadius: '8px',
              padding: '12px 14px', fontFamily: 'monospace', fontSize: '11.5px', color: 'var(--text-dim)',
              lineHeight: '1.7',
            }}>
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}

      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder, textarea::placeholder { color: var(--text-faint); }
        select option { background: var(--card); color: var(--text); }
      `}</style>
    </div>
  )
}
