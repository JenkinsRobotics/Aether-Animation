import { serializeCharacter } from './engine';
/** The engine validates/serializes the empty rig; the platform owns no schema. */
export async function createDocument(name: string): Promise<File> {
  const base = name.trim().replace(/(?:\.character)?\.anima$/i, '').trim();
  if (!base) throw new Error('Enter a character name.');
  const result = await serializeCharacter({ identity: { name: base, display_name: base }, parts: [], joints: [], clips: [] }, `${location.origin}/animation`);
  return new File([result.text], `${base}.anima`, { type: 'application/yaml' });
}
