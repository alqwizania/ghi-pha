"""
Daily report generation workflow
Triggered at 19:00 (7:00 PM)
"""

from datetime import datetime
from agents import Runner, SQLiteSession
from agents.tracing import set_trace_processors
from health_agents.shared.models import HealthContext
from health_agents.shared.tracing import create_tracer_from_env
from health_agents import reporting_generator
import os


async def generate_daily_report():
    """
    Generate daily AI narrative report at 19:00
    """
    print(f"\n{'='*80}")
    print(f"📊 DAILY REPORT GENERATION")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*80}\n")
    
    # Create context with report_mode=True
    context = HealthContext(
        report_mode=True,
        timestamp=datetime.now(),
    )
    
    context.log("Starting daily report generation")
    
    # Create session
    sqlite_path = os.getenv("SQLITE_PATH", "/tmp/agents_sessions.db")
    session_id = f"report_{datetime.now().strftime('%Y%m%d')}"
    session = SQLiteSession(
        session_id=session_id,
        db_path=sqlite_path,
    )
    
    # Configure tracing from environment
    tracer = create_tracer_from_env()
    if tracer:
        set_trace_processors([tracer])
    
    try:
        # Run workflow through reporting generator
        result = await Runner.run(
            starting_agent=reporting_generator,
            input="""Generate daily AI narrative report for all agencies.

Query all findings from today (all agencies) and create an executive summary.
Use the generate_daily_report_narrative tool to create the report.""",
            context=context,
            session=session,
            max_turns=10,
        )
        
        print(f"\n{'='*80}")
        print(f"✅ DAILY REPORT GENERATED")
        print(f"{'='*80}\n")
        
        # Print execution log
        print("\n📋 Execution Log:")
        for log_entry in context.execution_log:
            print(f"  {log_entry}")
        
        print(f"\n📄 Report:\n{result.final_output}\n")
        
        return result.final_output
        
    except Exception as e:
        context.log(f"❌ Daily report generation failed: {str(e)}")
        print(f"\n❌ ERROR: {str(e)}\n")
        raise
