# FitBuddy — Advanced Technical Documentation & Features Guide

FitBuddy is a gamified, fully responsive AI-powered fitness and nutrition assistant. It is built as a Single Page Application (SPA) backed by serverless microservices and a cloud Redis store.

---

## 📖 Feature Architecture Deep-Dive

### 1. Custom Onboarding Wizard & Biometric Calculator
The onboarding modal is the entry point for new profiles. As the user enters details, the frontend performs real-time calculations without server roundtrips.
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

### 2. Intelligent AI Coaching System (`watsonx.ai`)
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

### 3. Gamification Engine
*   **XP Rewards:** Users gain Experience Points (XP) for logging biometric details and activities:
    *   Log a meal: $+50 \text{ XP}$
    *   Log exercises: $+100 \text{ XP}$
    *   Drink water: $+10 \text{ XP}$ per glass
*   **Leveling Up:** Levels are calculated using a cumulative threshold scale. Upon level-up, the AI triggers a celebration prompt and generates a custom cheat-meal recipe that strictly matches the user's diet rules.

---

### 4. Interactive Tracking Dashboards
*   **Meal Tracker:** Allows categorizing entries into Breakfast, Lunch, Dinner, or Snacks. Utilizes nutrition guidelines to track daily remaining macros.
*   **Exercise Tracker:** Logs sets, reps, duration, and dynamically calculates calories burned.
*   **Water Tracker:** Standard 8-glass logger with real-time visual progress bars.

---

## 🗄️ Database & State Data Models

### 1. Redis Database User Schema (`user:{userId}`)
Each user is stored as a serialized JSON object inside Vercel KV under a unique key prefix:

```json
{
  "hash": "8b5f3a09c2a61...83d09a",
  "salt": "a4d38c92b101ff6c",
  "state": {
    "user": {
      "userId": "usr_7e4f9b8c2d103a5e",
      "username": "AlexFit",
      "weight": 78,
      "height": 182,
      "age": 28,
      "gender": "male",
      "bmi": 23.5,
      "goal": "loss",
      "tdee": 2450,
      "macros": {
        "protein": 146,
        "carbs": 195,
        "fat": 65
      },
      "cuisine": "mediterranean",
      "diet": "vegetarian"
    },
    "onboarded": true,
    "today": {
      "date": "2026-07-10",
      "meals": [
        {
          "id": "meal_172089201",
          "name": "Greek Salad with Tofu",
          "calories": 380,
          "protein": 18,
          "carbs": 12,
          "fat": 28
        }
      ],
      "exercises": [
        {
          "name": "Squats",
          "sets": 3,
          "reps": 12,
          "duration": 15,
          "caloriesBurned": 120
        }
      ],
      "water": 4,
      "sleep": 8,
      "mood": "neutral"
    },
    "xp": {
      "total": 350,
      "level": 2,
      "title": "Fit Novice"
    },
    "settings": {
      "mode": "proxy",
      "waterTarget": 8
    },
    "chatHistory": [
      {
        "role": "user",
        "content": "I'm craving sweet chocolate."
      },
      {
        "role": "assistant",
        "content": "Try having a small bowl of Greek yogurt topped with a teaspoon of unsweetened cocoa powder and dark chocolate chips. It satisfies your sweet tooth for just 150 kcal!"
      }
    ]
  }
}
```

---

## 📡 API Endpoints Spec

### 1. Fetch Guard Handshake
*   **Endpoint:** `GET /api/db-token`
*   **Header Required:** None
*   **Response:**
    ```json
    {
      "token": "fitbuddy-secret-token-2026-xK9mPqL4"
    }
    ```

### 2. Fetch User Profile
*   **Endpoint:** `GET /api/user-data?username=AlexFit`
*   **Headers Required:**
    *   `X-DB-Token`: `[DB_TOKEN_VALUE]`
    *   `X-User-Password`: `[PLAINTEXT_USER_PASSWORD]`
*   **Response (User Exists):**
    ```json
    {
      "success": true,
      "exists": true,
      "data": { ...stateObject... }
    }
    ```

### 3. Update / Register User Profile
*   **Endpoint:** `POST /api/user-data`
*   **Headers Required:**
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
*   **Response:**
    ```json
    {
      "success": true,
      "exists": true,
      "state": { ...updatedStateObject... }
    }
    ```

### 4. Chat Proxy
*   **Endpoint:** `POST /api/chat`
*   **Headers Required:** None
*   **Payload:**
    ```json
    {
      "message": "Give me a high protein breakfast idea",
      "history": [
        { "role": "user", "content": "Hello" },
        { "role": "assistant", "content": "Hi there! How can I help you today?" }
      ],
      "context": {
        "dietLabel": "Vegetarian",
        "cuisineLabel": "Indian",
        "consumed": 450,
        "tdee": 2000
      },
      "max_tokens": 300
    }
    ```
*   **Response:**
    ```json
    {
      "generated_text": "A great vegetarian Indian breakfast option is a Paneer Bhurji with whole wheat roti. It packs 25g of protein and is very satisfying!",
      "token_count": 48
    }
    ```
