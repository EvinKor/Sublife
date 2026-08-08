'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Upload,
  FileText,
  User,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8001'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface WorkflowStep {
  id: string
  stepName: string
  stepDescription?: string
  status: 'running' | 'completed' | 'error'
  html?: string
  output?: string
  kind?: string
  conditionId?: string
  conditionName?: string
  conditionMet?: boolean
}

interface WorkflowMessage {
  id: string
  type: 'user' | 'system' | 'result'
  content?: string
  userInput?: { identifier: string; message: string }
  steps?: WorkflowStep[]
  status?: 'running' | 'completed' | 'error'
  timestamp: Date
  elapsedMs?: number
}

// ─────────────────────────────────────────────
// Parse SSE stream into structured steps
// ─────────────────────────────────────────────

function parseSSEStream(rawText: string): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  const stepMap = new Map<string, WorkflowStep>()

  const lines = rawText.split('\n')
  let currentEvent = ''
  let currentData = ''

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      currentData = line.slice(6).trim()

      if (currentEvent === 'activity-run' && currentData) {
        try {
          const parsed = JSON.parse(currentData)
          const content = parsed.content || parsed
          const activityId = content.activityRunId || content.id
          const kind = content.kind || 'step'
          const status = content.status || 'running'

          // Skip ping events
          if (!activityId) continue

          // For conditions, track them separately
          if (kind === 'condition') {
            const condStep: WorkflowStep = {
              id: activityId,
              stepName: content.conditionName || content.stepName || content.stepId || 'Condition',
              status,
              kind: 'condition',
              conditionId: content.conditionId,
              conditionName: content.conditionName,
              conditionMet: content.outputs?.conditionMet,
            }
            if (status === 'completed' && content.outputs) {
              condStep.conditionMet = content.outputs.conditionMet
            }
            // Only add conditions that are completed and relevant
            if (status === 'completed' && content.outputs?.conditionMet === true) {
              stepMap.set(activityId, condStep)
            }
            continue
          }

          // Regular step
          const existing = stepMap.get(activityId)
          if (existing) {
            existing.status = status
            if (status === 'completed' && content.outputs) {
              existing.html = content.outputs?.displayData?.html || ''
              existing.output = content.outputs?.output || ''
            }
          } else {
            const step: WorkflowStep = {
              id: activityId,
              stepName: content.stepName || content.stepId || 'Processing',
              stepDescription: content.stepDescription || '',
              status,
              kind,
              html: content.outputs?.displayData?.html || '',
              output: content.outputs?.output || '',
            }
            stepMap.set(activityId, step)
          }
        } catch {
          // Skip unparseable lines
        }
      }
    } else if (line === '') {
      currentEvent = ''
      currentData = ''
    }
  }

  // Convert map to array, keeping only steps (not conditions)
  stepMap.forEach((step) => {
    if (step.kind !== 'condition') {
      steps.push(step)
    }
  })

  return steps
}

// ─────────────────────────────────────────────
// Step Card Component
// ─────────────────────────────────────────────

