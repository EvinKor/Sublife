'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiClient } from '@/lib/api-client'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Button } from '@/components/ui/button'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface WorkbenchItem {
  id: number
  ticket_key: string | null
  exception_type: string
  title: string
  description: string | null
  agent_diagnosis: string | null
  agent_recommendation: string | null
  correlated_tickets: string[] | null
  policy_evaluation: Record<string, unknown> | null
  sla_time_remaining_minutes: number | null
  priority: string
  is_vip: boolean
  status: string
  resolved_by: string | null
  resolution_note: string | null
  resolved_at: string | null
  created_at: string
}

// ─────────────────────────────────────────────
// Animations
// ─────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
}

// ─────────────────────────────────────────────
// Priority badge
// ─────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    P1: 'bg-red-100 text-red-700 border-red-200',
    P2: 'bg-orange-100 text-orange-700 border-orange-200',
    P3: 'bg-amber-100 text-amber-700 border-amber-200',
    P4: 'bg-slate-100 text-slate-600 border-slate-200',
  }
  return (
    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', map[priority] || map.P3)}>
      {priority}
    </span>
  )
}

function ExceptionTypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    risky_remediation: 'Risky Fix',
    change_approval: 'Change Approval',
    major_incident: 'Major Incident',
    vip_breach: 'VIP Breach',
    unknown_category: 'Unknown',
    csat_poor: 'Poor CSAT',
  }
  const colors: Record<string, string> = {
    risky_remediation: 'bg-purple-100 text-purple-700',
    change_approval: 'bg-blue-100 text-blue-700',
    major_incident: 'bg-red-100 text-red-700',
    vip_breach: 'bg-amber-100 text-amber-700',
    csat_poor: 'bg-pink-100 text-pink-700',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', colors[type] || 'bg-slate-100 text-slate-600')}>
      {labels[type] || type.replace(/_/g, ' ')}
    </span>
  )
}

// ─────────────────────────────────────────────
// Workbench Item Card
// ─────────────────────────────────────────────

