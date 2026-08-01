"""
Empty Agent Template - OpenAI Agents SDK

A comprehensive template demonstrating all available features of the OpenAI Agents SDK.
This template serves as a starting point for building new agents with full feature coverage.

Based on: https://openai.github.io/openai-agents-python/

Features included:
- Agent configuration with all parameters
- Context management with dataclasses
- Pydantic output types for structured outputs
- Function tools (@function_tool decorator)
- Hosted tools (WebSearch, FileSearch, CodeInterpreter, Computer, etc.)
- MCP (Model Context Protocol) integration (stdio, HTTP, SSE)
- Agent handoffs
- Agents as tools
- Guardrails (input/output validation)
- Session memory management
- Lifecycle hooks
- Dynamic instructions
- Model settings and tool behavior
- Streaming support
- Runner configuration
- Error handling
"""

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from pydantic import BaseModel

# Core imports
from agents import (
    Agent,
    Runner,
    RunConfig,
    ModelSettings,
    SQLiteSession,
)

# Tool imports
from agents import (
    function_tool,
    FunctionTool,
    RunContextWrapper,
    ToolOutputImage,
    ToolOutputText,
)

# Hosted tools (require OpenAI Responses API)
from agents import (
    WebSearchTool,
    FileSearchTool,
    CodeInterpreterTool,
    ComputerTool,
    ImageGenerationTool,
    LocalShellTool,
    HostedMCPTool,
)

# MCP imports
from agents.mcp import (
    MCPServerStdio,
    MCPServerSse,
    MCPServerStreamableHttp,
    create_static_tool_filter,
    ToolFilterContext,
)

# Handoff imports
from agents import handoff
from agents.extensions.handoff_filters import remove_all_tools
from agents.extensions.handoff_prompt import (
    RECOMMENDED_PROMPT_PREFIX,
    prompt_with_handoff_instructions,
)

# Guardrail imports
from agents import (
    input_guardrail,
    output_guardrail,
    GuardrailFunctionOutput,
    InputGuardrailTripwireTriggered,
    OutputGuardrailTripwireTriggered,
)

# Lifecycle hooks
from agents.lifecycle import AgentHooks

# Exception handling
from agents.exceptions import (
    AgentsException,
    MaxTurnsExceeded,
    ModelBehaviorError,
    UserError,
)

# Items for conversation handling
from agents.items import TResponseInputItem

# Streaming
from agents.result import RunResultStreaming

# Agent behavior
from agents.agent import StopAtTools, ToolsToFinalOutputResult
from agents.tool import FunctionToolResult

# Tracing
from agents.tracing import trace

# Load environment variables
load_dotenv(override=True)


# ============================================================================
# PYDANTIC MODELS - Define structured output types
# ============================================================================

class ExampleOutputType(BaseModel):
    """Example Pydantic model for structured agent output"""
    result: str
    confidence: float
    metadata: Optional[Dict[str, Any]] = None


class TaskBreakdown(BaseModel):
    """Example task breakdown structure"""
    task_name: str
    steps: List[str]
    estimated_time: int  # in minutes
    priority: str  # "high", "medium", "low"


class HandoffInput(BaseModel):
    """Example input data for handoffs"""
    reason: str
    context: Optional[str] = None


# ============================================================================
# CONTEXT - Dependency injection for agent runs
# ============================================================================

@dataclass
class AgentContext:
    """
    Context provides dependency injection for agent runs.
    Pass any state or dependencies here that your tools and agents need.
    """
    # User information
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    is_premium_user: bool = False
    
    # Application state
    app_state: Dict[str, Any] = field(default_factory=dict)
    
    # Database connections, API clients, etc.
    # db_session: Any = None
    # api_client: Any = None
    
    # Runtime tracking
    execution_log: List[str] = field(default_factory=list)
    
    def log(self, message: str) -> None:
        """Log a message to execution log"""
        self.execution_log.append(message)


# ============================================================================
# FUNCTION TOOLS - Turn Python functions into agent tools
# ============================================================================

@function_tool
async def example_simple_tool(query: str) -> str:
    """
    A simple example tool that processes a query.
    
    Args:
        query: The input query to process
        
    Returns:
        A processed response string
    """
    # Your tool implementation here
    return f"Processed query: {query}"


