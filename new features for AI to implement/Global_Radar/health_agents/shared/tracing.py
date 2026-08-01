"""
Custom tracing processor for Health Surveillance Agents
Provides detailed logging and debugging capabilities
"""

import json
import os
from datetime import datetime
from typing import Any, Dict, Optional
from enum import Enum

from agents.tracing import Trace, TracingProcessor, Span


class TraceLevel(str, Enum):
    """Trace verbosity levels"""
    MINIMAL = "minimal"      # Only agent handoffs and final outputs
    STANDARD = "standard"    # + tool calls and results
    DETAILED = "detailed"    # + LLM calls and thinking
    DEBUG = "debug"          # Everything including raw data


class HealthAgentsTracer(TracingProcessor):
    """
    Custom trace processor for health surveillance agents
    
    Captures and logs:
    - Agent transitions and handoffs
    - Tool function calls and results
    - LLM interactions and responses
    - Errors and exceptions
    - Performance metrics
    """
    
    def __init__(
        self,
        level: TraceLevel = TraceLevel.STANDARD,
        log_to_file: bool = False,
        log_file_path: Optional[str] = None,
    ):
        """
        Initialize the tracer
        
        Args:
            level: Trace verbosity level
            log_to_file: Whether to write traces to file
            log_file_path: Path to trace log file (default: /tmp/health-agents-trace.log)
        """
        self.level = level
        self.log_to_file = log_to_file
        self.log_file_path = log_file_path or "/tmp/health-agents-trace.log"
        self.session_start = datetime.now()
        self.metrics = {
            "trace_starts": 0,
            "trace_ends": 0,
            "span_starts": 0,
            "span_ends": 0,
        }
    
    def _format_timestamp(self) -> str:
        """Generate timestamp string"""
        return datetime.now().strftime("%H:%M:%S.%f")[:-3]
    
    def _log(self, message: str):
        """Log message to console and optionally to file"""
        print(message)
        
        if self.log_to_file:
            try:
                with open(self.log_file_path, "a") as f:
                    f.write(message + "\n")
            except Exception as e:
                print(f"⚠️ Failed to write to trace log: {str(e)}")
    
    def _format_json(self, data: Any, indent: int = 2) -> str:
        """Format JSON data for display"""
        try:
            if isinstance(data, (dict, list)):
                return json.dumps(data, indent=indent, default=str)
            return str(data)
        except Exception:
            return str(data)
    
    def on_trace_start(self, trace: Trace) -> None:
        """Called when a trace starts"""
        self.metrics["trace_starts"] += 1
        
        if self.level in [TraceLevel.DETAILED, TraceLevel.DEBUG]:
            timestamp = self._format_timestamp()
            self._log(f"\n{'='*80}")
            self._log(f"[{timestamp}] 🚀 TRACE START: {trace.trace_id}")
            self._log(f"{'='*80}")
    
    def on_trace_end(self, trace: Trace) -> None:
        """Called when a trace ends"""
        self.metrics["trace_ends"] += 1
        
        if self.level in [TraceLevel.DETAILED, TraceLevel.DEBUG]:
            timestamp = self._format_timestamp()
            self._log(f"\n{'='*80}")
            self._log(f"[{timestamp}] ✅ TRACE END: {trace.trace_id}")
            self._log(f"{'='*80}\n")
        
        # Print summary at end of trace
        if self.level != TraceLevel.MINIMAL:
            self.print_summary()
    
    def on_span_start(self, span: Span) -> None:
        """Called when a span starts"""
        self.metrics["span_starts"] += 1
        
        timestamp = self._format_timestamp()
        span_name = getattr(span.span_data, 'name', 'Unknown')
        span_type = span.span_data.__class__.__name__.replace('SpanData', '')
        
        # Determine if we should log based on span type and trace level
        should_log = False
        emoji = "🔹"
        
        if span_type == "Agent":
            should_log = True
            emoji = "🤖"
        elif span_type == "Function":
            should_log = self.level in [TraceLevel.STANDARD, TraceLevel.DETAILED, TraceLevel.DEBUG]
            emoji = "🔧"
        elif span_type == "Generation":
            should_log = self.level in [TraceLevel.DETAILED, TraceLevel.DEBUG]
            emoji = "🧠"
        elif span_type == "Handoff":
            should_log = True
            emoji = "🔀"
        else:
            should_log = self.level == TraceLevel.DEBUG
        
        if should_log:
            self._log(f"[{timestamp}] {emoji} {span_type.upper()} START: {span_name}")
            
            if self.level == TraceLevel.DEBUG:
                self._log(f"  Span ID: {span.span_id}")
                self._log(f"  Data: {self._format_json(span.span_data.__dict__)}")
    
    def on_span_end(self, span: Span) -> None:
        """Called when a span ends"""
        self.metrics["span_ends"] += 1
        
        timestamp = self._format_timestamp()
        span_name = getattr(span.span_data, 'name', 'Unknown')
        span_type = span.span_data.__class__.__name__.replace('SpanData', '')
        
        # Determine if we should log based on span type and trace level
        should_log = False
        emoji = "✅"
        
        if span_type == "Agent":
            should_log = True
        elif span_type == "Function":
            should_log = self.level in [TraceLevel.STANDARD, TraceLevel.DETAILED, TraceLevel.DEBUG]
        elif span_type == "Generation":
            should_log = self.level in [TraceLevel.DETAILED, TraceLevel.DEBUG]
        elif span_type == "Handoff":
            should_log = True
        else:
            should_log = self.level == TraceLevel.DEBUG
        
        if should_log:
            self._log(f"[{timestamp}] {emoji} {span_type.upper()} END: {span_name}")
            
            # Show duration
            if hasattr(span, 'start_time') and hasattr(span, 'end_time'):
                duration = (span.end_time - span.start_time).total_seconds()
                self._log(f"  Duration: {duration:.3f}s")
            
            if self.level == TraceLevel.DEBUG:
                self._log(f"  Data: {self._format_json(span.span_data.__dict__)}")
    
    def force_flush(self) -> None:
        """Force flush any buffered data"""
        pass
    
    def shutdown(self) -> None:
        """Shutdown the trace processor"""
        pass
    
    def get_summary(self) -> Dict[str, Any]:
        """Get execution summary"""
        duration = (datetime.now() - self.session_start).total_seconds()
        
        return {
            "duration_seconds": round(duration, 2),
            "metrics": self.metrics,
            "trace_level": self.level.value,
            "log_file": self.log_file_path if self.log_to_file else None,
        }
    
    def print_summary(self):
        """Print execution summary"""
        summary = self.get_summary()
        
        self._log(f"\n{'='*80}")
        self._log("📊 TRACE SUMMARY")
        self._log(f"{'='*80}")
        self._log(f"Duration: {summary['duration_seconds']}s")
        self._log(f"Trace starts: {summary['metrics']['trace_starts']}")
        self._log(f"Trace ends: {summary['metrics']['trace_ends']}")
        self._log(f"Span starts: {summary['metrics']['span_starts']}")
        self._log(f"Span ends: {summary['metrics']['span_ends']}")
        self._log(f"Trace level: {summary['trace_level']}")
        if summary['log_file']:
            self._log(f"Log file: {summary['log_file']}")
        self._log(f"{'='*80}\n")


