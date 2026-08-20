'use client'

import { useState } from 'react'

const FREKTO_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', format: '4:5' },
  { key: 'tiktok',    label: 'TikTok',    format: '9:16' },
  { key: 'linkedin',  label: 'LinkedIn',  format: '1:1' },
  { key: 'twitter',   label: 'X / Twitter', format: '1:1' },
  { key: 'facebook',  label: 'Facebook',  format: '1:1' },
  { key: 'youtube',   label: 'YouTube',   format: '1:1' },
]

const FREKTO_STYLES = [
  { value: '',                       label: 'Auto (AI picks)' },
  { value: 'revelation::cinematic',  label: 'Revelation · Cinematic' },
  { value: 'revelation::statement',  label: 'Revelation · Statement' },
  { value: 'revelation::split',      label: 'Revelation · Split' },
  { value: 'stat::cinematic',        label: 'Stat · Cinematic' },
  { value: 'stat::bold',             label: 'Stat · Bold' },
  { value: 'stat::editorial',        label: 'Stat · Editorial' },
  { value: 'stat::minimal',          label: 'Stat · Minimal' },
  { value: 'stat::split',            label: 'Stat · Split' },
  { value: 'quote::bold',            label: 'Quote · Bold' },
  { value: 'quote::minimal',         label: 'Quote · Minimal' },
  { value: 'quote::attributed',      label: 'Quote · Attributed' },
  { value: 'quote::contrast',        label: 'Quote · Contrast' },
  { value: 'quote::ticker',          label: 'Quote · Ticker' },
  { value: 'contrast::versus',       label: 'Contrast · Versus' },
  { value: 'contrast::split_screen', label: 'Contrast · Split Screen' },
  { value: 'contrast::myth_reality', label: 'Contrast · Myth vs Reality' },
  { value: 'contrast::before_after', label: 'Contrast · Before / After' },
  { value: 'contrast::old_new',      label: 'Contrast · Old vs New' },
  { value: 'question::rhetorical',   label: 'Question · Rhetorical' },
  { value: 'question::poll',         label: 'Question · Poll' },
  { value: 'question::challenge',    label: 'Question · Challenge' },
  { value: 'question::bold',         label: 'Question · Bold' },
  { value: 'question::minimal',      label: 'Question · Minimal' },
  { value: 'myth::bold',             label: 'Myth · Bold' },
  { value: 'myth::stack',            label: 'Myth · Stack' },
  { value: 'myth::minimal',          label: 'Myth · Minimal' },
  { value: 'myth::cinematic',        label: 'Myth · Cinematic' },
  { value: 'myth::split',            label: 'Myth · Split' },
  { value: 'checklist::minimal',     label: 'Checklist · Minimal' },
  { value: 'checklist::bold',        label: 'Checklist · Bold' },
  { value: 'checklist::do_dont',     label: "Checklist · Do / Don't" },
  { value: 'checklist::audit',       label: 'Checklist · Audit' },
  { value: 'checklist::score',       label: 'Checklist · Score' },
  { value: 'trend::rising',          label: 'Trend · Rising' },
  { value: 'trend::declining',       label: 'Trend · Declining' },
  { value: 'trend::watch',           label: 'Trend · Watch' },
  { value: 'trend::editorial',       label: 'Trend · Editorial' },
  { value: 'trend::data',            label: 'Trend · Data' },
  { value: 'prediction::bold_call',  label: 'Prediction · Bold Call' },
  { value: 'prediction::cinematic',  label: 'Prediction · Cinematic' },
  { value: 'prediction::editorial',  label: 'Prediction · Editorial' },
  { value: 'prediction::minimal',    label: 'Prediction · Minimal' },
  { value: 'prediction::three_up',   label: 'Prediction · Three Up' },
  { value: 'framework::ticker',      label: 'Framework · Ticker' },
  { value: 'journey::chapter',       label: 'Journey · Chapter' },
  { value: 'media::overlay',         label: 'Media · Overlay' },
  { value: 'media::framed',          label: 'Media · Framed' },
  { value: 'media::split',           label: 'Media · Split' },
  { value: 'media::caption_bar',     label: 'Media · Caption Bar' },
  { value: 'media::montage',         label: 'Media · Montage' },
  { value: 'media::video_brand_bar', label: 'Media · Video Brand Bar' },
  { value: 'media::video_gradient',  label: 'Media · Video Gradient' },
  { value: 'media::video_cinematic', label: 'Media · Video Cinematic' },
  { value: 'media::video_minimal',   label: 'Media · Video Minimal' },
]