@function_tool
def example_tool_with_context(
    ctx: RunContextWrapper[AgentContext], 
    parameter: str,
    optional_param: Optional[int] = None
) -> str:
    """
    Example tool that uses context and optional parameters.
    
    Args:
        parameter: A required parameter
        optional_param: An optional parameter with default
        
    Returns:
        Result string
    """
    # Access context
    ctx.context.log(f"Tool called with parameter: {parameter}")
    
    # Your implementation
    result = f"Parameter: {parameter}, Optional: {optional_param}"
    
    if ctx.context.is_premium_user:
        result += " [Premium]"
    
    return result


@function_tool
async def example_tool_returning_image() -> ToolOutputImage:
    """
    Example tool that returns an image.
    Tools can return images, files, or text.
    
    Returns:
        A tool output image
    """
    # Return an image from URL or file path
    return ToolOutputImage(
        url="https://example.com/image.png",
        detail="high"  # or "low" or "auto"
    )


@function_tool
def example_multi_output_tool() -> List[ToolOutputText | ToolOutputImage]:
    """
    Example tool returning multiple outputs (text and images).
    
    Returns:
        List of tool outputs
    """
    return [
        ToolOutputText(text="Here is the result:"),
        ToolOutputImage(url="https://example.com/result.png"),
        ToolOutputText(text="Analysis complete.")
    ]


# Custom error handler for tool failures
def custom_tool_error_handler(context: RunContextWrapper[AgentContext], error: Exception) -> str:
    """Custom error handling for tool failures"""
    context.context.log(f"Tool error: {str(error)}")
    return "An error occurred while processing your request. Please try again."


@function_tool(failure_error_function=custom_tool_error_handler)
def example_tool_with_error_handling(data: str) -> str:
    """
    Example tool with custom error handling.
    
    Args:
        data: Input data
        
    Returns:
        Processed data
    """
    # Simulate potential error
    if not data:
        raise ValueError("Data cannot be empty")
    
    return f"Processed: {data}"


# ============================================================================
# CUSTOM FUNCTION TOOL - Manual FunctionTool creation
# ============================================================================

class CustomToolArgs(BaseModel):
    """Arguments schema for custom tool"""
    param1: str
    param2: int


async def custom_tool_implementation(ctx: RunContextWrapper[AgentContext], args_json: str) -> str:
    """Implementation function for custom tool"""
    args = CustomToolArgs.model_validate_json(args_json)
    return f"Custom tool executed: {args.param1}, {args.param2}"


custom_tool = FunctionTool(
    name="custom_tool",
    description="A manually created custom tool",
    params_json_schema=CustomToolArgs.model_json_schema(),
    on_invoke_tool=custom_tool_implementation,
)


# ============================================================================
# MCP (MODEL CONTEXT PROTOCOL) SERVERS
# ============================================================================

# MCP Server configurations - uncomment and configure as needed

# 1. stdio MCP Server (local subprocess)
async def create_stdio_mcp_server():
    """Create a stdio-based MCP server"""
    samples_dir = Path("./sample_files")
    
    server = MCPServerStdio(
        name="Filesystem Server",
        params={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", str(samples_dir)],
        },
        # Optional: filter tools
        tool_filter=create_static_tool_filter(
            allowed_tool_names=["read_file", "write_file"]
        ),
        cache_tools_list=True,
    )
    return server


# 2. HTTP with SSE MCP Server
async def create_sse_mcp_server():
    """Create a Server-Sent Events MCP server"""
    server = MCPServerSse(
        name="SSE Server",
        params={
            "url": "http://localhost:8000/sse",
            "headers": {"Authorization": "Bearer TOKEN"},
        },
        cache_tools_list=True,
    )
    return server


# 3. Streamable HTTP MCP Server
async def create_http_mcp_server():
    """Create a Streamable HTTP MCP server"""
    server = MCPServerStreamableHttp(
        name="HTTP Server",
        params={
            "url": "http://localhost:8000/mcp",
            "headers": {"Authorization": f"Bearer {os.getenv('MCP_TOKEN')}"},
            "timeout": 10,
        },
        cache_tools_list=True,
        max_retry_attempts=3,
    )
    return server


# Dynamic tool filtering for MCP
async def dynamic_mcp_filter(context: ToolFilterContext, tool) -> bool:
    """Dynamic tool filter based on context"""
    # Filter tools based on agent name, context, etc.
    if context.agent.name == "RestrictedAgent" and tool.name.startswith("dangerous_"):
        return False
    return True


