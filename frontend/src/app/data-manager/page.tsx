'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Button } from '@/components/ui/button'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Integration {
  id: number
  name: string
  description: string | null
  category: string
  provider: string | null
  status: string
  last_checked_at: string | null
  last_success_at: string | null
  error_message: string | null
  is_active: boolean
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const categoryConfig: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  channel: { label: 'Channel (Ticket Intake)', icon: Icons.mail, color: 'bg-blue-500' },
  system_of_record: { label: 'System of Record', icon: Icons.fileText, color: 'bg-purple-500' },
  human_loop: { label: 'Human Loop', icon: Icons.users, color: 'bg-amber-500' },
  storage: { label: 'Storage', icon: Icons.download, color: 'bg-slate-500' },
}

const statusConfig: Record<string, { label: string; dot: string; badge: string }> = {
  healthy: { label: 'Healthy', dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  degraded: { label: 'Degraded', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
  down: { label: 'Down', dot: 'bg-red-500', badge: 'bg-red-100 text-red-700' },
  unknown: { label: 'Unknown', dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600' },
}

const providerIcons: Record<string, string> = {
  'Microsoft Teams': '🟦',
  Supabase: '🟢',
  Airtable: '🟠',
  Jira: '🔵',
  Slack: '🟣',
  Outlook: '🔷',
}

// ─────────────────────────────────────────────
// Integration Card
// ─────────────────────────────────────────────

function IntegrationCard({ integration, onHealthCheck }: { integration: Integration; onHealthCheck: (id: number) => void }) {
  const [checking, setChecking] = useState(false)
  const status = statusConfig[integration.status] || statusConfig.unknown
  const catCfg = categoryConfig[integration.category] || { label: integration.category, icon: Icons.share, color: 'bg-slate-400' }
  const CategoryIcon = catCfg.icon
  const providerEmoji = integration.provider ? (providerIcons[integration.provider] || '🔌') : '🔌'

  const timeAgo = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-2xl border bg-white/80 backdrop-blur-sm p-5 shadow-sm transition-shadow hover:shadow-md',
        integration.status === 'down' && 'border-red-200 ring-1 ring-red-100',
        integration.status === 'degraded' && 'border-amber-200 ring-1 ring-amber-100',
      )}
    >
      <div className='flex items-start gap-4'>
        {/* Provider icon */}
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl', catCfg.color, 'bg-opacity-10')}>
          <span>{providerEmoji}</span>
        </div>

        <div className='min-w-0 flex-1'>
          {/* Top row */}
          <div className='flex items-start gap-2'>
            <div className='min-w-0 flex-1'>
              <p className='font-semibold text-brand-navy leading-tight'>{integration.name}</p>
              {integration.provider && (
                <p className='text-xs text-muted-foreground'>{integration.provider}</p>
              )}
            </div>
            {/* Status badge */}
            <div className='flex items-center gap-1.5 shrink-0'>
              <span className={cn('relative flex h-2 w-2')}>
                {integration.status === 'healthy' && (
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50' />
                )}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', status.dot)} />
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', status.badge)}>
                {status.label}
              </span>
            </div>
          </div>

          {/* Description */}
          {integration.description && (
            <p className='mt-1.5 text-sm text-muted-foreground line-clamp-2'>{integration.description}</p>
          )}

          {/* Category + timestamps */}
          <div className='mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground'>
            <div className='flex items-center gap-1'>
              <CategoryIcon className='h-3 w-3' strokeWidth={1.5} />
              <span>{catCfg.label}</span>
            </div>
            <span>·</span>
            <span>Checked {timeAgo(integration.last_checked_at)}</span>
            {integration.last_success_at && (
              <>
                <span>·</span>
                <span className='text-emerald-600'>Last OK {timeAgo(integration.last_success_at)}</span>
              </>
            )}
          </div>

          {/* Error message */}
          {integration.error_message && (
            <div className='mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-1.5'>
              <p className='text-[11px] text-red-700'>{integration.error_message}</p>
            </div>
          )}

          {/* Health check button */}
          <div className='mt-3'>
            <Button
              size='sm'
              variant='outline'
              disabled={checking || !integration.is_active}
              onClick={async () => {
                setChecking(true)
                await onHealthCheck(integration.id)
                setChecking(false)
              }}
              className='text-xs'
            >
              {checking ? (
                <><Icons.loader className='mr-1.5 h-3 w-3 animate-spin' />Checking…</>
              ) : (
                <><Icons.activity className='mr-1.5 h-3 w-3' />Run Health Check</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Summary bar
// ─────────────────────────────────────────────

function SummaryBar({ integrations }: { integrations: Integration[] }) {
  const healthy = integrations.filter((i) => i.status === 'healthy').length
  const degraded = integrations.filter((i) => i.status === 'degraded').length
  const down = integrations.filter((i) => i.status === 'down').length
  const total = integrations.length

  return (
    <div className='grid grid-cols-4 gap-4'>
      {[
        { label: 'Total', value: total, color: 'text-brand-navy', bg: 'bg-brand-navy/10' },
        { label: 'Healthy', value: healthy, color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { label: 'Degraded', value: degraded, color: 'text-amber-600', bg: 'bg-amber-50' },
        { label: 'Down', value: down, color: 'text-red-600', bg: 'bg-red-50' },
      ].map(({ label, value, color, bg }) => (
        <Card key={label} className={cn('relative overflow-hidden border-0', bg)}>
          <CardContent className='p-4'>
            <p className={cn('text-2xl font-bold', color)}>{value}</p>
            <p className='text-xs text-muted-foreground'>{label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

export default function DataManagerPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingAll, setCheckingAll] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const fetchIntegrations = useCallback(async () => {
    try {
      const data = await apiClient.get<Integration[]>('/api/service-desk/integrations')
      setIntegrations(data)
    } catch (err) {
      console.error('[DataManager] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchIntegrations()
    const interval = setInterval(fetchIntegrations, 30_000)
    return () => clearInterval(interval)
  }, [fetchIntegrations])

  const handleHealthCheck = async (id: number) => {
    try {
      await apiClient.post(`/api/service-desk/integrations/${id}/health-check`)
      await fetchIntegrations()
    } catch (err) {
      console.error('[DataManager] Health check failed:', err)
    }
  }

  const handleCheckAll = async () => {
    setCheckingAll(true)
    for (const i of integrations) {
      try {
        await apiClient.post(`/api/service-desk/integrations/${i.id}/health-check`)
      } catch (_) {}
    }
    await fetchIntegrations()
    setCheckingAll(false)
  }

  const categories = ['all', ...Array.from(new Set(integrations.map((i) => i.category)))]

  const filtered = categoryFilter === 'all'
    ? integrations
    : integrations.filter((i) => i.category === categoryFilter)

  return (
    <motion.div className='space-y-8' variants={containerVariants} initial='hidden' animate='visible'>
      {/* Header */}
      <motion.div variants={itemVariants} className='flex items-end justify-between'>
        <div>
          <h1 className='font-display text-display-3 font-bold tracking-tight text-brand-navy'>
            Data Manager
          </h1>
          <p className='mt-1 text-muted-foreground'>
            Live registry of every connected system and its health status
          </p>
        </div>
        <div className='flex items-center gap-3'>
          {loading && <Icons.loader className='h-4 w-4 animate-spin text-brand-muted' />}
          <Button
            variant='outline'
            size='sm'
            onClick={handleCheckAll}
            disabled={checkingAll}
          >
            {checkingAll ? (
              <><Icons.loader className='mr-2 h-4 w-4 animate-spin' />Checking all…</>
            ) : (
              <><Icons.activity className='mr-2 h-4 w-4' />Check All</>
            )}
          </Button>
        </div>
      </motion.div>

      {/* Summary */}
      <motion.div variants={itemVariants}>
        <SummaryBar integrations={integrations} />
      </motion.div>

      {/* Category filter tabs */}
      <motion.div variants={itemVariants}>
        <div className='flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-fit'>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all',
                categoryFilter === cat
                  ? 'bg-white text-brand-navy shadow-sm'
                  : 'text-brand-muted hover:text-brand-navy'
              )}
            >
              {cat === 'all' ? 'All' : (categoryConfig[cat]?.label ?? cat)}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Integration grid */}
      {loading && integrations.length === 0 ? (
        <motion.div variants={itemVariants} className='flex items-center justify-center py-20'>
          <Icons.loader className='h-8 w-8 animate-spin text-brand-muted' />
        </motion.div>
      ) : filtered.length === 0 ? (
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-16 space-y-3'>
              <Icons.share className='h-10 w-10 text-brand-muted' strokeWidth={1} />
              <p className='font-semibold text-brand-navy'>No integrations found</p>
              <p className='text-sm text-muted-foreground'>
                Add integrations via the Supervity Data Manager or configure them in your .env file.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <motion.div variants={itemVariants} className='grid gap-5 lg:grid-cols-2'>
          <AnimatePresence>
            {filtered.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onHealthCheck={handleHealthCheck}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      )}

    </motion.div>
  )
}
