# FitBuddy — Advanced Technical Documentation & Features Guide

FitBuddy is a gamified, fully responsive AI-powered fitness and nutrition assistant. It is built as a Single Page Application (SPA) backed by serverless microservices and a cloud Redis store.

---

## 📖 Feature Architecture Deep-Dive

### 1. Multi-Stage Auth & Onboarding Wizard
The onboarding modal is the entry point for users, structured as a clean three-stage wizard:
1.  **Sign In Stage:** Accepts Username/Email and Password, with Google Sign-in support.
2.  **Sign Up Stage:** Standard credentials registration (Email, Username, Password) or signup with Google.
3.  **Biometrics Setup Stage:** When standard users register or new Google users sign up for the first time, they are redirected to specify Gender, Weight, Height, Age, Preferred Cuisine, and Diet Type.
*   **BMI (Body Mass Index):** Calculated using standard metrics:
    $$\text{BMI} = \frac{\text{Weight (kg)}}{\left(\frac{\text{Height (cm)}}{100}\right)^2}$$
*   **TDEE (Total Daily Energy Expenditure):** Calculated using the **Mifflin-St Jeor equation**:
    *   *Male:* $\text{BMR} = 10 \times \text{Weight (kg)} + 6.25 \times \text{Height (cm)} - 5 \times \text{Age (y)} + 5$
    *   *Female:* $\text{BMR} = 10 \times \text{Weight (kg)} + 6.25 \times \text{Height (cm)} - 5 \times \text{Age (y)} - 161$
    *   *TDEE:* $\text{BMR} \times 1.375$ (Lightly Active Multiplier)
*   **Caloric Targets by Goal:**
    *   `Weight Loss`: $\text{TDEE} - 500 \text{ kcal}$
    *   `Maintain Weight`: $\text{TDEE}$
    *   `Weight Gain`: $\text{TDEE} + 300 \text{ kcal}$
*   **Macro Allocations:** Caloric targets are split using a balanced zone ratio:
    *   **Protein (30%):** $4 \text{ kcal/g}$
    *   **Carbs (40%):** $4 \text{ kcal/g}$
    *   **Fat (30%):** $9 \text{ kcal/g}$

---

### 2. Google Sign-In & Callback Stubbing
Google Identity Services (GSI) authentication is integrated directly into the wizard:
*   **Initialization Race Mitigation:** To avoid GSI SDK loading race conditions before dynamic module loads, a script stub in the HTML `<head>` caches the Google authentication response:
    ```javascript
    window.handleCredentialResponse = function(response) {
      if (window.__actualHandleCredentialResponse) {
        window.__actualHandleCredentialResponse(response);
      } else {
        window.__pendingGoogleResponse = response;
      }
    };
    ```
    Once the onboarding module completes importing, it immediately flushes `__pendingGoogleResponse` and resolves the session.
*   **Account Auto-Linking:** The backend `/api/google-login` verifies the token. If a standard account already exists with the same email, it automatically links the Google credentials to the existing profile.
*   **New Profile Defaults:** For new Google profiles, the UI pre-populates default biometrics and triggers calculations instantly via a fake `'input'` event.

---

### 3. Password Reset & SMTP Code Flow
Users can securely recover their passwords using a 6-digit verification code system:
*   **Secure SMTP Transport:** If SMTP environment variables are configured, Nodemailer sends a 6-digit verification code to the registered email address.
*   **Dev Mode Fallback:** If SMTP credentials are not set up on the host, the server logs the generated verification code to the console and includes it in a `devMode` JSON response for easy local testing.
*   **Expiration Guard:** Verification codes are stored in Redis under `reset:{username}` with a strict 10-minute expiration (`EX 600`).

---

### 4. Intelligent AI Coaching System (`watsonx.ai`)
Powered by the `ibm/granite-3-8b-instruct` model, the AI engine acts as a humanized coach. Prompt compilers construct rich context payloads dynamically:
*   **Craving Detection:** When users mention high-calorie junk foods, the prompt injects strict bounds to output a healthy alternative matching the user's cuisine selection.
*   **Recipe Mode:** If ingredients are listed, the AI wraps a simplified recipe inside a JSON structure:
    `[RECIPE_START] {"name": "...", "steps": [...], "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0} [RECIPE_END]`
    This JSON is parsed by the frontend to render an interactive recipe card.