# ============================================================================
# LIFECYCLE HOOKS - Observe agent lifecycle events
# ============================================================================

class CustomAgentHooks(AgentHooks):
    """Custom lifecycle hooks for observing agent behavior"""
    
    async def on_agent_start(self, agent, context):
        """Called when agent starts"""
        print(f"🚀 Agent '{agent.name}' starting...")
        if hasattr(context, 'log'):
            context.log(f"Agent {agent.name} started")
    
    async def on_agent_end(self, agent, context, result):
        """Called when agent ends"""
        print(f"✅ Agent '{agent.name}' completed")
        if hasattr(context, 'log'):
            context.log(f"Agent {agent.name} completed")
    
    async def on_tool_call(self, agent, context, tool_name, tool_args):
        """Called before tool execution"""
        print(f"🔧 Tool '{tool_name}' called with args: {tool_args}")
    
    async def on_tool_result(self, agent, context, tool_name, result):
        """Called after tool execution"""
        print(f"✨ Tool '{tool_name}' completed")


# ============================================================================
# GUARDRAILS - Input/output validation
# ============================================================================

class GuardrailOutput(BaseModel):
    """Output structure for guardrail checks"""
    is_valid: bool
    reason: Optional[str] = None
    severity: str = "low"  # "low", "medium", "high"


# Input guardrail agent
guardrail_agent = Agent(
    name="Input Validator",
    instructions="Check if the input is appropriate and safe.",
    output_type=GuardrailOutput,
)


@input_guardrail
async def example_input_guardrail(
    ctx: RunContextWrapper[AgentContext],
    agent: Agent,
    input: str | list[TResponseInputItem]
) -> GuardrailFunctionOutput:
    """
    Example input guardrail that validates user input.
    
    Set run_in_parallel=True (default) for concurrent execution with agent.
    Set run_in_parallel=False for blocking execution before agent starts.
    """
    # Run validation
    result = await Runner.run(guardrail_agent, input, context=ctx.context)
    
    # Return guardrail result
    return GuardrailFunctionOutput(
        output_info=result.final_output,
        tripwire_triggered=not result.final_output.is_valid,
    )


@output_guardrail
async def example_output_guardrail(
    ctx: RunContextWrapper[AgentContext],
    agent: Agent,
    output: ExampleOutputType
) -> GuardrailFunctionOutput:
    """
    Example output guardrail that validates agent output.
    Output guardrails always run after agent completes.
    """
    # Validate output
    is_valid = output.confidence >= 0.5
    
    return GuardrailFunctionOutput(
        output_info={"validated": is_valid, "confidence": output.confidence},
        tripwire_triggered=not is_valid,
    )


# ============================================================================
# DYNAMIC INSTRUCTIONS - Runtime instruction generation
# ============================================================================

def dynamic_instructions(
    context: RunContextWrapper[AgentContext],
    agent: Agent
) -> str:
    """
    Generate dynamic instructions based on context.
    Can be sync or async function.
    """
    base_instructions = "You are a helpful assistant."
    
    if context.context.user_name:
        base_instructions += f" The user's name is {context.context.user_name}."
    
    if context.context.is_premium_user:
        base_instructions += " Provide premium-level detailed responses."
    
    return base_instructions


# ============================================================================
# SUB-AGENTS - Specialized agents for handoffs and delegation
# ============================================================================

# Specialized sub-agent 1
research_agent = Agent(
    name="Research Agent",
    instructions="You are a research specialist. Gather and analyze information thoroughly.",
    tools=[
        example_simple_tool,
        # WebSearchTool(),  # Uncomment if using OpenAI Responses API
    ],
    model="gpt-4o",  # or "gpt-4o-mini"
)

# Specialized sub-agent 2
analysis_agent = Agent(
    name="Analysis Agent",
    instructions="You are an analysis specialist. Provide detailed insights and recommendations.",
    tools=[
        example_tool_with_context,
    ],
    model="gpt-4o-mini",
)

# Sub-agent for tool execution (agent as tool pattern)
data_processing_agent = Agent(
    name="Data Processor",
    instructions="Process and transform data efficiently.",
    tools=[
        example_simple_tool,
        example_tool_with_error_handling,
    ],
)


