"""
Main application entry point
Can be used for CLI testing and development
"""

import asyncio
import os
from dotenv import load_dotenv

# Load environment variables BEFORE importing workflows
load_dotenv()

from workflows import process_webhook, generate_daily_report


async def test_webhook_processing():
    """Test webhook processing with WHO"""
    print("\n" + "="*80)
    print("TESTING WEBHOOK PROCESSING")
    print("="*80 + "\n")
    
    # Test with WHO
    result = await process_webhook(
        agency="WHO",
        webhook_id="test_webhook_001"
    )
    
    print(f"\n✅ Test completed\n")
    print(f"Result: {result}\n")


async def test_daily_report():
    """Test daily report generation"""
    print("\n" + "="*80)
    print("TESTING DAILY REPORT GENERATION")
    print("="*80 + "\n")
    
    result = await generate_daily_report()
    
    print(f"\n✅ Test completed\n")
    print(f"Result: {result}\n")


async def main():
    """Main entry point"""
    import sys
    
    if len(sys.argv) > 1:
        command = sys.argv[1]
        
        if command == "test-webhook":
            agency = sys.argv[2] if len(sys.argv) > 2 else "WHO"
            await process_webhook(agency=agency)
        
        elif command == "test-report":
            await test_daily_report()
        
        elif command == "test":
            await test_webhook_processing()
        
        else:
            print(f"Unknown command: {command}")
            print("\nUsage:")
            print("  python main.py test              # Test webhook processing")
            print("  python main.py test-webhook WHO  # Test specific agency webhook")
            print("  python main.py test-report       # Test daily report generation")
    
    else:
        print("Health Surveillance Agent System")
        print("\nUsage:")
        print("  python main.py test              # Test webhook processing")
        print("  python main.py test-webhook WHO  # Test specific agency webhook")
        print("  python main.py test-report       # Test daily report generation")
        print("\nTo run the server:")
        print("  python server.py")


if __name__ == "__main__":
    asyncio.run(main())
