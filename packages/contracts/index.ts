import { z } from 'zod'

export type Kind = 'folder' | 'image' | 'video'
export type Root = { id: string; name: string; path: string; entryId: string; state: string; identity: string; active: number }
export type Crop = { mode: 'cover' | 'contain'; x: number; y: number; zoom: number }
export type Entry = {
  id: string; rootId: string; parentId: string | null; name: string; rel: string; kind: Kind; ext: string;
  size: number; mtime: number; identity: string; state: string; revision: number; favorite: number;
  width: number | null; height: number | null; duration: number | null; codec: string | null;
  coverMode: string | null; coverHash: string | null; coverRevision: number; coverSource: string | null; coverOriginal: string | null; coverPts: string | null;
  crop: string | null; tags: string[]; directImages: number; directVideos: number; directFolders: number;
  subtree: number; other: number; complete: number; rootState: string; playback: number;
}
export const querySchema = z.object({
  folderId: z.string().nullable(), scope: z.enum(['direct', 'descendants', 'library']), text: z.string().max(500).default(''),
  kinds: z.array(z.enum(['image', 'video'])).max(2).default([]), extensions: z.array(z.string().max(20)).max(30).default([]),
  tags: z.array(z.string().max(64)).max(30).default([]), favorite: z.boolean().default(false),
  sort: z.enum(['name', 'mtime', 'size', 'duration']).default('name'), direction: z.enum(['asc', 'desc']).default('asc'),
  minSize: z.number().nonnegative().nullable().default(null), maxSize: z.number().nonnegative().nullable().default(null),
  after: z.number().nonnegative().nullable().default(null), before: z.number().nonnegative().nullable().default(null),
  minDuration: z.number().nonnegative().nullable().default(null), maxDuration: z.number().nonnegative().nullable().default(null)
})
export type QuerySpec = z.infer<typeof querySchema>
export type QuerySession = { id: string; folders: number; media: number; total: number; complete: boolean }
export type Page = { entries: Entry[]; offset: number; total: number }
export type Task = { id: string; kind: string; name: string; state: string; discovered: number; processed: number; failed: number; message: string; results?: { name: string; source: string; destination: string | null; state: string; message: string }[] }
export type Selection = { ids: string[] } | { snapshotId: string }
export type PluginInfo = { id: string; name: string; description: string; group: string; slot: string; enabled: boolean; state: string; version: string; requires: string[]; config: Record<string, unknown>; schema: Record<string, unknown>; error?: string }
export type Frame = { token: string; url: string; time: number; pts: string; ordinal: number; width: number; height: number; duration: number; generation: number }
export type CoverSource = { handle: string; name: string; kind: Kind; duration: number; sourceId: string | null; playbackUrl: string | null }
export type Plan = { id: string; kind: string; items: { id: string; name: string; source: string; destination: string | null; files: number; folders: number; bytes: number; conflict: boolean }[]; expires: number; message: string }
export type VMEvent = { topic: string; data?: unknown; sequence: number }
export type Bootstrap = { roots: Root[]; tags: { name: string; count: number }[]; plugins: PluginInfo[]; settings: Record<string, unknown>; tasks: Task[]; libraryId: string; libraries: { id: string; name: string }[]; version: string }