# ============================================================================
# CUSTOM TOOL USE BEHAVIOR
# ============================================================================

def custom_tool_handler(
    context: RunContextWrapper[AgentContext],
    tool_results: List[FunctionToolResult]
) -> ToolsToFinalOutputResult:
    """
    Custom function to process tool results and decide whether to stop or continue.
    """
    for result in tool_results:
        # Check if we should stop based on tool output
        if result.output and "STOP" in result.output:
            return ToolsToFinalOutputResult(
                is_final_output=True,
                final_output=f"Stopped early: {result.output}"
            )
    
    # Continue with LLM processing
    return ToolsToFinalOutputResult(
        is_final_output=False,
        final_output=None
    )


# ============================================================================
# MAIN AGENT - Template with all features
# ============================================================================

def create_template_agent(
    use_handoffs: bool = False,
    use_agents_as_tools: bool = False,
    enable_guardrails: bool = False,
    use_dynamic_instructions: bool = False,
    use_mcp_servers: bool = False,
    use_hosted_tools: bool = False,
) -> Agent[AgentContext]:
    """
    Create a template agent with configurable features.
    
    Args:
        use_handoffs: Enable agent handoffs
        use_agents_as_tools: Use other agents as tools
        enable_guardrails: Enable input/output guardrails
        use_dynamic_instructions: Use dynamic instructions
        use_mcp_servers: Enable MCP server integration
        use_hosted_tools: Enable OpenAI hosted tools
        
    Returns:
        Configured agent instance
    """
    
    # Base configuration
    tools = [
        example_simple_tool,
        example_tool_with_context,
        example_tool_with_error_handling,
        custom_tool,
    ]
    
    # Add hosted tools (require OpenAI Responses API)
    if use_hosted_tools:
        tools.extend([
            # WebSearchTool(),
            # FileSearchTool(vector_store_ids=["vs_xxx"]),
            # CodeInterpreterTool(),
            # ImageGenerationTool(),
            # LocalShellTool(),
            # ComputerTool(),
        ])
    
    # Add agents as tools
    if use_agents_as_tools:
        tools.extend([
            data_processing_agent.as_tool(
                tool_name="process_data",
                tool_description="Process and transform data",
                # Optional: custom output extractor
                # custom_output_extractor=my_extractor_function,
            ),
        ])
    
    # Handoff configuration
    handoffs_list = []
    if use_handoffs:
        handoffs_list = [
            research_agent,  # Simple handoff
            handoff(  # Customized handoff
                agent=analysis_agent,
                tool_name_override="transfer_to_analysis",
                tool_description_override="Transfer to analysis specialist",
                # on_handoff=lambda ctx: print("Handing off to analysis..."),
                input_type=HandoffInput,
                # input_filter=remove_all_tools,  # Optional filter
                # is_enabled=lambda ctx, agent: ctx.context.is_premium_user,
            ),
        ]
    
    # Guardrails configuration
    input_guardrails_list = []
    output_guardrails_list = []
    if enable_guardrails:
        input_guardrails_list = [example_input_guardrail]
        output_guardrails_list = [example_output_guardrail]
    
    # Instructions configuration
    instructions = dynamic_instructions if use_dynamic_instructions else """
    You are a helpful AI assistant with access to various tools and capabilities.
    
    Your responsibilities:
    - Answer user questions accurately and helpfully
    - Use available tools when needed
    - Provide clear and concise responses
    - Follow safety and ethical guidelines
    
    Always be professional, accurate, and helpful.
    """
    
    # Add handoff instructions if using handoffs
    if use_handoffs:
        if isinstance(instructions, str):
            instructions = f"{RECOMMENDED_PROMPT_PREFIX}\n\n{instructions}"
    
    # Create the agent
    agent = Agent[AgentContext](
        # ====== BASIC CONFIGURATION ======
        name="Template Agent",
        instructions=instructions,
        
        # ====== MODEL CONFIGURATION ======
        model="gpt-4o-mini",  # or "gpt-4o", "gpt-3.5-turbo", etc.
        model_settings=ModelSettings(
            temperature=0.7,
            top_p=1.0,
            max_tokens=None,
            # Tool behavior
            tool_choice="auto",  # "auto", "required", "none", or specific tool name
            # parallel_tool_calls=True,  # Enable parallel tool execution
        ),
        
        # ====== TOOLS & CAPABILITIES ======
        tools=tools,
        handoffs=handoffs_list,
        
        # ====== MCP INTEGRATION ======
        # mcp_servers=[],  # Add MCP servers here
        
        # ====== OUTPUT CONFIGURATION ======
        # output_type=ExampleOutputType,  # Uncomment for structured output
        
        # ====== GUARDRAILS ======
        input_guardrails=input_guardrails_list,
        output_guardrails=output_guardrails_list,
        
        # ====== LIFECYCLE HOOKS ======
        # hooks=CustomAgentHooks(),  # Uncomment to enable lifecycle hooks
        
        # ====== TOOL USE BEHAVIOR ======
        # Options:
        # - "run_llm_again" (default): LLM processes tool results
        # - "stop_on_first_tool": Use first tool output as final output
        # - StopAtTools(stop_at_tool_names=["tool1", "tool2"]): Stop at specific tools
        # - custom_tool_handler: Custom function to handle tool results
        tool_use_behavior="run_llm_again",
        # tool_use_behavior=StopAtTools(stop_at_tool_names=["example_simple_tool"]),
        # tool_use_behavior=custom_tool_handler,
        
        # ====== ADVANCED OPTIONS ======
        # reset_tool_choice=True,  # Reset tool_choice after tool call
    )
    
    return agent


