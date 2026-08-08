'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { CardWatermark } from '@/components/ui/card-watermark'
import { Icons } from '@/components/ui/icons'
import { InsightCard, type Insight } from '@/components/ai/insights/InsightCard'
import { PatternCluster, type Pattern } from '@/components/ai/insights/PatternCluster'
import { ActionCard, type ActionItem } from '@/components/ai/insights/ActionCard'

// ============================================================================
// Demo Data — Replace with your own API integration
// ============================================================================

const DEMO_INSIGHTS: Insight[] = [
  {
    id: 'demo-insight-001',
    type: 'pattern',
    severity: 'info',
    title: 'Peak Usage Pattern Detected',
    description: 'Most user activity occurs between 9 AM and 11 AM on weekdays. Tuesday shows 23% higher engagement than other days.',
    data: { peak_hours: '9:00 - 11:00', peak_day: 'Tuesday', avg_daily_sessions: 156, tuesday_increase: '23%' },
    suggested_action: 'Schedule system maintenance outside peak hours (before 8 AM or after 6 PM)',
    action_type: 'schedule_maintenance',
    confidence: 0.92,
    created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    is_demo: true,
  },
  {
    id: 'demo-insight-002',
    type: 'anomaly',
    severity: 'warning',
    title: 'Unusual API Activity Spike',
    description: 'API requests spiked 340% at 3:15 AM, significantly outside normal usage patterns. Source traced to 3 IP addresses.',
    data: { spike_time: '03:15 AM', normal_avg_requests: 45, spike_requests: 198, increase_percent: '340%', source_ips: 3 },
    suggested_action: 'Review API access logs and verify source IP addresses',
    action_type: 'investigate',
    confidence: 0.95,
    created_at: new Date(Date.now() - 6 * 3600000).toISOString(),
    is_demo: true,
  },
  {
    id: 'demo-insight-003',
    type: 'recommendation',
    severity: 'info',
    title: 'Policy Optimization Opportunity',
    description: '23 transactions were manually reviewed that match the Auto-Approve Low Value policy criteria. Creating a supporting policy could save ~3.5 hours per week.',
    data: { manual_reviews: 23, matching_criteria: 'amount < $50, status = pending', potential_savings_hours: 3.5 },
    suggested_action: 'Create a complementary policy for amounts under $50',
    action_type: 'create_policy',
    confidence: 0.88,
    created_at: new Date(Date.now() - 12 * 3600000).toISOString(),
    is_demo: true,
  },
  {
    id: 'demo-insight-004',
    type: 'anomaly',
    severity: 'warning',
    title: 'Duplicate Transaction Detected',
    description: 'Two transactions with identical amounts, timestamps, and vendor details submitted within 2 seconds. Potential duplicate entry.',
    data: { transaction_1_id: 'TXN-2024-001234', transaction_2_id: 'TXN-2024-001235', amount: 4750.0, vendor: 'TechSupply Inc', time_difference_seconds: 1.8 },
    suggested_action: 'Review and potentially void duplicate transaction',
    action_type: 'review_duplicate',
    confidence: 0.97,
    created_at: new Date(Date.now() - 30 * 60000).toISOString(),
    is_demo: true,
  },
]

const DEMO_PATTERNS: Pattern[] = [
  { name: 'Peak Business Hours', frequency: 'daily', confidence: 0.92, sample_size: 2500, description: 'Activity peaks between 9-11 AM and 2-4 PM on weekdays', is_demo: true },
  { name: 'Weekend Activity Drop', frequency: 'weekly', confidence: 0.96, sample_size: 8400, description: 'Weekend activity drops to 12% of weekday average', is_demo: true },
  { name: 'Month-End Surge', frequency: 'monthly', confidence: 0.89, sample_size: 15000, description: 'Last 3 days of month show 45% higher transaction volume', is_demo: true },
  { name: 'Vendor Preference Clustering', frequency: 'ongoing', confidence: 0.78, sample_size: 1200, description: 'Top 5 vendors account for 67% of all transactions', is_demo: true },
]

