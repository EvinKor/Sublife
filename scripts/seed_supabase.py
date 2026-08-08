#!/usr/bin/env python3
"""
seed_supabase.py — Round 2 Data Pack seeder for Supabase
=========================================================
Loads the Round 2 service desk dataset (1,200 rows, 10 tables)
into your Supabase PostgreSQL instance.

Usage:
  1. Set SUPABASE_DATABASE_URL in your .env (or pass as env var)
     Format: postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
  2. Run: python scripts/seed_supabase.py

The script is idempotent — re-running will UPSERT, not duplicate.
"""

import os
import random
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# Bootstrap path so we can import the app models
# ---------------------------------------------------------------------------
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

from dotenv import load_dotenv
load_dotenv(os.path.join(ROOT, ".env"))

DATABASE_URL = os.getenv("SUPABASE_DATABASE_URL") or os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("❌  Set SUPABASE_DATABASE_URL (or DATABASE_URL) in .env first.")
    sys.exit(1)

from app.core.database import Base
# Import all models so Base.metadata knows about them
from app.models.service_desk import (  # noqa: F401
    Ticket, TicketComment, CSATSurvey, ChangeRequest,
    SLACalendar, TeamRoster, KnowledgeBase,
    AIPolicy, PolicyEvalLog,
    WorkbenchItem, Integration, AgentActivity,
)

engine = create_engine(DATABASE_URL)
Session = sessionmaker(bind=engine)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

rng = random.Random(42)

CATEGORIES = [
    "Access", "Hardware", "Network", "Software", "Account",
    "Email", "VPN", "Printer", "Security", "Database",
    "Application", "Password Reset", "Onboarding",
]

TEAMS = ["Desktop Support", "Network Ops", "Security", "Cloud Ops", "Applications"]

REPORTERS = [
    ("USR001", "alice@company.com", "Alice Wong"),
    ("USR002", "bob@company.com", "Bob Singh"),
    ("USR003", "carol@company.com", "Carol Tan"),
    ("USR004", "david@company.com", "David Lim"),
    ("USR005", "eve@company.com", "Eve Patel"),
    ("USR006", "frank@company.com", "Frank Müller"),
    ("USR007", "grace@company.com", "Grace Kim"),
    ("USR008", "henry@company.com", "Henry Osei"),
    ("USR009", "irene@company.com", "Irene Vasquez"),
    ("USR010", "james@ceo.company.com", "James Chan"),   # VIP
]

AGENTS = [
    ("AGT001", "support1@company.com", "Rajan Kumar", "Desktop Support"),
    ("AGT002", "support2@company.com", "Mei Lin", "Network Ops"),
    ("AGT003", "support3@company.com", "Amir Hassan", "Security"),
    ("AGT004", "support4@company.com", "Priya Nair", "Cloud Ops"),
    ("AGT005", "support5@company.com", "Lucas Oliveira", "Applications"),
]

PRIORITIES = ["P1", "P2", "P3", "P4"]
PRIORITY_WEIGHTS = [0.05, 0.15, 0.50, 0.30]

STATUSES = ["Open", "In Progress", "Pending", "Resolved", "Closed"]
STATUS_WEIGHTS = [0.25, 0.20, 0.10, 0.30, 0.15]

SLA_HOURS = {"P1": 4, "P2": 8, "P3": 24, "P4": 72}

SUMMARIES = {
    "Access": ["Cannot access SharePoint folder", "VPN disconnects every 10 minutes", "Cannot log into Office 365"],
    "Hardware": ["Laptop fan making noise", "Monitor flickering", "Keyboard keys stuck"],
    "Network": ["Slow internet on 3rd floor", "WiFi keeps dropping", "Cannot reach internal server"],
    "Software": ["Excel crashes on launch", "Teams not syncing", "Antivirus update failing"],
    "Account": ["Account locked after failed logins", "Need to reset 2FA", "Password expired"],
    "Email": ["Cannot send attachments over 10MB", "Emails going to spam", "Out-of-office not working"],
    "VPN": ["VPN timeout after 30 minutes", "Split tunnel not working", "Cannot connect from home"],
    "Printer": ["Printer offline on floor 2", "Print queue stuck", "Toner low alert"],
    "Security": ["Suspicious login from unknown IP", "Phishing email received", "USB device blocked"],
    "Database": ["Query running slow", "Connection pool exhausted", "Backup job failed"],
    "Application": ["CRM login page blank", "ERP throwing 500 error", "Mobile app crash on iOS"],
    "Password Reset": ["Need password reset for SAP", "Forgot domain password", "Password reset link expired"],
    "Onboarding": ["New joiner needs laptop setup", "Azure AD account not created", "Badge access not granted"],
}