# ============================================================================
# RUNNER CONFIGURATION & EXECUTION
# ============================================================================

async def run_agent_example():
    """
    Example of running the agent with full configuration.
    Demonstrates all Runner options and patterns.
    """
    
    # Create context
    context = AgentContext(
        user_id="user_123",
        user_name="Alice",
        is_premium_user=True,
    )
    
    # Create agent
    agent = create_template_agent(
        use_handoffs=False,
        use_agents_as_tools=False,
        enable_guardrails=False,
        use_dynamic_instructions=False,
    )
    
    # Create session for conversation memory (optional)
    session = SQLiteSession(
        session_id="conversation_123",
        db_path="agent_sessions.db"
    )
    
    # Create run configuration
    run_config = RunConfig(
        # Model overrides
        # model="gpt-4o",  # Override agent's model
        # model_settings=ModelSettings(temperature=0.5),  # Override settings
        
        # Guardrails (applied to all agents)
        # input_guardrails=[],
        # output_guardrails=[],
        
        # Handoff configuration
        # handoff_input_filter=None,  # Global handoff filter
        nest_handoff_history=True,  # Collapse handoff history
        # handoff_history_mapper=None,  # Custom history mapper
        
        # Tracing configuration
        tracing_disabled=False,
        trace_include_sensitive_data=True,
        workflow_name="TemplateAgentWorkflow",
        # trace_id="trace_123",
        # group_id="group_123",
        trace_metadata={"environment": "development"},
    )
    
    # User input
    user_input = "Hello! Can you help me with a task?"
    
    # ====== OPTION 1: Async run ======
    print("\n" + "="*80)
    print("ASYNC RUN")
    print("="*80)
    
    try:
        result = await Runner.run(
            starting_agent=agent,
            input=user_input,
            context=context,
            session=session,
            run_config=run_config,
            max_turns=10,
            # conversation_id="conv_123",  # For server-managed conversations
            # previous_response_id=None,  # For response chaining
            # auto_previous_response_id=False,
        )
        
        print(f"\n✅ Final Output: {result.final_output}")
        print(f"📊 Usage: {result.usage}")
        print(f"🔧 Tools called: {len([item for item in result.new_items if hasattr(item, 'tool_call_id')])}")
        
        # Access conversation history for next turn
        # next_input = result.to_input_list() + [{"role": "user", "content": "Follow-up question"}]
        
    except InputGuardrailTripwireTriggered as e:
        print(f"❌ Input guardrail triggered: {e}")
    except OutputGuardrailTripwireTriggered as e:
        print(f"❌ Output guardrail triggered: {e}")
    except MaxTurnsExceeded as e:
        print(f"⚠️ Max turns exceeded: {e}")
    except ModelBehaviorError as e:
        print(f"❌ Model behavior error: {e}")
    except AgentsException as e:
        print(f"❌ Agent exception: {e}")
    
    # ====== OPTION 2: Sync run ======
    print("\n" + "="*80)
    print("SYNC RUN")
    print("="*80)
    
    result = Runner.run_sync(
        starting_agent=agent,
        input="Another question",
        context=context,
        session=session,
        max_turns=10,
    )
    print(f"✅ Sync Final Output: {result.final_output}")
    
    # ====== OPTION 3: Streaming run ======
    print("\n" + "="*80)
    print("STREAMING RUN")
    print("="*80)
    
    streaming_result = await Runner.run_streamed(
        starting_agent=agent,
        input="A streaming question",
        context=context,
        session=session,
        max_turns=10,
        stream=True,
    )
    
    # Process streaming events
    async for event in streaming_result.stream_events():
        if event.type == "run_item_stream_event":
            # Handle streaming content
            if hasattr(event.item, 'content'):
                print(event.item.content, end='', flush=True)
        elif event.type == "raw_response_event":
            # Handle raw response events
            pass
        elif event.type == "agent_updated_stream_event":
            # Handle agent update events
            pass
    
    # Get final result after streaming
    print(f"\n✅ Stream Final Output: {streaming_result.final_output}")
    
    # ====== MULTI-TURN CONVERSATION ======
    print("\n" + "="*80)
    print("MULTI-TURN CONVERSATION")
    print("="*80)
    
    # Using session for automatic history management
    with trace(workflow_name="MultiTurnConversation", group_id="thread_123"):
        # Turn 1
        result1 = await Runner.run(agent, "What is Python?", session=session, context=context)
        print(f"Turn 1: {result1.final_output}")
        
        # Turn 2 - agent automatically has history via session
        result2 = await Runner.run(agent, "What are its main features?", session=session, context=context)
        print(f"Turn 2: {result2.final_output}")
    
    # Print execution log
    print("\n" + "="*80)
    print("EXECUTION LOG")
    print("="*80)
    for log_entry in context.execution_log:
        print(f"  📝 {log_entry}")


