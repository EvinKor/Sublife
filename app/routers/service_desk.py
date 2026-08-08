# app/routers/service_desk.py
"""
Service Desk API Router — Round 2 Hackathon

Endpoints:
  Command Center
    GET  /api/service-desk/kpis              Live KPI tiles
    GET  /api/service-desk/activity          Agent activity feed (last N events)

  Tickets
    GET  /api/service-desk/tickets           Paginated ticket backlog with SLA risk
    POST /api/service-desk/tickets/ingest    Ingest a ticket from Supervity Auto (webhook)

  Workbench (human loop)
    GET  /api/service-desk/workbench         Pending exception queue
    POST /api/service-desk/workbench         Create a new workbench item (from agent)
    GET  /api/service-desk/workbench/{id}    Get single item with full context
    POST /api/service-desk/workbench/{id}/resolve   Human resolves / approves / rejects

  AI Policies
    GET  /api/service-desk/policies          List all policies
    GET  /api/service-desk/policies/{key}    Get single policy + evaluation log
    PUT  /api/service-desk/policies/{key}    Update policy value (no code deploy needed)
    GET  /api/service-desk/policies/{key}/logs  Evaluation history for a policy

  AI Insights
    GET  /api/service-desk/insights          All insight cards
    GET  /api/service-desk/insights/clusters Known-error clusters
    GET  /api/service-desk/insights/sla-forecast SLA breach forecasts
    GET  /api/service-desk/insights/kb-gaps  KB gap analysis
    GET  /api/service-desk/insights/team-load Team load heatmap

  AI Manager (chat)
    POST /api/service-desk/manager/chat      Forward message to Supervity Orchestrator

  Data Manager
    GET  /api/service-desk/integrations      Integration registry + health
    POST /api/service-desk/integrations      Register a new integration
    POST /api/service-desk/integrations/{id}/health-check  Trigger health check
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, func, text
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..models.service_desk import (
    AgentActivity, AIPolicy, Integration, PolicyEvalLog,
    TeamRoster, Ticket, WorkbenchItem,
)
from ..security import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/service-desk", tags=["Service Desk"])

# Supervity Auto webhook URL — set in .env
SUPERVITY_API_URL = os.getenv("SUPERVITY_API_URL", "")
SUPERVITY_API_KEY = os.getenv("SUPERVITY_API_KEY", "")


# =============================================================================
# Pydantic schemas (request / response)
# =============================================================================

class KPIResponse(BaseModel):
    total_open: int
    total_resolved_today: int
    sla_compliance_pct: float
    auto_resolution_rate: float
    avg_mttr_hours: float
    open_major_incidents: int
    csat_avg: float
    pending_workbench: int
    tickets_at_risk: int       # SLA breach imminent (< 30 min)


class ActivityItem(BaseModel):
    id: int
    operator: str
    action: str
    ticket_key: Optional[str]
    result: Optional[str]
    details: Optional[dict]
    created_at: str


class TicketItem(BaseModel):
    id: int
    ticket_key: str
    summary: str
    priority: str
    status: str
    category: Optional[str]
    reporter_name: Optional[str]
    assignee_name: Optional[str]
    team: Optional[str]
    is_vip: bool
    sla_breached: bool
    sla_risk_score: Optional[float]
    sla_resolve_due: Optional[str]
    major_incident_id: Optional[str]
    auto_resolved: bool
    created_at: str


class WorkbenchItemResponse(BaseModel):
    id: int | str
    ticket_key: Optional[str]
    exception_type: str
    title: str
    description: Optional[str]
    agent_diagnosis: Optional[str]
    agent_recommendation: Optional[str]
    correlated_tickets: Optional[list]
    policy_evaluation: Optional[dict]
    sla_time_remaining_minutes: Optional[int]
    priority: str
    is_vip: bool
    status: str
    resolved_by: Optional[str]
    resolution_note: Optional[str]
    resolved_at: Optional[str]
    created_at: str


class WorkbenchCreateRequest(BaseModel):
    ticket_key: Optional[str] = None
    exception_type: str
    title: str
    description: Optional[str] = None
    agent_diagnosis: Optional[str] = None
    agent_recommendation: Optional[str] = None
    correlated_tickets: Optional[list] = None
    policy_evaluation: Optional[dict] = None
    sla_time_remaining_minutes: Optional[int] = None
    priority: str = "P3"
    is_vip: bool = False


class WorkbenchResolveRequest(BaseModel):
    action: str                  # "approve" | "reject" | "reassign"
    resolution_note: Optional[str] = None
    resolved_by: Optional[str] = None


class PolicyResponse(BaseModel):
    id: int
    policy_key: str
    name: str
    description: Optional[str]
    policy_type: str
    value: Any
    default_value: Any
    is_active: bool
    priority: int
    evaluation_count: int
    last_evaluated_at: Optional[str]
    updated_at: Optional[str]
    updated_by: Optional[str]


class PolicyUpdateRequest(BaseModel):
    value: Any
    is_active: Optional[bool] = None


class InsightResponse(BaseModel):
    clusters: list
    sla_forecast: list
    kb_gaps: list
    team_load: list
    major_incident_risk: list


class ChatRequest(BaseModel):
    message: str
    context: Optional[dict] = None


class ChatResponse(BaseModel):
    reply: str
    operator_trace: Optional[list] = None
    ticket_keys: Optional[list] = None


class IntegrationResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    category: str
    provider: Optional[str]
    status: str
    last_checked_at: Optional[str]
    last_success_at: Optional[str]
    error_message: Optional[str]
    is_active: bool


class IntegrationCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    category: str
    provider: Optional[str] = None
    endpoint_url: Optional[str] = None
    config: Optional[dict] = None


class TicketIngestRequest(BaseModel):
    """Payload pushed by Supervity Auto Orchestrator after processing a ticket."""
    ticket_key: str
    summary: str
    description: Optional[str] = None
    priority: str = "P3"
    status: str = "Open"
    category: Optional[str] = None
    reporter_email: Optional[str] = None
    reporter_name: Optional[str] = None
    assignee_name: Optional[str] = None
    team: Optional[str] = None
    is_vip: bool = False
    sla_breached: bool = False
    sla_risk_score: Optional[float] = None
    sla_resolve_due: Optional[str] = None
    auto_resolved: bool = False
    major_incident_id: Optional[str] = None
    agent_recommendation: Optional[str] = None
    csat_score: Optional[float] = None
    operator: Optional[str] = None   # which operator last touched this
    raw_data: Optional[dict] = None


# =============================================================================
# Helpers
# =============================================================================

def _dt_str(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _seed_default_policies(db: Session):
    """Seed the 4 mandatory policies if the table is empty."""
    if db.query(AIPolicy).count() > 0:
        return

    defaults = [
        {
            "policy_key": "sla_thresholds",
            "name": "SLA Thresholds by Priority",
            "description": "Maximum resolution time (business hours) per priority level. Changing these values immediately affects how the agent scores SLA risk.",
            "policy_type": "sla_threshold",
            "value": {"P1": 4, "P2": 8, "P3": 24, "P4": 72},
            "default_value": {"P1": 4, "P2": 8, "P3": 24, "P4": 72},
            "priority": 1,
        },
        {
            "policy_key": "auto_remediation_gate",
            "name": "Auto-Remediation Gate",
            "description": "Which fix categories the agent may execute autonomously without human approval. Any category NOT listed requires a Workbench escalation.",
            "policy_type": "auto_remediation",
            "value": {
                "allowed": ["password_reset", "account_unlock", "software_install", "vpn_reconnect"],
                "blocked": ["firewall_change", "server_reboot", "data_deletion", "privilege_escalation"]
            },
            "default_value": {
                "allowed": ["password_reset", "account_unlock", "software_install", "vpn_reconnect"],
                "blocked": ["firewall_change", "server_reboot", "data_deletion", "privilege_escalation"]
            },
            "priority": 2,
        },
        {
            "policy_key": "vip_prioritization",
            "name": "VIP Prioritization",
            "description": "Users or email domains that are automatically elevated to P1 priority regardless of their original ticket priority.",
            "policy_type": "vip_priority",
            "value": {
                "vip_domains": ["ceo.company.com", "board.company.com"],
                "vip_emails": [],
                "auto_assign_team": "VIP Support",
                "sla_multiplier": 0.5
            },
            "default_value": {
                "vip_domains": [],
                "vip_emails": [],
                "auto_assign_team": "VIP Support",
                "sla_multiplier": 0.5
            },
            "priority": 3,
        },
        {
            "policy_key": "escalation_matrix",
            "name": "Escalation Matrix",
            "description": "Conditions that trigger automatic escalation to the human Workbench. Adjusting thresholds changes how aggressively the agent escalates.",
            "policy_type": "escalation_matrix",
            "value": {
                "sla_risk_threshold": 70,
                "dispute_amount_threshold": 5000,
                "csat_poor_threshold": 2.5,
                "major_incident_ticket_count": 5,
                "unknown_category_auto_escalate": True
            },
            "default_value": {
                "sla_risk_threshold": 70,
                "dispute_amount_threshold": 5000,
                "csat_poor_threshold": 2.5,
                "major_incident_ticket_count": 5,
                "unknown_category_auto_escalate": True
            },
            "priority": 4,
        },
    ]

    for d in defaults:
        db.add(AIPolicy(**d))
    db.commit()
    log.info("Seeded 4 default AI policies.")


def _seed_default_integrations(db: Session):
    """Seed the 3 mandatory integrations if the table is empty."""
    if db.query(Integration).count() > 0:
        return

    defaults = [
        {
            "name": "Microsoft Outlook — Ticket Intake",
            "description": "Incoming channel for new ticket notifications from emails. The Orchestrator listens here for new service requests.",
            "category": "channel",
            "provider": "Microsoft Outlook",
            "endpoint_url": os.getenv("OUTLOOK_WEBHOOK_URL", ""),
            "status": "healthy",
        },
        {
            "name": "Supabase — Ticket System of Record",
            "description": "Primary database for ticket backlog, user directory, access register, KB, CSAT surveys, change requests, and SLA calendar (Round 2 data pack).",
            "category": "system_of_record",
            "provider": "Supabase",
            "endpoint_url": os.getenv("SUPABASE_URL", ""),
            "status": "healthy",
        },
        {
            "name": "Microsoft Outlook — Human Escalation",
            "description": "Outbound channel for human-loop escalations. The Workbench sends an email to the on-call specialist when a ticket needs review.",
            "category": "human_loop",
            "provider": "Microsoft Outlook",
            "endpoint_url": os.getenv("OUTLOOK_ESCALATION_EMAIL", ""),
            "status": "healthy",
        },
    ]

    for d in defaults:
        db.add(Integration(**d))
    db.commit()
    log.info("Seeded 3 default integrations.")


# =============================================================================
# Command Center — KPIs
# =============================================================================

@router.get("/kpis", response_model=KPIResponse)
async def get_kpis(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    """Live KPI tiles for the Command Center dashboard."""
    _seed_default_policies(db)
    _seed_default_integrations(db)

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    total_open = db.query(Ticket).filter(Ticket.status.notin_(["Resolved", "Closed"])).count()

    total_resolved_today = (
        db.query(Ticket)
        .filter(Ticket.resolved_at >= today_start)
        .count()
    )

    # SLA compliance: (non-breached resolved) / total resolved
    total_resolved = db.query(Ticket).filter(Ticket.status.in_(["Resolved", "Closed"])).count()
    non_breached_resolved = (
        db.query(Ticket)
        .filter(Ticket.status.in_(["Resolved", "Closed"]), Ticket.sla_breached == False)
        .count()
    )
    sla_compliance = round((non_breached_resolved / total_resolved * 100) if total_resolved else 100.0, 1)

    auto_rate = 0.0

    # Average MTTR — only for resolved tickets with both timestamps
    mttr_result = (
        db.query(
            func.avg(
                func.extract("epoch", Ticket.resolved_at) -
                func.extract("epoch", Ticket.created_at)
            )
        )
        .filter(Ticket.resolved_at.isnot(None))
        .scalar()
    )
    avg_mttr_hours = round((mttr_result / 3600) if mttr_result else 0.0, 1)

    # Open major incidents (tickets that are the parent)
    open_major = (
        db.query(Ticket)
        .filter(Ticket.parent_incident_id == Ticket.id, Ticket.status.notin_(["Resolved", "Closed"]))
        .count()
    )

    # CSAT average (mocked since it's not in dataset)
    csat_avg = 4.8

    pending_workbench = db.query(WorkbenchItem).filter(WorkbenchItem.status == "pending").count()

    # Tickets at risk (SLA due within 30 minutes)
    risk_window = now + timedelta(minutes=30)
    tickets_at_risk = (
        db.query(Ticket)
        .filter(
            Ticket.sla_resolution_due_at <= risk_window,
            Ticket.sla_resolution_due_at >= now,
            Ticket.status.notin_(["Resolved", "Closed"]),
            Ticket.sla_breached == False,
        )
        .count()
    )

    return KPIResponse(
        total_open=total_open,
        total_resolved_today=total_resolved_today,
        sla_compliance_pct=sla_compliance,
        auto_resolution_rate=auto_rate,
        avg_mttr_hours=avg_mttr_hours,
        open_major_incidents=open_major,
        csat_avg=csat_avg,
        pending_workbench=pending_workbench,
        tickets_at_risk=tickets_at_risk,
    )


# =============================================================================
# Agent Activity Feed
# =============================================================================

@router.get("/activity")
async def get_activity(
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Last N agent activity events for the live feed."""
    activities = (
        db.query(AgentActivity)
        .order_by(desc(AgentActivity.created_at))
        .limit(limit)
        .all()
    )
    return [
        ActivityItem(
            id=a.id,
            operator=a.operator,
            action=a.action,
            ticket_key=a.ticket_key,
            result=a.result,
            details=a.details,
            created_at=_dt_str(a.created_at),
        )
        for a in activities
    ]