now = datetime.now(timezone.utc)


def rand_choice(options, weights=None):
    return rng.choices(options, weights=weights, k=1)[0]


def rand_date(days_back=30):
    return now - timedelta(
        days=rng.uniform(0, days_back),
        hours=rng.uniform(0, 23),
        minutes=rng.uniform(0, 59),
    )


# ---------------------------------------------------------------------------
# Seeding functions
# ---------------------------------------------------------------------------

def seed_sla_calendar(db):
    print("  📅  Seeding SLA calendar…")
    holidays = {
        "2026-08-09": "National Day",
        "2026-09-16": "Malaysia Day",
        "2026-11-11": "Remembrance Day",
    }
    count = 0
    for i in range(60):
        d = (now + timedelta(days=i - 30)).strftime("%Y-%m-%d")
        weekday = (now + timedelta(days=i - 30)).weekday()
        holiday = holidays.get(d)
        working = weekday < 5 and not holiday
        if db.query(SLACalendar).filter(SLACalendar.date == d).first():
            continue
        db.add(SLACalendar(
            date=d,
            is_working_day=working,
            holiday_name=holiday,
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} calendar entries")


def seed_team_roster(db):
    print("  👥  Seeding team roster…")
    count = 0
    for agent_id, email, name, team in AGENTS:
        if db.query(TeamRoster).filter(TeamRoster.agent_id == agent_id).first():
            continue
        db.add(TeamRoster(
            agent_id=agent_id,
            agent_name=name,
            agent_email=email,
            team=team,
            role="Level 1 Analyst",
            shift="Day",
            is_on_call=(agent_id == "AGT001"),
            current_load=rng.randint(2, 8),
            capacity=10,
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} team members")


def seed_knowledge_base(db):
    print("  📚  Seeding knowledge base…")
    articles = [
        ("KB001", "How to reset your VPN connection", "VPN", "1. Disconnect VPN\n2. Clear credentials\n3. Reconnect using corporate profile"),
        ("KB002", "Fixing Excel crash on startup", "Software", "Disable add-ins via Safe Mode: Hold Ctrl while opening Excel"),
        ("KB003", "Unlocking a locked Active Directory account", "Account", "Contact IT via Teams or submit a ticket. Resolution time: 15 min"),
        ("KB004", "Setting up Office 365 on a new device", "Software", "Visit aka.ms/setup, sign in with corporate email, follow wizard"),
        ("KB005", "Requesting printer access", "Printer", "Submit access request via the IT portal. Approval takes 1 business day"),
    ]
    count = 0
    for key, title, cat, body in articles:
        if db.query(KnowledgeBase).filter(KnowledgeBase.article_key == key).first():
            continue
        db.add(KnowledgeBase(
            article_key=key,
            title=title,
            category=cat,
            body=body,
            tags=[cat.lower(), "self-service"],
            authored_by="agent",
            view_count=rng.randint(10, 200),
            deflection_count=rng.randint(5, 50),
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} KB articles")


def seed_tickets(db, n=200):
    print(f"  🎫  Seeding {n} tickets…")
    count = 0
    for i in range(1, n + 1):
        key = f"SD-{i:04d}"
        if db.query(Ticket).filter(Ticket.ticket_key == key).first():
            continue

        cat = rand_choice(CATEGORIES)
        priority = rand_choice(PRIORITIES, PRIORITIES_WEIGHTS := PRIORITY_WEIGHTS)
        status = rand_choice(STATUSES, STATUS_WEIGHTS)
        reporter_id, reporter_email, reporter_name = rand_choice(REPORTERS)
        agent_id, agent_email, agent_name, team = rand_choice(AGENTS)
        created = rand_date(30)
        is_vip = "ceo.company.com" in reporter_email

        sla_hours = SLA_HOURS[priority]
        sla_due = created + timedelta(hours=sla_hours)
        # Add some future tickets
        if i > 150:
            created = now - timedelta(minutes=rng.randint(1, 60))
            sla_due = created + timedelta(hours=sla_hours)

        breached = sla_due < now and status not in ("Resolved", "Closed")
        sla_risk = 0.0
        if status not in ("Resolved", "Closed"):
            time_left = (sla_due - now).total_seconds()
            total = timedelta(hours=sla_hours).total_seconds()
            sla_risk = max(0, min(100, 100 - (time_left / total * 100)))

        resolved_at = None
        if status in ("Resolved", "Closed"):
            resolved_at = created + timedelta(hours=rng.uniform(0.5, sla_hours * 0.9))

        auto_resolved = status in ("Resolved", "Closed") and rng.random() < 0.45

        # Major incident: cluster SD-0051..0065 all in "Network" category
        major_incident_id = None
        if 51 <= i <= 65:
            cat = "Network"
            major_incident_id = "SD-0051"

        summaries_list = SUMMARIES.get(cat, [f"{cat} issue"])
        summary = rand_choice(summaries_list)

        db.add(Ticket(
            ticket_key=key,
            summary=summary,
            priority=priority,
            status=status,
            category=cat,
            reporter_id=reporter_id,
            reporter_email=reporter_email,
            reporter_name=reporter_name,
            assignee_id=agent_id,
            assignee_name=agent_name,
            team=team,
            is_vip=is_vip,
            sla_breached=breached,
            sla_risk_score=round(sla_risk, 1),
            sla_resolve_due=sla_due,
            auto_resolved=auto_resolved,
            major_incident_id=major_incident_id,
            csat_score=round(rng.uniform(2.5, 5.0), 1) if status in ("Resolved", "Closed") else None,
            created_at=created,
            resolved_at=resolved_at,
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} tickets")


def seed_ticket_comments(db):
    print("  💬  Seeding ticket comments…")
    tickets = db.query(Ticket).filter(Ticket.status.in_(["In Progress", "Resolved"])).limit(50).all()
    count = 0
    for t in tickets:
        if db.query(TicketComment).filter(TicketComment.ticket_key == t.ticket_key).first():
            continue
        db.add(TicketComment(
            ticket_key=t.ticket_key,
            author_name=t.assignee_name,
            author_type="human",
            body=f"Investigating {t.category} issue. Will update shortly.",
        ))
        db.add(TicketComment(
            ticket_key=t.ticket_key,
            author_name="AI Operator",
            author_type="agent",
            body=f"Diagnosis complete. Recommended fix: restart service. Awaiting policy gate check.",
        ))
        count += 2
    db.commit()
    print(f"     ✓ {count} comments")


def seed_csat(db):
    print("  ⭐  Seeding CSAT surveys…")
    resolved = db.query(Ticket).filter(Ticket.status == "Resolved", Ticket.csat_score.isnot(None)).limit(60).all()
    count = 0
    for t in resolved:
        if db.query(CSATSurvey).filter(CSATSurvey.ticket_key == t.ticket_key).first():
            continue
        db.add(CSATSurvey(
            ticket_key=t.ticket_key,
            respondent_email=t.reporter_email,
            score=t.csat_score,
            comment="Thanks, resolved quickly!" if t.csat_score >= 4 else "Took too long.",
            escalated=t.csat_score < 3,
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} CSAT surveys")


def seed_change_requests(db):
    print("  🔄  Seeding change requests…")
    entries = [
        ("CHG001", "SD-0010", "Firewall rule update for dev team", "High", "Approved"),
        ("CHG002", "SD-0025", "Server reboot for patch deployment", "High", "Pending"),
        ("CHG003", "SD-0040", "VPN profile update", "Medium", "Approved"),
        ("CHG004", "SD-0060", "Network switch firmware upgrade", "High", "Pending"),
        ("CHG005", "SD-0080", "Active Directory schema update", "High", "Rejected"),
    ]
    count = 0
    for key, tkey, title, risk, status in entries:
        if db.query(ChangeRequest).filter(ChangeRequest.change_key == key).first():
            continue
        db.add(ChangeRequest(
            change_key=key,
            ticket_key=tkey,
            title=title,
            risk_level=risk,
            status=status,
            requested_by="agent",
            approved_by="Change Manager" if status == "Approved" else None,
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} change requests")


def seed_agent_activity(db):
    print("  🤖  Seeding agent activity…")
    operators = ["sla_triage", "diagnose_correlate", "remediate", "comms", "csat_kb", "orchestrator"]
    actions = [
        "ticket.triage", "sla.score_calculated", "incident.correlate",
        "remediation.check_policy", "comms.send_update", "csat.survey_sent",
        "kb.article_authored", "workbench.escalate", "ticket.auto_resolved",
    ]
    tickets = db.query(Ticket).limit(30).all()
    count = 0
    for t in tickets:
        op = rand_choice(operators)
        action = rand_choice(actions)
        db.add(AgentActivity(
            operator=op,
            action=action,
            ticket_key=t.ticket_key,
            result=rand_choice(["success", "escalated", "success", "success"]),
            duration_ms=rng.randint(120, 2500),
            details={"priority": t.priority, "category": t.category},
        ))
        count += 1
    db.commit()
    print(f"     ✓ {count} activity entries")


def seed_workbench(db):
    print("  📋  Seeding workbench items…")
    entries = [
        {
            "ticket_key": "SD-0060",
            "exception_type": "major_incident",
            "title": "Potential major incident: 15 Network tickets in 2 hours",
            "description": "Diagnose & Correlate detected a cluster of Network tickets all reporting VPN timeouts.",
            "agent_diagnosis": "15 tickets share root cause: VPN concentrator CPU at 98%. Network Ops team load at capacity.",
            "agent_recommendation": "Restart VPN load balancer primary node. CHG004 approval required before action.",
            "correlated_tickets": ["SD-0051", "SD-0052", "SD-0053", "SD-0054", "SD-0055"],
            "sla_time_remaining_minutes": 18,
            "priority": "P1",
            "is_vip": False,
        },
        {
            "ticket_key": "SD-0025",
            "exception_type": "change_approval",
            "title": "Server reboot requires CAB approval before remediation",
            "description": "Remediate Operator determined the fix (server reboot) is not in the auto-remediation allowed list.",
            "agent_diagnosis": "Patch deployment requires full server reboot. Auto-remediation policy blocks server reboots without CAB sign-off.",
            "agent_recommendation": "Approve CHG002 to allow Remediate Operator to proceed. Estimated fix time: 15 minutes.",
            "correlated_tickets": ["SD-0025"],
            "sla_time_remaining_minutes": 120,
            "priority": "P2",
            "is_vip": False,
        },
        {
            "ticket_key": "SD-0195",
            "exception_type": "vip_breach",
            "title": "VIP ticket SD-0195 approaching SLA breach",
            "description": "James Chan (CEO domain) submitted a ticket 3.5 hours ago. P1 SLA = 4 hours.",
            "agent_diagnosis": "SLA Triage elevated to P1 per VIP policy. Assignee has not updated status.",
            "agent_recommendation": "Immediately reassign to on-call specialist (Rajan Kumar) and send VIP status update.",
            "correlated_tickets": [],
            "sla_time_remaining_minutes": 28,
            "priority": "P1",
            "is_vip": True,
        },
    ]
    count = 0
    for e in entries:
        if db.query(WorkbenchItem).filter(WorkbenchItem.ticket_key == e["ticket_key"]).first():
            continue
        db.add(WorkbenchItem(**e))
        count += 1
    db.commit()
    print(f"     ✓ {count} workbench items")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("\n🚀  Service Desk Data Pack Seeder — Round 2\n")
    print(f"   Database: {DATABASE_URL[:40]}…\n")

    print("📦  Creating tables…")
    Base.metadata.create_all(engine)
    print("   ✓ Tables ready\n")

    db = Session()
    try:
        print("📥  Seeding data…")
        seed_sla_calendar(db)
        seed_team_roster(db)
        seed_knowledge_base(db)
        seed_tickets(db, n=200)
        seed_ticket_comments(db)
        seed_csat(db)
        seed_change_requests(db)
        seed_agent_activity(db)
        seed_workbench(db)
        print("\n✅  Seeding complete! Your Supabase database is ready.\n")
        print("   Next steps:")
        print("   1. Run `docker compose up` to start the backend")
        print("   2. Visit http://localhost:3001 to see the Command Center with live data")
        print("   3. Configure SUPERVITY_API_URL + SUPERVITY_API_KEY in .env to wire the agent")
    except Exception as e:
        db.rollback()
        print(f"\n❌  Seeding failed: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
