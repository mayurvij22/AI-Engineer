import datetime
from backend import data_store

SNAPSHOT_TIME = datetime.datetime(2026, 8, 16, 11, 0) # 2026-08-16 11:00

def parse_date(date_str):
    if not date_str:
        return None
    try:
        return datetime.datetime.strptime(date_str, "%Y-%m-%d %H:%M")
    except ValueError:
        try:
            return datetime.datetime.strptime(date_str, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None

def check_order_ownership(order_id: str, account_id: str = None) -> tuple[dict, str]:
    """
    Looks up order and checks ownership. Returns (order_dict, error_msg).
    """
    orders = data_store.get_orders()
    order = next((o for o in orders if o["order_id"] == order_id), None)
    if not order:
        return None, f"Order {order_id} not found."
    if account_id and order["account_id"] != account_id:
        return None, "Unauthorized: Order belongs to another account."
    return order, None

def check_ticket_ownership(ticket_id: str, account_id: str = None) -> tuple[dict, str]:
    """
    Looks up ticket and checks ownership. Returns (ticket_dict, error_msg).
    """
    tickets = data_store.get_tickets()
    ticket = next((t for t in tickets if t["ticket_id"] == ticket_id), None)
    if not ticket:
        return None, f"Ticket {ticket_id} not found."
    if account_id and ticket["account_id"] != account_id:
        return None, "Unauthorized: Ticket belongs to another account."
    return ticket, None

def get_account_details(account_id: str):
    """
    Returns account details.
    """
    accounts = data_store.get_accounts()
    account = next((a for a in accounts if a["account_id"] == account_id), None)
    if not account:
        return {"error": f"Account {account_id} not found."}
    return account

def get_order_details(order_id: str, account_id: str = None):
    """
    Retrieves order details, enforcing account scoping.
    """
    order, error = check_order_ownership(order_id, account_id)
    if error:
        return {"error": error}
    return order

def get_ticket_details(ticket_id: str, account_id: str = None):
    """
    Retrieves ticket details, enforcing account scoping.
    """
    ticket, error = check_ticket_ownership(ticket_id, account_id)
    if error:
        return {"error": error}
    return ticket

def calculate_service_credit(order_id: str, account_id: str = None) -> dict:
    """
    Evaluates whether an order is eligible for a service credit due to late pickup.
    Applies custom agreement terms or standard SOP v4.
    """
    order, error = check_order_ownership(order_id, account_id)
    if error:
        return {"eligible": False, "error": error}
        
    act_id = order["account_id"]
    accounts = data_store.get_accounts()
    account = next((a for a in accounts if a["account_id"] == act_id), None)
    
    if not account:
        return {"eligible": False, "error": f"Account {act_id} not found."}
        
    fee = order.get("shipment_fee_inr", 0)
    carrier_fault = order.get("carrier_fault", False)
    customer_fault = order.get("customer_fault", False)
    
    # Check pickup times
    window_end_str = order.get("pickup_window_end")
    window_end = parse_date(window_end_str)
    
    actual_pickup_str = order.get("pickup_actual_at")
    actual_pickup = parse_date(actual_pickup_str)
    
    if not window_end:
        return {"eligible": False, "reason": "Missing scheduled pickup window end date."}
        
    # Determine the end point for delay calculation
    if actual_pickup:
        end_time = actual_pickup
        time_desc = f"picked up at {actual_pickup_str}"
    else:
        end_time = SNAPSHOT_TIME
        time_desc = f"not yet picked up at snapshot time ({SNAPSHOT_TIME.strftime('%Y-%m-%d %H:%M')})"
        
    # Calculate delay in hours
    delay_delta = end_time - window_end
    delay_hours = delay_delta.total_seconds() / 3600.0
    
    if delay_hours < 0:
        delay_hours = 0
        
    # Check custom terms
    plan = account.get("plan", "Standard")
    
    # 1. LumenWorks ACCT-002 custom agreement
    if act_id == "ACCT-002":
        threshold_hours = 4.0
        credit_amount = 300.0
        rule_applied = "LumenWorks Service Agreement Section 3"
        custom_agreement = True
    else:
        threshold_hours = 2.0
        credit_amount = min(500.0, fee * 0.1)
        rule_applied = "Standard SOP v4 Section 2"
        custom_agreement = False
        
    # Determine eligibility
    eligible = True
    reasons = []
    
    if delay_hours <= threshold_hours:
        eligible = False
        reasons.append(f"Delay of {delay_hours:.2f} hours does not exceed the threshold of {threshold_hours} hours.")
    if not carrier_fault:
        eligible = False
        reasons.append("Carrier was not marked at fault.")
    if customer_fault:
        eligible = False
        reasons.append("Customer was marked at fault.")
    if order["status"] not in ("BOOKED", "PICKED_UP", "DELIVERED"):
        eligible = False
        reasons.append(f"Invalid order status: {order['status']}.")
        
    final_credit = credit_amount if eligible else 0.0
    
    # Manager approval check (any credit above INR 1000)
    requires_approval = final_credit > 1000.0
    
    # Northstar specific cap check
    additional_notes = ""
    if act_id == "ACCT-001" and eligible:
        additional_notes = "Northstar monthly aggregate service credits are capped at INR 5,000."
        
    reason_str = f"Pickup was {delay_hours:.2f} hours late ({time_desc}). "
    if eligible:
        reason_str += f"Eligible for credit. Carrier at fault."
    else:
        reason_str += f"Not eligible: " + "; ".join(reasons)
        
    if additional_notes:
        reason_str += f" Note: {additional_notes}"
        
    return {
        "order_id": order_id,
        "account_id": act_id,
        "account_name": account.get("account_name"),
        "eligible": eligible,
        "delay_hours": round(delay_hours, 2),
        "threshold_hours": threshold_hours,
        "shipment_fee": fee,
        "carrier_fault": carrier_fault,
        "customer_fault": customer_fault,
        "credit_amount": final_credit,
        "reason": reason_str,
        "rule_applied": rule_applied,
        "requires_manager_approval": requires_approval,
        "custom_agreement": custom_agreement
    }

def cancel_order_assessment(order_id: str, account_id: str = None) -> dict:
    """
    Evaluates cancellation terms, fees, and rules.
    """
    order, error = check_order_ownership(order_id, account_id)
    if error:
        return {"cancellable": False, "error": error}
        
    act_id = order["account_id"]
    accounts = data_store.get_accounts()
    account = next((a for a in accounts if a["account_id"] == act_id), None)
    
    status = order.get("status", "DRAFT")
    
    if status == "DRAFT":
        return {
            "order_id": order_id,
            "cancellable": True,
            "cancellation_fee": 0.0,
            "reason": "Shipment is in DRAFT status and can be cancelled with no fee.",
            "rule_applied": "Standard SOP v4 Section 1"
        }
    elif status == "PICKED_UP":
        return {
            "order_id": order_id,
            "cancellable": False,
            "cancellation_fee": 0.0,
            "reason": "Shipment has already been picked up. Do not cancel. Use return-to-origin workflow.",
            "rule_applied": "Standard SOP v4 Section 1"
        }
    elif status == "DELIVERED":
        return {
            "order_id": order_id,
            "cancellable": False,
            "cancellation_fee": 0.0,
            "reason": "Shipment has been delivered and cannot be cancelled.",
            "rule_applied": "Standard SOP v4 Section 1"
        }
    elif status == "BOOKED":
        # Check booking date and request date
        booked_at = parse_date(order.get("booked_at"))
        req_at_str = order.get("cancellation_requested_at")
        req_at = parse_date(req_at_str) if req_at_str else SNAPSHOT_TIME
        
        if not booked_at:
            # Fallback if booked date is missing
            return {
                "order_id": order_id,
                "cancellable": True,
                "cancellation_fee": 250.0,
                "reason": "Shipment is BOOKED. Booking time is missing; assuming standard fee of INR 250.",
                "rule_applied": "Standard SOP v4 Section 1"
            }
            
        elapsed_delta = req_at - booked_at
        elapsed_minutes = elapsed_delta.total_seconds() / 60.0
        
        # Check custom contract for ACCT-001 (Northstar)
        if act_id == "ACCT-001":
            return {
                "order_id": order_id,
                "cancellable": True,
                "cancellation_fee": 0.0,
                "elapsed_minutes": elapsed_minutes,
                "reason": f"Northstar custom agreement allows free cancellation of BOOKED shipments before pickup, regardless of booking age.",
                "rule_applied": "Northstar Logistics Enterprise Agreement Section 2"
            }
            
        # Standard SOP rules
        if elapsed_minutes <= 30.0:
            return {
                "order_id": order_id,
                "cancellable": True,
                "cancellation_fee": 0.0,
                "elapsed_minutes": elapsed_minutes,
                "reason": f"Shipment cancelled within 30 minutes of booking ({elapsed_minutes:.1f} mins elapsed). Fee is waived.",
                "rule_applied": "Standard SOP v4 Section 1"
            }
        else:
            return {
                "order_id": order_id,
                "cancellable": True,
                "cancellation_fee": 250.0,
                "elapsed_minutes": elapsed_minutes,
                "reason": f"Shipment cancelled after 30 minutes of booking ({elapsed_minutes:.1f} mins elapsed). Cancellation fee of INR 250 applies.",
                "rule_applied": "Standard SOP v4 Section 1"
            }
            
    return {"cancellable": False, "reason": f"Unknown status: {status}"}

# --- State Changing Actions ---

def escalate_ticket(ticket_id: str, reason: str, account_id: str = None, confirmed: bool = False) -> dict:
    """
    Escalates a support ticket. Requires confirmation.
    """
    ticket, error = check_ticket_ownership(ticket_id, account_id)
    if error:
        return {"success": False, "error": error}
        
    summary = f"Escalating ticket {ticket_id} ('{ticket['subject']}') to priority P1 (Critical). Reason: {reason}"
    
    if not confirmed:
        return {
            "success": True,
            "requires_confirmation": True,
            "action_type": "escalate_ticket",
            "params": {"ticket_id": ticket_id, "reason": reason},
            "summary": summary
        }
        
    # Execute action
    updated = data_store.update_ticket(ticket_id, {
        "status": "escalated",
        "notes": f"Escalated on {SNAPSHOT_TIME.strftime('%Y-%m-%d %H:%M')} due to: {reason}"
    })
    
    return {
        "success": True,
        "requires_confirmation": False,
        "message": f"Ticket {ticket_id} has been successfully escalated to the operations team.",
        "data": updated
    }

def update_ticket_status(ticket_id: str, new_status: str, account_id: str = None, confirmed: bool = False) -> dict:
    """
    Updates ticket status. Requires confirmation.
    """
    ticket, error = check_ticket_ownership(ticket_id, account_id)
    if error:
        return {"success": False, "error": error}
        
    summary = f"Updating ticket {ticket_id} status from '{ticket['status']}' to '{new_status}'."
    
    if not confirmed:
        return {
            "success": True,
            "requires_confirmation": True,
            "action_type": "update_ticket_status",
            "params": {"ticket_id": ticket_id, "new_status": new_status},
            "summary": summary
        }
        
    updated = data_store.update_ticket(ticket_id, {"status": new_status})
    return {
        "success": True,
        "requires_confirmation": False,
        "message": f"Ticket {ticket_id} status has been updated to {new_status}.",
        "data": updated
    }

def apply_service_credit(order_id: str, amount: float, account_id: str = None, confirmed: bool = False) -> dict:
    """
    Applies a service credit to an order. Requires confirmation.
    """
    order, error = check_order_ownership(order_id, account_id)
    if error:
        return {"success": False, "error": error}
        
    summary = f"Applying a service credit of INR {amount} to order {order_id}."
    
    # Check managers approval condition in confirmation
    if amount > 1000.0:
        summary += " WARNING: This amount is greater than INR 1,000 and requires manager approval."
        
    if not confirmed:
        return {
            "success": True,
            "requires_confirmation": True,
            "action_type": "apply_service_credit",
            "params": {"order_id": order_id, "amount": amount},
            "summary": summary
        }
        
    updated = data_store.update_order(order_id, {
        "notes": f"{order.get('notes', '')} | Service credit of INR {amount} applied on {SNAPSHOT_TIME.strftime('%Y-%m-%d %H:%M')}."
    })
    
    return {
        "success": True,
        "requires_confirmation": False,
        "message": f"Service credit of INR {amount} has been successfully applied to order {order_id}.",
        "data": updated
    }

def cancel_order_execute(order_id: str, account_id: str = None, confirmed: bool = False) -> dict:
    """
    Cancels an order and applies the computed cancellation fee. Requires confirmation.
    """
    assessment = cancel_order_assessment(order_id, account_id)
    if "error" in assessment:
        return {"success": False, "error": assessment["error"]}
    if not assessment["cancellable"]:
        return {"success": False, "error": assessment["reason"]}
        
    fee = assessment["cancellation_fee"]
    summary = f"Cancelling order {order_id}. A cancellation fee of INR {fee} will be applied."
    
    if not confirmed:
        return {
            "success": True,
            "requires_confirmation": True,
            "action_type": "cancel_order",
            "params": {"order_id": order_id},
            "summary": summary
        }
        
    # Perform update
    order, _ = check_order_ownership(order_id, account_id)
    updated = data_store.update_order(order_id, {
        "status": "CANCELLED",
        "cancellation_requested_at": SNAPSHOT_TIME.strftime("%Y-%m-%d %H:%M"),
        "notes": f"Cancelled. Cancellation fee of INR {fee} applied. | " + (order.get("notes", "") if order else "")
    })
    
    return {
        "success": True,
        "requires_confirmation": False,
        "message": f"Order {order_id} has been cancelled. Cancellation fee: INR {fee}.",
        "data": updated
    }
