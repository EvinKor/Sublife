import logging
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import sessionmaker
from app.core.database import engine
from app.models.service_desk import Ticket

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def seed():
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    try:
        # Create clusters
        t1 = Ticket(id="1", ticket_key="SD-001", subject="Login Issue 1", category="Authentication", status="Open", escalation_risk="Low")
        t2 = Ticket(id="2", ticket_key="SD-002", subject="Login Issue 2", category="Authentication", status="Open", escalation_risk="Low")
        t3 = Ticket(id="3", ticket_key="SD-003", subject="Login Issue 3", category="Authentication", status="Open", escalation_risk="Low")
        
        # Create SLA Forecast
        t4 = Ticket(id="4", ticket_key="SD-004", subject="VIP Network Down", priority="P1", escalation_risk="Critical", is_vip=True, status="Open", sla_resolution_due_at=now + timedelta(minutes=15))
        
        # Create Automation Opportunities (Resolved tickets)
        t5 = Ticket(id="5", ticket_key="SD-005", subject="VPN Access Request", category="Access", status="Resolved")
        t6 = Ticket(id="6", ticket_key="SD-006", subject="VPN Access Request", category="Access", status="Resolved")
        t7 = Ticket(id="7", ticket_key="SD-007", subject="VPN Access Request", category="Access", status="Resolved")
        
        # Create major incident risks
        t8 = Ticket(id="8", ticket_key="SD-008", subject="DB down 1", category="Database", status="Open", created_at=now - timedelta(hours=1))
        t9 = Ticket(id="9", ticket_key="SD-009", subject="DB down 2", category="Database", status="Open", created_at=now - timedelta(hours=1))
        t10 = Ticket(id="10", ticket_key="SD-010", subject="DB down 3", category="Database", status="Open", created_at=now - timedelta(hours=1))
        t11 = Ticket(id="11", ticket_key="SD-011", subject="DB down 4", category="Database", status="Open", created_at=now - timedelta(hours=1))
        t12 = Ticket(id="12", ticket_key="SD-012", subject="DB down 5", category="Database", status="Open", created_at=now - timedelta(hours=1))

        # Clear existing
        db.query(Ticket).delete()
        
        db.add_all([t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12])
        db.commit()
        print("Data seeded successfully!")
    except Exception as e:
        print(f"Error: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed()
