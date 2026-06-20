CREATE DATABASE secure_messaging;

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender VARCHAR(100) NOT NULL,
    recipient VARCHAR(100) NOT NULL,
    content TEXT NOT NULL,
    delivered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);