*   **Mood & Stress Intervention:** If the user inputs a "sad", "stressed", or "exhausted" mood:
    *   The coach locks the Exercise logger tab to prevent injury/pressure.
    *   It unlocks the "Play Zone" and redirects the user to the guided Zen breathing tool or mini-games.
    *   The workout logs only unlock once the user finishes a game or reports feeling better.

---

### 5. Gamification Engine
*   **XP Rewards:** Users gain Experience Points (XP) for logging biometric details and activities:
    *   Log a meal: $+50 \text{ XP}$
    *   Log exercises: $+100 \text{ XP}$
    *   Drink water: $+10 \text{ XP}$ per glass
*   **Leveling Up:** Levels are calculated using a cumulative threshold scale. Upon level-up, the AI triggers a celebration prompt and generates a custom cheat-meal recipe that strictly matches the user's diet rules.

---

## 🗄️ Database & State Data Models

### 1. Redis Database User Schema (`user:{userId}`)
Each user is stored as a serialized JSON object inside Vercel KV under a unique key prefix:
```json
{
  "hash": "8b5f3a09c2a61...83d09a",
  "salt": "a4d38c92b101ff6c",
  "googleId": "10482930219283749",
  "state": {
    "user": {
      "userId": "usr_7e4f9b8c2d103a5e",
      "username": "AlexFit",
      "email": "alex@example.com",
      "weight": 78,
      "height": 182,
      "age": 28,
      "gender": "male",
      "bmi": 23.5,
      "goal": "loss",
      "tdee": 2450,
      "macros": { "protein": 146, "carbs": 195, "fat": 65 },
      "cuisine": "mediterranean",
      "diet": "vegetarian"
    },
    "onboarded": true,
    "today": {
      "date": "2026-07-10",
      "meals": [],
      "exercises": [],
      "water": 0,
      "sleep": 8,
      "mood": "neutral"
    },
    "xp": { "total": 350, "level": 2 },
    "chatHistory": []
  }
}
```

---

## 📡 API Endpoints Spec

### 1. Fetch Guard Handshake
*   **Endpoint:** `GET /api/db-token`
*   **Response:**
    ```json
    { "token": "fitbuddy-secret-token-..." }
    ```

### 2. Fetch User Profile
*   **Endpoint:** `GET /api/user-data?username=AlexFit` (Accepts username or email)
*   **Headers:**
    *   `X-DB-Token`: `[DB_TOKEN_VALUE]`
    *   `X-User-Password`: `[PLAINTEXT_USER_PASSWORD]`
*   **Response:**
    ```json
    { "success": true, "exists": true, "data": { ...stateObject... } }
    ```

### 3. Update / Register User Profile
*   **Endpoint:** `POST /api/user-data`
*   **Headers:**
    *   `X-DB-Token`: `[DB_TOKEN_VALUE]`
*   **Payload:**
    ```json
    {
      "username": "AlexFit",
      "password": "mySecurePassword123",
      "newPassword": "",
      "state": { ...stateObject... }
    }
    ```

### 4. Google Authentication
*   **Endpoint:** `POST /api/google-login`
*   **Payload:**
    ```json
    {
      "googleId": "10482930219283749",
      "email": "alex@example.com",
      "name": "Alex Fit"
    }
    ```
*   **Response:**
    ```json
    { "success": true, "state": { ...stateObject... } }
    ```

### 5. Password Reset Request
*   **Endpoint:** `POST /api/reset-password?action=send`
*   **Payload:**
    ```json
    {
      "username": "AlexFit",
      "email": "alex@example.com"
    }
    ```
*   **Response:**
    ```json
    { "success": true, "devMode": false }
    ```

### 6. Password Reset Verification
*   **Endpoint:** `POST /api/reset-password?action=verify`
*   **Payload:**
    ```json
    {
      "username": "AlexFit",
      "code": "123456",
      "newPassword": "myNewPassword789"
    }
    ```
*   **Response:**
    ```json
    { "success": true }
    ```
