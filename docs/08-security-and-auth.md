# Security & Authentication

This document details the Two-Tier One-Time Password (OTP) security model, session lifecycle, role-based authorization, and attack mitigation strategies in `music-streamer`.

---

## 1. Two-Tier OTP Security Model

`music-streamer` features a two-tier authentication architecture designed for multi-user and public broadcast deployments.

```mermaid
graph TD
    User([Incoming Client Request]) --> AuthCheck{OTP Security Enabled?}
    AuthCheck -->|No| AllowAdmin[Grant Admin Access]
    AuthCheck -->|Yes| VerifySession{Has Valid Session Token / OTP?}

    VerifySession -->|No / Invalid| Deny[403 Forbidden / Auth Prompt]
    VerifySession -->|Yes| RoleCheck{Inspect Session Role}

    RoleCheck -->|Role: Admin| AdminPerms[Full Access<br/>Playback, Queue, Playlists, Settings]
    RoleCheck -->|Role: Subscriber| SubPerms[Subscriber Access<br/>Stream Audio & Track Metadata Only]
```

### 1.1 Role Capabilities Matrix

| Capability / Action | Admin Role | Subscriber Role | Unauthenticated (When Enabled) |
|---|:---:|:---:|:---:|
| **Listen to Live Stream (`/stream.mp3`)** | Yes | Yes | Blocked |
| **Real-Time Web Audio (`/ws`)** | Yes | Yes | Blocked |
| **View Now Playing & Status (`/status`)** | Yes | Yes | Blocked |
| **Web Music Search (`/api/search`)** | Yes | Yes (Web Only) | Blocked |
| **View Named Playlists (`/api/playlists`)** | Yes | No (Hidden) | Blocked |
| **Play / Pause / Resume / Stop** | Yes | No | Blocked |
| **Queue & Playlist Modifications** | Yes | No | Blocked |
| **Change Volume / Loop / Audio Mode** | Yes | No | Blocked |

---

## 2. Cryptographic Passcode Generation & Verification

Passcodes are 6-digit cryptographically secure numerical strings generated using Python's `secrets` module.

```python
import secrets

# Cryptographically secure 6-digit OTP generation
new_admin_otp = f"{secrets.randbelow(900000) + 100000}"
new_subscriber_otp = f"{secrets.randbelow(900000) + 100000}"
```

### 2.1 Timing-Safe Verification
To prevent side-channel timing attacks, OTP verification uses constant-time string comparison:

```python
if secrets.compare_digest(user_input_otp, stored_admin_otp):
    return True, create_session(role="admin")
elif secrets.compare_digest(user_input_otp, stored_subscriber_otp):
    return True, create_session(role="subscriber")
```

---

## 3. Session Lifecycle & Token Management

When a user successfully enters an OTP passcode, a 128-bit cryptographically secure session token is generated:

```python
session_token = secrets.token_hex(16)  # 32-character hexadecimal string
```

### 3.1 Session Persistence in SQLite
Session records are stored in the `otp_sessions` table:

```sql
INSERT INTO otp_sessions (token, client_ip, role, created_at, expires_at)
VALUES (?, ?, ?, ?, ?);
```

- **Duration**: Default expiration is **7 days** (`86400 * 7 = 604,800 seconds`).
- **IP Binding**: The client's source IP address is logged for auditing and anomaly detection.
- **Automatic Pruning**: Expired tokens are purged automatically during session lookups.

### 3.2 Token Transport Channels
Clients can transmit session tokens across any standard transport channel:

1. **HTTP Cookie**:
   ```http
   Cookie: music_session=7a3f8e91b2c44f0a9e8d1234567890ab
   ```
2. **HTTP Authorization Header**:
   ```http
   Authorization: Bearer 7a3f8e91b2c44f0a9e8d1234567890ab
   ```
3. **Query Parameter** (useful for direct media player streams like VLC):
   ```http
   GET /stream.mp3?token=7a3f8e91b2c44f0a9e8d1234567890ab HTTP/1.1
   ```

---

## 4. CLI Security Management (`otp.py`)

Administrators can inspect, regenerate, enable, or disable security settings via the CLI:

```bash
# View active Admin and Subscriber passcodes
./otp.py show

# Generate a new Admin passcode
./otp.py new admin

# Generate a new Subscriber passcode
./otp.py new subscriber

# Enable OTP enforcement
./otp.py on

# Disable OTP enforcement (open public access)
./otp.py off

# View active client sessions
./otp.py sessions
```
