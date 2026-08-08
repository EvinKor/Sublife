'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Button } from '@/components/ui/button'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  operator_trace?: string[]
  ticket_keys?: string[]
  timestamp: Date
}

interface ActivityItem {
  id: number
  operator: string
  action: string
  ticket_key: string | null
  result: string | null
  created_at: string
}

// ─────────────────────────────────────────────
// Operator colours & labels (for trace)
// ─────────────────────────────────────────────

const operatorConfig: Record<string, { color: string; label: string; Icon: React.ElementType }> = {
  sla_triage: { color: 'bg-blue-500', label: 'SLA Triage', Icon: Icons.clock },
  diagnose_correlate: { color: 'bg-purple-500', label: 'Diagnose & Correlate', Icon: Icons.activity },
  remediate: { color: 'bg-emerald-500', label: 'Remediate', Icon: Icons.zap },
  comms: { color: 'bg-amber-500', label: 'Requester Comms', Icon: Icons.mail },
  csat_kb: { color: 'bg-pink-500', label: 'CSAT & KB', Icon: Icons.star },
  orchestrator: { color: 'bg-brand-navy', label: 'Orchestrator', Icon: Icons.sparkles },
}

// ─────────────────────────────────────────────
// Suggested prompts
// ─────────────────────────────────────────────

const SUGGESTIONS = [
  'What are the top 3 open P1 tickets right now?',
  'Which team is most overloaded?',
  'Is there a major incident forming?',
  'Show me tickets likely to breach SLA today',
  'Summarise the CSAT trend for this week',
  'What KB articles are missing?',
]

// ─────────────────────────────────────────────
// Single chat message
// ─────────────────────────────────────────────

function ChatMessage({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const isSystem = msg.role === 'system'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-3', isUser && 'flex-row-reverse')}
    >
      {/* Avatar */}
      {!isSystem && (
        <div className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white text-sm font-bold',
          isUser ? 'bg-brand-navy' : 'bg-gradient-to-br from-brand-cornflower to-brand-purple'
        )}>
          {isUser ? <Icons.user className='h-4 w-4' strokeWidth={1.5} /> : <Icons.sparkles className='h-4 w-4' strokeWidth={1.5} />}
        </div>
      )}

      <div className={cn('max-w-[78%] space-y-2', isSystem && 'w-full max-w-full')}>
        {/* Bubble */}
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-brand-navy text-white rounded-tr-sm'
            : isSystem
            ? 'rounded-xl border border-blue-100 bg-blue-50 text-blue-800'
            : 'border border-border/60 bg-white/90 text-foreground shadow-sm rounded-tl-sm'
        )}>
          {msg.content}
        </div>

        {/* Operator trace */}
        {msg.operator_trace && msg.operator_trace.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {msg.operator_trace.map((op, i) => {
              const cfg = Object.entries(operatorConfig).find(([key]) => op.toLowerCase().includes(key))
              return (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold text-white',
                    cfg ? cfg[1].color : 'bg-slate-400'
                  )}
                >
                  {op}
                </span>
              )
            })}
          </div>
        )}

        {/* Ticket keys */}
        {msg.ticket_keys && msg.ticket_keys.length > 0 && (
          <div className='flex flex-wrap gap-1.5'>
            {msg.ticket_keys.map((key) => (
              <span key={key} className='rounded-md bg-brand-cornflower/10 px-1.5 py-0.5 font-mono text-[11px] text-brand-cornflower border border-brand-cornflower/20'>
                {key}
              </span>
            ))}
          </div>
        )}

        <p className='px-1 text-[10px] text-muted-foreground'>
          {msg.timestamp.toLocaleTimeString()}
        </p>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Activity sidebar
// ─────────────────────────────────────────────

