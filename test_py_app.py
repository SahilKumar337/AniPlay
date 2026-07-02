import asyncio
import httpx
import uvicorn
import threading
import sys
import os

# Point to copied folder in E:\Anilab
sys.path.append(os.path.join(os.path.dirname(__file__), "my-anime-api"))

from app.main import app

def run_server():
    uvicorn.run(app, host="127.0.0.1", port=4000, log_level="warning")

async def test_endpoints():
    print("=== STARTING FASTAPI ANILAB BACKEND TEST ===")
    
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()
    
    await asyncio.sleep(2)
    
    client = httpx.AsyncClient(timeout=45.0)
    
    # 1. Test Ping
    print("\nTesting /api/ping...")
    try:
        r = await client.get("http://127.0.0.1:4000/api/ping")
        print(f"Ping Status: {r.status_code}")
        print(f"Ping JSON: {r.json()}")
        assert r.status_code == 200
    except Exception as e:
        print(f"Ping Endpoint Failed: {str(e)}")
        
    # 2. Test Get Servers Aggregator
    print("\nTesting /api/anineko-servers?title=Death Note&episode=1...")
    try:
        r = await client.get("http://127.0.0.1:4000/api/anineko-servers?title=Death+Note&episode=1")
        print(f"Servers Status: {r.status_code}")
        data = r.json()
        print(f"Ok: {data.get('ok')}")
        print(f"Servers found: {len(data.get('servers', []))}")
        assert r.status_code == 200
        assert data.get("ok") is True
    except Exception as e:
        print(f"Servers Endpoint Failed: {str(e)}")

    # 3. Test Extract Stream
    print("\nTesting /api/extract-stream...")
    try:
        r = await client.get("http://127.0.0.1:4000/api/extract-stream?url=https%3A//vivibebe.site/bcb70ca8623be66b")
        print(f"Extract Stream Status: {r.status_code}")
        print(f"Extract Stream JSON: {r.json()}")
        assert r.status_code == 200
        assert r.json().get("ok") is True
    except Exception as e:
        print(f"Extract Stream Endpoint Failed: {str(e)}")

    await client.aclose()
    print("\n=== INTEGRATION TEST COMPLETED ===")

if __name__ == "__main__":
    asyncio.run(test_endpoints())
