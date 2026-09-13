import asyncio
import websockets

async def handle_connection(websocket, path):
    print("✅ Web App Connected!")
    try:
        async for message in websocket:
            print(f"Received coordinates: {message}")
    except websockets.exceptions.ConnectionClosed:
        print("❌ Web App Disconnected")

async def main():
    print("Dummy Python WebSocket Server running on ws://localhost:8080")
    print("Waiting for web app to connect...")
    async with websockets.serve(handle_connection, "localhost", 8080):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
