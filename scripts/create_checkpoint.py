import os
import shutil

SOURCE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKUP_DIR = os.path.join(os.path.dirname(SOURCE_DIR), "NTK-note-final-storage-proof-rollback-checkpoint")

EXCLUDE_DIRS = {"node_modules", ".git", ".wrangler", ".firebase", "dist", "backups", "scratch", ".tempmediaStorage"}
EXCLUDE_EXTS = {".zip", ".log", ".tmp"}

if os.path.exists(BACKUP_DIR):
    shutil.rmtree(BACKUP_DIR)
os.makedirs(BACKUP_DIR, exist_ok=True)

copied = 0
for root, dirs, files in os.walk(SOURCE_DIR):
    dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
    rel_root = os.path.relpath(root, SOURCE_DIR)
    
    if rel_root.startswith("backups"):
        continue
        
    dest_folder = os.path.join(BACKUP_DIR, rel_root) if rel_root != "." else BACKUP_DIR
    os.makedirs(dest_folder, exist_ok=True)
    
    for file in files:
        _, ext = os.path.splitext(file)
        if ext in EXCLUDE_EXTS or file.endswith(".local"):
            continue
        src_path = os.path.join(root, file)
        dst_path = os.path.join(dest_folder, file)
        shutil.copy2(src_path, dst_path)
        copied += 1

with open(os.path.join(BACKUP_DIR, "CHECKPOINT_INFO.txt"), "w") as f:
    f.write(f"R2-B2 Media Round Rollback Checkpoint with {copied} files.")

print(f"Rollback checkpoint created with {copied} files in {BACKUP_DIR}")
