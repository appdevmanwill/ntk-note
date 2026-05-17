import re

with open('src/store/index.ts', 'r') as f:
    content = f.read()

# Add imports
content = content.replace(
    "import { v4 as uuid } from 'uuid';",
    "import { v4 as uuid } from 'uuid';\nimport { db } from '@/utils/firebase';\nimport { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocs } from 'firebase/firestore';"
)

# Update interface
content = content.replace(
    "// Actions — Profile\n  setProfile",
    "// Actions — Auth & Sync\n  uid: string | null;\n  unsubscribeNotes: (() => void) | null;\n  initFirestore: (uid: string) => void;\n  clearAuth: () => void;\n\n  // Actions — Profile\n  setProfile"
)

# Change return types to Promise for notes
content = content.replace(
    "createNote: (partial: Partial<Note>) => Note;",
    "createNote: (partial: Partial<Note>) => Promise<Note>;"
)
for action in ['updateNote', 'deleteNote', 'trashNote', 'restoreNote', 'emptyTrash', 'archiveNote', 'unarchiveNote', 'pinNote', 'starNote', 'duplicateNote', 'moveNote', 'setNoteColor', 'setNotePriority', 'addNoteTag', 'removeNoteTag', 'setNoteReminder', 'reorderNotes', 'addChecklistItem', 'updateChecklistItem', 'removeChecklistItem', 'reorderChecklist']:
    if action == 'duplicateNote':
        content = content.replace("duplicateNote: (id: string) => Note | null;", "duplicateNote: (id: string) => Promise<Note | null>;")
    else:
        content = content.replace(f"{action}: ", f"{action}: async ")

# Make the interface match the implementation
# Wait, I shouldn't replace all async blindly in interface. Let's just fix the interface using regex.

with open('src/store/index.ts', 'w') as f:
    f.write(content)
