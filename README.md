# ChatHere - Secure CLI Vault

A fully End-to-End Encrypted (E2EE) terminal chat application built with Node.js, Socket.IO, and React-Ink.

This application uses **Elliptic Curve Diffie-Hellman (ECDH)** over the `secp256k1` curve to securely exchange keys, ensuring that your chat messages are mathematically impossible to read by the server routing them. All encrypted messages are permanently persisted in a Supabase PostgreSQL database for offline delivery.

## Architecture Highlights
- **E2E Encryption**: Messages are encrypted locally on your machine before they ever touch the internet.
- **Offline Messaging**: If a user is offline, the server holds onto their Public Key and securely queues the encrypted ciphertext in the database.
- **Persistent Ephemeral Keys**: Private Keys are generated and stored securely in a local hidden file (`.keys_<username>.json`) ensuring you can always decrypt your offline messages without compromising security.

## Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- A [Supabase](https://supabase.com/) project (for the PostgreSQL database)

## Database Setup (Supabase)
Create a table in your Supabase project with the following schema:
```sql
CREATE TABLE public.messages (
    id SERIAL PRIMARY KEY,
    sender VARCHAR NOT NULL,
    recipient VARCHAR NOT NULL,
    content TEXT NOT NULL,
    delivered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Installation
First, install the dependencies for both the client and the server.
```bash
# Install Server dependencies
cd server
npm install

# Install Client dependencies
cd ../client
npm install
```

## Configuration
Create a `.env` file in the root directory (the same folder as this README) with your Supabase credentials:
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

## Running the Application

You will need to open multiple terminal windows.

### 1. Start the Server
In your first terminal, start the central Socket.IO router:
```bash
cd server
npm start
```

### 2. Start the Clients
In your second terminal, launch the chat client. You must provide a unique username:
```bash
cd client
npm start -- --username Alice
```

Open a third terminal for the recipient:
```bash
cd client
npm start -- --username Bob
```

## Usage
To send an encrypted message, simply tag the user and type your message:
```text
Alice > @Bob Hello! This message is end-to-end encrypted!
```

If Bob is offline, the message will be queued in Supabase and delivered the moment he logs in.
