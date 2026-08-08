'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Button } from '@/components/ui/button'
import { Icons } from '@/components/ui/icons'
import { cn } from '@/lib/utils'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface KPIs {
  total_open: number
  total_resolved_today: number
  sla_compliance_pct: number
  auto_resolution_rate: number
  avg_mttr_hours: number
  open_major_incidents: number
  csat_avg: number
  pending_workbench: number
  tickets_at_risk: number
}

interface ActivityItem {
  id: number
  operator: string
  action: string
  ticket_key: string | null
  result: string | null
  details: Record<string, unknown> | null
  created_at: string
}

interface WorkbenchItem {
  id: number
  ticket_key: string | null
  title: string
  priority: string
  is_vip: boolean
  status: string
  created_at: string
}

// ─────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
}

// ─────────────────────────────────────────────
// Animated Counter
// ─────────────────────────────────────────────

function AnimatedNumber({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const animated = useRef(false)

  useEffect(() => {
    if (!inView || animated.current) return
    animated.current = true
    const start = performance.now()
    const duration = 900
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(2, -10 * t)
      setDisplay(eased * value)
      if (t < 1) requestAnimationFrame(animate)
      else setDisplay(value)
    }
    requestAnimationFrame(animate)
  }, [value, inView])

  return (
    <span ref={ref}>
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display)}
      {suffix}
    </span>
  )
}

// ─────────────────────────────────────────────
// Operator labels
// ─────────────────────────────────────────────

const operatorColors: Record<string, string> = {
  sla_triage: 'bg-blue-500',
  diagnose_correlate: 'bg-purple-500',
  remediate: 'bg-emerald-500',
  comms: 'bg-amber-500',
  csat_kb: 'bg-pink-500',
  orchestrator: 'bg-brand-navy',
  human: 'bg-slate-500',
}

const operatorLabels: Record<string, string> = {
  sla_triage: 'SLA Triage',
  diagnose_correlate: 'Diagnose & Correlate',
  remediate: 'Remediate',
  comms: 'Requester Comms',
  csat_kb: 'CSAT & KB',
  orchestrator: 'Orchestrator',
  human: 'Human',
}

// ─────────────────────────────────────────────
// KPI Card (simplified)
// ─────────────────────────────────────────────

interface KPICardProps {
  title: string
  value: number
  suffix?: string
  decimals?: number
  icon: React.ElementType
  colorClass: string
  subtitle?: string
  alert?: boolean
}

