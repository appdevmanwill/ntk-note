import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (fullPath.endsWith('.tsx')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk('./src');
let totalButtons = 0;
const missingAccessibleName = [];
const genericAriaLabels = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const tagRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    totalButtons++;
    const attrs = match[1];
    const inner = match[2].trim();

    const labelMatch = /aria-label\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/i.exec(attrs);
    const hasAriaLabelledby = /aria-labelledby\s*=/i.test(attrs);

    if (labelMatch) {
      const val = (labelMatch[1] || labelMatch[2] || labelMatch[3] || '').trim().replace(/['"]/g, '');
      if (/^(?:button|icon|action)$/i.test(val)) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        genericAriaLabels.push({ file, lineNum, label: val, attrs: attrs.trim() });
      }
    } else if (!hasAriaLabelledby) {
      // Check if there is genuine visible text
      const withoutTags = inner.replace(/<[^>]+>/g, ' ').trim();
      const withoutComments = withoutTags.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '').trim();
      
      const words = withoutComments.replace(/\{[^}]+\}/g, '').trim();
      const hasVisibleWord = /[a-zA-Z0-9]{2,}/.test(words);

      const hasDynamicText = /\{(?:\w+\.)?(?:title|name|label|text|children|format|count|date|tag|category|shortcut|heading|desc|step|tab|opt)\b/i.test(withoutComments);
      const hasTernaryString = /\{.*?\?.*?['"`][a-zA-Z0-9 ]+['"`].*?:.*?\}/.test(withoutComments);

      if (!hasVisibleWord && !hasDynamicText && !hasTernaryString) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        missingAccessibleName.push({
          file,
          lineNum,
          attrs: attrs.replace(/\s+/g, ' ').trim(),
          inner: inner.replace(/\s+/g, ' ').substring(0, 100),
        });
      }
    }
  }
}

console.log(`Audited ${files.length} tsx files.`);
console.log(`Total <button> elements: ${totalButtons}`);
console.log(`Buttons with generic labels (Button/Icon/Action): ${genericAriaLabels.length}`);
for (const g of genericAriaLabels) {
  console.log(`  ${g.file}:${g.lineNum} -> "${g.label}"`);
}

console.log(`Buttons missing accessible name: ${missingAccessibleName.length}`);
for (const m of missingAccessibleName) {
  console.log(`  ${m.file}:${m.lineNum}`);
  console.log(`    attrs: ${m.attrs}`);
  console.log(`    inner: ${m.inner}`);
}
