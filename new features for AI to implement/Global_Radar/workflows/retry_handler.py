"""
Retry handler with exponential backoff
Orchestrator-level retry logic
"""

import asyncio
from typing import Callable, List


async def retry_with_backoff(
    func: Callable,
    max_retries: int = 3,
    delays: List[int] = None
):
    """
    Orchestrator-level retry with exponential backoff
    
    Args:
        func: Async function to retry
        max_retries: Maximum number of retry attempts (default 3)
        delays: List of delays in seconds for each retry [1, 2, 4]
    
    Returns:
        Result from successful function call
    
    Raises:
        Last exception if all retries fail
    """
    if delays is None:
        delays = [1, 2, 4]
    
    last_exception = None
    
    for attempt in range(max_retries):
        try:
            return await func()
            
        except Exception as e:
            last_exception = e
            
            if attempt == max_retries - 1:
                print(f"❌ All retries failed after {max_retries} attempts")
                raise
            
            delay = delays[attempt] if attempt < len(delays) else delays[-1]
            print(f"⚠️  Retry {attempt + 1}/{max_retries} after {delay}s (Error: {str(e)})")
            await asyncio.sleep(delay)
    
    # Should never reach here, but just in case
    if last_exception:
        raise last_exception