const DEMO_ACTIONS: ActionItem[] = [
  { title: 'Create policy for sub-$50 auto-approval', priority: 'high', estimated_impact: 'Save 3.5 hours/week', action_type: 'create_policy', action_config: { template: 'auto_approve', threshold: 50 }, is_demo: true },
  { title: 'Investigate 3 AM API spike', priority: 'high', estimated_impact: 'Security improvement', action_type: 'investigate', action_config: { log_type: 'api_access', time_range: '02:00-04:00' }, is_demo: true },
  { title: 'Review duplicate transaction pair', priority: 'critical', estimated_impact: 'Prevent $4,750 overpayment', action_type: 'review_transaction', action_config: { transaction_ids: ['TXN-2024-001234', 'TXN-2024-001235'] }, is_demo: true },
]

interface _InsightsResponse {
  insights: Insight[]
  patterns: Pattern[]
  actions: ActionItem[]
}

// Tab configuration
interface Tab {
  id: string
  label: string
  icon: React.ElementType
}

const tabs: Tab[] = [
  { id: 'summary', label: 'Summary', icon: Icons.activity },
  { id: 'patterns', label: 'Patterns', icon: Icons.layers },
  { id: 'actions', label: 'Actions', icon: Icons.zap },
]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}

export default function AIInsightsPage() {
  const [activeTab, setActiveTab] = useState('summary')
  const [insights, setInsights] = useState<Insight[]>([])
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const router = useRouter()

  const fetchInsights = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await apiClient.get<{
        clusters: Array<{ category: string; open_tickets: number; severity: string; recommendation: string }>
        sla_forecast: Array<{ ticket_key: string; summary: string; priority: string; sla_risk_score: number; sla_resolve_due: string | null; is_vip: boolean }>
        kb_gaps: Array<{ category: string; open_tickets: number; recommendation: string }>
        team_load: Array<{ agent_name: string; team: string; current_load: number; capacity: number; utilization_pct: number; is_on_call: boolean }>
        major_incident_risk: Array<{ category: string; ticket_count_24h: number; risk_level: string; recommendation: string }>
      }>('/api/service-desk/insights')

      // Map to Insight[] format for the existing InsightCard components
      const mapped: Insight[] = [
        // Major incident risks (critical)
        ...data.major_incident_risk.map((r, i) => ({
          id: `mi-risk-${i}`,
          type: 'anomaly' as const,
          severity: 'critical' as const,
          title: `⚠️ Major Incident Risk: ${r.category}`,
          description: `${r.ticket_count_24h} tickets in the last 24h — a major incident may be forming.`,
          data: { category: r.category, ticket_count: r.ticket_count_24h },
          suggested_action: r.recommendation,
          action_type: 'investigate' as const,
          confidence: 0.90,
          created_at: new Date().toISOString(),
          is_demo: false,
        })),
        // SLA breach forecasts (warning)
        ...data.sla_forecast.slice(0, 5).map((t, i) => ({
          id: `sla-${i}`,
          type: 'anomaly' as const,
          severity: 'warning' as const,
          title: `SLA Risk: ${t.ticket_key} — ${t.priority}`,
          description: `${t.summary} (risk score: ${t.sla_risk_score?.toFixed(0)}%)${t.is_vip ? ' · VIP ticket' : ''}`,
          data: { ticket_key: t.ticket_key, risk_score: t.sla_risk_score, due: t.sla_resolve_due },
          suggested_action: 'Assign to on-call specialist immediately and send requester update.',
          action_type: 'investigate' as const,
          confidence: 0.85,
          created_at: new Date().toISOString(),
          is_demo: false,
        })),
        // Known-error clusters (info)
        ...data.clusters.slice(0, 3).map((c, i) => ({
          id: `cluster-${i}`,
          type: 'pattern' as const,
          severity: c.severity === 'critical' ? 'critical' as const : 'info' as const,
          title: `Cluster: ${c.category} (${c.open_tickets} open)`,
          description: `${c.open_tickets} open tickets share category '${c.category}'. Root cause investigation recommended.`,
          data: { category: c.category, open_tickets: c.open_tickets },
          suggested_action: c.recommendation,
          action_type: 'investigate' as const,
          confidence: 0.80,
          created_at: new Date().toISOString(),
          is_demo: false,
        })),
        // KB gaps (recommendation)
        ...data.kb_gaps.slice(0, 3).map((g, i) => ({
          id: `kb-gap-${i}`,
          type: 'recommendation' as const,
          severity: 'info' as const,
          title: `KB Gap: No article for '${g.category}'`,
          description: `${g.open_tickets} open tickets in this category — authoring a KB article could auto-deflect future requests.`,
          data: { category: g.category, affected_tickets: g.open_tickets },
          suggested_action: g.recommendation,
          action_type: 'create_policy' as const,
          confidence: 0.88,
          created_at: new Date().toISOString(),
          is_demo: false,
        })),
      ]

      // Build patterns from team load
      const loadPatterns: Pattern[] = data.team_load.map((m, i) => ({
        id: `team-${i}`,
        name: `${m.agent_name} (${m.team})`,
        title: `${m.agent_name} — ${m.utilization_pct}% utilised`,
        description: `${m.current_load}/${m.capacity} tickets assigned. Team: ${m.team}${m.is_on_call ? ' · On-call' : ''}`,
        frequency: String(m.current_load),
        impact: m.utilization_pct > 80 ? 'high' : m.utilization_pct > 60 ? 'medium' : 'low',
        trend: m.utilization_pct > 80 ? 'increasing' : 'stable',
        examples: [`${m.current_load} open tickets`],
        recommendation: m.utilization_pct > 80 ? 'Redistribute tickets to lower-load agents.' : 'Load balanced.',
        confidence: m.utilization_pct / 100,
      }))

      setInsights(mapped.length > 0 ? mapped : DEMO_INSIGHTS)
      setPatterns(loadPatterns.length > 0 ? loadPatterns : DEMO_PATTERNS)
      setActions(DEMO_ACTIONS)
    } catch (err) {
      console.error('[Insights] Failed to load from API:', err)
      setInsights(DEMO_INSIGHTS)
      setPatterns(DEMO_PATTERNS)
      setActions(DEMO_ACTIONS)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights])

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    await fetchInsights()
    setIsAnalyzing(false)
  }

  const handleInsightAction = useCallback(async (insight: Insight) => {
    // Route based on action_type
    switch (insight.action_type) {
      case 'create_policy':
        router.push('/ai/policies?tab=create-with-ai')
        break
      case 'investigate':
      case 'review_duplicate':
        router.push('/workbench')
        break
      default:
        break
    }
  }, [router])

  const handleDismissInsight = useCallback(async (id: string) => {
    // Optimistic UI update
    setInsights(prev => prev.filter(i => i.id !== id))
  }, [])

  const handleApplyAction = useCallback(async (action: ActionItem) => {
    // Route based on action type
    switch (action.action_type) {
      case 'create_policy':
        router.push('/ai/policies?tab=create-with-ai')
        break
      case 'investigate':
      case 'review_transaction':
        router.push('/workbench')
        break
      default:
        break
    }
  }, [router])

  // Stats for summary
  const criticalCount = insights.filter(i => i.severity === 'critical').length
  const warningCount = insights.filter(i => i.severity === 'warning').length
  const infoCount = insights.filter(i => i.severity === 'info').length

  return (
    <motion.div
      className="space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <div>
          <h1 className="text-display-3 font-bold tracking-tight text-brand-navy lg:text-display-2">
            AI Insights
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            AI-powered analysis of your data. Discover patterns, anomalies, and optimization opportunities.
          </p>
        </div>
        <Button
          variant="gradient"
          onClick={handleAnalyze}
          disabled={isAnalyzing}
        >
          {isAnalyzing ? (
            <>
              <Icons.loader className="mr-2 h-4 w-4 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Icons.sparkles className="mr-2 h-4 w-4" strokeWidth={1.5} />
              Run Analysis
            </>
          )}
        </Button>
      </motion.div>

      {/* Demo Data Notice */}
      <motion.div 
        variants={itemVariants}
        className="rounded-lg border border-amber-200 bg-amber-50 p-4"
      >
        <div className="flex items-start gap-3">
          <Icons.info className="h-5 w-5 text-amber-600 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-900">Demo Insights</p>
            <p className="text-sm text-amber-700 mt-1">
              Items marked with [DEMO] are sample data for demonstration purposes. 
              Connect your AI backend to enable real-time analysis of your data.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div variants={itemVariants} className="grid gap-4 sm:grid-cols-3">
        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={0.8} />
          <CardContent className="relative z-10 flex items-center gap-4 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-100">
              <Icons.alertCircle className="h-6 w-6 text-red-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-2xl font-bold text-brand-navy">{criticalCount}</p>
              <p className="text-sm text-muted-foreground">Critical Issues</p>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={0.8} />
          <CardContent className="relative z-10 flex items-center gap-4 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100">
              <Icons.alertTriangle className="h-6 w-6 text-amber-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-2xl font-bold text-brand-navy">{warningCount}</p>
              <p className="text-sm text-muted-foreground">Warnings</p>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardWatermark opacity={2} scale={0.8} />
          <CardContent className="relative z-10 flex items-center gap-4 py-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
              <Icons.lightbulb className="h-6 w-6 text-blue-600" strokeWidth={1.5} />
            </div>
            <div>
              <p className="text-2xl font-bold text-brand-navy">{infoCount + patterns.length}</p>
              <p className="text-sm text-muted-foreground">Recommendations</p>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Tab Navigation */}
      <motion.div variants={itemVariants}>
        <div className={cn(
          'inline-flex items-center gap-1 rounded-xl p-1',
          'bg-white/50 border border-border/50',
          'backdrop-blur-sm'
        )}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            const Icon = tab.icon
            
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'relative flex items-center gap-2 rounded-lg px-4 py-2.5',
                  'text-sm font-medium transition-all duration-200',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-cornflower/50',
                  isActive
                    ? 'text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-white/50'
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeInsightTab"
                    className="absolute inset-0 rounded-lg bg-brand-navy shadow-soft"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2">
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                  <span className="hidden sm:inline">{tab.label}</span>
                </span>
              </button>
            )
          })}
        </div>
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Icons.loader className="h-8 w-8 animate-spin text-brand-cornflower" />
            </div>
          ) : (
            <>
              {activeTab === 'summary' && (
                <Card className="relative overflow-hidden">
                  <CardWatermark opacity={2} scale={1} />
                  <CardHeader className="relative z-10">
                    <CardTitle>All Insights</CardTitle>
                    <CardDescription>
                      {insights.length} insights generated from your data analysis.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 space-y-4">
                    {insights.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className={cn(
                          'mb-4 flex h-16 w-16 items-center justify-center rounded-2xl',
                          'bg-gradient-to-br from-brand-cornflower/20 to-brand-purple/20'
                        )}>
                          <Icons.lightbulb className="h-8 w-8 text-brand-cornflower" strokeWidth={1.5} />
                        </div>
                        <h3 className="font-display text-lg font-semibold text-brand-navy">
                          No insights yet
                        </h3>
                        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                          Run an analysis to discover patterns, anomalies, and recommendations.
                        </p>
                        <Button
                          variant="gradient"
                          className="mt-6"
                          onClick={handleAnalyze}
                          disabled={isAnalyzing}
                        >
                          <Icons.sparkles className="mr-2 h-4 w-4" strokeWidth={1.5} />
                          Generate Insights
                        </Button>
                      </div>
                    ) : (
                      insights.map((insight) => (
                        <InsightCard
                          key={insight.id}
                          insight={insight}
                          onAction={handleInsightAction}
                          onDismiss={handleDismissInsight}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              )}

              {activeTab === 'patterns' && (
                <Card className="relative overflow-hidden">
                  <CardWatermark opacity={2} scale={1} />
                  <CardHeader className="relative z-10">
                    <CardTitle>Detected Patterns</CardTitle>
                    <CardDescription>
                      Recurring behaviors and trends identified in your data.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10">
                    <PatternCluster patterns={patterns} />
                  </CardContent>
                </Card>
              )}

              {activeTab === 'actions' && (
                <Card className="relative overflow-hidden">
                  <CardWatermark opacity={2} scale={1} />
                  <CardHeader className="relative z-10">
                    <CardTitle>Recommended Actions</CardTitle>
                    <CardDescription>
                      AI-suggested improvements based on your insights.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="relative z-10 space-y-3">
                    {actions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className={cn(
                          'mb-4 flex h-12 w-12 items-center justify-center rounded-xl',
                          'bg-muted/50'
                        )}>
                          <Icons.zap className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          No actions recommended at this time.
                        </p>
                      </div>
                    ) : (
                      actions.map((action, idx) => (
                        <ActionCard
                          key={idx}
                          action={action}
                          onApply={handleApplyAction}
                        />
                      ))
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}

