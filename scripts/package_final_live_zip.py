import os
import zipfile
import re

ZIP_NAME = "NTK-note-connections-online-live-antigravity-verified.zip"
ROOT_DIR = os.path.abspath(".")

EXCLUDE_DIRS = {
    "node_modules",
    ".git",
    ".wrangler",
    ".firebase",
    "dist",
    "backups",
    "scratch",
    "__pycache__"
}

EXCLUDE_FILES = {
    ".env.local",
    ".dev.vars",
    "active_oauth_url.txt",
    ZIP_NAME
}

EXCLUDE_EXTENSIONS = {
    ".log",
    ".tmp"
}

FORBIDDEN_PATTERNS = [
    # Generic secret shape detectors (no literal secret values)
    r"sk-or-v1-[a-f0-9]{64}",
    r"gsk_[A-Za-z0-9]{48,}",
    r"bearer\s+[a-zA-Z0-9_\-\.]{25,}",
    r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}",
    r"-----BEGIN\s+(?:RSA|EC|OPENSSH|PRIVATE)\s+KEY-----",
    r"(?:aws_secret_access_key|aws_session_token)\s*=\s*['"][A-Za-z0-9/+=]{30,}['"]",
    r"(?:api[_-]?key|secret[_-]?key|auth[_-]?token)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]"
]

def should_exclude(rel_path):
    parts = rel_path.replace("\\", "/").split("/")
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
    
    filename = os.path.basename(rel_path)
    if filename in EXCLUDE_FILES or filename.startswith(".env.") and filename.endswith(".local"):
        return True
    
    _, ext = os.path.splitext(filename)
    if ext in EXCLUDE_EXTENSIONS:
        return True
    
    return False

def scan_for_secrets(file_path):
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            for pat in FORBIDDEN_PATTERNS:
                if re.search(pat, content):
                    return True
    except Exception:
        pass
    return False

def main():
    print(f"Creating clean production ZIP: {ZIP_NAME}...")
    file_count = 0
    
    with zipfile.ZipFile(ZIP_NAME, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(ROOT_DIR):
            # Prune excluded dirs
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
            
            for file in files:
                abs_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_path, ROOT_DIR)
                
                if should_exclude(rel_path):
                    continue
                
                if scan_for_secrets(abs_path):
                    print(f"ERROR: Secret pattern detected in {rel_path}! Excluding.")
                    continue
                
                zf.write(abs_path, rel_path)
                file_count += 1
                
    print(f"Successfully packaged {file_count} files into {ZIP_NAME}.")
    
    # Audit created zip
    print("\nAuditing packaged archive...")
    with zipfile.ZipFile(ZIP_NAME, "r") as zf:
        names = zf.namelist()
        forbidden_found = []
        for name in names:
            norm = name.replace("\\", "/")
            if any(norm.startswith(d + "/") or ("/" + d + "/") in norm for d in ["node_modules", ".git", ".wrangler", ".firebase"]):
                forbidden_found.append(name)
            if norm == ".env.local" or norm.endswith("/.env.local") or (norm.startswith(".env.") and norm.endswith(".local")):
                forbidden_found.append(name)
        if forbidden_found:
            raise RuntimeError(f"Audit failed! Found forbidden entries: {forbidden_found}")
        print(f"Audit PASSED! Archive is clean, secret-free, and production-ready ({len(names)} files).")

if __name__ == "__main__":
    main()
