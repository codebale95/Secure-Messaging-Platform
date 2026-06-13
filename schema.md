# Database Schema

## messages

Stores all direct messages exchanged between users.

| Column | Type | Description |
|----------|----------|----------|
| id | SERIAL PRIMARY KEY | Unique message ID |
| sender | VARCHAR(100) | Username of sender |
| recipient | VARCHAR(100) | Username of recipient |
| content | TEXT | Message body |
| delivered | BOOLEAN | Delivery status |
| created_at | TIMESTAMP | Time message was created |

---

## Message Flow

1. Sender sends message.
2. Server checks if recipient is online.
3. If online:
   - Deliver instantly through Socket.IO.
4. If offline:
   - Save message in PostgreSQL.
5. Recipient reconnects.
6. Server loads undelivered messages.
7. Messages are delivered.
8. Database record is marked as delivered.