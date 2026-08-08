# app/models/service_desk.py
"""
Service Desk Models — Round 2 Hackathon

Covers:
  - User             : Employee directory (requesters)
  - Ticket           : IT service desk tickets (mirrors Jira/Round-2 data pack)
  - TicketComment    : Comment threads per ticket
  - CSATSurvey       : Post-resolution satisfaction surveys
  - ChangeRequest    : Change approval workflow
  - SLACalendar      : Business-hours / holidays calendar
  - TeamRoster       : Agent team members and on-call shifts
  - KnowledgeBase    : KB articles authored by the agent
  - AIPolicy         : Configurable rules that gate / change agent behaviour
  - PolicyEvalLog    : Every time a policy is evaluated, log it
  - WorkbenchItem    : Escalated exceptions awaiting human review
  - Integration      : Live registry of connected systems
  - AgentActivity    : Audit trail of every Operator action
"""

from datetime import datetime
from enum import Enum

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, Float, ForeignKey,
    Integer, String, Text, func,
)

from ..core.database import Base


# =============================================================================
# Enumerations
# =============================================================================

class TicketPriority(str, Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    P4 = "P4"


class TicketStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "In Progress"
    PENDING = "Pending"
    RESOLVED = "Resolved"
    CLOSED = "Closed"
    ESCALATED = "Escalated"


class WorkbenchStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REASSIGNED = "reassigned"


class IntegrationCategory(str, Enum):
    CHANNEL = "channel"
    SYSTEM_OF_RECORD = "system_of_record"
    HUMAN_LOOP = "human_loop"
    STORAGE = "storage"


class IntegrationStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    DOWN = "down"
    UNKNOWN = "unknown"


class PolicyType(str, Enum):
    SLA_THRESHOLD = "auto_remediation"
    AUTO_REMEDIATION = "auto_remediation"
    VIP_PRIORITY = "vip_priority"
    ESCALATION_MATRIX = "escalation_matrix"
    CHANGE_APPROVAL = "change_approval"


# =============================================================================
# User
# =============================================================================

class User(Base):
    __tablename__ = "users"
    id = Column(String(100), primary_key=True)
    full_name = Column(String(255))
    email = Column(String(255))
    role = Column(String(50))
    team = Column(String(100))
    department = Column(String(100))
    is_vip = Column(Boolean, default=False)
    location = Column(String(100))

    @property
    def name(self):
        return self.full_name

    @name.setter
    def name(self, value):
        self.full_name = value

# =============================================================================
# Ticket (core entity)
# =============================================================================

class Ticket(Base):
    __tablename__ = "tickets"
    id = Column(String(100), primary_key=True, index=True)
    ticket_key = Column(String(50), unique=True, index=True)
    subject = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    requester_id = Column(String(100), nullable=True)
    assignee_id = Column(String(100), nullable=True)
    team = Column(String(100), nullable=True)
    priority = Column(String(20), nullable=True)
    status = Column(String(50), nullable=False, default="Open")
    channel = Column(String(50), nullable=True)
    category = Column(String(100), nullable=True)
    related_system = Column(String(100), nullable=True)
    is_vip = Column(Boolean, default=False)
    sla_response_due_at = Column(DateTime(timezone=True), nullable=True)
    sla_resolution_due_at = Column(DateTime(timezone=True), nullable=True)
    sla_breached = Column(Boolean, default=False)
    change_approval_required = Column(Boolean, default=False)
    parent_incident_id = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    requester_name_raw = Column(String(255), nullable=True)
    assignee_name_raw = Column(String(255), nullable=True)
    escalation_risk = Column(String(50), nullable=True)
    reopened = Column(Boolean, default=False)
    first_response_hours = Column(Float, nullable=True)
    linked_incident_label = Column(String(100), nullable=True)
    confidence = Column(Float, nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    request_type = Column(String(100), nullable=True)
    raw_sla_text = Column(String(255), nullable=True)

    @property
    def summary(self):
        return self.subject

    @summary.setter
    def summary(self, value):
        self.subject = value

    @property
    def reporter_name(self):
        return self.requester_name_raw

    @reporter_name.setter
    def reporter_name(self, value):
        self.requester_name_raw = value

    @property
    def assignee_name(self):
        return self.assignee_name_raw

    @assignee_name.setter
    def assignee_name(self, value):
        self.assignee_name_raw = value

    @property
    def reporter_email(self):
        return None

    @property
    def sla_risk_score(self):
        risk_map = {"Critical": 95, "High": 80, "Medium": 50, "Low": 20}
        return risk_map.get(self.escalation_risk, 0) if self.escalation_risk else 0

    @sla_risk_score.setter
    def sla_risk_score(self, value):
        pass

    @property
    def sla_resolve_due(self):
        return self.sla_resolution_due_at

    @sla_resolve_due.setter
    def sla_resolve_due(self, value):
        self.sla_resolution_due_at = value

    @property
    def auto_resolved(self):
        return False

    @auto_resolved.setter
    def auto_resolved(self, value):
        pass

    @property
    def major_incident_id(self):
        return self.parent_incident_id

    @major_incident_id.setter
    def major_incident_id(self, value):
        self.parent_incident_id = value

    @property
    def agent_recommendation(self):
        return None

    @agent_recommendation.setter
    def agent_recommendation(self, value):
        pass

    @property
    def csat_score(self):
        return None

    @csat_score.setter
    def csat_score(self, value):
        pass

    @property
    def raw_data(self):
        return None

    @raw_data.setter
    def raw_data(self, value):
        pass

    def __repr__(self):
        return f"<Ticket {self.ticket_key}: {self.priority} {self.status}>"

    @property
    def mttr_hours(self) -> float | None:
        """Mean time to resolution in hours."""
        if self.resolved_at and self.created_at:
            delta = self.resolved_at - self.created_at
            return round(delta.total_seconds() / 3600, 2)
        return None


# =============================================================================
# Ticket Comments
# =============================================================================

class TicketComment(Base):
    """Conversation thread entry for a ticket."""
    __tablename__ = "ticket_comments"

    id = Column(String(100), primary_key=True, index=True)
    ticket_id = Column(String(100), ForeignKey("tickets.id"), nullable=True)
    ticket_key = Column(String(50), nullable=False, index=True)
    author_id = Column(String(100), nullable=True)
    author_name = Column("author_name_raw", String(255), nullable=True)
    author_type = Column(String(20), nullable=False, default="human")   # "human" | "agent"
    body = Column("comment_text", Text, nullable=False)
    is_internal = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# =============================================================================
# CSAT Survey
# =============================================================================

class CSATSurvey(Base):
    """Post-resolution customer satisfaction survey."""
    __tablename__ = "csat_surveys"

    id = Column(String(100), primary_key=True, index=True)
    ticket_id = Column(String(100), ForeignKey("tickets.id"), nullable=True)
    ticket_key = Column(String(50), nullable=False, index=True)
    respondent_id = Column(String(100), nullable=True)
    respondent_email = Column(String(255), nullable=True)
    score = Column(Float, nullable=False)                       # 1-5
    feedback = Column("comment", Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    responded_at = Column(DateTime(timezone=True), nullable=True)
    escalated = Column(Boolean, nullable=False, default=False)  # Poor score escalated to human
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# Change Request
# =============================================================================

class ChangeRequest(Base):
    """Change approval record — required before agent touches production."""
    __tablename__ = "change_requests"

    id = Column(String(100), primary_key=True, index=True)
    change_key = Column(String(50), nullable=True, index=True)
    ticket_id = Column(String(100), ForeignKey("tickets.id"), nullable=True)
    ticket_key = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    risk_level = Column(String(20), nullable=False, default="Medium")   # Low | Medium | High
    status = Column(String(50), nullable=False, default="Pending")
    requested_by = Column(String(255), nullable=True)
    approved_by = Column(String(255), nullable=True)
    approver_name_raw = Column(String(255), nullable=True)
    cab_approval_required = Column(Boolean, default=False)
    scheduled_start = Column(DateTime(timezone=True), nullable=True)
    scheduled_end = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# =============================================================================
# SLA Calendar
# =============================================================================

class SLACalendar(Base):
    """Business hours and holiday definitions for SLA calculation."""
    __tablename__ = "sla_calendar"

    id = Column(String(100), primary_key=True, index=True)
    region = Column(String(100), nullable=False)
    day_of_week = Column(Integer, nullable=True)
    start_time = Column(String(50), nullable=True)
    end_time = Column(String(50), nullable=True)
    timezone = Column(String(50), nullable=True)
    is_24x7 = Column(Boolean, nullable=False, default=False)
    is_holiday = Column(Boolean, nullable=False, default=False)
    holiday_date = Column(DateTime, nullable=True)





# =============================================================================
# Team Roster
# =============================================================================

class TeamRoster(Base):
    """Agent assignment groups, shift schedules, and on-call rotation."""
    __tablename__ = "team_roster"

    id = Column(String(100), primary_key=True, index=True)
    team = Column(String(100), nullable=False, index=True)
    member_id = Column(String(100), nullable=True, index=True)
    role = Column(String(100), nullable=True)
    region = Column(String(100), nullable=True)
    team_label = Column(String(100), nullable=True)
    member_name_raw = Column(String(255), nullable=True)
    shift_start = Column(DateTime(timezone=True), nullable=True)
    shift_end = Column(DateTime(timezone=True), nullable=True)
    capacity = Column(Integer, nullable=True)
    on_call = Column(Boolean, nullable=False, default=False)

    @property
    def agent_name(self):
        return self.member_name_raw

    @property
    def is_on_call(self):
        return self.on_call

    @property
    def current_load(self):
        # We can just mock this for now or return 0, since it's not a real column
        return 0


# =============================================================================
# Knowledge Base
# =============================================================================

class KnowledgeBase(Base):
    __tablename__ = "knowledge_base"
    id = Column(String(100), primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    body = Column(Text, nullable=False)
    category = Column(String(100), nullable=True)
    related_system = Column(String(100), nullable=True)
    author_id = Column(String(100), nullable=True)
    x_auto_safe = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    @property
    def content(self):
        return self.body

    @property
    def view_count(self):
        return 0
    
    @property
    def helpful_count(self):
        return 0


# =============================================================================
# AI Policy
# =============================================================================

class AIPolicy(Base):
    """Business rules governing the Agent's autonomy."""
    __tablename__ = "sd_ai_policies"

    id = Column(Integer, primary_key=True, index=True)
    policy_key = Column(String(100), unique=True, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    policy_type = Column(String(50), nullable=False)
    value = Column(JSON, nullable=True)
    default_value = Column(JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    priority = Column(Integer, nullable=False, default=100)
    evaluation_count = Column(Integer, nullable=False, default=0)
    last_evaluated_at = Column(DateTime(timezone=True), nullable=True)
    updated_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

# =============================================================================
# Workbench Items
# =============================================================================
class WorkbenchItem(Base):
    """Escalations routed to the human Workbench."""
    __tablename__ = "workbench_items"

    id = Column(String(100), primary_key=True, index=True)
    ticket_id = Column(String(100), nullable=True)
    exception_type = Column(String(100), nullable=False)
    context = Column(JSON, nullable=True)
    agent_recommendation = Column("ai_recommendation", Text, nullable=True)
    ai_confidence = Column(Float, nullable=True)
    status = Column(String(50), nullable=False, default="pending")
    resolved_by = Column(String(100), nullable=True)
    resolution_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def ticket_key(self):
        return self.context.get("ticket_key", self.ticket_id) if self.context else self.ticket_id

    @property
    def title(self):
        return self.context.get("title", self.exception_type) if self.context else self.exception_type

    @property
    def description(self):
        return self.context.get("description") if self.context else None

    @property
    def agent_diagnosis(self):
        return self.context.get("agent_diagnosis") if self.context else None

    @property
    def correlated_tickets(self):
        return self.context.get("correlated_tickets") if self.context else None

    @property
    def policy_evaluation(self):
        return self.context.get("policy_evaluation") if self.context else None

    @property
    def sla_time_remaining_minutes(self):
        return self.context.get("sla_time_remaining_minutes") if self.context else None

    @property
    def priority(self):
        return self.context.get("priority", "P3") if self.context else "P3"

    @property
    def is_vip(self):
        return self.context.get("is_vip", False) if self.context else False

    @property
    def resolution_notes(self):
        return self.resolution_note


class Integration(Base):
    __tablename__ = "sd_integrations"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)
    provider = Column(String(100), nullable=True)
    endpoint_url = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default="unknown")
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    last_success_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    config = Column(JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentActivity(Base):
    __tablename__ = "sd_agent_activity"
    id = Column(Integer, primary_key=True, index=True)
    operator = Column(String(100), nullable=True)
    action = Column(String(100), nullable=False)
    ticket_key = Column(String(50), index=True, nullable=True)
    workbench_item_id = Column(String(100), nullable=True)
    details = Column(JSON, nullable=True)
    result = Column(String(50), nullable=True)
    duration_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class PolicyEvalLog(Base):
    __tablename__ = "sd_policy_eval_logs"
    id = Column(Integer, primary_key=True, index=True)
    policy_key = Column(String(100), nullable=True)
    ticket_key = Column(String(50), nullable=True)
    result = Column(String(50), nullable=False)
    reason = Column(Text, nullable=True)
    input_context = Column(JSON, nullable=True)
    policy_value_snapshot = Column(JSON, nullable=True)
    evaluated_at = Column(DateTime(timezone=True), server_default=func.now())