# =============================================================================
# Tickets
# =============================================================================

@router.get("/tickets")
async def list_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    team: Optional[str] = None,
    is_vip: Optional[bool] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Paginated ticket backlog sorted by SLA risk (highest first)."""
    q = db.query(Ticket)
    if status:
        q = q.filter(Ticket.status == status)
    if priority:
        q = q.filter(Ticket.priority == priority)
    if team:
        q = q.filter(Ticket.team == team)
    if is_vip is not None:
        q = q.filter(Ticket.is_vip == is_vip)

    total = q.count()
    tickets = (
        q.order_by(desc(Ticket.escalation_risk), desc(Ticket.created_at))
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "tickets": [
            TicketItem(
                id=t.id,
                ticket_key=t.ticket_key,
                summary=t.summary,
                priority=t.priority,
                status=t.status,
                category=t.category,
                reporter_name=t.reporter_name,
                assignee_name=t.assignee_name,
                team=t.team,
                is_vip=t.is_vip,
                sla_breached=t.sla_breached,
                sla_risk_score=t.sla_risk_score,
                sla_resolve_due=_dt_str(t.sla_resolve_due),
                major_incident_id=t.major_incident_id,
                auto_resolved=t.auto_resolved,
                created_at=_dt_str(t.created_at),
            )
            for t in tickets
        ],
    }


@router.post("/tickets/ingest", status_code=201)
async def ingest_ticket(
    payload: TicketIngestRequest,
    db: Session = Depends(get_db),
):
    """
    Webhook endpoint called by Supervity Auto Orchestrator to create / update a ticket.
    No auth token required — protected by being internal only (no public exposure).
    """
    existing = db.query(Ticket).filter(Ticket.ticket_key == payload.ticket_key).first()

    sla_due = None
    if payload.sla_resolve_due:
        try:
            sla_due = datetime.fromisoformat(payload.sla_resolve_due.replace("Z", "+00:00"))
        except Exception:
            pass

    if existing:
        # Update existing ticket
        existing.summary = payload.summary
        existing.status = payload.status
        existing.priority = payload.priority
        existing.category = payload.category
        existing.assignee_name = payload.assignee_name
        existing.team = payload.team
        existing.is_vip = payload.is_vip
        existing.sla_breached = payload.sla_breached
        existing.sla_risk_score = payload.sla_risk_score
        existing.sla_resolve_due = sla_due
        existing.auto_resolved = payload.auto_resolved
        existing.major_incident_id = payload.major_incident_id
        existing.agent_recommendation = payload.agent_recommendation
        existing.csat_score = payload.csat_score
        if payload.status in ("Resolved", "Closed") and not existing.resolved_at:
            existing.resolved_at = datetime.now(timezone.utc)
        existing.raw_data = payload.raw_data
        db.commit()
        ticket = existing
    else:
        ticket = Ticket(
            ticket_key=payload.ticket_key,
            summary=payload.summary,
            description=payload.description,
            priority=payload.priority,
            status=payload.status,
            category=payload.category,
            reporter_email=payload.reporter_email,
            reporter_name=payload.reporter_name,
            assignee_name=payload.assignee_name,
            team=payload.team,
            is_vip=payload.is_vip,
            sla_breached=payload.sla_breached,
            sla_risk_score=payload.sla_risk_score,
            sla_resolve_due=sla_due,
            auto_resolved=payload.auto_resolved,
            major_incident_id=payload.major_incident_id,
            agent_recommendation=payload.agent_recommendation,
            csat_score=payload.csat_score,
            raw_data=payload.raw_data,
        )
        db.add(ticket)
        db.commit()
        db.refresh(ticket)

    # Log the operator action
    if payload.operator:
        db.add(AgentActivity(
            operator=payload.operator,
            action=f"ticket.ingest:{payload.status}",
            ticket_key=payload.ticket_key,
            result="success",
            details={"priority": payload.priority, "is_vip": payload.is_vip, "auto_resolved": payload.auto_resolved},
        ))
        db.commit()

    return {"status": "ok", "ticket_key": ticket.ticket_key}


# =============================================================================
# Workbench — Human Loop
# =============================================================================

@router.get("/workbench")
async def list_workbench(
    status: str = "pending",
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Pending exception queue for human review."""
    items = (
        db.query(WorkbenchItem)
        .filter(WorkbenchItem.status == status)
        .order_by(WorkbenchItem.created_at.asc())
        .all()
    )
    # Sort VIP items first (is_vip is a @property reading from JSON context, not a column)
    items.sort(key=lambda i: (not i.is_vip, i.created_at))
    return [_workbench_schema(i) for i in items]