export default function FrektoPostingSection({
  moduleId,
  brandName,
  connected,
}: {
  moduleId: string
  brandName: string
  connected: boolean
}) {
  const [platform, setPlatform]         = useState('instagram')
  const [format, setFormat]             = useState('4:5')
  const [outputFormat, setOutputFormat] = useState<'png' | 'mp4'>('png')
  const [style, setStyle]               = useState('')
  const [topic, setTopic]               = useState('')
  const [generating, setGenerating]     = useState(false)
  const [resultUrl, setResultUrl]       = useState<string | null>(null)
  const [jobId, setJobId]               = useState<string | null>(null)
  const [error, setError]               = useState<string | null>(null)

  const selectPlatform = (p: { key: string; format: string }) => {
    setPlatform(p.key)
    setFormat(p.format)
    setResultUrl(null)
    setError(null)
  }

  const handleGenerate = async () => {
    if (!topic.trim() || generating) return
    setGenerating(true)
    setError(null)
    setResultUrl(null)
    setJobId(null)
    try {
      const res = await fetch('/api/frekto/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, topic: topic.trim(), format, outputFormat, style: style || undefined }),
      })
      const data = await res.json() as { outputUrl?: string; jobId?: string; error?: string }
      if (data.outputUrl) {
        setResultUrl(data.outputUrl)
        setJobId(data.jobId ?? null)
      } else {
        setError(data.error ?? 'Generation failed. Please try again.')
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '5px 13px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', border: '1px solid',
    borderColor: active ? 'var(--green)' : 'var(--line)',
    background: active ? 'rgba(23,154,80,.12)' : 'transparent',
    color: active ? 'var(--green)' : 'var(--text-dim)',
  })

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Connected status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>
          {brandName} · Frekto post generator
        </span>
        {connected ? (
          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(23,154,80,.1)', border: '1px solid rgba(23,154,80,.3)', color: 'var(--green)' }}>
            Connected
          </span>
        ) : (
          <a href="/settings?tab=integrations" style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'var(--bg-soft)', border: '1px solid var(--line)', color: 'var(--text-dim)', textDecoration: 'none' }}>
            Connect Frekto in Settings →
          </a>
        )}
      </div>

      {!connected && (
        <p style={{ fontSize: '13px', color: 'var(--text-faint)', margin: 0, lineHeight: 1.6 }}>
          Add your Frekto API key in Settings → Integrations to generate platform-ready social media images and videos directly from here.
        </p>
      )}

      {connected && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Platform pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {FREKTO_PLATFORMS.map((p) => (
              <button key={p.key} onClick={() => selectPlatform(p)} style={pill(platform === p.key)}>{p.label}</button>
            ))}
          </div>

          {/* Format + Output + Style */}
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Aspect ratio</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {['4:5', '9:16', '1:1'].map((f) => (
                  <button key={f} onClick={() => setFormat(f)} style={pill(format === f)}>{f}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Output</div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {(['png', 'mp4'] as const).map((f) => (
                  <button key={f} onClick={() => setOutputFormat(f)} style={pill(outputFormat === f)}>{f.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '6px', fontWeight: 500 }}>Style</div>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '12px', outline: 'none', cursor: 'pointer' }}
              >
                {FREKTO_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          {/* Topic */}
          <div>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 300))}
              placeholder={`Describe the post for ${FREKTO_PLATFORMS.find(p => p.key === platform)?.label ?? platform}… e.g. "Announce our new product with bold visuals and a clear CTA"`}
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '7px', border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)', fontSize: '13px', lineHeight: '1.55', resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
            />
            <div style={{ textAlign: 'right', fontSize: '11px', color: topic.length >= 280 ? 'var(--gold)' : 'var(--text-faint)', marginTop: '3px' }}>
              {topic.length}/300
            </div>
          </div>

          {error && <p style={{ fontSize: '13px', color: '#ef4444', margin: 0 }}>{error}</p>}

          <button
            disabled={generating || !topic.trim()}
            onClick={handleGenerate}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', padding: '9px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: generating || !topic.trim() ? 'not-allowed' : 'pointer', border: 'none', background: generating || !topic.trim() ? 'var(--bg-soft)' : 'var(--green)', color: generating || !topic.trim() ? 'var(--text-dim)' : '#fff', alignSelf: 'flex-start', fontFamily: 'var(--font-body)' }}
          >
            {generating ? 'Generating… (15–90s)' : 'Generate post'}
          </button>

          {/* Result */}
          {resultUrl && (
            <div style={{ padding: '14px', borderRadius: '8px', border: '1px solid rgba(23,154,80,.25)', background: 'rgba(23,154,80,.04)' }}>
              <div style={{ fontSize: '11px', color: 'var(--green)', fontWeight: 600, marginBottom: '10px', letterSpacing: '0.02em' }}>
                GENERATED {jobId && <span style={{ color: 'var(--text-faint)', fontWeight: 400, marginLeft: '8px', fontFamily: 'monospace' }}>{jobId}</span>}
              </div>
              {outputFormat === 'mp4'
                ? <video src={resultUrl} controls style={{ maxWidth: '100%', maxHeight: '400px', borderRadius: '6px', display: 'block', marginBottom: '10px' }} />
                : <img src={resultUrl} alt="Generated content" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain', borderRadius: '6px', display: 'block', marginBottom: '10px' }} />
              }
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <a href={resultUrl} download target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--green)', color: 'var(--green)', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}>
                  Download
                </a>
                <input readOnly value={resultUrl} onClick={(e) => (e.target as HTMLInputElement).select()} style={{ flex: 1, minWidth: '140px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg-soft)', color: 'var(--text-dim)', fontSize: '11px', fontFamily: 'monospace', outline: 'none' }} />
                <button onClick={() => { setResultUrl(null); setJobId(null); setError(null) }} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--line)', color: 'var(--text-dim)', fontSize: '12px', cursor: 'pointer', background: 'transparent' }}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
