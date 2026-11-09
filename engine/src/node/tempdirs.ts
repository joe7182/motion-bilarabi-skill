import { rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_ID_RE, type Project } from '../core/project'

/**
 * Temporary data of a project lives outside the project folder, in the system temp folder:
 * `<tmp>/mba/<project id>/frames` (extracted video frames) and `<tmp>/mba/<project id>/parts`
 * (unfinished renders). A project folder is often inside OneDrive or another synced folder, where
 * thousands of short-lived JPEGs and chunk files would be uploaded, locked by the sync client and
 * slow every write. The project id (`mba-project.json`) keys the folder, so it survives a rename of
 * the project folder; resume still works as long as the temp folder is kept.
 */

/** `<tmp>/mba`. */
export function mbaTempRoot(): string {
  return join(tmpdir(), 'mba')
}

/** `<tmp>/mba/<project id>`. The id is checked again here: it becomes a path segment. */
export function projectTempDir(project: Project): string {
  const id = project.manifest.id
  if (!PROJECT_ID_RE.test(id)) {
    throw new Error(`معرّف المشروع غير صالح لمجلد مؤقت — Invalid project id for a temp folder: "${id}" (${project.dir})`)
  }
  return join(mbaTempRoot(), id)
}

/** Extracted frames of a project: `<tmp>/mba/<project id>/frames`. */
export function framesRootOf(project: Project): string {
  return join(projectTempDir(project), 'frames')
}

/** Unfinished renders of a project: `<tmp>/mba/<project id>/parts`. */
export function partsDirOf(project: Project): string {
  return join(projectTempDir(project), 'parts')
}

/** Removes `<tmp>/mba/<project id>` once it is empty (best effort, never throws). */
export async function removeProjectTempIfEmpty(project: Project): Promise<void> {
  await rmdir(projectTempDir(project)).catch(() => {})
}