@router.post("/workbench", status_code=201)
async def create_workbench_item(
    payload: WorkbenchCreateRequest,
    db: Session = Depends(get_db),
):
    """Agent creates a new Workbench exception (no auth — internal webhook)."""
    import uuid
    context_data = payload.dict(exclude={"exception_type", "agent_recommendation"})
    item = WorkbenchItem(
        id=str(uuid.uuid4()),
        exception_type=payload.exception_type,
        context=context_data,
        agent_recommendation=payload.agent_recommendation,
        status="pending"
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    # Log activity
    db.add(AgentActivity(
        operator="orchestrator",
        action="workbench.escalate",
        ticket_key=payload.ticket_key,
        result="escalated",
        details={"exception_type": payload.exception_type, "title": payload.title},
    ))
    db.commit()

    return {"status": "created", "id": item.id}


@router.get("/workbench/{item_id}", response_model=WorkbenchItemResponse)
async def get_workbench_item(
    item_id: str,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Get a single workbench item with full context."""
    item = db.query(WorkbenchItem).filter(WorkbenchItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Workbench item not found")
    return _workbench_schema(item)


@router.post("/workbench/{item_id}/resolve")
async def resolve_workbench_item(
    item_id: str,
    payload: WorkbenchResolveRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Human resolves / approves / rejects an exception."""
    item = db.query(WorkbenchItem).filter(WorkbenchItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Workbench item not found")
    if item.status != "pending":
        raise HTTPException(status_code=400, detail=f"Item is already {item.status}")

    action_to_status = {"approve": "approved", "reject": "rejected", "reassign": "reassigned"}
    new_status = action_to_status.get(payload.action, "resolved")

    item.status = new_status
    item.resolved_by = payload.resolved_by or None
    item.resolution_note = payload.resolution_note
    item.resolved_at = datetime.now(timezone.utc)
    db.commit()

    # Log activity
    db.add(AgentActivity(
        operator="human",
        action=f"workbench.{payload.action}",
        ticket_key=item.ticket_key,
        result=new_status,
        details={"note": payload.resolution_note},
    ))
    db.commit()

    if SUPERVITY_API_URL:
        def send_webhook():
            try:
                webhook_url = f"{SUPERVITY_API_URL.rstrip('/')}/v1/resume"
                webhook_payload = {
                    "workbench_item_id": item_id,
                    "ticket_key": item.ticket_key,
                    "status": new_status,
                    "resolution_note": payload.resolution_note
                }
                headers = {"Authorization": f"Bearer {SUPERVITY_API_KEY}"} if SUPERVITY_API_KEY else {}
                with httpx.Client(timeout=10.0) as client:
                    client.post(webhook_url, json=webhook_payload, headers=headers)
            except Exception as e:
                log.error(f"Failed to send resume webhook: {e}")
        
        background_tasks.add_task(send_webhook)

    return {"status": new_status, "id": item_id}


def _workbench_schema(i: WorkbenchItem) -> WorkbenchItemResponse:
    return WorkbenchItemResponse(
        id=str(i.id),
        ticket_key=i.ticket_key,
        exception_type=i.exception_type,
        title=i.title,
        description=i.description,
        agent_diagnosis=i.agent_diagnosis,
        agent_recommendation=i.agent_recommendation,
        correlated_tickets=i.correlated_tickets,
        policy_evaluation=i.policy_evaluation,
        sla_time_remaining_minutes=i.sla_time_remaining_minutes,
        priority=i.priority,
        is_vip=i.is_vip,
        status=i.status,
        resolved_by=i.resolved_by,
        resolution_note=i.resolution_note,
        resolved_at=_dt_str(i.resolved_at),
        created_at=_dt_str(i.created_at),
    )


# =============================================================================
# AI Policies
# =============================================================================

@router.get("/policies")
async def list_policies(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """List all AI policies."""
    _seed_default_policies(db)
    policies = db.query(AIPolicy).order_by(AIPolicy.priority).all()
    return [_policy_schema(p) for p in policies]


@router.get("/policies/{policy_key}")
async def get_policy(
    policy_key: str,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Get a single policy with recent evaluation logs."""
    p = db.query(AIPolicy).filter(AIPolicy.policy_key == policy_key).first()
    if not p:
        raise HTTPException(status_code=404, detail="Policy not found")

    logs = (
        db.query(PolicyEvalLog)
        .filter(PolicyEvalLog.policy_key == policy_key)
        .order_by(desc(PolicyEvalLog.evaluated_at))
        .limit(50)
        .all()
    )

    return {
        "policy": _policy_schema(p),
        "recent_evaluations": [
            {
                "id": l.id,
                "ticket_key": l.ticket_key,
                "result": l.result,
                "reason": l.reason,
                "evaluated_at": _dt_str(l.evaluated_at),
            }
            for l in logs
        ],
    }


@router.put("/policies/{policy_key}")
async def update_policy(
    policy_key: str,
    payload: PolicyUpdateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """
    Update a policy value — takes effect immediately.
    The Orchestrator reads policy values at runtime; no redeploy required.
    """
    p = db.query(AIPolicy).filter(AIPolicy.policy_key == policy_key).first()
    if not p:
        raise HTTPException(status_code=404, detail="Policy not found")

    p.value = payload.value
    if payload.is_active is not None:
        p.is_active = payload.is_active
    p.updated_by = user.get("email") if user else "admin"
    p.updated_at = datetime.now(timezone.utc)
    db.commit()

    # Log the policy change as an evaluation
    db.add(PolicyEvalLog(
        policy_key=policy_key,
        ticket_key=None,
        result="updated",
        reason=f"Policy value updated by {p.updated_by}",
        input_context={"new_value": payload.value},
        policy_value_snapshot=payload.value,
    ))
    db.commit()

    return {"status": "updated", "policy_key": policy_key}


@router.get("/policies/{policy_key}/logs")
async def get_policy_logs(
    policy_key: str,
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Evaluation history for a specific policy."""
    logs = (
        db.query(PolicyEvalLog)
        .filter(PolicyEvalLog.policy_key == policy_key)
        .order_by(desc(PolicyEvalLog.evaluated_at))
        .limit(limit)
        .all()
    )
    return [
        {
            "id": l.id,
            "ticket_key": l.ticket_key,
            "result": l.result,
            "reason": l.reason,
            "input_context": l.input_context,
            "evaluated_at": _dt_str(l.evaluated_at),
        }
        for l in logs
    ]


# Endpoint for agent to log a policy evaluation (no auth — internal)
@router.post("/policies/{policy_key}/eval")
async def log_policy_eval(
    policy_key: str,
    ticket_key: Optional[str] = None,
    result: str = "allow",
    reason: Optional[str] = None,
    input_context: Optional[dict] = None,
    db: Session = Depends(get_db),
):
    """Called by Supervity Operator after evaluating a policy against a ticket."""
    p = db.query(AIPolicy).filter(AIPolicy.policy_key == policy_key).first()
    if not p:
        raise HTTPException(status_code=404, detail="Policy not found")

    p.evaluation_count += 1
    p.last_evaluated_at = datetime.now(timezone.utc)

    db.add(PolicyEvalLog(
        policy_key=policy_key,
        ticket_key=ticket_key,
        result=result,
        reason=reason,
        input_context=input_context,
        policy_value_snapshot=p.value,
    ))
    db.commit()

    return {"status": "logged", "policy_value": p.value}


def _policy_schema(p: AIPolicy) -> PolicyResponse:
    return PolicyResponse(
        id=p.id,
        policy_key=p.policy_key,
        name=p.name,
        description=p.description,
        policy_type=p.policy_type,
        value=p.value,
        default_value=p.default_value,
        is_active=p.is_active,
        priority=p.priority,
        evaluation_count=p.evaluation_count,
        last_evaluated_at=_dt_str(p.last_evaluated_at),
        updated_at=_dt_str(p.updated_at),
        updated_by=p.updated_by,
    )


# =============================================================================
# AI Insights
# =============================================================================

@router.get("/insights")
async def get_insights(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """All insight cards computed from live agent-processed data."""
    now = datetime.now(timezone.utc)

    # 1. Known-error clusters: group open tickets by category
    cluster_rows = (
        db.query(Ticket.category, func.count(Ticket.id).label("count"))
        .filter(Ticket.status.notin_(["Resolved", "Closed"]), Ticket.category.isnot(None))
        .group_by(Ticket.category)
        .order_by(desc("count"))
        .limit(10)
        .all()
    )
    clusters = [
        {
            "category": row.category,
            "open_tickets": row.count,
            "severity": "critical" if row.count >= 10 else "warning" if row.count >= 5 else "info",
            "recommendation": f"Investigate root cause for {row.category} — {row.count} open tickets may share a common fix.",
        }
        for row in cluster_rows
    ]

    # 2. SLA breach forecasts: open tickets with sla_risk_score > 60
    at_risk = (
        db.query(Ticket)
        .filter(
            Ticket.status.notin_(["Resolved", "Closed"]),
            Ticket.escalation_risk.in_(["High", "Critical"]),
        )
        .order_by(desc(Ticket.escalation_risk))
        .limit(20)
        .all()
    )
    sla_forecast = [
        {
            "ticket_key": t.ticket_key,
            "summary": t.summary,
            "priority": t.priority,
            "sla_risk_score": t.sla_risk_score,
            "sla_resolve_due": _dt_str(t.sla_resolve_due),
            "is_vip": t.is_vip,
        }
        for t in at_risk
    ]

    # 3. KB gaps: ticket categories with many open tickets but no KB article
    from ..models.service_desk import KnowledgeBase
    kb_categories = {
        row[0] for row in db.query(KnowledgeBase.category).filter(KnowledgeBase.category.isnot(None)).all()
    }
    kb_gaps = [
        {
            "category": c.category,
            "open_tickets": c.count,
            "has_kb_article": c.category in kb_categories,
            "recommendation": f"Author a KB article for '{c.category}' to deflect future tickets.",
        }
        for c in cluster_rows
        if c.category not in kb_categories and c.count >= 3
    ]

    # 4. Team load heatmap
    from ..models.service_desk import TeamRoster
    roster = db.query(TeamRoster).all()
    team_load = [
        {
            "agent_name": r.agent_name,
            "team": r.team,
            "current_load": r.current_load,
            "capacity": r.capacity,
            "utilization_pct": round(r.current_load / r.capacity * 100 if r.capacity else 0, 1),
            "is_on_call": r.is_on_call,
        }
        for r in roster
    ]

    # 5. Major incident risk (clusters of 5+ tickets in same category in last 24h)
    day_ago = now - timedelta(hours=24)
    mi_risk_rows = (
        db.query(Ticket.category, func.count(Ticket.id).label("count"))
        .filter(Ticket.created_at >= day_ago, Ticket.category.isnot(None))
        .group_by(Ticket.category)
        .having(func.count(Ticket.id) >= 5)
        .all()
    )
    major_incident_risk = [
        {
            "category": row.category,
            "ticket_count_24h": row.count,
            "risk_level": "critical" if row.count >= 15 else "high",
            "recommendation": f"Possible major incident forming in '{row.category}'. Correlate tickets and open a parent incident.",
        }
        for row in mi_risk_rows
    ]

    # 6. Automation Opportunity Insights
    auto_opp_rows = (
        db.query(Ticket.category, func.count(Ticket.id).label("count"))
        .filter(Ticket.status.in_(["Resolved", "Closed"]), Ticket.category.isnot(None))
        .group_by(Ticket.category)
        .order_by(desc("count"))
        .limit(3)
        .all()
    )
    automation_opportunities = [
        {
            "category": row.category,
            "manual_resolutions": row.count,
            "recommendation": f"High volume of completed tickets ({row.count}) in '{row.category}'. Consider creating a new Operator or AI Policy to automate this category."
        }
        for row in auto_opp_rows
    ]

    return {
        "clusters": clusters,
        "sla_forecast": sla_forecast,
        "kb_gaps": kb_gaps,
        "team_load": team_load,
        "major_incident_risk": major_incident_risk,
        "automation_opportunities": automation_opportunities,
    }


# =============================================================================
# AI Manager (chat with Orchestrator)
# =============================================================================

@router.post("/manager/chat")
async def chat_with_manager(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Forward a message to the Supervity Orchestrator and return its reply."""

    if not SUPERVITY_API_URL or not SUPERVITY_API_KEY:
        # Demo fallback when Supervity is not wired yet
        return ChatResponse(
            reply=f"[Demo Mode] Orchestrator received: '{payload.message}'. Configure SUPERVITY_API_URL and SUPERVITY_API_KEY in .env to enable live delegation.",
            operator_trace=["orchestrator → demo_fallback"],
            ticket_keys=[],
        )

    try:
        import uuid
        ticket_key = f"SD-{uuid.uuid4().hex[:4].upper()}"
        
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://auto-workflow-api.supervity.ai/api/v1/workflow-runs/execute/stream",
                headers={
                    "Authorization": f"Bearer {SUPERVITY_API_KEY}",
                    "x-source": "external",
                    "x-active-org": "SubLife",
                    "x-user-timezone": "Asia/Kuala_Lumpur",
                },
                data={
                    "workflowId": "019fe03b-7cc6-7000-9f5f-78adb631ae98",
                    "inputs[ticket_key]": ticket_key,
                    "inputs[summary]": payload.message,
                    "inputs[reporter_email]": user.get("email", "manager@company.com"),
                    "inputs[reporter_name]": user.get("name", "AI Manager"),
                    "inputs[category]": "General",
                    "inputs[priority]": "P3",
                }
            )
            resp.raise_for_status()
            
            # The streaming execution API might return plain text or JSON
            try:
                data = resp.json()
            except Exception:
                data = {"reply": resp.text, "operator_trace": ["orchestrator"], "ticket_keys": [ticket_key]}

    except httpx.HTTPError as e:
        log.error(f"Supervity API error: {e}")
        raise HTTPException(status_code=502, detail=f"Supervity API error: {str(e)}")

    # Log manager interaction
    db.add(AgentActivity(
        operator="orchestrator",
        action="manager.chat",
        result="success",
        details={"question": payload.message[:200]},
    ))
    db.commit()

    return ChatResponse(
        reply=data.get("reply", data.get("output", str(data))),
        operator_trace=data.get("operator_trace"),
        ticket_keys=data.get("ticket_keys"),
    )


# =============================================================================
# Data Manager — Integration Registry
# =============================================================================

@router.get("/integrations")
async def list_integrations(
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Live registry of all connected systems with health status."""
    _seed_default_integrations(db)
    integrations = db.query(Integration).order_by(Integration.category, Integration.name).all()
    return [_integration_schema(i) for i in integrations]


@router.post("/integrations", status_code=201)
async def create_integration(
    payload: IntegrationCreateRequest,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Register a new integration."""
    integration = Integration(**payload.dict())
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return _integration_schema(integration)


@router.post("/integrations/{integration_id}/health-check")
async def health_check_integration(
    integration_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    """Trigger a health check on an integration."""
    integration = db.query(Integration).filter(Integration.id == integration_id).first()
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    now = datetime.now(timezone.utc)
    new_status = "unknown"
    error_msg = None

    if integration.endpoint_url:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(integration.endpoint_url)
                if resp.status_code < 400:
                    new_status = "healthy"
                    integration.last_success_at = now
                else:
                    new_status = "degraded"
                    error_msg = f"HTTP {resp.status_code}"
        except Exception as e:
            new_status = "down"
            error_msg = str(e)[:200]
    else:
        new_status = "healthy"  # No URL to check — assume configured OK

    integration.status = new_status
    integration.last_checked_at = now
    integration.error_message = error_msg
    db.commit()

    return {
        "id": integration_id,
        "status": new_status,
        "checked_at": _dt_str(now),
        "error_message": error_msg,
    }


def _integration_schema(i: Integration) -> IntegrationResponse:
    return IntegrationResponse(
        id=i.id,
        name=i.name,
        description=i.description,
        category=i.category,
        provider=i.provider,
        status=i.status,
        last_checked_at=_dt_str(i.last_checked_at),
        last_success_at=_dt_str(i.last_success_at),
        error_message=i.error_message,
        is_active=i.is_active,
    )