function StepCard({ step, index }: { step: WorkflowStep; index: number }) {
  const [expanded, setExpanded] = useState(true)

  const statusIcon = step.status === 'completed'
    ? <CheckCircle2 className='h-4 w-4 text-emerald-500' />
    : step.status === 'error'
      ? <XCircle className='h-4 w-4 text-red-500' />
      : <Loader2 className='h-4 w-4 animate-spin text-brand-cornflower' />

  const statusColor = step.status === 'completed'
    ? 'border-emerald-200 bg-emerald-50/30'
    : step.status === 'error'
      ? 'border-red-200 bg-red-50/30'
      : 'border-brand-cornflower/30 bg-brand-cornflower/5'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={cn('rounded-xl border overflow-hidden', statusColor)}
    >
      {/* Step Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className='flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02]'
      >
        <div className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-navy/10 text-[10px] font-bold text-brand-navy'>
          {index + 1}
        </div>
        {statusIcon}
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-semibold text-foreground truncate'>{step.stepName}</p>
        </div>
        {expanded ? <ChevronUp className='h-4 w-4 text-muted-foreground' /> : <ChevronDown className='h-4 w-4 text-muted-foreground' />}
      </button>

      {/* Step Content */}
      <AnimatePresence>
        {expanded && step.html && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='overflow-hidden'
          >
            <div className='border-t border-inherit px-4 py-3'>
              {/* Render Supervity HTML */}
              <div
                className='supervity-step-content text-sm'
                dangerouslySetInnerHTML={{ __html: step.html }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Result Message (Chat Bubble + Technical Trace Accordion)
// ─────────────────────────────────────────────

function ResultMessage({ msg, formatTime, elapsedTime }: { 
  msg: WorkflowMessage
  formatTime: (ms: number) => string
  elapsedTime: number 
}) {
  const [showTrace, setShowTrace] = useState(false)

  const steps = msg.steps || []
  
  // Extract user-friendly response
  const getFriendlyResponse = () => {
    if (steps.length === 0) {
      return { text: "Starting workflow orchestrator..." }
    }

    // 1. Check if there's a draft specialist response
    const draftStep = steps.find(s => s.id === 'draft_specialist_response' || s.stepName.toLowerCase().includes('draft specialist'))
    if (draftStep && draftStep.status === 'completed' && draftStep.output) {
      try {
        const parsed = JSON.parse(draftStep.output)
        if (parsed.draft_response) {
          return { text: parsed.draft_response }
        }
      } catch (e) {
        // Fallback
      }
    }

    // 2. Check if there's an exception handler route
    const routeStep = steps.find(s => s.id === 'route_to_exception_handler' || s.stepName.toLowerCase().includes('exception handler'))
    if (routeStep && routeStep.status === 'completed' && routeStep.html) {
      return { html: routeStep.html }
    }

    // 3. Check if there's an IT service desk workbench escalation
    const workbenchStep = steps.find(s => s.id === 'step_6_workbench' || s.stepName.toLowerCase().includes('escalate to workbench'))
    if (workbenchStep && workbenchStep.status === 'completed') {
      try {
        const parsed = JSON.parse(workbenchStep.output || '{}')
        const ticketKey = parsed.ticket_key || 'pending'
        return {
          text: `Your request has been escalated to our Support Team for manual review. A ticket (${ticketKey}) has been created, and our specialists will update you shortly.`
        }
      } catch (e) {
        if (workbenchStep.html) return { html: workbenchStep.html }
      }
    }

    // 4. Check if there's any general ticket management step or config error card
    const ticketStep = steps.find(s => s.id === 'it_ticket_management' || s.stepName.toLowerCase().includes('ticket management'))
    if (ticketStep && ticketStep.status === 'completed') {
      // If it contains a config error about environment variables, let's translate that into a friendly message
      if (ticketStep.output?.includes('IT_SERVICE_DESK_BASE_URL') || ticketStep.html?.includes('config error')) {
        return {
          text: "Your IT ticket has been queued for manual processing by our Service Desk team. A specialist is reviewing your request."
        }
      }
      if (ticketStep.html) return { html: ticketStep.html }
    }

    // 5. Default: Find the last completed step with display HTML
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i]
      if (s.status === 'completed' && s.html) {
        return { html: s.html }
      }
    }

    // 6. Last active step description
    const lastActive = steps[steps.length - 1]
    return { text: `Executing step: ${lastActive?.stepName || 'Orchestration'}...` }
  }

  const response = getFriendlyResponse()

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className='max-w-3xl space-y-4 w-full'
    >
      {/* ─── Assistant Chat Bubble ─── */}
      <div className='flex items-start gap-3 w-full'>
        <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy to-brand-purple shadow-md text-white'>
          <Zap className='h-4 w-4' />
        </div>
        
        <div className='flex-1 min-w-0'>
          {/* Status Header */}
          <div className='flex items-center gap-2 mb-1.5'>
            <span className='text-xs font-semibold text-brand-navy'>Assistant</span>
            {msg.status === 'running' ? (
              <span className='flex items-center gap-1 text-[10px] text-brand-cornflower font-medium'>
                <Loader2 className='h-2.5 w-2.5 animate-spin' />
                Thinking... ({formatTime(elapsedTime)})
              </span>
            ) : msg.status === 'completed' ? (
              <span className='text-[10px] text-emerald-600 font-medium'>
                Complete ({msg.elapsedMs ? formatTime(msg.elapsedMs) : ''})
              </span>
            ) : (
              <span className='text-[10px] text-red-600 font-medium'>Error</span>
            )}
          </div>

          {/* User-facing response bubble */}
          <div className='rounded-2xl rounded-tl-md border border-border bg-white px-5 py-3.5 shadow-sm w-full overflow-hidden'>
            {response.html ? (
              <div className='supervity-step-content text-sm' dangerouslySetInnerHTML={{ __html: response.html }} />
            ) : (
              <p className='text-sm leading-relaxed text-foreground whitespace-pre-wrap'>{response.text}</p>
            )}
          </div>

          {/* Error Message */}
          {msg.status === 'error' && msg.content && (
            <div className='mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700'>
              {msg.content}
            </div>
          )}

          {/* Technical Trace Toggle */}
          {steps.length > 0 && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() => setShowTrace(!showTrace)}
                className='flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-brand-cornflower transition-colors'
              >
                {showTrace ? 'Hide workflow trace' : `Show technical workflow trace (${steps.length} steps)`}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', showTrace && 'rotate-180')} />
              </button>

              <AnimatePresence>
                {showTrace && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className='overflow-hidden'
                  >
                    <div className='mt-2.5 space-y-2 border-l-2 border-border/60 pl-3.5 py-1'>
                      {steps.map((step, i) => (
                        <StepCard key={step.id} step={step} index={i} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Main Operator Console
// ─────────────────────────────────────────────

export default function OperatorConsolePage() {
  const [messages, setMessages] = useState<WorkflowMessage[]>([])
  const [userIdentifier, setUserIdentifier] = useState('')
  const [userMessage, setUserMessage] = useState('')
  const [membershipUrl, setMembershipUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messageInputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const startTimer = () => {
    setElapsedTime(0)
    timerRef.current = setInterval(() => {
      setElapsedTime((prev) => prev + 100)
    }, 100)
  }

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const tenths = Math.floor((ms % 1000) / 100)
    return `${seconds}.${tenths}s`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userIdentifier.trim() || !userMessage.trim()) return

    const msgId = Date.now().toString()

    // Add user message
    const userMsg: WorkflowMessage = {
      id: `user-${msgId}`,
      type: 'user',
      userInput: { identifier: userIdentifier, message: userMessage },
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMsg])

    // Add processing message
    const processingMsg: WorkflowMessage = {
      id: `result-${msgId}`,
      type: 'result',
      status: 'running',
      steps: [],
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, processingMsg])

    setIsLoading(true)
    startTimer()

    const formData = new FormData()
    formData.append('customer_identifier', userIdentifier)
    formData.append('customer_message', userMessage)
    if (membershipUrl) formData.append('membership_program_url', membershipUrl)
    if (file) formData.append('tier_benefits_document', file)

    try {
      const res = await fetch(`${API_URL}/api/workflow/execute`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        let done = false
        let accumulated = ''
        while (!done) {
          const { value, done: readerDone } = await reader.read()
          done = readerDone
          if (value) {
            const chunk = decoder.decode(value, { stream: !done })
            accumulated += chunk
            const steps = parseSSEStream(accumulated)
            setMessages((prev) =>
              prev.map((m) =>
                m.id === `result-${msgId}` ? { ...m, steps, status: 'running' } : m
              )
            )
          }
        }
        // Final parse
        const finalSteps = parseSSEStream(accumulated)
        stopTimer()
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `result-${msgId}`
              ? { ...m, steps: finalSteps, status: 'completed', elapsedMs: elapsedTime }
              : m
          )
        )
      } else {
        const text = await res.text()
        const steps = parseSSEStream(text)
        stopTimer()
        setMessages((prev) =>
          prev.map((m) =>
            m.id === `result-${msgId}`
              ? { ...m, steps, status: 'completed', elapsedMs: elapsedTime }
              : m
          )
        )
      }

      // Clear input for next message
      setUserMessage('')
    } catch (err: unknown) {
      stopTimer()
      setMessages((prev) =>
        prev.map((m) =>
          m.id === `result-${msgId}`
            ? { ...m, status: 'error', content: err instanceof Error ? err.message : 'An unexpected error occurred' }
            : m
        )
      )
    } finally {
      setIsLoading(false)
      messageInputRef.current?.focus()
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) setFile(selected)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (userIdentifier.trim() && userMessage.trim() && !isLoading) {
        handleSubmit(e as unknown as React.FormEvent)
      }
    }
  }

  return (
    <div className='flex h-[calc(100vh-7rem)] flex-col'>
      {/* ─── Header ─── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className='flex-shrink-0 pb-4'
      >
        <div className='flex items-center gap-3'>
          <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy to-brand-purple shadow-md'>
            <Zap className='h-5 w-5 text-white' />
          </div>
          <div>
            <h1 className='text-xl font-bold tracking-tight text-brand-navy'>
              Operator Console
            </h1>
            <p className='text-xs text-muted-foreground'>
              Send a message to your AI workforce — SubLife or IT Support
            </p>
          </div>
        </div>
      </motion.div>

      {/* ─── Messages Area ─── */}
      <div
        ref={scrollRef}
        className='flex-1 overflow-y-auto scrollbar-hide space-y-6 pb-4'
      >
        {messages.length === 0 ? (
          <div className='flex h-full items-center justify-center'>
            <div className='text-center max-w-md'>
              <div className='mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-navy/10 to-brand-purple/10'>
                <Zap className='h-8 w-8 text-brand-navy/40' />
              </div>
              <h2 className='text-lg font-semibold text-brand-navy mb-2'>
                What can I help you with?
              </h2>
              <p className='text-sm text-muted-foreground leading-relaxed'>
                Ask about subscriptions, billing, cancellations, IT tickets, incidents — the Master Orchestrator will route your request to the right AI agent.
              </p>
              <div className='mt-6 flex flex-wrap justify-center gap-2'>
                {[
                  'I want to cancel my membership',
                  'My VPN is not working',
                  'Why was I double charged?',
                  'What tier am I on?',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setUserMessage(suggestion)}
                    className={cn(
                      'rounded-full border border-border/60 px-3 py-1.5',
                      'text-xs text-muted-foreground',
                      'transition-all duration-200',
                      'hover:border-brand-cornflower/40 hover:bg-brand-cornflower/5 hover:text-brand-navy'
                    )}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.type === 'user') {
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className='flex justify-end'
                >
                  <div className='max-w-lg rounded-2xl rounded-br-md bg-brand-navy px-5 py-3 text-white shadow-md'>
                    <div className='flex items-center gap-2 mb-1'>
                      <User className='h-3 w-3 text-white/60' />
                      <span className='text-[10px] font-medium text-white/60'>
                        {msg.userInput?.identifier}
                      </span>
                    </div>
                    <p className='text-sm leading-relaxed'>{msg.userInput?.message}</p>
                  </div>
                </motion.div>
              )
            }

            if (msg.type === 'result') {
              return (
                <ResultMessage
                  key={msg.id}
                  msg={msg}
                  formatTime={formatTime}
                  elapsedTime={elapsedTime}
                />
              )
            }

            return null
          })
        )}
      </div>

      {/* ─── Input Bar ─── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className='flex-shrink-0 border-t border-border/40 bg-white/60 backdrop-blur-lg pt-4'
      >
        <form onSubmit={handleSubmit}>
          {/* Advanced Options (collapsible) */}
          <AnimatePresence>
            {showAdvanced && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className='overflow-hidden'
              >
                <div className='mb-3 flex flex-wrap gap-3 rounded-xl border border-border/40 bg-muted/20 p-3'>
                  <div className='flex-1 min-w-[200px]'>
                    <label className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block'>
                      Membership URL
                    </label>
                    <Input
                      type='url'
                      placeholder='https://example.com/membership'
                      value={membershipUrl}
                      onChange={(e) => setMembershipUrl(e.target.value)}
                      className='h-8 text-xs'
                    />
                  </div>
                  <div className='min-w-[200px]'>
                    <label className='text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block'>
                      Tier Document
                    </label>
                    <div className='flex items-center gap-2'>
                      <input
                        ref={fileInputRef}
                        type='file'
                        className='hidden'
                        accept='.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls'
                        onChange={handleFileChange}
                      />
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        className='h-8 text-xs'
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload className='h-3 w-3 mr-1' />
                        {file ? file.name : 'Browse...'}
                      </Button>
                      {file && (
                        <button
                          type='button'
                          onClick={() => setFile(null)}
                          className='text-muted-foreground hover:text-red-500 transition-colors'
                        >
                          <X className='h-3.5 w-3.5' />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main input row */}
          <div className='flex items-end gap-2'>
            {/* User ID field */}
            <div className='w-40 shrink-0'>
              <Input
                placeholder='User ID or Email'
                value={userIdentifier}
                onChange={(e) => setUserIdentifier(e.target.value)}
                className='h-11 text-sm'
                disabled={isLoading}
              />
            </div>

            {/* Message textarea */}
            <div className='relative flex-1'>
              <textarea
                ref={messageInputRef}
                placeholder='Describe the request or problem...'
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={isLoading}
                className={cn(
                  'flex w-full rounded-xl border border-border/60 bg-white px-4 py-3 pr-10 text-sm',
                  'resize-none overflow-hidden',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cornflower/50',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  'min-h-[44px] max-h-[120px]'
                )}
                style={{ height: '44px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = '44px'
                  target.style.height = Math.min(target.scrollHeight, 120) + 'px'
                }}
              />
            </div>

            {/* Action buttons */}
            <div className='flex items-center gap-1'>
              <Button
                type='button'
                variant='ghost'
                size='icon-sm'
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={cn(
                  'h-11 w-11 rounded-xl text-muted-foreground',
                  showAdvanced && 'bg-brand-cornflower/10 text-brand-cornflower'
                )}
                title='Advanced options (URL, file upload)'
              >
                <FileText className='h-4 w-4' />
              </Button>

              <Button
                type='submit'
                disabled={!userIdentifier.trim() || !userMessage.trim() || isLoading}
                className={cn(
                  'h-11 w-11 rounded-xl',
                  'bg-brand-navy text-white shadow-md',
                  'hover:bg-brand-navy/90 hover:shadow-lg',
                  'disabled:opacity-40 disabled:shadow-none',
                  'transition-all duration-200'
                )}
              >
                {isLoading ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Send className='h-4 w-4' />
                )}
              </Button>
            </div>
          </div>

          {/* Helper text */}
          <p className='mt-2 text-[10px] text-muted-foreground/60'>
            Press Enter to send · Shift+Enter for new line · Click <FileText className='inline h-3 w-3' /> for advanced options
          </p>
        </form>
      </motion.div>
    </div>
  )
}