export interface VMApi {
  bootstrap(): Promise<Bootstrap>
  pickRoot(): Promise<{ grant: string; path: string; overlaps: string[] } | null>
  addRoot(grant: string): Promise<Root>
  removeRoot(id: string): Promise<void>
  refreshRoot(id: string): Promise<void>
  rebindPreview(id: string): Promise<{ grant: string; total: number; matched: number; conflicts: string[]; path: string } | null>
  rebindRoot(id: string, grant: string): Promise<void>
  openQuery(spec: QuerySpec): Promise<QuerySession>
  page(id: string, offset: number, limit?: number): Promise<Page>
  position(id: string, entryId: string): Promise<number | null>
  entry(id: string): Promise<Entry>
  ancestors(id: string): Promise<Entry[]>
  children(id: string): Promise<Entry[]>
  freeze(id: string): Promise<{ snapshotId: string; count: number }>
  organize(selection: Selection, action: 'favorite' | 'tag-add' | 'tag-remove', value: string | boolean): Promise<void>
  media(id: string, purpose: 'original' | 'thumbnail'): Promise<string>
  release(url: string): Promise<void>
  playback(id: string, position: number): Promise<void>
  system(id: string, action: 'open' | 'reveal' | 'copy'): Promise<void>
  coverSource(id: string | null): Promise<CoverSource | null>
  coverSnapshot(id: string): Promise<{ frame: Frame; status: string }>
  frame(handle: string, time: number, step: number, generation: number): Promise<Frame>
  closeSource(handle: string): Promise<void>
  saveCover(target: string, token: string, crop: Crop, revision: number): Promise<Entry>
  recommend(target: string): Promise<Frame[]>
  restoreCover(target: string, revision: number): Promise<Entry>
  plan(selection: Selection, kind: 'rename' | 'move' | 'trash', target: string | null, name: string | null, conflict: 'skip' | 'keep'): Promise<Plan>
  commit(plan: string): Promise<Task>
  taskAction(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<void>
  plugins(): Promise<PluginInfo[]>
  setPlugin(id: string, enabled: boolean, config: Record<string, unknown>): Promise<PluginInfo[]>
  loadPlugin(): Promise<PluginInfo[]>
  settings(patch: Record<string, unknown>): Promise<void>
  clearCache(): Promise<void>
  exportLibrary(): Promise<string | null>
  importLibrary(): Promise<string | null>
  switchLibrary(id: string): Promise<void>
  diagnostics(): Promise<string | null>
  onEvent(callback: (event: VMEvent) => void): () => void
}
declare global { interface Window { vm: VMApi } }

const id = z.string().min(1).max(200)
const selection = z.union([z.object({ ids: z.array(id).min(1).max(10000) }), z.object({ snapshotId: id })])
export const cropSchema = z.object({ mode: z.enum(['cover', 'contain']), x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(4) })
export const ipcSchemas = {
  bootstrap: z.tuple([]), pickRoot: z.tuple([]), addRoot: z.tuple([id]), removeRoot: z.tuple([id]), refreshRoot: z.tuple([id]),
  rebindPreview: z.tuple([id]), rebindRoot: z.tuple([id, id]), openQuery: z.tuple([querySchema]),
  page: z.tuple([id, z.number().int().nonnegative(), z.number().int().min(1).max(200).optional()]),
  position: z.tuple([id,id]), entry: z.tuple([id]), ancestors: z.tuple([id]), children: z.tuple([id]), freeze: z.tuple([id]),
  organize: z.tuple([selection, z.enum(['favorite', 'tag-add', 'tag-remove']), z.union([z.string().trim().min(1).max(64), z.boolean()])]),
  media: z.tuple([id, z.enum(['original', 'thumbnail'])]), release: z.tuple([z.string().max(300)]),
  playback: z.tuple([id, z.number().nonnegative().max(1e9)]), system: z.tuple([id, z.enum(['open', 'reveal', 'copy'])]),
  coverSource: z.tuple([id.nullable()]), coverSnapshot: z.tuple([id]), frame: z.tuple([id, z.number().nonnegative().max(1e9), z.number().int().min(-1).max(1), z.number().int().nonnegative()]),
  closeSource: z.tuple([id]), saveCover: z.tuple([id, id, cropSchema, z.number().int().nonnegative()]), recommend: z.tuple([id]), restoreCover: z.tuple([id,z.number().int().nonnegative()]),
  plan: z.tuple([selection, z.enum(['rename', 'move', 'trash']), id.nullable(), z.string().max(255).nullable(), z.enum(['skip','keep'])]),
  commit: z.tuple([id]), taskAction: z.tuple([id,z.enum(['pause','resume','cancel'])]), plugins: z.tuple([]),
  setPlugin: z.tuple([id,z.boolean(), z.record(z.string(),z.unknown())]), loadPlugin: z.tuple([]),
  settings: z.tuple([z.record(z.string(), z.unknown())]), clearCache: z.tuple([]), exportLibrary: z.tuple([]), importLibrary: z.tuple([]), switchLibrary: z.tuple([id]), diagnostics: z.tuple([])
}