function ActivitySidebar({ items }: { items: ActivityItem[] }) {
  const config: Record<string, string> = {
    sla_triage: 'bg-blue-500',
    diagnose_correlate: 'bg-purple-500',
    remediate: 'bg-emerald-500',
    comms: 'bg-amber-500',
    csat_kb: 'bg-pink-500',
    orchestrator: 'bg-brand-navy',
    human: 'bg-slate-400',
  }

  return (
    <Card className='sticky top-4 h-[calc(100vh-9rem)] overflow-hidden flex flex-col'>
      <CardHeader className='pb-3 shrink-0'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          <span className='relative flex h-2 w-2'>
            <span className='absolute animate-ping inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75' />
            <span className='relative inline-flex h-2 w-2 rounded-full bg-emerald-500' />
          </span>
          Live Operator Activity
        </CardTitle>
      </CardHeader>
      <CardContent className='flex-1 overflow-y-auto px-3 pb-3 scrollbar-hide'>
        {items.length === 0 ? (
          <p className='py-4 text-center text-xs text-muted-foreground'>No activity yet</p>
        ) : (
          <div className='space-y-2'>
            <AnimatePresence initial={false}>
              {items.map((a) => (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className='flex gap-2 rounded-lg border border-border/40 bg-muted/20 p-2'
                >
                  <div className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white', config[a.operator] || 'bg-slate-400')}>
                    {a.operator.charAt(0).toUpperCase()}
                  </div>
                  <div className='min-w-0'>
                    <p className='truncate text-[11px] font-semibold text-brand-navy'>{a.action}</p>
                    {a.ticket_key && (
                      <span className='font-mono text-[10px] text-brand-cornflower'>{a.ticket_key}</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

const WELCOME_MSG: Message = {
  id: 'welcome',
  role: 'system',
  content: '🤖 Orchestrator ready. Ask me anything about the service desk — active tickets, team load, SLA risk, major incidents, or specific ticket details. I\'ll delegate to the right Operators and report back.',
  timestamp: new Date('2024-01-01T12:00:00Z'),
}

export default function AIManagerPage() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MSG])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const fetchActivity = useCallback(async () => {
    try {
      const data = await apiClient.get<ActivityItem[]>('/api/service-desk/activity?limit=30')
      setActivity(data)
    } catch (_) {}
  }, [])

  useEffect(() => {
    fetchActivity()
    const interval = setInterval(fetchActivity, 8_000)
    return () => clearInterval(interval)
  }, [fetchActivity])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content) return
    setInput('')

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])
    setSending(true)

    try {
      const data = await apiClient.post<{ reply: string; operator_trace?: string[]; ticket_keys?: string[] }>(
        '/api/service-desk/manager/chat',
        { message: content }
      )
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.reply,
        operator_trace: data.operator_trace,
        ticket_keys: data.ticket_keys,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMsg])
      fetchActivity()
    } catch (err) {
      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `⚠️ Connection error: ${err instanceof Error ? err.message : 'Unknown error'}. Check that SUPERVITY_API_URL is configured in .env.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMsg])
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className='flex h-[calc(100vh-8rem)] gap-6'>
      {/* Chat area */}
      <div className='flex flex-1 flex-col space-y-0'>
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className='mb-4 flex items-center gap-3'
        >
          <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy to-brand-purple shadow-lg'>
            <Icons.sparkles className='h-5 w-5 text-white' strokeWidth={1.5} />
          </div>
          <div>
            <h1 className='font-display text-xl font-bold text-brand-navy'>AI Manager</h1>
            <p className='text-xs text-muted-foreground'>Chat with the Service Desk Orchestrator · delegates to Operators live</p>
          </div>
        </motion.div>

        {/* Messages */}
        <div className='flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border/60 bg-slate-50/50 p-4 scrollbar-hide'>
          {messages.map((msg) => (
            <ChatMessage key={msg.id} msg={msg} />
          ))}
          {sending && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className='flex gap-3'>
              <div className='flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-cornflower to-brand-purple text-white'>
                <Icons.sparkles className='h-4 w-4' strokeWidth={1.5} />
              </div>
              <div className='flex items-center gap-1 rounded-2xl border border-border/60 bg-white/90 px-4 py-3 shadow-sm rounded-tl-sm'>
                <div className='flex gap-1'>
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className='h-1.5 w-1.5 rounded-full bg-brand-cornflower'
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 0.6, delay: i * 0.1, repeat: Infinity }}
                    />
                  ))}
                </div>
                <span className='ml-2 text-xs text-muted-foreground'>Orchestrator is delegating…</span>
              </div>
            </motion.div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        <div className='flex flex-wrap gap-2 py-3'>
          {SUGGESTIONS.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => sendMessage(s)}
              className='rounded-full border border-border bg-white px-3 py-1.5 text-xs text-brand-muted hover:border-brand-cornflower/50 hover:bg-brand-cornflower/5 hover:text-brand-navy transition-all'
            >
              {s}
            </button>
          ))}
        </div>

        {/* Input */}
        <div className='relative'>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Ask the Orchestrator anything… (Enter to send)'
            rows={2}
            disabled={sending}
            className='w-full resize-none rounded-2xl border border-border bg-white px-4 py-3 pr-16 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-cornflower/30 disabled:opacity-60'
          />
          <Button
            onClick={() => sendMessage()}
            disabled={sending || !input.trim()}
            variant='gradient'
            size='icon-sm'
            className='absolute bottom-3 right-3 rounded-xl'
          >
            {sending ? <Icons.loader className='h-4 w-4 animate-spin' /> : <Icons.arrowRight className='h-4 w-4' />}
          </Button>
        </div>
      </div>

      {/* Activity sidebar */}
      <div className='hidden w-64 lg:block'>
        <ActivitySidebar items={activity} />
      </div>
    </div>
  )
}
