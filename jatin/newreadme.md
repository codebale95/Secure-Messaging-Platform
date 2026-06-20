# PostgreSQL Offline Messaging Implementation

Author: Jatin

## Overview

This module extends the Secure Messaging Platform by introducing persistent message storage using PostgreSQL.

Previously, messages were only routed through Socket.IO and were lost when recipients were offline.

The new implementation allows:

- Offline message storage
- Automatic message retrieval
- Delivery status tracking
- Persistent chat records

---

## Technologies Used

- Node.js
- Express.js
- Socket.IO
- PostgreSQL
- Supabase (Cloud PostgreSQL)

---

## Features Added

### Offline Message Storage

When a recipient is unavailable:

1. Message is inserted into PostgreSQL.
2. Delivery status is marked FALSE.

### Offline Message Retrieval

When recipient logs in:

1. Server queries database.
2. Undelivered messages are loaded.
3. Messages are sent to recipient.
4. Delivery status is updated to TRUE.

---

## Database Table

messages

Columns:

- id
- sender
- recipient
- content
- delivered
- created_at

---

## Workflow

Alice sends message
↓
Server receives message
↓
Bob offline?
↓
Yes
↓
Store in PostgreSQL
↓
Bob reconnects
↓
Load pending messages
↓
Deliver messages
↓
Mark delivered = TRUE

---

## Future Improvements

- End-to-End Encryption
- Chat History API
- Read Receipts
- Group Messaging
- User Authentication