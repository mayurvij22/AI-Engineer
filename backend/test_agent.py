import os
import sys

# Add workspace root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend import data_store
from backend import tools
from backend import agent

def test_northstar_cancellation():
    print("--- Testing Northstar Cancellation (ORD-1001) ---")
    assessment = tools.cancel_order_assessment("ORD-1001", None)
    print(f"Cancellable: {assessment['cancellable']}")
    print(f"Fee: INR {assessment['cancellation_fee']}")
    print(f"Reason: {assessment['reason']}")
    print(f"Rule: {assessment['rule_applied']}")
    assert assessment['cancellable'] == True
    assert assessment['cancellation_fee'] == 0.0
    assert "Northstar custom agreement" in assessment['reason']
    print("PASS\n")

def test_lumenworks_service_credit():
    print("--- Testing LumenWorks Service Credit (ORD-2002) ---")
    credit = tools.calculate_service_credit("ORD-2002", None)
    print(f"Eligible: {credit['eligible']}")
    print(f"Delay: {credit['delay_hours']} hours (Threshold: {credit['threshold_hours']} hours)")
    print(f"Credit Amount: INR {credit['credit_amount']}")
    print(f"Reason: {credit['reason']}")
    print(f"Rule: {credit['rule_applied']}")
    assert credit['eligible'] == True
    assert credit['credit_amount'] == 300.0
    assert "LumenWorks Service Agreement" in credit['rule_applied']
    print("PASS\n")

def test_lumenworks_service_credit_not_eligible():
    print("--- Testing LumenWorks Service Credit Not Eligible (ORD-2001) ---")
    credit = tools.calculate_service_credit("ORD-2001", None)
    print(f"Eligible: {credit['eligible']}")
    print(f"Delay: {credit['delay_hours']} hours (Threshold: {credit['threshold_hours']} hours)")
    print(f"Credit Amount: INR {credit['credit_amount']}")
    print(f"Reason: {credit['reason']}")
    assert credit['eligible'] == False
    assert credit['credit_amount'] == 0.0
    print("PASS\n")

def test_standard_cancellation_after_30m():
    print("--- Testing Standard Cancellation After 30m (ORD-2001) ---")
    # ORD-2001 belongs to LumenWorks ACCT-002, which has standard cancellation policy.
    # Booked at 09:00, snapshot is 11:00 (120 mins).
    assessment = tools.cancel_order_assessment("ORD-2001", None)
    print(f"Cancellable: {assessment['cancellable']}")
    print(f"Fee: INR {assessment['cancellation_fee']}")
    print(f"Reason: {assessment['reason']}")
    print(f"Rule: {assessment['rule_applied']}")
    assert assessment['cancellable'] == True
    assert assessment['cancellation_fee'] == 250.0
    assert "Standard SOP v4 Section 1" in assessment['rule_applied']
    print("PASS\n")

def test_data_privacy_scoping():
    print("--- Testing Data Privacy and Scoping ---")
    # Customer ACCT-002 (LumenWorks) tries to access Northstar's order ORD-1001
    order, error = tools.check_order_ownership("ORD-1001", "ACCT-002")
    print(f"Access Result: {order}, Error: {error}")
    assert order is None
    assert "Unauthorized" in error
    
    # Customer ACCT-001 (Northstar) tries to access Northstar's order ORD-1001
    order, error = tools.check_order_ownership("ORD-1001", "ACCT-001")
    print(f"Access Result: {order['order_id']}, Error: {error}")
    assert order is not None
    assert error is None
    print("PASS\n")

def test_sla_breach_detection():
    print("--- Testing SLA Breach Detection in Proactive Alerts ---")
    from backend import main
    alerts = main.get_proactive_alerts()
    print(f"Total alerts: {alerts['summary']['total_alerts']}")
    
    sla_breaches = alerts['sla_breaches']
    print(f"SLA Breaches: {len(sla_breaches)}")
    for b in sla_breaches:
        print(f"- Ticket {b['ticket_id']} ({b['account_name']}): {b['severity']} breached by {b['breached_by_minutes']} mins")
        
    breached_ids = [b['ticket_id'] for b in sla_breaches]
    assert "TKT-501" in breached_ids # Northstar P1 (outage) open 30 min, target 15m
    assert "TKT-505" in breached_ids # Axis Labs P1 (security key) open 150 min, target 30m
    print("PASS\n")

if __name__ == "__main__":
    test_northstar_cancellation()
    test_lumenworks_service_credit()
    test_lumenworks_service_credit_not_eligible()
    test_standard_cancellation_after_30m()
    test_data_privacy_scoping()
    test_sla_breach_detection()
    print("All backend automated tests PASSED successfully!")