function KPICard({ title, value, suffix = '', decimals = 0, icon: Icon, colorClass, subtitle, alert }: KPICardProps) {
  return (
    <motion.div variants={itemVariants} whileHover={{ y: -4 }}>
      <Card className={cn('group relative h-full cursor-default overflow-hidden', alert && 'ring-2 ring-red-400/60')}>
        <CardWatermark opacity={3} scale={0.9} />
        <CardContent className='relative z-10 p-6'>
          <div className='flex items-start justify-between'>
            <div className='space-y-3 min-w-0'>
              <p className='text-xs font-semibold uppercase tracking-widest text-brand-muted transition-colors duration-200 group-hover:text-brand-cornflower'>
                {title}
              </p>
              <p className='font-display text-4xl font-bold leading-none tracking-tight text-brand-navy'>
                <AnimatedNumber value={value} suffix={suffix} decimals={decimals} />
              </p>
              {subtitle && (
                <p className='text-xs text-muted-foreground'>{subtitle}</p>
              )}
            </div>
            <motion.div
              className={cn('rounded-xl p-3 text-white shadow-lg shrink-0', colorClass)}
              whileHover={{ scale: 1.15, rotate: 5 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            >
              <Icon className='h-5 w-5' strokeWidth={1.5} />
            </motion.div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ─────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────

const EMPTY_KPIS: KPIs = {
  total_open: 0,
  total_resolved_today: 0,
  sla_compliance_pct: 0,
  auto_resolution_rate: 0,
  avg_mttr_hours: 0,
  open_major_incidents: 0,
  csat_avg: 0,
  pending_workbench: 0,
  tickets_at_risk: 0,
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export default function HomePage() {
  const [kpis, setKpis] = useState<KPIs>(EMPTY_KPIS)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [workbench, setWorkbench] = useState<WorkbenchItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const [kpiData, activityData, workbenchData] = await Promise.all([
        apiClient.get<KPIs>('/api/service-desk/kpis'),
        apiClient.get<ActivityItem[]>('/api/service-desk/activity?limit=10'),
        apiClient.get<WorkbenchItem[]>('/api/service-desk/workbench?status=pending'),
      ])
      setKpis(kpiData)
      setActivity(activityData)
      setWorkbench(Array.isArray(workbenchData) ? workbenchData.slice(0, 3) : [])
    } catch (err) {
      console.error('[Dashboard] Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15_000)
    return () => clearInterval(interval)
  }, [fetchData])

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <motion.div className='space-y-8' variants={containerVariants} initial='hidden' animate='visible'>
      {/* ─── Hero Section ─── */}
      <motion.div variants={itemVariants}>
        <div className='relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-navy via-brand-navy to-brand-purple p-8 lg:p-10'>
          {/* Decorative dots */}
          <div className='absolute right-0 top-0 h-full w-1/3 opacity-10'>
            <svg className='h-full w-full' viewBox='0 0 200 200'>
              {Array.from({ length: 100 }).map((_, i) => (
                <circle
                  key={i}
                  cx={(i % 10) * 22 + 10}
                  cy={Math.floor(i / 10) * 22 + 10}
                  r='1.5'
                  fill='white'
                />
              ))}
            </svg>
          </div>

          <div className='relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between'>
            <div className='space-y-3'>
              <p className='text-sm font-medium text-white/60'>{greeting}</p>
              <h1 className='font-display text-3xl font-bold tracking-tight text-white lg:text-4xl'>
                Master Orchestrator
              </h1>
              <p className='max-w-lg text-sm leading-relaxed text-white/70'>
                Your dual-purpose AI assistant for SubLife subscription support and
                internal IT operations. Send a message to get started.
              </p>
            </div>

            <div className='flex flex-wrap gap-3'>
              <Link href='/test-workflow'>
                <Button
                  size='lg'
                  className={cn(
                    'bg-white text-brand-navy font-semibold shadow-lg',
                    'hover:bg-white/90 hover:shadow-xl',
                    'transition-all duration-200'
                  )}
                >
                  <Icons.zap className='h-4 w-4 mr-2' strokeWidth={2} />
                  Run Operator
                </Button>
              </Link>
              <Link href='/workbench'>
                <Button
                  size='lg'
                  variant='outline'
                  className={cn(
                    'border-white/30 text-white bg-white/10',
                    'hover:bg-white/20 hover:border-white/50',
                    'transition-all duration-200'
                  )}
                >
                  <Icons.workbench className='h-4 w-4 mr-2' strokeWidth={1.5} />
                  View Workbench
                  {kpis.pending_workbench > 0 && (
                    <span className='ml-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white'>
                      {kpis.pending_workbench}
                    </span>
                  )}
                </Button>
              </Link>
            </div>
          </div>

          {/* Loading indicator */}
          {loading && (
            <div className='absolute bottom-3 right-3'>
              <Icons.loader className='h-4 w-4 animate-spin text-white/40' />
            </div>
          )}
        </div>
      </motion.div>

      {/* ─── KPI Cards ─── */}
      <div className='grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3'>
        <KPICard
          title='Open Tickets'
          value={kpis.total_open}
          icon={Icons.fileText}
          colorClass='bg-brand-navy'
          subtitle={`${kpis.total_resolved_today} resolved today`}
        />
        <KPICard
          title='SLA Compliance'
          value={kpis.sla_compliance_pct}
          suffix='%'
          decimals={1}
          icon={Icons.checkCircle}
          colorClass={kpis.sla_compliance_pct >= 90 ? 'bg-emerald-500' : kpis.sla_compliance_pct >= 75 ? 'bg-amber-500' : 'bg-red-500'}
          subtitle={kpis.tickets_at_risk > 0 ? `${kpis.tickets_at_risk} at risk` : 'All on track'}
          alert={kpis.tickets_at_risk > 0}
        />
        <KPICard
          title='Workbench Queue'
          value={kpis.pending_workbench}
          icon={Icons.workbench}
          colorClass={kpis.pending_workbench > 0 ? 'bg-amber-500' : 'bg-emerald-500'}
          subtitle={kpis.pending_workbench > 0 ? 'Awaiting review' : 'All clear'}
          alert={kpis.pending_workbench > 0}
        />
      </div>

      {/* ─── Bottom Two-Column ─── */}
      <motion.div variants={itemVariants} className='grid gap-6 lg:grid-cols-2'>
        {/* Live Activity Feed */}
        <Card className='relative overflow-hidden'>
          <CardWatermark opacity={2} scale={1.2} />
          <CardHeader className='relative z-10 pb-3'>
            <CardTitle className='flex items-center justify-between text-base'>
              <span className='flex items-center gap-2'>
                <span className='relative flex h-2.5 w-2.5'>
                  <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
                  <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
                </span>
                Live Activity
              </span>
              <Link href='/ai/manager' className='text-xs font-normal text-brand-cornflower hover:underline'>
                View all →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className='relative z-10 px-4 pb-4'>
            {activity.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-10 text-center'>
                <Icons.activity className='h-8 w-8 text-muted-foreground/30 mb-3' />
                <p className='text-sm text-muted-foreground'>No agent activity yet.</p>
                <p className='text-xs text-muted-foreground/60 mt-1'>Run the Operator to see live actions here.</p>
              </div>
            ) : (
              <div className='space-y-2 max-h-80 overflow-y-auto scrollbar-hide'>
                <AnimatePresence initial={false}>
                  {activity.map((a) => (
                    <motion.div
                      key={a.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      className='flex items-start gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5'
                    >
                      <div className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white', operatorColors[a.operator] || 'bg-slate-400')}>
                        {(operatorLabels[a.operator] || a.operator).charAt(0).toUpperCase()}
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          <span className='text-xs font-semibold text-brand-navy'>
                            {operatorLabels[a.operator] || a.operator}
                          </span>
                          {a.ticket_key && (
                            <span className='rounded-full bg-brand-cornflower/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-cornflower'>
                              {a.ticket_key}
                            </span>
                          )}
                          {a.result && (
                            <span className={cn('ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold', a.result === 'success' ? 'bg-emerald-100 text-emerald-700' : a.result === 'escalated' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700')}>
                              {a.result}
                            </span>
                          )}
                        </div>
                        <p className='truncate text-xs text-muted-foreground'>{a.action}</p>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Workbench Preview */}
        <Card className='relative overflow-hidden'>
          <CardWatermark opacity={2} scale={1.1} />
          <CardHeader className='relative z-10 pb-3'>
            <CardTitle className='flex items-center justify-between text-base'>
              <span className='flex items-center gap-2'>
                <Icons.workbench className='h-4 w-4 text-brand-cornflower' strokeWidth={1.5} />
                Pending Escalations
              </span>
              <Link href='/workbench' className='text-xs font-normal text-brand-cornflower hover:underline'>
                View all →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className='relative z-10 px-4 pb-4'>
            {workbench.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-10 text-center'>
                <Icons.checkCircle className='h-8 w-8 text-emerald-400/50 mb-3' />
                <p className='text-sm text-muted-foreground'>No pending escalations.</p>
                <p className='text-xs text-muted-foreground/60 mt-1'>The AI is handling everything automatically.</p>
              </div>
            ) : (
              <div className='space-y-2'>
                {workbench.map((item) => (
                  <Link href='/workbench' key={item.id}>
                    <div className='group flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-4 py-3 transition-all duration-200 hover:bg-muted/40 hover:border-brand-cornflower/30'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-2'>
                          {item.ticket_key && (
                            <span className='rounded-full bg-brand-cornflower/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-brand-cornflower'>
                              {item.ticket_key}
                            </span>
                          )}
                          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase', {
                            'bg-red-100 text-red-700 border-red-200': item.priority === 'P1',
                            'bg-orange-100 text-orange-700 border-orange-200': item.priority === 'P2',
                            'bg-amber-100 text-amber-700 border-amber-200': item.priority === 'P3',
                            'bg-slate-100 text-slate-600 border-slate-200': item.priority === 'P4',
                          })}>
                            {item.priority}
                          </span>
                          {item.is_vip && (
                            <span className='rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700'>
                              VIP
                            </span>
                          )}
                        </div>
                        <p className='mt-1 truncate text-sm text-foreground'>{item.title}</p>
                      </div>
                      <Icons.chevronRight className='h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-1 group-hover:text-brand-cornflower' />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
