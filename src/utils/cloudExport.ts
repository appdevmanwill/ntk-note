import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import JSZip from 'jszip';
import { auth } from '@/utils/firebase';

interface BackupNote {
  id: string;
  title?: string;
  content?: string;
}

interface WorkspaceBackup {
  notes?: BackupNote[];
}

interface GoogleDriveUploadResponse {
  id?: string;
  name?: string;
  webViewLink?: string;
}

export interface CloudExportResult {
  provider: 'google-drive';
  fileId: string;
  fileName: string;
  url: string;
}

const archiveMimeType = 'application/zip';

export const getWorkspaceArchiveFileName = () =>
  `ntk-notes-workspace-${new Date().toISOString().slice(0, 10)}.zip`;

export const createWorkspaceArchive = async (exportData: string) => {
  const exportObj = JSON.parse(exportData) as WorkspaceBackup;
  const notesList = Array.isArray(exportObj.notes) ? exportObj.notes : [];
  const zip = new JSZip();

  zip.file('backup.json', exportData);

  const notesFolder = zip.folder('notes');
  const imagesFolder = zip.folder('images');
  let imageCounter = 1;

  notesList.forEach(note => {
    let content = note.content || '';

    const base64Regex = /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
    content = content.replace(base64Regex, (_match: string, alt: string, dataUrl: string) => {
      const matches = dataUrl.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) return _match;

      const ext = matches[1];
      const base64Data = matches[2];
      const filename = `img_${imageCounter++}.${ext}`;

      imagesFolder?.file(filename, base64Data, { base64: true });
      return `![${alt}](../images/${filename})`;
    });

    const safeTitle = (note.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-');
    const filename = `${safeTitle.substring(0, 50)}_${note.id.substring(0, 8)}.md`;
    notesFolder?.file(filename, content);
  });

  return zip.generateAsync({ type: 'blob' });
};

const getGoogleDriveAccessToken = async () => {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.setCustomParameters({ prompt: 'consent select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Google Drive permission was not granted.');
  }

  return credential.accessToken;
};

const createMultipartBody = async (blob: Blob, fileName: string) => {
  const boundary = `ntk_note_${Date.now()}`;
  const metadata = {
    name: fileName,
    mimeType: archiveMimeType,
    description: 'NTK Note workspace backup',
  };

  const fileBuffer = await blob.arrayBuffer();
  const body = new Blob([
    `--${boundary}\r\n`,
    'Content-Type: application/json; charset=UTF-8\r\n\r\n',
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\n`,
    `Content-Type: ${archiveMimeType}\r\n\r\n`,
    fileBuffer,
    `\r\n--${boundary}--`,
  ], {
    type: `multipart/related; boundary=${boundary}`,
  });

  return body;
};

export const exportWorkspaceArchiveToGoogleDrive = async (exportData: string): Promise<CloudExportResult> => {
  const fileName = getWorkspaceArchiveFileName();
  const [accessToken, archive] = await Promise.all([
    getGoogleDriveAccessToken(),
    createWorkspaceArchive(exportData),
  ]);
  const body = await createMultipartBody(archive, fileName);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': body.type,
      },
      body,
    }
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText || `Google Drive upload failed with status ${response.status}.`);
  }

  const result = JSON.parse(responseText) as GoogleDriveUploadResponse;
  if (!result.id) {
    throw new Error('Google Drive did not return a file id.');
  }

  return {
    provider: 'google-drive',
    fileId: result.id,
    fileName: result.name || fileName,
    url: result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`,
  };
};