# ============================================================================
# ADVANCED PATTERNS
# ============================================================================

async def multi_agent_orchestration():
    """Example of orchestrating multiple agents"""
    
    # Manager/orchestrator pattern - agents as tools
    orchestrator = Agent(
        name="Orchestrator",
        instructions="Coordinate between specialists to complete complex tasks.",
        tools=[
            research_agent.as_tool(
                tool_name="research",
                tool_description="Research information"
            ),
            analysis_agent.as_tool(
                tool_name="analyze",
                tool_description="Analyze data and provide insights"
            ),
        ],
    )
    
    result = await Runner.run(
        orchestrator,
        "Research Python programming and analyze its key strengths"
    )
    print(f"Orchestrated result: {result.final_output}")


async def handoff_pattern():
    """Example of using handoffs for task delegation"""
    
    # Triage agent that hands off to specialists
    triage_agent = Agent(
        name="Triage Agent",
        instructions=f"""{RECOMMENDED_PROMPT_PREFIX}
        
        You are a triage agent. Assess the user's request and hand off to the
        appropriate specialist:
        - Research Agent for information gathering
        - Analysis Agent for data analysis and insights
        """,
        handoffs=[research_agent, analysis_agent],
    )
    
    result = await Runner.run(
        triage_agent,
        "I need detailed information about machine learning and an analysis of its applications"
    )
    print(f"Handoff result: {result.final_output}")


async def mcp_integration_example():
    """Example of using MCP servers"""
    
    # Create MCP server (example: stdio)
    async with MCPServerStdio(
        name="FileSystem",
        params={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "./data"],
        },
    ) as mcp_server:
        
        agent = Agent(
            name="File Assistant",
            instructions="Help users work with files using the filesystem server.",
            mcp_servers=[mcp_server],
        )
        
        result = await Runner.run(agent, "List the files in the data directory")
        print(f"MCP result: {result.final_output}")


# ============================================================================
# MAIN ENTRY POINT
# ============================================================================

async def main():
    """Main entry point demonstrating template usage"""
    
    print("="*80)
    print("OPENAI AGENTS SDK - EMPTY TEMPLATE")
    print("="*80)
    print("\nThis template demonstrates all available features.")
    print("Uncomment and configure features as needed for your use case.\n")
    
    # Run examples
    await run_agent_example()
    
    # Uncomment to try other patterns:
    # await multi_agent_orchestration()
    # await handoff_pattern()
    # await mcp_integration_example()


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())

