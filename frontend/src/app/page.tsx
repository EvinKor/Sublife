'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, useInView, AnimatePresence } from 'framer-motion'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
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

// ─────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] } },
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
// KPI Card
// ─────────────────────────────────────────────

interface KPICardProps {
  title: string
  value: number
  suffix?: string
  decimals?: number
  icon: React.ElementType
  colorClass: string
  trend?: { label: string; positive: boolean }
  alert?: boolean
  delay?: number
}

function KPICard({ title, value, suffix = '', decimals = 0, icon: Icon, colorClass, trend, alert, delay = 0 }: KPICardProps) {
  return (
    <motion.div variants={itemVariants} transition={{ delay }} whileHover={{ y: -4 }}>
      <Card className={cn('group relative h-full cursor-default overflow-hidden', alert && 'ring-2 ring-red-400/60')}>
        <CardWatermark opacity={3} scale={0.9} />
        <CardContent className='relative z-10 p-5'>
          <div className='flex items-start justify-between'>
            <div className='space-y-2 min-w-0'>
              <p className='text-[11px] font-semibold uppercase tracking-widest text-brand-muted transition-colors duration-200 group-hover:text-brand-cornflower'>
                {title}
              </p>
              <p className='font-display text-[2.1rem] font-bold leading-none tracking-tight text-brand-navy'>
                <AnimatedNumber value={value} suffix={suffix} decimals={decimals} />
              </p>
              {trend && (
                <p className={cn('flex items-center gap-1 text-xs font-medium', trend.positive ? 'text-emerald-600' : 'text-red-500')}>
                  {trend.positive ? <Icons.trendingUp className='h-3 w-3' strokeWidth={2} /> : <Icons.trendingUp className='h-3 w-3 rotate-180' strokeWidth={2} />}
                  {trend.label}
                </p>
              )}
            </div>
            <motion.div
              className={cn('rounded-xl p-2.5 text-white shadow-lg shrink-0', colorClass)}
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
// Live Activity Feed
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

function ActivityFeed({ activities }: { activities: ActivityItem[] }) {
  return (
    <Card className='relative overflow-hidden'>
      <CardWatermark opacity={2} scale={1.2} />
      <CardHeader className='relative z-10 pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <span className='relative flex h-2.5 w-2.5'>
            <span className='absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75' />
            <span className='relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500' />
          </span>
          Live Agent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className='relative z-10 px-4 pb-4'>
        {activities.length === 0 ? (
          <p className='py-6 text-center text-sm text-muted-foreground'>No agent activity yet. Supervity Operators will appear here.</p>
        ) : (
          <div className='space-y-2 max-h-72 overflow-y-auto scrollbar-hide'>
            <AnimatePresence initial={false}>
              {activities.map((a) => (
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
  )
}

// ─────────────────────────────────────────────
// SLA Risk Bar Chart (simple visual)
// ─────────────────────────────────────────────

function SLARiskBar({ compliance, atRisk }: { compliance: number; atRisk: number }) {
  return (
    <Card className='relative overflow-hidden'>
      <CardWatermark opacity={2} scale={1.1} />
      <CardHeader className='relative z-10 pb-3'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Icons.activity className='h-4 w-4 text-brand-cornflower' strokeWidth={1.5} />
          SLA Health Overview
        </CardTitle>
      </CardHeader>
      <CardContent className='relative z-10 space-y-4 px-5 pb-5'>
        <div className='space-y-2'>
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <span>SLA Compliance</span>
            <span className='font-semibold text-brand-navy'>{compliance.toFixed(1)}%</span>
          </div>
          <div className='h-3 w-full overflow-hidden rounded-full bg-muted'>
            <motion.div
              className={cn('h-full rounded-full', compliance >= 90 ? 'bg-emerald-500' : compliance >= 75 ? 'bg-amber-500' : 'bg-red-500')}
              initial={{ width: 0 }}
              animate={{ width: `${compliance}%` }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.3 }}
            />
          </div>
        </div>
        <div className='space-y-2'>
          <div className='flex items-center justify-between text-xs text-muted-foreground'>
            <span>Tickets at Risk (next 30 min)</span>
            <span className={cn('font-semibold', atRisk > 0 ? 'text-red-500' : 'text-emerald-600')}>
              {atRisk} ticket{atRisk !== 1 ? 's' : ''}
            </span>
          </div>
          {atRisk > 0 && (
            <motion.div
              className='flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
            >
              <Icons.alertTriangle className='h-4 w-4 shrink-0 text-red-500' strokeWidth={1.5} />
              <p className='text-xs text-red-700'>
                {atRisk} ticket{atRisk !== 1 ? 's are' : ' is'} about to breach SLA. Review Workbench.
              </p>
            </motion.div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────
// Main Page
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

export default function HomePage() {
  const [kpis, setKpis] = useState<KPIs>(EMPTY_KPIS)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const [kpiData, activityData] = await Promise.all([
        apiClient.get<KPIs>('/api/service-desk/kpis'),
        apiClient.get<ActivityItem[]>('/api/service-desk/activity?limit=20'),
      ])
      setKpis(kpiData)
      setActivity(activityData)
      setLastRefresh(new Date())
    } catch (err) {
      console.error('[Dashboard] Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    // Auto-refresh every 15 seconds
    const interval = setInterval(fetchData, 15_000)
    return () => clearInterval(interval)
  }, [fetchData])

  return (
    <motion.div className='space-y-6' variants={containerVariants} initial='hidden' animate='visible'>
      {/* Header */}
      <motion.div variants={itemVariants} className='flex items-end justify-between'>
        <div>
          <h1 className='font-display text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2'>
            Service Desk{' '}
            <span className='text-gradient'>Command Center</span>
          </h1>
          <p className='mt-1 text-muted-foreground'>
            Live operational view · AI Employees running on Supervity Auto
          </p>
        </div>
        <div className='flex items-center gap-3 text-xs text-muted-foreground'>
          {loading && <Icons.loader className='h-4 w-4 animate-spin' />}
          {lastRefresh && (
            <span>Updated {lastRefresh.toLocaleTimeString()}</span>
          )}
        </div>
      </motion.div>

      {/* KPI Grid */}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-4'>
        <KPICard
          title='Open Tickets'
          value={kpis.total_open}
          icon={Icons.fileText}
          colorClass='bg-brand-navy'
          trend={{ label: `${kpis.total_resolved_today} resolved today`, positive: true }}
          delay={0.05}
        />
        <KPICard
          title='SLA Compliance'
          value={kpis.sla_compliance_pct}
          suffix='%'
          decimals={1}
          icon={Icons.checkCircle}
          colorClass={kpis.sla_compliance_pct >= 90 ? 'bg-emerald-500' : kpis.sla_compliance_pct >= 75 ? 'bg-amber-500' : 'bg-red-500'}
          trend={{ label: kpis.sla_compliance_pct >= 90 ? 'On track' : 'Needs attention', positive: kpis.sla_compliance_pct >= 90 }}
          delay={0.1}
        />
        <KPICard
          title='Auto-Resolution Rate'
          value={kpis.auto_resolution_rate}
          suffix='%'
          decimals={1}
          icon={Icons.sparkles}
          colorClass='bg-brand-purple'
          trend={{ label: 'Agent-resolved', positive: true }}
          delay={0.15}
        />
        <KPICard
          title='Avg MTTR'
          value={kpis.avg_mttr_hours}
          suffix='h'
          decimals={1}
          icon={Icons.clock}
          colorClass='bg-brand-cornflower'
          delay={0.2}
        />
      </div>

      {/* Second KPI Row */}
      <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
        <KPICard
          title='Major Incidents'
          value={kpis.open_major_incidents}
          icon={Icons.alertTriangle}
          colorClass={kpis.open_major_incidents > 0 ? 'bg-red-500' : 'bg-slate-400'}
          alert={kpis.open_major_incidents > 0}
          delay={0.25}
        />
        <KPICard
          title='CSAT Score'
          value={kpis.csat_avg}
          suffix='/5'
          decimals={1}
          icon={Icons.star}
          colorClass={kpis.csat_avg >= 4 ? 'bg-emerald-500' : kpis.csat_avg >= 3 ? 'bg-amber-500' : 'bg-red-500'}
          delay={0.3}
        />
        <KPICard
          title='Workbench Queue'
          value={kpis.pending_workbench}
          icon={Icons.workbench}
          colorClass={kpis.pending_workbench > 0 ? 'bg-amber-500' : 'bg-slate-400'}
          alert={kpis.pending_workbench > 0}
          trend={{ label: kpis.pending_workbench > 0 ? 'Awaiting review' : 'All clear', positive: kpis.pending_workbench === 0 }}
          delay={0.35}
        />
        <KPICard
          title='SLA Risk (30 min)'
          value={kpis.tickets_at_risk}
          icon={Icons.zap}
          colorClass={kpis.tickets_at_risk > 0 ? 'bg-red-500' : 'bg-slate-400'}
          alert={kpis.tickets_at_risk > 0}
          delay={0.4}
        />
      </div>

      {/* Bottom row */}
      <motion.div variants={itemVariants} className='grid gap-6 lg:grid-cols-2'>
        <SLARiskBar compliance={kpis.sla_compliance_pct} atRisk={kpis.tickets_at_risk} />
        <ActivityFeed activities={activity} />
      </motion.div>
    </motion.div>
  )
}