def create_tracer_from_env() -> Optional[HealthAgentsTracer]:
    """
    Create tracer from environment variables
    
    Environment variables:
    - TRACE_ENABLED: Enable tracing (true/false, default: false)
    - TRACE_LEVEL: Trace level (minimal/standard/detailed/debug, default: standard)
    - TRACE_TO_FILE: Write traces to file (true/false, default: false)
    - TRACE_FILE_PATH: Path to trace log file (default: /tmp/health-agents-trace.log)
    
    Returns:
        HealthAgentsTracer instance if enabled, None otherwise
    """
    trace_enabled = os.getenv("TRACE_ENABLED", "false").lower() == "true"
    
    if not trace_enabled:
        return None
    
    # Parse trace level
    trace_level_str = os.getenv("TRACE_LEVEL", "standard").lower()
    try:
        trace_level = TraceLevel(trace_level_str)
    except ValueError:
        print(f"⚠️ Invalid TRACE_LEVEL '{trace_level_str}', using 'standard'")
        trace_level = TraceLevel.STANDARD
    
    # Parse log to file
    log_to_file = os.getenv("TRACE_TO_FILE", "false").lower() == "true"
    log_file_path = os.getenv("TRACE_FILE_PATH", "/tmp/health-agents-trace.log")
    
    tracer = HealthAgentsTracer(
        level=trace_level,
        log_to_file=log_to_file,
        log_file_path=log_file_path,
    )
    
    print(f"✅ Tracing enabled: level={trace_level.value}, file={log_to_file}")
    
    return tracer