function WorkbenchCard({
  item,
  onResolve,
}: {
  item: WorkbenchItem
  onResolve: (id: number, action: string, note?: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [note, setNote] = useState('')

  const slaUrgent = item.sla_time_remaining_minutes !== null && item.sla_time_remaining_minutes < 30

  return (
    <motion.div
      variants={itemVariants}
      layout
      className={cn(
        'rounded-2xl border bg-white/80 backdrop-blur-sm shadow-sm transition-shadow hover:shadow-md',
        item.is_vip && 'border-amber-300 ring-1 ring-amber-200',
        slaUrgent && 'border-red-300 ring-1 ring-red-200',
      )}
    >
      {/* Header */}
      <div className='flex items-start gap-4 p-5'>
        {/* Priority dot */}
        <div className={cn(
          'mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white font-bold text-sm',
          item.priority === 'P1' ? 'bg-red-500' :
          item.priority === 'P2' ? 'bg-orange-500' :
          item.priority === 'P3' ? 'bg-amber-500' : 'bg-slate-400'
        )}>
          {item.priority}
        </div>

        <div className='min-w-0 flex-1 space-y-1'>
          <div className='flex flex-wrap items-center gap-2'>
            {item.ticket_key && (
              <span className='font-mono text-xs font-semibold text-brand-cornflower bg-brand-cornflower/10 rounded-md px-1.5 py-0.5'>
                {item.ticket_key}
              </span>
            )}
            <ExceptionTypeBadge type={item.exception_type} />
            {item.is_vip && (
              <span className='rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700'>
                ⭐ VIP
              </span>
            )}
            {slaUrgent && (
              <span className='rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 animate-pulse'>
                🚨 {item.sla_time_remaining_minutes}m left
              </span>
            )}
          </div>
          <p className='font-semibold text-brand-navy leading-snug'>{item.title}</p>
          {item.description && (
            <p className='text-sm text-muted-foreground line-clamp-2'>{item.description}</p>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className='ml-2 shrink-0 rounded-lg p-1.5 text-brand-muted hover:bg-muted hover:text-brand-navy transition-colors'
        >
          <Icons.chevronRight
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
            strokeWidth={2}
          />
        </button>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='overflow-hidden'
          >
            <div className='border-t border-border/50 px-5 pb-5 pt-4 space-y-4'>
              {/* Agent diagnosis */}
              {item.agent_diagnosis && (
                <div className='rounded-xl border border-blue-100 bg-blue-50 p-3 space-y-1'>
                  <p className='text-[10px] font-bold uppercase tracking-wider text-blue-600'>
                    Agent Diagnosis
                  </p>
                  <p className='text-sm text-blue-900'>{item.agent_diagnosis}</p>
                </div>
              )}

              {/* Agent recommendation */}
              {item.agent_recommendation && (
                <div className='rounded-xl border border-purple-100 bg-purple-50 p-3 space-y-1'>
                  <p className='text-[10px] font-bold uppercase tracking-wider text-purple-600'>
                    Recommendation
                  </p>
                  <p className='text-sm text-purple-900'>{item.agent_recommendation}</p>
                </div>
              )}

              {/* Correlated tickets */}
              {item.correlated_tickets && item.correlated_tickets.length > 0 && (
                <div>
                  <p className='mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground'>
                    Correlated Tickets ({item.correlated_tickets.length})
                  </p>
                  <div className='flex flex-wrap gap-1.5'>
                    {item.correlated_tickets.map((key) => (
                      <span key={key} className='rounded-md bg-brand-cornflower/10 px-1.5 py-0.5 font-mono text-[11px] text-brand-cornflower'>
                        {key}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Resolution actions */}
              {item.status === 'pending' && (
                <div className='space-y-3 rounded-xl border border-border/50 bg-muted/20 p-3'>
                  <p className='text-xs font-semibold text-brand-navy'>Resolve this exception</p>
                  <textarea
                    className='w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-cornflower/30'
                    rows={2}
                    placeholder='Optional resolution note...'
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      variant='gradient'
                      disabled={resolving}
                      onClick={async () => {
                        setResolving(true)
                        await onResolve(item.id, 'approve', note)
                        setResolving(false)
                      }}
                    >
                      <Icons.checkCircle className='mr-1.5 h-3.5 w-3.5' />
                      Approve
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      className='border-red-200 text-red-600 hover:bg-red-50'
                      disabled={resolving}
                      onClick={async () => {
                        setResolving(true)
                        await onResolve(item.id, 'reject', note)
                        setResolving(false)
                      }}
                    >
                      <Icons.close className='mr-1.5 h-3.5 w-3.5' />
                      Reject
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={resolving}
                      onClick={async () => {
                        setResolving(true)
                        await onResolve(item.id, 'reassign', note)
                        setResolving(false)
                      }}
                    >
                      <Icons.share className='mr-1.5 h-3.5 w-3.5' />
                      Reassign
                    </Button>
                  </div>
                </div>
              )}

              {/* Already resolved */}
              {item.status !== 'pending' && (
                <div className='rounded-xl border border-emerald-100 bg-emerald-50 p-3 space-y-1'>
                  <p className='text-[10px] font-bold uppercase tracking-wider text-emerald-600'>Resolved</p>
                  <p className='text-sm text-emerald-800'>
                    {item.status.charAt(0).toUpperCase() + item.status.slice(1)} by {item.resolved_by || 'human'}
                    {item.resolution_note && ` — ${item.resolution_note}`}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function WorkbenchPage() {
  const [items, setItems] = useState<WorkbenchItem[]>([])
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [loading, setLoading] = useState(true)

  const fetchItems = useCallback(async () => {
    try {
      const data = await apiClient.get<WorkbenchItem[]>(`/api/service-desk/workbench?status=${statusFilter}`)
      setItems(data)
    } catch (err) {
      console.error('[Workbench] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    setLoading(true)
    fetchItems()
    const interval = setInterval(fetchItems, 10_000)
    return () => clearInterval(interval)
  }, [fetchItems])

  const handleResolve = async (id: number, action: string, note?: string) => {
    try {
      await apiClient.post(`/api/service-desk/workbench/${id}/resolve`, {
        action,
        resolution_note: note || undefined,
      })
      await fetchItems()
    } catch (err) {
      console.error('[Workbench] Resolve failed:', err)
    }
  }

  const pending = items.filter((i) => i.status === 'pending')
  const vipItems = pending.filter((i) => i.is_vip)
  const urgentItems = pending.filter((i) => !i.is_vip && i.sla_time_remaining_minutes !== null && i.sla_time_remaining_minutes < 30)
  const regularItems = pending.filter((i) => !i.is_vip && !(i.sla_time_remaining_minutes !== null && i.sla_time_remaining_minutes < 30))

  return (
    <motion.div className='space-y-8' variants={containerVariants} initial='hidden' animate='visible'>
      {/* Header */}
      <motion.div variants={itemVariants}>
        <div className='flex items-center justify-between'>
          <div>
            <h1 className='font-display text-display-3 font-bold tracking-tight text-brand-navy'>
              Human Workbench
            </h1>
            <p className='mt-1 text-muted-foreground'>
              Exceptions escalated by the AI — review with full context and resolve
            </p>
          </div>
          <div className='flex items-center gap-2'>
            {loading && <Icons.loader className='h-4 w-4 animate-spin text-brand-muted' />}
            <span className={cn(
              'rounded-full px-3 py-1.5 text-sm font-semibold',
              pending.length > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
            )}>
              {pending.length} pending
            </span>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className='mt-4 flex gap-1 rounded-xl border border-border bg-muted/40 p-1 w-fit'>
          {(['pending', 'approved', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                'rounded-lg px-4 py-1.5 text-sm font-medium capitalize transition-all',
                statusFilter === s
                  ? 'bg-white text-brand-navy shadow-sm'
                  : 'text-brand-muted hover:text-brand-navy'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Items list */}
      {loading && items.length === 0 ? (
        <motion.div variants={itemVariants} className='flex items-center justify-center py-20'>
          <div className='text-center space-y-3'>
            <Icons.loader className='mx-auto h-8 w-8 animate-spin text-brand-muted' />
            <p className='text-muted-foreground'>Loading exceptions…</p>
          </div>
        </motion.div>
      ) : items.length === 0 ? (
        <motion.div variants={itemVariants}>
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-16 space-y-3'>
              <div className='flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100'>
                <Icons.checkCircle className='h-7 w-7 text-emerald-500' strokeWidth={1.5} />
              </div>
              <p className='font-semibold text-brand-navy'>
                {statusFilter === 'pending' ? 'All clear — no pending exceptions' : `No ${statusFilter} items`}
              </p>
              <p className='text-sm text-muted-foreground'>
                {statusFilter === 'pending'
                  ? 'The AI Employees are handling everything. You\'ll be notified via Teams when review is needed.'
                  : 'Items resolved by your team will appear here.'}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <div className='space-y-6'>
          {/* VIP items */}
          {vipItems.length > 0 && (
            <div className='space-y-3'>
              <h2 className='text-xs font-bold uppercase tracking-widest text-amber-600 flex items-center gap-2'>
                <span>⭐ VIP Escalations</span>
                <span className='rounded-full bg-amber-100 px-2 py-0.5 text-amber-700'>{vipItems.length}</span>
              </h2>
              <AnimatePresence>
                {vipItems.map((item) => (
                  <WorkbenchCard key={item.id} item={item} onResolve={handleResolve} />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* SLA urgent */}
          {urgentItems.length > 0 && (
            <div className='space-y-3'>
              <h2 className='text-xs font-bold uppercase tracking-widest text-red-600 flex items-center gap-2'>
                <span>🚨 SLA Critical</span>
                <span className='rounded-full bg-red-100 px-2 py-0.5 text-red-700'>{urgentItems.length}</span>
              </h2>
              <AnimatePresence>
                {urgentItems.map((item) => (
                  <WorkbenchCard key={item.id} item={item} onResolve={handleResolve} />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Regular items */}
          {regularItems.length > 0 && (
            <div className='space-y-3'>
              <h2 className='text-xs font-bold uppercase tracking-widest text-brand-muted'>
                Pending Review
              </h2>
              <AnimatePresence>
                {regularItems.map((item) => (
                  <WorkbenchCard key={item.id} item={item} onResolve={handleResolve} />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Resolved items (other statuses) */}
          {statusFilter !== 'pending' && items.map((item) => (
            <WorkbenchCard key={item.id} item={item} onResolve={handleResolve} />
          ))}
        </div>
      )}
    </motion.div>
  )
}
