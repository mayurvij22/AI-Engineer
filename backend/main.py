import datetime
import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Dict, Any, Optional

from backend import data_store
from backend import tools
from backend import agent

app = FastAPI(title="ParcelPilot AI Support & Operations API")

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class ChatRequest(BaseModel):
    message: str
    user_context: str  # "customer" or "internal"
    account_id: Optional[str] = None
    chat_history: Optional[List[Dict[str, str]]] = None
    api_key: Optional[str] = None

class ConfirmRequest(BaseModel):
    action_type: str
    params: Dict[str, Any]
    account_id: Optional[str] = None

@app.get("/api/health")
def health():
    return {"status": "ok", "time": datetime.datetime.now().isoformat()}

@app.post("/api/chat")
def chat(req: ChatRequest):
    try:
        res = agent.run_chat_agent(
            message=req.message,
            user_context=req.user_context,
            account_id=req.account_id,
            chat_history=req.chat_history,
            api_key=req.api_key
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/action/confirm")
def confirm_action(req: ConfirmRequest):
    action_type = req.action_type
    params = req.params
    account_id = req.account_id
    
    try:
        if action_type == "cancel_order":
            order_id = params.get("order_id")
            if not order_id:
                raise HTTPException(status_code=400, detail="Missing order_id param.")
            res = tools.cancel_order_execute(order_id, account_id, confirmed=True)
            return res
            
        elif action_type == "apply_service_credit":
            order_id = params.get("order_id")
            amount = params.get("amount")
            if not order_id or amount is None:
                raise HTTPException(status_code=400, detail="Missing order_id or amount param.")
            res = tools.apply_service_credit(order_id, float(amount), account_id, confirmed=True)
            return res
            
        elif action_type == "escalate_ticket":
            ticket_id = params.get("ticket_id")
            reason = params.get("reason", "Operations Escalation")
            if not ticket_id:
                raise HTTPException(status_code=400, detail="Missing ticket_id param.")
            res = tools.escalate_ticket(ticket_id, reason, account_id, confirmed=True)
            return res
            
        elif action_type == "update_ticket_status":
            ticket_id = params.get("ticket_id")
            new_status = params.get("new_status")
            if not ticket_id or not new_status:
                raise HTTPException(status_code=400, detail="Missing ticket_id or new_status.")
            res = tools.update_ticket_status(ticket_id, new_status, account_id, confirmed=True)
            return res
            
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action type: {action_type}")
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/proactive-alerts")
def get_proactive_alerts():
    """
    Scans the database of active support tickets, orders, and known issues
    to proactively identify critical issues, SLA breaches, and trends.
    """
    tickets = data_store.get_tickets()
    orders = data_store.get_orders()
    accounts = data_store.get_accounts()
    
    alerts = []
    sla_breaches = []
    matching_issues = []
    
    # 1. Check Ticket SLAs
    for ticket in tickets:
        if ticket["status"] != "closed":
            act_id = ticket["account_id"]
            created = tools.parse_date(ticket["created_at"])
            if not created:
                continue
                
            elapsed_mins = (tools.SNAPSHOT_TIME - created).total_seconds() / 60.0
            
            # Resolve SLA Target
            account = next((a for a in accounts if a["account_id"] == act_id), None)
            if not account:
                continue
                
            plan = account.get("plan", "Standard")
            
            # Determine Severity
            severity = "P3"
            subj_desc = (ticket["subject"] + " " + ticket["description"]).lower()
            if "outage" in subj_desc or "http 500" in subj_desc or "all shipment" in subj_desc or "security" in subj_desc or "api key exposure" in subj_desc:
                severity = "P1"
            elif "fails" in subj_desc or "upload" in subj_desc or "degraded" in subj_desc or "major feature" in subj_desc:
                severity = "P2"
                
            # SLAs in minutes
            if act_id == "ACCT-001": # Northstar
                targets = {"P1": 15, "P2": 60, "P3": 480}
            elif plan == "Enterprise":
                targets = {"P1": 30, "P2": 120, "P3": 480}
            elif plan == "Growth":
                targets = {"P1": 120, "P2": 240, "P3": 960}
            else:
                targets = {"P1": 240, "P2": 480, "P3": 960}
                
            target_mins = targets.get(severity, 960)
            
            if elapsed_mins > target_mins:
                breach_amount = elapsed_mins - target_mins
                breach_info = {
                    "ticket_id": ticket["ticket_id"],
                    "account_name": account["account_name"],
                    "subject": ticket["subject"],
                    "severity": severity,
                    "target_minutes": target_mins,
                    "elapsed_minutes": round(elapsed_mins, 1),
                    "breached_by_minutes": round(breach_amount, 1)
                }
                sla_breaches.append(breach_info)
                
                # Proactive alert
                alerts.append({
                    "id": f"SLA-BREACH-{ticket['ticket_id']}",
                    "severity": "CRITICAL" if severity == "P1" else "HIGH",
                    "title": f"SLA BREACH: Ticket {ticket['ticket_id']} ({account['account_name']})",
                    "description": f"Ticket '{ticket['subject']}' has been open for {elapsed_mins:.1f} mins, exceeding the {target_mins} min response SLA for {severity}.",
                    "suggested_action": f"Immediately escalate Ticket {ticket['ticket_id']} to {account.get('csm', 'operations')}."
                })
                
    # 2. Check for Known Issue Matches in open tickets
    for ticket in tickets:
        if ticket["status"] != "closed":
            subj_desc = (ticket["subject"] + " " + ticket["description"]).lower()
            
            # KI-208 Bulk Upload Issue
            if "bulk upload" in subj_desc or "4,200-row" in subj_desc or "row csv" in subj_desc:
                matching_issues.append({
                    "ticket_id": ticket["ticket_id"],
                    "known_issue_id": "KI-208",
                    "title": "Bulk Upload Failure above 3,000 rows",
                    "status": "Matches Active Bug"
                })
                alerts.append({
                    "id": f"KI-MATCH-208-{ticket['ticket_id']}",
                    "severity": "MEDIUM",
                    "title": f"Known Issue Identified: KI-208 on {ticket['ticket_id']}",
                    "description": f"Ticket reports CSV upload failures. This matches known issue KI-208 (CSV upload failures above 3,000 rows for Growth/Enterprise). Current status is investigating.",
                    "suggested_action": "Inform customer of the workaround to split the upload into files under 3,000 rows."
                })
                
            # KI-211 SwiftShip Webhook delay
            if "swiftship" in subj_desc and "booked" in subj_desc and ("driver" in subj_desc or "pickup" in subj_desc):
                matching_issues.append({
                    "ticket_id": ticket["ticket_id"],
                    "known_issue_id": "KI-211",
                    "title": "SwiftShip Webhook Delay (up to 20 minutes)",
                    "status": "Matches Active Bug"
                })
                alerts.append({
                    "id": f"KI-MATCH-211-{ticket['ticket_id']}",
                    "severity": "LOW",
                    "title": f"Known Issue Identified: KI-211 on {ticket['ticket_id']}",
                    "description": f"SwiftShip driver pickup was completed but status shows BOOKED. Matches Known Issue KI-211 (delay up to 20 mins).",
                    "suggested_action": "Advise the customer to wait for the 20-minute webhook window to expire."
                })
                
            # Security Credential Exposure (TKT-505)
            if "api key" in subj_desc or "exposure" in subj_desc or "credential" in subj_desc:
                alerts.append({
                    "id": f"SECURITY-RISK-{ticket['ticket_id']}",
                    "severity": "CRITICAL",
                    "title": f"SECURITY ALERT: API Key Exposed on {ticket['ticket_id']}",
                    "description": f"Suspected production API key exposed in public channel screenshot.",
                    "suggested_action": "Revoke the exposed API key immediately and notify CSM Priya Mehta."
                })

    # 3. Check Order Patterns
    # SwiftShip order pickup late check (e.g. ORD-2002 which is delayed)
    for order in orders:
        if order["status"] == "BOOKED":
            # Check if pickup window has ended and carrier is at fault
            window_end = tools.parse_date(order.get("pickup_window_end"))
            if window_end and window_end < tools.SNAPSHOT_TIME:
                delay = (tools.SNAPSHOT_TIME - window_end).total_seconds() / 3600.0
                if delay > 2.0 and order.get("carrier_fault"):
                    acct = next((a for a in accounts if a["account_id"] == order["account_id"]), None)
                    name = acct["account_name"] if acct else order["account_id"]
                    alerts.append({
                        "id": f"ORDER-DELAY-{order['order_id']}",
                        "severity": "HIGH",
                        "title": f"Missed Pickup Warning: Order {order['order_id']} ({name})",
                        "description": f"Shipment is {delay:.1f} hours past its scheduled pickup window end of {order['pickup_window_end']}. Carrier is at fault.",
                        "suggested_action": f"Apply service credit for late pickup (LumenWorks receives INR 300; standard receives lower of 500 or 10%)."
                    })

    return {
        "summary": {
            "total_alerts": len(alerts),
            "critical_alerts": sum(1 for a in alerts if a["severity"] == "CRITICAL"),
            "high_alerts": sum(1 for a in alerts if a["severity"] == "HIGH"),
            "medium_alerts": sum(1 for a in alerts if a["severity"] == "MEDIUM")
        },
        "alerts": alerts,
        "sla_breaches": sla_breaches,
        "matching_issues": matching_issues
    }

@app.get("/api/accounts")
def get_accounts():
    return data_store.get_accounts()

@app.get("/api/orders")
def get_orders(account_id: Optional[str] = None):
    return data_store.get_orders(account_id)

@app.get("/api/tickets")
def get_tickets(account_id: Optional[str] = None):
    return data_store.get_tickets(account_id)

@app.post("/api/reset")
def reset_database():
    try:
        data_store.load_data()
        return {"success": True, "message": "Database reset to Excel snapshot successful."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount Static Files (Production deployment frontend)
frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
else:
    print(f"Warning: Frontend distribution directory '{frontend_dist}' not found. Please compile frontend using 'npm run build'.")

