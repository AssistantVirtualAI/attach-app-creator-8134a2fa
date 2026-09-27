# Project Architecture Rules

- Maestro task completion uses the documented soft-delete endpoint and a complete GET read-back; never invent a status option ID or trust mutation success alone.
- AVA customer lookup is profile-first: show verified Maestro details before contact actions, and offer calls, SMS, or email only when explicitly requested.