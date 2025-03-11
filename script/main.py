from telethon import TelegramClient, events
from telethon.tl.functions.channels import JoinChannelRequest
from pymongo import MongoClient

from dotenv import load_dotenv
import re
import os

load_dotenv()
# Replace these with your API credentials
API_ID = os.getenv('API_ID')
API_HASH = os.getenv('API_HASH')
PHONE_NUMBER = os.getenv('PHONE_NUMBER')
  # Include country code, e.g., +1234567890

DBserver = MongoClient("mongodb://localhost:27017/")
db = DBserver["Moonbot"]
collection = db["signals"]

# Regex to detect pump.fun contract addresses (44 characters + "pump")
PUMP_FUN_CA_REGEX = r"\b[1-9A-HJ-NP-Za-km-z]{44}pump\b"

# Target chat ID where you want to forward detected CAs
TARGET_CHAT_ID = 6007738067  # Use an integer, not a string

# List of chat IDs to monitor (use integers, not strings)
MONITORED_CHAT_IDS = [-1001536018812]  # Replace with the correct integer

# Initialize the Telegram client
client = TelegramClient("pump_fun_monitor_session", API_ID, API_HASH)

@client.on(events.NewMessage(chats=MONITORED_CHAT_IDS))
async def monitor_messages(event):
    try:
        message_text = event.message.message
        print(f"New message: {message_text}")  # Debug: Print the message content

        # Search for pump.fun contract addresses
        contract_addresses = re.findall(PUMP_FUN_CA_REGEX, message_text)
        print(f"Detected addresses: {contract_addresses}")  # Debug: Print detected addresses

        # Forward each detected CA to the target chat
        for ca in contract_addresses:
            if len(ca) == 48:  # 44 characters + 4 characters for "pump"
                print(f"Valid pump.fun CA: {ca}")  # Debug: Print valid pump.fun addresses
                print(f"Sending to target chat: {TARGET_CHAT_ID}")  # Debug: Print target chat ID
                await client.send_message(TARGET_CHAT_ID, ca)  # Send only the CA
    except Exception as e:
        print(f"Error processing message: {e}")

async def joinChannel(channelName):
    channel = await client.get_entity(channelName)
    updates = await client(JoinChannelRequest(channel))
    MONITORED_CHAT_IDS.append("-100"+str(updates.chats[0].id))
    print(f"Detecting Channel list : {MONITORED_CHAT_IDS}" )

async def main():
    try:
        # Start the client
        await client.start(PHONE_NUMBER)
        print("Monitoring chats for pump.fun CAs...")

        # Debug: Print all dialogs (chats/groups/channels) the bot is part of
        # async for dialog in client.iter_dialogs():
        #     print(f"Chat Name: {dialog.name}, Chat ID: {dialog.id}")
        # await joinChannel("Maestrosdegen")
        await client.run_until_disconnected()
    except Exception as e:
        print(f"Error starting client: {e}")

if __name__ == "__main__":
    with client:
        client.loop.run_until_complete(main())