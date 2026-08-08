'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Upload,
  FileText,
  User,
  MessageSquare,
  Link2,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Terminal,
  Copy,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8001'

type Status = 'idle' | 'loading' | 'success' | 'error'

export default function TestWorkflowPage() {
  const [customerIdentifier, setCustomerIdentifier] = useState('')
  const [customerMessage, setCustomerMessage] = useState('')
  const [membershipUrl, setMembershipUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [response, setResponse] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [copied, setCopied] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const outputRef = useRef<HTMLPreElement>(null)

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setStatus('loading')
    setResponse('')
    setErrorMessage('')
    startTimer()

    const formData = new FormData()
    formData.append('customer_identifier', customerIdentifier)
    formData.append('customer_message', customerMessage)
    formData.append('membership_program_url', membershipUrl)
    formData.append('tier_benefits_document', file)

    try {
      const res = await fetch(`${API_URL}/api/workflow/execute`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }

      // Read the response body
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
            setResponse(accumulated)
            // Auto-scroll output
            if (outputRef.current) {
              outputRef.current.scrollTop = outputRef.current.scrollHeight
            }
          }
        }
      } else {
        const text = await res.text()
        setResponse(text)
      }

      stopTimer()
      setStatus('success')
    } catch (err: unknown) {
      stopTimer()
      setStatus('error')
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred'
      )
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(response)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) setFile(selected)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }

  const isFormValid =
    customerIdentifier.trim() &&
    customerMessage.trim() &&
    membershipUrl.trim() &&
    file

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    const tenths = Math.floor((ms % 1000) / 100)
    return `${seconds}.${tenths}s`
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-navy to-brand-purple shadow-md">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-brand-navy">
              Workflow Test Console
            </h1>
            <p className="text-sm text-muted-foreground">
              Test the Supervity workflow stream API with your operator
            </p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        {/* Form Panel */}
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border/50 bg-gradient-to-r from-brand-navy/[0.02] to-transparent">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Terminal className="h-4 w-4 text-brand-cornflower" />
                Request Parameters
              </CardTitle>
              <CardDescription>
                Fill in the fields to test the workflow execution
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                {/* Customer Identifier */}
                <div className="space-y-2">
                  <Label
                    htmlFor="customer_identifier"
                    className="flex items-center gap-2 text-foreground"
                  >
                    <User className="h-3.5 w-3.5 text-brand-cornflower" />
                    Customer Identifier
                  </Label>
                  <Input
                    id="customer_identifier"
                    placeholder="e.g. CUST-001 or john@example.com"
                    value={customerIdentifier}
                    onChange={(e) => setCustomerIdentifier(e.target.value)}
                    required
                  />
                </div>

                {/* Customer Message */}
                <div className="space-y-2">
                  <Label
                    htmlFor="customer_message"
                    className="flex items-center gap-2 text-foreground"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-brand-cornflower" />
                    Customer Message
                  </Label>
                  <textarea
                    id="customer_message"
                    rows={4}
                    placeholder="Enter the customer's message or query..."
                    value={customerMessage}
                    onChange={(e) => setCustomerMessage(e.target.value)}
                    required
                    className={cn(
                      'flex w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm',
                      'ring-offset-background resize-none',
                      'placeholder:text-muted-foreground',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cornflower focus-visible:ring-offset-0',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                  />
                </div>

                {/* Membership URL */}
                <div className="space-y-2">
                  <Label
                    htmlFor="membership_url"
                    className="flex items-center gap-2 text-foreground"
                  >
                    <Link2 className="h-3.5 w-3.5 text-brand-cornflower" />
                    Membership Program URL
                  </Label>
                  <Input
                    id="membership_url"
                    type="url"
                    placeholder="https://example.com/membership"
                    value={membershipUrl}
                    onChange={(e) => setMembershipUrl(e.target.value)}
                    required
                  />
                </div>

                {/* File Upload */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-foreground">
                    <FileText className="h-3.5 w-3.5 text-brand-cornflower" />
                    Tier Benefits Document
                  </Label>
                  <div
                    className={cn(
                      'relative cursor-pointer rounded-xl border-2 border-dashed p-6 text-center',
                      'transition-all duration-200',
                      file
                        ? 'border-brand-cornflower/40 bg-brand-cornflower/[0.03]'
                        : 'border-gray-200 hover:border-brand-cornflower/30 hover:bg-gray-50/50'
                    )}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls"
                      onChange={handleFileChange}
                    />
                    <AnimatePresence mode="wait">
                      {file ? (
                        <motion.div
                          key="file-selected"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="flex flex-col items-center gap-2"
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-cornflower/10">
                            <FileText className="h-5 w-5 text-brand-cornflower" />
                          </div>
                          <p className="text-sm font-medium text-foreground">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB · Click to change
                          </p>
                        </motion.div>
                      ) : (
                        <motion.div
                          key="no-file"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="flex flex-col items-center gap-2"
                        >
                          <Upload className="h-8 w-8 text-gray-300" />
                          <p className="text-sm text-muted-foreground">
                            Drop a file here or click to browse
                          </p>
                          <p className="text-xs text-gray-400">
                            PDF, DOCX, TXT, CSV, XLSX
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Submit Button */}
                <Button
                  type="submit"
                  variant="gradient"
                  size="lg"
                  className="w-full"
                  disabled={!isFormValid || status === 'loading'}
                  loading={status === 'loading'}
                >
                  {status === 'loading' ? (
                    'Executing...'
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Execute Workflow
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        {/* Response Panel */}
        <motion.div
          className="lg:col-span-3"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <Card className="flex h-full flex-col overflow-hidden">
            <CardHeader className="flex-shrink-0 border-b border-border/50 bg-gradient-to-r from-brand-navy/[0.02] to-transparent">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Terminal className="h-4 w-4 text-brand-cornflower" />
                    Response Output
                  </CardTitle>
                  <CardDescription>
                    Streaming response from the Supervity API
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {/* Timer */}
                  {(status === 'loading' || elapsedTime > 0) && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className={cn(
                        'rounded-full px-3 py-1 text-xs font-mono font-medium',
                        status === 'loading'
                          ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
                          : status === 'success'
                            ? 'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200'
                            : 'bg-red-50 text-red-600 ring-1 ring-red-200'
                      )}
                    >
                      {formatTime(elapsedTime)}
                    </motion.span>
                  )}

                  {/* Status badge */}
                  <AnimatePresence mode="wait">
                    {status === 'loading' && (
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600 ring-1 ring-amber-200"
                      >
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Streaming
                      </motion.div>
                    )}
                    {status === 'success' && (
                      <motion.div
                        key="success"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600 ring-1 ring-emerald-200"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Complete
                      </motion.div>
                    )}
                    {status === 'error' && (
                      <motion.div
                        key="error"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-600 ring-1 ring-red-200"
                      >
                        <XCircle className="h-3 w-3" />
                        Error
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              <div className="relative flex-1">
                {/* Copy button */}
                {response && (
                  <button
                    onClick={handleCopy}
                    className="absolute right-3 top-3 z-10 rounded-lg bg-white/80 p-2 text-muted-foreground shadow-sm ring-1 ring-black/5 backdrop-blur-sm transition-all hover:bg-white hover:text-foreground"
                    title="Copy response"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                )}

                <pre
                  ref={outputRef}
                  className={cn(
                    'h-full min-h-[400px] overflow-auto p-4 font-mono text-xs leading-relaxed',
                    'scrollbar-hide',
                    status === 'idle' && !response
                      ? 'flex items-center justify-center text-muted-foreground/50'
                      : 'text-foreground'
                  )}
                >
                  {status === 'idle' && !response ? (
                    <span className="flex flex-col items-center gap-3">
                      <Terminal className="h-8 w-8 text-gray-200" />
                      <span className="text-sm">
                        Response will appear here...
                      </span>
                    </span>
                  ) : status === 'error' ? (
                    <span className="text-red-500">
                      {`Error: ${errorMessage}`}
                    </span>
                  ) : (
                    <code className="whitespace-pre-wrap break-words">
                      {response}
                      {status === 'loading' && (
                        <span className="inline-block h-4 w-1.5 animate-pulse bg-brand-cornflower/60 align-middle" />
                      )}
                    </code>
                  )}
                </pre>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
