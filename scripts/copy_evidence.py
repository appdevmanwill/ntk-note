import os
import shutil

SOURCE_DIR = r"C:\Users\NTK\.gemini\antigravity-ide\brain\511f6699-a438-4c64-9028-9ab86c459f19"
TARGET_DIR = r"c:\Users\NTK\Projects\NTK Projects\NTK-note\test-evidence\online-connections-round"

os.makedirs(TARGET_DIR, exist_ok=True)

files_in_source = os.listdir(SOURCE_DIR)

mapping = {
    "dashboard_home_light": "live-light-dashboard.png",
    "dashboard_light": "live-google-avatar.png",
    "settings_dark_mode": "live-dark-mode.png",
    "owner_connections": "live-ai-connections.png",
    "ai_suggestion_streamed": "live-ai-real-response.png",
    "inserted_ai_suggestion": "live-ai-fallback.png",
    "templates_page": "live-templates.png",
    "reminders_page": "live-reminders.png",
    "initial_landing_page": "live-guest-login.png"
}

for prefix, dest_name in mapping.items():
    matching = [f for f in files_in_source if f.startswith(prefix) and f.endswith(".png")]
    if matching:
        src = os.path.join(SOURCE_DIR, matching[0])
        dst = os.path.join(TARGET_DIR, dest_name)
        shutil.copyfile(src, dst)
        print(f"Copied {matching[0]} -> {dest_name}")
    else:
        print(f"No match for prefix {prefix}")

print("Evidence copying complete.")
