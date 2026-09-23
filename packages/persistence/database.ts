import {coverQualities,thumbnailName} from '../contracts/covers'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { compileQuery, naturalKey, safeRelative } from '../domain'
import type { Entry, QuerySpec, QuerySession, Selection, ActressPage } from '../contracts'

export const schema = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roots(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,entryId TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'online',identity TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,indexMode TEXT NOT NULL DEFAULT 'manual',intervalMinutes INTEGER NOT NULL DEFAULT 60,lastIndexedAt INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS entries(
 id TEXT UNIQUE NOT NULL,rootId TEXT NOT NULL REFERENCES roots(id),parentId TEXT,kind TEXT NOT NULL,name TEXT NOT NULL,rel TEXT NOT NULL,pathKey TEXT NOT NULL,
 ext TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL DEFAULT 0,mtime REAL NOT NULL DEFAULT 0,identity TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT 'present',
 sortKey TEXT NOT NULL,search TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,width INTEGER,height INTEGER,duration REAL,codec TEXT,probeError TEXT,
 coverMode TEXT,coverHash TEXT,coverRevision INTEGER NOT NULL DEFAULT 0,coverSource TEXT,coverPts TEXT,crop TEXT,coverOriginal TEXT,coverQuality TEXT NOT NULL DEFAULT 'fast',
  playback REAL NOT NULL DEFAULT 0,directImages INTEGER NOT NULL DEFAULT 0,directVideos INTEGER NOT NULL DEFAULT 0,directFolders INTEGER NOT NULL DEFAULT 0,subtree INTEGER NOT NULL DEFAULT 0,other INTEGER NOT NULL DEFAULT 0,complete INTEGER NOT NULL DEFAULT 0,seen TEXT,fingerprint TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS active_paths ON entries(rootId,pathKey) WHERE state='present';
CREATE INDEX IF NOT EXISTS parent_kind ON entries(parentId,kind,state,sortKey,id);
CREATE INDEX IF NOT EXISTS root_state ON entries(rootId,state);
CREATE INDEX IF NOT EXISTS identities ON entries(identity);
CREATE TABLE IF NOT EXISTS closure(ancestor TEXT NOT NULL,descendant TEXT NOT NULL,depth INTEGER NOT NULL,PRIMARY KEY(ancestor,descendant));
CREATE INDEX IF NOT EXISTS closure_reverse ON closure(descendant,ancestor);
CREATE TABLE IF NOT EXISTS entry_tags(entryId TEXT NOT NULL,tag TEXT NOT NULL,PRIMARY KEY(entryId,tag));
CREATE INDEX IF NOT EXISTS tag_entries ON entry_tags(tag,entryId);
CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS selection_items(snapshotId TEXT NOT NULL,entryId TEXT NOT NULL,revision INTEGER NOT NULL,ordinal INTEGER NOT NULL,PRIMARY KEY(snapshotId,entryId));
CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS entry_fts USING fts5(search,content='entries',content_rowid='rowid',tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS entry_ai AFTER INSERT ON entries BEGIN INSERT INTO entry_fts(rowid,search) VALUES(new.rowid,new.search); END;
CREATE TRIGGER IF NOT EXISTS entry_ad AFTER DELETE ON entries BEGIN INSERT INTO entry_fts(entry_fts,rowid,search) VALUES('delete',old.rowid,old.search); END;
CREATE TRIGGER IF NOT EXISTS entry_au AFTER UPDATE OF search ON entries BEGIN INSERT INTO entry_fts(entry_fts,rowid,search) VALUES('delete',old.rowid,old.search); INSERT INTO entry_fts(rowid,search) VALUES(new.rowid,new.search); END;
CREATE TABLE IF NOT EXISTS scrape_metadata(
 entryId TEXT PRIMARY KEY,code TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '',originalTitle TEXT NOT NULL DEFAULT '',
 studio TEXT NOT NULL DEFAULT '',series TEXT NOT NULL DEFAULT '',releaseDate TEXT NOT NULL DEFAULT '',durationMin INTEGER NOT NULL DEFAULT 0,
 actors TEXT NOT NULL DEFAULT '[]',tags TEXT NOT NULL DEFAULT '[]',description TEXT NOT NULL DEFAULT '',
 coverUrl TEXT NOT NULL DEFAULT '',coverFile TEXT NOT NULL DEFAULT '',provider TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'auto',scrapedAt INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS scrape_status ON scrape_metadata(status);
CREATE TABLE IF NOT EXISTS actresses(
 id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,japaneseName TEXT NOT NULL DEFAULT '',chineseName TEXT NOT NULL DEFAULT '',
 birthDate TEXT NOT NULL DEFAULT '',height INTEGER NOT NULL DEFAULT 0,
 bust INTEGER NOT NULL DEFAULT 0,waist INTEGER NOT NULL DEFAULT 0,hips INTEGER NOT NULL DEFAULT 0,cup TEXT NOT NULL DEFAULT '',
 aliases TEXT NOT NULL DEFAULT '[]',coverEntryId TEXT NOT NULL DEFAULT '',profileSource TEXT NOT NULL DEFAULT '',profileAt INTEGER NOT NULL DEFAULT 0,createdAt INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS entry_actors(entryId TEXT NOT NULL,actressId TEXT NOT NULL,PRIMARY KEY(entryId,actressId));
CREATE INDEX IF NOT EXISTS actress_entries ON entry_actors(actressId,entryId);
`
type Row = Record<string, any>
const searchText = (rel: string, name: string) => `${name}\n${rel}`.normalize('NFKC').toLowerCase()
const parseStringArray = (value: unknown): string[] => { if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean); try { const parsed = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed.map(item => String(item).trim()).filter(Boolean) : [] } catch { return [] } }
const clampCount = (value: unknown) => { const parsed = Math.round(Number(value)); return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 300) : 0 }
export class LibraryDatabase {
  db: Database.Database
  sessions = new Map<string, QuerySession & { touched: number; table:string }>()
  private sessionCounter=0
  readonly: boolean
  constructor(filename: string, readonly = false) {
    this.readonly = readonly
    this.db = new Database(filename, { readonly, timeout: 2500 })
    this.db.pragma('foreign_keys=ON')
    this.db.pragma('temp_store=MEMORY')
    this.db.pragma('cache_size=-32768')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 9) throw Error('数据库由更高版本创建，请升级应用')
    if (!readonly) {
      this.db.pragma('journal_mode=WAL'); this.db.pragma('synchronous=FULL')
      this.db.exec(schema)
      if(version<2){const columns=new Set((this.db.pragma('table_info(roots)') as Row[]).map(row=>row.name));if(!columns.has('indexMode'))this.db.exec("ALTER TABLE roots ADD COLUMN indexMode TEXT NOT NULL DEFAULT 'manual'");if(!columns.has('intervalMinutes'))this.db.exec('ALTER TABLE roots ADD COLUMN intervalMinutes INTEGER NOT NULL DEFAULT 60');if(!columns.has('lastIndexedAt'))this.db.exec('ALTER TABLE roots ADD COLUMN lastIndexedAt INTEGER NOT NULL DEFAULT 0')}
      if(version<3){const columns=new Set((this.db.pragma('table_info(entries)') as Row[]).map(row=>row.name));if(!columns.has('coverQuality'))this.db.exec("ALTER TABLE entries ADD COLUMN coverQuality TEXT NOT NULL DEFAULT 'balanced'")}
      if(version<4)this.db.exec("UPDATE entries SET coverHash=NULL,coverSource=NULL,coverQuality='compact',coverRevision=coverRevision+1 WHERE coverMode='auto'; UPDATE entries SET coverQuality='compact' WHERE coverMode IS NULL")
      if(version<5)this.db.exec("UPDATE entries SET coverHash=NULL,coverSource=NULL,coverQuality='fast',coverRevision=coverRevision+1 WHERE coverMode='auto'; UPDATE entries SET coverQuality='fast' WHERE coverMode IS NULL")
      if(version<6)this.db.exec('CREATE TABLE IF NOT EXISTS scrape_metadata(entryId TEXT PRIMARY KEY,code TEXT NOT NULL DEFAULT \'\',title TEXT NOT NULL DEFAULT \'\',originalTitle TEXT NOT NULL DEFAULT \'\',studio TEXT NOT NULL DEFAULT \'\',series TEXT NOT NULL DEFAULT \'\',releaseDate TEXT NOT NULL DEFAULT \'\',durationMin INTEGER NOT NULL DEFAULT 0,actors TEXT NOT NULL DEFAULT \'[]\',tags TEXT NOT NULL DEFAULT \'[]\',description TEXT NOT NULL DEFAULT \'\',coverUrl TEXT NOT NULL DEFAULT \'\',coverFile TEXT NOT NULL DEFAULT \'\',provider TEXT NOT NULL DEFAULT \'\',status TEXT NOT NULL DEFAULT \'auto\',scrapedAt INTEGER NOT NULL DEFAULT 0)')
      if(version<7){
        // 刮削标签并入现有标签系统（entry_tags），女优与作品关联从刮削结果重建。
        this.db.exec("INSERT OR IGNORE INTO entry_tags(entryId,tag) SELECT s.entryId,TRIM(j.value) FROM scrape_metadata s,json_each(s.tags) j WHERE json_valid(s.tags) AND s.tags NOT IN ('','[]') AND TRIM(j.value)<>''")
        this.rebuildActresses()
      }
      if(version<8){
        // 演员资料扩展（日文名/中文名）与手动封面选择。
        const columns=new Set((this.db.pragma('table_info(actresses)') as Row[]).map(row=>row.name))
        if(!columns.has('japaneseName'))this.db.exec("ALTER TABLE actresses ADD COLUMN japaneseName TEXT NOT NULL DEFAULT ''")
        if(!columns.has('chineseName'))this.db.exec("ALTER TABLE actresses ADD COLUMN chineseName TEXT NOT NULL DEFAULT ''")
        if(!columns.has('coverEntryId'))this.db.exec("ALTER TABLE actresses ADD COLUMN coverEntryId TEXT NOT NULL DEFAULT ''")
      }
      if(version<9){
        // 资料补全升级为三源聚合（新增 JavModel 中文名/罗马名），重置补全时间触发一次性重新聚合。
        this.db.exec('UPDATE actresses SET profileAt=0')
      }
      this.db.pragma('user_version=9')
      this.db.prepare("INSERT OR IGNORE INTO meta VALUES('libraryId',?)").run(randomUUID())
    }
  }
  close() { this.db.close() }
  info() { return { libraryId: this.db.prepare("SELECT value FROM meta WHERE key='libraryId'").pluck().get(), roots: this.roots(), settings: this.settings(), tags: this.tags(), actressCount: this.actressCount(), movieCount: this.movieCount() } }
  roots() { return this.db.prepare('SELECT * FROM roots WHERE active=1').all() }
  root(id: string) { return this.db.prepare('SELECT * FROM roots WHERE id=?').get(id) as Row }
  allRoots() { return this.db.prepare('SELECT * FROM roots').all() }
  rootState(id: string, state: string) { this.db.prepare('UPDATE roots SET state=? WHERE id=?').run(state,id) }
  rootIndexed(id:string){this.db.prepare("UPDATE roots SET state='online',lastIndexedAt=? WHERE id=?").run(Date.now(),id)}
  rootIndexing(id:string,mode:'manual'|'scheduled',intervalMinutes:number){this.db.prepare('UPDATE roots SET indexMode=?,intervalMinutes=? WHERE id=?').run(mode,intervalMinutes,id);return this.root(id)}
  archiveRoot(id: string) { this.db.prepare('UPDATE roots SET active=0 WHERE id=?').run(id) }
  addRoot(root: Row, merges: { id: string; prefix: string }[] = []) {
    return this.db.transaction(() => {
      const old = this.db.prepare('SELECT * FROM roots WHERE identity=? AND path=?').get(root.identity, root.path) as Row | undefined
      if (old) { this.db.prepare("UPDATE roots SET active=1,state='online' WHERE id=?").run(old.id); return old }
      this.db.prepare('INSERT INTO roots(id,name,path,entryId,state,identity) VALUES(@id,@name,@path,@entryId,\'online\',@identity)').run(root)
      this.insert({ id: root.entryId, rootId: root.id, parentId: null, kind: 'folder', name: root.name, rel: '', identity: root.identity, size: 0, mtime: 0, ext: '', seen: '' })
      for (const merge of merges) {
        const rows = this.db.prepare('SELECT * FROM entries WHERE rootId=?').all(merge.id) as Row[]
        for (const e of rows) {
          const rel = [merge.prefix,e.rel].filter(Boolean).join('/')
          this.db.prepare('UPDATE entries SET rootId=?,rel=?,pathKey=?,search=? WHERE id=?').run(root.id, rel, rel, searchText(rel,e.name),e.id)
        }
        this.db.prepare('UPDATE roots SET active=0 WHERE id=?').run(merge.id)
      }
      return root
    })()
  }
  private insert(e: Row) {
    this.db.prepare(`INSERT INTO entries(id,rootId,parentId,kind,name,rel,pathKey,ext,size,mtime,identity,sortKey,search,seen) VALUES(@id,@rootId,@parentId,@kind,@name,@rel,@rel,@ext,@size,@mtime,@identity,@sortKey,@search,@seen)`).run({...e,sortKey:naturalKey(e.name),search:searchText(e.rel,e.name)})
    if (e.kind === 'folder') this.attachClosure(e.id,e.parentId)
  }
  private attachClosure(id: string, parentId: string | null) {
    this.db.prepare('INSERT OR IGNORE INTO closure VALUES(?,?,0)').run(id,id)
    if (parentId) this.db.prepare('INSERT OR IGNORE INTO closure SELECT ancestor,?,depth+1 FROM closure WHERE descendant=?').run(id,parentId)
  }
  findPath(rootId: string, rel: string) { return this.db.prepare("SELECT * FROM entries WHERE rootId=? AND pathKey=? AND state='present'").get(rootId, rel) }
  findIdentity(identity: string) { return this.db.prepare('SELECT e.*,r.path AS rootPath FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.identity=?').all(identity) }
  lookupBatch(rootId:string,items:{rel:string;identity:string}[]){const existing=this.db.prepare("SELECT id FROM entries WHERE rootId=? AND pathKey=? AND state='present'");const identity=this.db.prepare('SELECT e.id,e.rel,e.identity,r.path AS rootPath FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.identity=?');return items.map(item=>{const known=!!existing.get(rootId,item.rel);return {rel:item.rel,known,matches:known?[]:identity.all(item.identity)}})}
  ingest(items: Row[]) {
    return this.db.transaction(() => items.map(item => {
      let e = this.findPath(item.rootId,item.rel) as Row | undefined
      if (e && e.identity !== item.identity) { this.db.prepare("UPDATE entries SET state='replaced' WHERE id=?").run(e.id); e=undefined }
      if (!e && item.reuseId) e = this.db.prepare('SELECT * FROM entries WHERE id=? AND identity=?').get(item.reuseId,item.identity) as Row | undefined
      if (e) {
        const changed = e.size !== item.size || Math.abs(e.mtime-item.mtime)>1
        if(!changed&&e.parentId===item.parentId&&e.rootId===item.rootId&&e.rel===item.rel&&e.name===item.name){this.db.prepare("UPDATE entries SET seen=?,state='present' WHERE id=?").run(item.seen,e.id);return {...item,id:e.id}}
        this.db.prepare(`UPDATE entries SET parentId=@parentId,rootId=@rootId,rel=@rel,pathKey=@rel,name=@name,sortKey=@sortKey,search=@search,size=@size,mtime=@mtime,seen=@seen,state='present',revision=revision+@changed,playback=CASE WHEN @changed THEN 0 ELSE playback END,width=CASE WHEN @changed THEN NULL ELSE width END,duration=CASE WHEN @changed THEN NULL ELSE duration END,probeError=CASE WHEN @changed THEN NULL ELSE probeError END WHERE id=@id`).run({...item,id:e.id,sortKey:naturalKey(item.name),search:searchText(item.rel,item.name),changed:changed?1:0})
        if (item.kind==='folder') { this.db.prepare('DELETE FROM closure WHERE descendant=?').run(e.id); this.attachClosure(e.id,item.parentId) }
        return {...item,id:e.id}
      }
      this.insert(item); return item
    }))()
  }
  finishDirectory(id: string, seen: string, other: number) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE entries SET state='missing' WHERE parentId=? AND seen!=? AND state='present'").run(id,seen)
      this.db.prepare("UPDATE entries SET state='missing' WHERE parentId IN (SELECT descendant FROM closure WHERE ancestor IN (SELECT id FROM entries WHERE parentId=? AND state='missing'))").run(id)
      this.db.prepare("UPDATE entries SET directImages=(SELECT count(*) FROM entries c WHERE c.parentId=entries.id AND c.kind='image' AND c.state='present'), directVideos=(SELECT count(*) FROM entries c WHERE c.parentId=entries.id AND c.kind='video' AND c.state='present'),directFolders=(SELECT count(*) FROM entries c WHERE c.parentId=entries.id AND c.kind='folder' AND c.state='present'),other=?,complete=1 WHERE id=?").run(other,id)
    })()
  }
  ingestDirectory(items:Row[],id:string,seen:string,other:number){return this.db.transaction(()=>{const entries=this.ingest(items);this.finishDirectory(id,seen,other);return entries})()}
  finishScan(rootId: string) {
    this.db.prepare("UPDATE entries SET subtree=(SELECT count(*) FROM entries c WHERE c.state='present' AND c.kind!='folder' AND c.parentId IN (SELECT descendant FROM closure WHERE ancestor=entries.id)) WHERE rootId=? AND kind='folder'").run(rootId)
    this.db.prepare("UPDATE entries SET coverHash=NULL,coverSource=NULL,coverRevision=coverRevision+1 WHERE coverMode='auto' AND coverSource IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM entries s WHERE s.id=entries.coverSource AND s.state='present') OR (kind='folder' AND NOT EXISTS(SELECT 1 FROM entries s JOIN closure c ON c.descendant=s.parentId WHERE s.id=entries.coverSource AND c.ancestor=entries.id)))").run()
  }
  indexEntries(rootId:string,generation:string){return (this.db.prepare("SELECT e.*,r.state AS rootState FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.rootId=? AND e.state='present' AND (e.seen=? OR e.rel='') ORDER BY (e.kind='folder'),length(e.rel) DESC,e.sortKey").all(rootId,generation) as Row[]).map(e=>({...e,tags:[]}))}
  refreshAncestorCovers(id:string,quality?:string){return this.db.transaction(()=>{const target=this.entry(id);if(!target.parentId||!target.coverHash)return [];const ids=this.db.prepare("SELECT e.id FROM entries e JOIN closure c ON c.ancestor=e.id WHERE c.descendant=? AND (e.coverMode IS NULL OR e.coverMode='auto') ORDER BY c.depth").pluck().all(target.parentId) as string[];const update=this.db.prepare("UPDATE entries SET coverMode='auto',coverHash=?,coverSource=?,coverPts=?,crop=?,coverQuality=?,coverRevision=coverRevision+1 WHERE id=?");for(const ancestor of ids)update.run(target.coverHash,target.id,target.coverPts,target.crop,quality??target.coverQuality,ancestor);return ids.map(ancestor=>this.entry(ancestor))})()}
  entry(id: string): Entry {
    const e=this.db.prepare('SELECT e.*,r.state AS rootState FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.id=?').get(id) as Row | undefined
    if (!e) throw Error('条目不存在')
    return {...e, tags:this.db.prepare('SELECT tag FROM entry_tags WHERE entryId=? ORDER BY tag').pluck().all(id)} as Entry
  }
  ancestors(id: string) { const result: Entry[]=[]; let e: Entry | null=this.entry(id); for(let i=0;e && i<256;i++){result.unshift(e);e=e.parentId?this.entry(e.parentId):null} return result }
  children(id: string) { return (this.db.prepare("SELECT id FROM entries WHERE parentId=? AND kind='folder' AND state='present' ORDER BY sortKey LIMIT 500").pluck().all(id) as string[]).map(v=>this.entry(v)) }
  tags(): { name: string; count: number }[] { return this.db.prepare("SELECT tag AS name,count(*) AS count FROM entry_tags t JOIN entries e ON e.id=t.entryId JOIN roots r ON r.id=e.rootId WHERE r.active=1 GROUP BY tag ORDER BY tag").all() as { name: string; count: number }[] }
  openQuery(q: QuerySpec): QuerySession {
    const {where,params,order}=compileQuery(q); const id=randomUUID();const table='query_'+(++this.sessionCounter)
    while(this.sessions.size>=3){ const oldest=this.sessions.keys().next().value!; const old=this.sessions.get(oldest)!;this.sessions.delete(oldest);this.db.exec(`DROP TABLE IF EXISTS temp.${old.table}`) }
    this.db.exec(`CREATE TEMP TABLE ${table}(ordinal INTEGER PRIMARY KEY,entryId TEXT NOT NULL,revision INTEGER NOT NULL,folder INTEGER NOT NULL)`)
    this.db.prepare(`INSERT INTO ${table} SELECT row_number() OVER(ORDER BY ${order})-1,e.id,e.revision,(e.kind='folder') FROM entries e JOIN roots r ON r.id=e.rootId WHERE ${where}`).run(...params)
    const counts=this.db.prepare(`SELECT count(*) AS total,coalesce(sum(folder),0) AS folders FROM ${table}`).get() as {total:number;folders:number}
    const {total,folders}=counts
    const incomplete = this.db.prepare("SELECT count(*) FROM roots WHERE active=1 AND state NOT IN ('online','offline')").pluck().get() as number
    const session={id,total,folders,media:total-folders,complete:incomplete===0,touched:Date.now(),table}; this.sessions.set(id,session);return {id,total,folders,media:total-folders,complete:incomplete===0}
  }
  page(id: string,offset: number,limit=100) {
    const session=this.sessions.get(id);if(!session || Date.now()-session.touched>600000) throw Error('QUERY_EXPIRED：浏览结果已过期，请刷新')
    session.touched=Date.now()
    const rows=this.db.prepare(`SELECT entryId FROM ${session.table} WHERE ordinal>=? AND ordinal<? ORDER BY ordinal`).pluck().all(offset,offset+Math.min(limit,200)) as string[]
    return {entries:rows.map(v=>this.entry(v)),offset,total:session.total}
  }
  position(id:string,entryId:string){const session=this.sessions.get(id);if(!session)throw Error('QUERY_EXPIRED');const value=this.db.prepare(`SELECT ordinal FROM ${session.table} WHERE entryId=?`).pluck().get(entryId);return typeof value==='number'?value:null}
  sessionIds(id: string) { const session=this.sessions.get(id);if(!session)throw Error('QUERY_EXPIRED');return this.db.prepare(`SELECT entryId,revision,ordinal FROM ${session.table} ORDER BY ordinal`).all() as Row[] }
  freeze(rows: Row[]) {const id=randomUUID();this.db.transaction(()=>{this.db.prepare('INSERT INTO snapshots VALUES(?,?)').run(id,Date.now()); const put=this.db.prepare('INSERT INTO selection_items VALUES(?,?,?,?)'); for(const row of rows)put.run(id,row.entryId,row.revision,row.ordinal)})();return {snapshotId:id,count:rows.length} }
  selected(s: Selection): Entry[] {
    if('ids' in s) return [...new Set(s.ids)].map(id=>this.entry(id))
    const rows=this.db.prepare('SELECT entryId,revision FROM selection_items WHERE snapshotId=? ORDER BY ordinal').all(s.snapshotId) as Row[]
    if(!rows.length)throw Error('选择快照已过期')
    return rows.map(row=>{const e=this.entry(row.entryId); if(e.revision!==row.revision || e.state!=='present') throw Error(`SOURCE_CHANGED：${e.name} 已变化，请重新选择`); return e})
  }
  organize(s: Selection,action: string,value: string | boolean) {
    const entries=this.selected(s); this.db.transaction(()=>{for(const e of entries){
      if(action==='favorite')this.db.prepare('UPDATE entries SET favorite=? WHERE id=?').run(value?1:0,e.id)
      else if(action==='tag-add')this.db.prepare('INSERT OR IGNORE INTO entry_tags VALUES(?,?)').run(e.id,value)
      else if(action==='tag-remove')this.db.prepare('DELETE FROM entry_tags WHERE entryId=? AND tag=?').run(e.id,value)
    }})()
  }
  metadata(id: string,rev: number,data: Row) { this.db.prepare('UPDATE entries SET width=?,height=?,duration=?,codec=?,probeError=? WHERE id=? AND revision=?').run(data.width??null,data.height??null,data.duration??null,data.codec??null,data.error??null,id,rev) }
  unprobed(rootId:string,limit=50){return (this.db.prepare("SELECT e.id FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.rootId=? AND e.kind!='folder' AND e.state='present' AND e.width IS NULL AND e.probeError IS NULL AND r.state='online' LIMIT ?").pluck().all(rootId,limit) as string[]).map(id=>this.entry(id))}
  playback(id: string,position: number,revision:number) { this.db.prepare('UPDATE entries SET playback=? WHERE id=? AND revision=?').run(position,id,revision) }
  cover(id: string,revision: number,data: Row,automatic=false) {
    const result=this.db.prepare(`UPDATE entries SET coverMode=@mode,coverHash=@hash,coverOriginal=@original,coverSource=@source,coverPts=@pts,crop=@crop,coverQuality=@quality,coverRevision=coverRevision+1 WHERE id=@id AND coverRevision=@revision ${automatic?"AND (coverMode IS NULL OR coverMode='auto')":''}`).run({id,revision,mode:data.mode,hash:data.hash,original:data.original??null,source:data.source??null,pts:data.pts??null,crop:JSON.stringify(data.crop??{mode:'cover',x:.5,y:.5,zoom:1}),quality:data.quality??'fast'})
    if(!result.changes&&!automatic)throw Error('封面已被其他操作修改，请重新打开编辑器')
    return result.changes
  }
  automaticCandidates(id:string){const e=this.entry(id);if(e.kind!=='folder')return [e];const rows=this.db.prepare("SELECT id FROM entries WHERE parentId=? AND state='present' AND (kind!='folder' OR coverHash IS NOT NULL) ORDER BY CASE WHEN coverMode='manual' THEN 0 WHEN kind='image' THEN 1 WHEN coverHash IS NOT NULL THEN 2 ELSE 3 END,sortKey LIMIT 24").pluck().all(id) as string[];return rows.length?rows.map(id=>this.entry(id)):this.candidates(id)}
  candidates(id: string) {
    const e=this.entry(id);if(e.kind!=='folder')return [e]
    return (this.db.prepare("SELECT e.id FROM entries e JOIN closure c ON c.descendant=e.parentId WHERE c.ancestor=? AND e.kind!='folder' AND e.state='present' ORDER BY c.depth,e.sortKey LIMIT 240").pluck().all(id) as string[]).map(id=>this.entry(id))
  }
  settings(patch?: Row) { if(patch)this.db.transaction(()=>{const put=this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');for(const [k,v]of Object.entries(patch))put.run(k,JSON.stringify(v))})();return Object.fromEntries((this.db.prepare('SELECT * FROM settings').all() as Row[]).map(r=>[r.key,JSON.parse(r.value)])) }
  log(id: string,state: string,data: unknown) {this.db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?,?,?)').run(id,state,JSON.stringify(data),Date.now())}
  operations() {return (this.db.prepare('SELECT * FROM operations ORDER BY updated DESC LIMIT 500').all() as Row[]).map(r=>({...r,data:JSON.parse(r.data)}))}
  storageReferences(){const rows=this.db.prepare('SELECT id,revision,state,coverMode,coverHash,coverOriginal,coverRevision FROM entries').all() as Row[];const cache:string[]=[];const objects:string[]=[];for(const row of rows){if(row.coverMode==='manual'){if(row.coverHash)objects.push(row.coverHash+'.png');if(row.coverOriginal)objects.push(row.coverOriginal+'.png')}else if(row.coverHash)cache.push(row.coverHash+'.png');if(row.state==='present')cache.push(`thumb-${row.id}-${row.revision}-${row.coverRevision}.webp`,...coverQualities.map(quality=>thumbnailName(row as Entry,quality.value)))}return {cache:[...new Set(cache)],objects:[...new Set(objects)]}}
  relocate(id: string,rootId: string,parentId: string,rel: string,name: string,identities: Record<string,string>={}) {
    this.db.transaction(()=>{const e=this.entry(id); const children=this.db.prepare("SELECT * FROM entries WHERE rootId=? AND (id=? OR substr(rel,1,?)=?)").all(e.rootId,id,e.rel.length+1,e.rel+'/') as Row[]
      for(const child of children){const next=child.id===id?rel:rel+child.rel.slice(e.rel.length);this.db.prepare('UPDATE entries SET rootId=?,parentId=?,rel=?,pathKey=?,name=?,sortKey=?,search=?,identity=?,state=\'present\' WHERE id=?').run(rootId,child.id===id?parentId:child.parentId,next,next,child.id===id?name:child.name,naturalKey(child.id===id?name:child.name),searchText(next,child.id===id?name:child.name),identities[child.id]??child.identity,child.id)}
      this.rebuildClosure()
    })()
  }
  rebuildClosure() { this.db.exec("DELETE FROM closure; INSERT INTO closure WITH RECURSIVE c(ancestor,descendant,depth) AS(SELECT id,id,0 FROM entries WHERE kind='folder' UNION ALL SELECT c.ancestor,e.id,c.depth+1 FROM c JOIN entries e ON e.parentId=c.descendant WHERE e.kind='folder' AND c.depth<256) SELECT * FROM c;") }
  adoptDirectory(originalId:string,temporaryId:string,identity:string) {this.db.transaction(()=>{const target=this.entry(temporaryId);this.db.prepare("UPDATE entries SET state='merged' WHERE id=?").run(temporaryId);this.db.prepare('UPDATE entries SET parentId=? WHERE parentId=?').run(originalId,temporaryId);this.db.prepare("UPDATE entries SET rootId=?,parentId=?,rel=?,pathKey=?,identity=?,state='present',search=?,sortKey=? WHERE id=?").run(target.rootId,target.parentId,target.rel,target.rel,identity,searchText(target.rel,target.name),naturalKey(target.name),originalId);this.rebuildClosure()})()}
  trash(id: string) {const e=this.entry(id);this.db.prepare("UPDATE entries SET state='trashed' WHERE id=? OR (rootId=? AND substr(rel,1,?)=?)").run(id,e.rootId,e.rel.length+1,e.rel+'/')}
  rebind(rootId: string,path: string,identity: string,matches: Row[]) {this.db.transaction(()=>{this.db.prepare("UPDATE roots SET path=?,identity=?,state='online' WHERE id=?").run(path,identity,rootId);for(const m of matches)this.db.prepare("UPDATE entries SET identity=?,state='present' WHERE id=?").run(m.identity,m.id)})()}
  rootEntries(rootId: string) {return this.db.prepare("SELECT * FROM entries WHERE rootId=? AND state='present' ORDER BY length(rel)").all(rootId)}
  backup(path: string) { return this.db.backup(path) }
  dump() {return Object.fromEntries(['roots','entries','entry_tags','settings','scrape_metadata','actresses'].map(t=>[t,this.db.prepare(`SELECT * FROM ${t}`).all()]))}
  importRecords(data: Record<string,Row[]>) {
    this.db.transaction(()=>{
      for(const r of data.roots??[]) this.db.prepare("INSERT INTO roots(id,name,path,entryId,state,identity,active) VALUES(?,?,'',?,'offline','',1)").run(r.id,r.name,r.entryId)
      const columns=(this.db.pragma('table_info(entries)') as Row[]).map(r=>r.name as string)
      const put=this.db.prepare(`INSERT INTO entries(${columns.join(',')}) VALUES(${columns.map(c=>'@'+c).join(',')})`)
      for(const e of data.entries??[]){if(!safeRelative(e.rel))throw Error('管理包包含非法相对路径');/* watchedAt/watched 为旧版本（v7–v9）库的遗留列：新库无此列时多余键被忽略，旧库导入时提供默认值 */put.run({watchedAt:0,watched:0,coverQuality:'fast',...e})}
      for(const t of data.entry_tags??[])this.db.prepare('INSERT INTO entry_tags VALUES(?,?)').run(t.entryId,t.tag)
      for(const s of data.settings??[])this.db.prepare('INSERT INTO settings VALUES(?,?)').run(s.key,s.value)
      for(const s of data.scrape_metadata??[])this.db.prepare(`INSERT OR REPLACE INTO scrape_metadata(entryId,code,title,originalTitle,studio,series,releaseDate,durationMin,actors,tags,description,coverUrl,coverFile,provider,status,scrapedAt)
        VALUES(@entryId,@code,@title,@originalTitle,@studio,@series,@releaseDate,@durationMin,@actors,@tags,@description,@coverUrl,@coverFile,@provider,@status,@scrapedAt)`).run({...s,entryId:String(s.entryId??'')})
      for(const a of data.actresses??[])this.db.prepare('INSERT OR REPLACE INTO actresses(id,name,japaneseName,chineseName,birthDate,height,bust,waist,hips,cup,aliases,coverEntryId,profileSource,profileAt,createdAt) VALUES(@id,@name,@japaneseName,@chineseName,@birthDate,@height,@bust,@waist,@hips,@cup,@aliases,@coverEntryId,@profileSource,@profileAt,@createdAt)').run({japaneseName:'',chineseName:'',birthDate:'',height:0,bust:0,waist:0,hips:0,cup:'',aliases:'[]',coverEntryId:'',profileSource:'',profileAt:0,createdAt:0,...a,id:String(a.id),name:String(a.name)})
      this.rebuildActresses()
      this.rebuildClosure();const check=this.db.pragma('foreign_key_check');if((check as unknown[]).length)throw Error('管理包关系校验失败')
    })()
  }
  scrapeGet(id: string) {
    const row=this.db.prepare('SELECT * FROM scrape_metadata WHERE entryId=?').get(id) as Row | undefined
    if(!row) return null
    return {...row,actors:JSON.parse(row.actors) as string[],tags:JSON.parse(row.tags) as string[]}
  }
  scrapePut(id: string, data: Row) {
    this.db.transaction(() => {
      // 重新刮削时先移除上一次刮削写入 entry_tags 的旧标签，避免过期标签残留。
      const previous = this.db.prepare('SELECT tags FROM scrape_metadata WHERE entryId=?').get(id) as Row | undefined
      if (previous) for (const tag of parseStringArray(previous.tags)) this.db.prepare('DELETE FROM entry_tags WHERE entryId=? AND tag=?').run(id, tag)
      this.db.prepare(`INSERT INTO scrape_metadata(entryId,code,title,originalTitle,studio,series,releaseDate,durationMin,actors,tags,description,coverUrl,coverFile,provider,status,scrapedAt)
        VALUES(@entryId,@code,@title,@originalTitle,@studio,@series,@releaseDate,@durationMin,@actors,@tags,@description,@coverUrl,@coverFile,@provider,@status,@scrapedAt)
        ON CONFLICT(entryId) DO UPDATE SET code=@code,title=@title,originalTitle=@originalTitle,studio=@studio,series=@series,releaseDate=@releaseDate,durationMin=@durationMin,actors=@actors,tags=@tags,description=@description,coverUrl=@coverUrl,coverFile=@coverFile,provider=@provider,status=@status,scrapedAt=@scrapedAt`)
        .run({...data,entryId:id,actors:JSON.stringify(data.actors??[]),tags:JSON.stringify(data.tags??[])})
      // 刮削标签并入现有标签系统：写入 entry_tags 后，侧边栏与筛选的标签计数自动保持最新。
      for (const raw of Array.isArray(data.tags) ? data.tags : []) {
        const tag = String(raw).trim().slice(0, 64)
        if (tag) this.db.prepare('INSERT OR IGNORE INTO entry_tags VALUES(?,?)').run(id, tag)
      }
      this.syncEntryActors(id, data.actors)
    })()
  }
  // 维护 entry_actors 关联：同一女优跨条目聚合为 actresses 行。
  private syncEntryActors(entryId: string, actors: unknown) {
    const names = [...new Set((Array.isArray(actors) ? actors : []).map(value => String(value).trim()).filter(Boolean))].slice(0, 32)
    this.db.prepare('DELETE FROM entry_actors WHERE entryId=?').run(entryId)
    const find = this.db.prepare('SELECT id FROM actresses WHERE name=?')
    const insert = this.db.prepare('INSERT OR IGNORE INTO actresses(id,name,createdAt) VALUES(?,?,?)')
    const link = this.db.prepare('INSERT OR IGNORE INTO entry_actors VALUES(?,?)')
    for (const name of names) {
      let actressId = (find.get(name) as Row | undefined)?.id as string | undefined
      if (!actressId) { actressId = randomUUID(); insert.run(actressId, name, Date.now()) }
      link.run(entryId, actressId)
    }
  }
  // 从全部刮削结果重建女优与作品关联（迁移与导入时使用）。
  rebuildActresses() {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM entry_actors').run()
      const rows = this.db.prepare('SELECT entryId,actors FROM scrape_metadata').all() as Row[]
      const find = this.db.prepare('SELECT id FROM actresses WHERE name=?')
      const insert = this.db.prepare('INSERT OR IGNORE INTO actresses(id,name,createdAt) VALUES(?,?,?)')
      const link = this.db.prepare('INSERT OR IGNORE INTO entry_actors VALUES(?,?)')
      for (const row of rows) {
        let actors: unknown = []
        try { actors = JSON.parse(String(row.actors ?? '[]')) } catch { actors = [] }
        const names = [...new Set((Array.isArray(actors) ? actors : []).map(value => String(value).trim()).filter(Boolean))].slice(0, 32)
        for (const name of names) {
          let actressId = (find.get(name) as Row | undefined)?.id as string | undefined
          if (!actressId) { actressId = randomUUID(); insert.run(actressId, name, Date.now()) }
          link.run(row.entryId, actressId)
        }
      }
    })()
  }
  // 女优聚合列表：作品数仅统计在线资源目录中的现存视频；封面优先手动选择，
  // 未选择时取有刮削封面且最新发行的作品。
  actressList(sort: string, offset: number, limit: number): ActressPage {
    const workCount = "(SELECT count(*) FROM entry_actors wea JOIN entries we ON we.id=wea.entryId JOIN roots wr ON wr.id=we.rootId WHERE wea.actressId=a.id AND we.state='present' AND we.kind='video' AND wr.active=1)"
    const recentAt = "(SELECT max(we.mtime) FROM entry_actors wea JOIN entries we ON we.id=wea.entryId JOIN roots wr ON wr.id=we.rootId WHERE wea.actressId=a.id AND we.state='present' AND wr.active=1)"
    const autoCover = "(SELECT wea.entryId FROM entry_actors wea JOIN entries we ON we.id=wea.entryId JOIN roots wr ON wr.id=we.rootId LEFT JOIN scrape_metadata sm ON sm.entryId=we.id WHERE wea.actressId=a.id AND we.state='present' AND wr.active=1 ORDER BY (sm.coverFile!='') DESC,sm.releaseDate DESC,we.mtime DESC LIMIT 1)"
    const coverEntry = `(CASE WHEN a.coverEntryId<>'' AND EXISTS(SELECT 1 FROM entries ce JOIN roots cr ON cr.id=ce.rootId WHERE ce.id=a.coverEntryId AND ce.state='present' AND cr.active=1) THEN a.coverEntryId ELSE ${autoCover} END)`
    const orders: Record<string, string> = {
      'work-desc': 'workCount DESC, name COLLATE NOCASE ASC',
      'work-asc': 'workCount ASC, name COLLATE NOCASE ASC',
      'name-asc': 'name COLLATE NOCASE ASC',
      'age-asc': "CASE WHEN birthDate='' THEN 1 ELSE 0 END, birthDate DESC, name COLLATE NOCASE ASC",
      'age-desc': "CASE WHEN birthDate='' THEN 1 ELSE 0 END, birthDate ASC, name COLLATE NOCASE ASC",
      'recent-desc': 'CASE WHEN recentAt IS NULL THEN 1 ELSE 0 END, recentAt DESC, name COLLATE NOCASE ASC'
    }
    const select = `SELECT a.id,a.name,a.japaneseName,a.chineseName,a.birthDate,a.height,a.bust,a.waist,a.hips,a.cup,a.aliases,a.profileSource,a.profileAt,${workCount} AS workCount,${recentAt} AS recentAt,${coverEntry} AS coverEntryId FROM actresses a`
    const rows = this.db.prepare(`SELECT * FROM (${select}) WHERE workCount>0 ORDER BY ${orders[sort] ?? orders['work-desc']!} LIMIT ? OFFSET ?`).all(limit, offset) as Row[]
    const total = this.db.prepare(`SELECT count(*) FROM (SELECT ${workCount} AS workCount FROM actresses a) WHERE workCount>0`).pluck().get() as number
    const items = rows.map(row => ({
      id: String(row.id), name: String(row.name), japaneseName: String(row.japaneseName ?? ''), chineseName: String(row.chineseName ?? ''),
      birthDate: String(row.birthDate ?? ''),
      height: Number(row.height) || 0, bust: Number(row.bust) || 0, waist: Number(row.waist) || 0, hips: Number(row.hips) || 0,
      cup: String(row.cup ?? ''), aliases: parseStringArray(row.aliases), profileSource: String(row.profileSource ?? ''), profileAt: Number(row.profileAt) || 0,
      workCount: Number(row.workCount) || 0, recentAt: row.recentAt == null ? null : Number(row.recentAt),
      coverEntryId: row.coverEntryId == null ? null : String(row.coverEntryId)
    }))
    return { total, items }
  }
  // 编辑演员资料：名字冲突时拒绝；数字字段复用补全的钳制规则。
  actressUpdate(id: string, data: Row) {
    const name = String(data.name ?? '').trim().slice(0, 64)
    if (!name) throw Error('演员名字不能为空')
    if (this.db.prepare('SELECT id FROM actresses WHERE name=? AND id!=?').get(name, id)) throw Error(`已存在同名演员：${name}`)
    this.db.prepare(`UPDATE actresses SET name=@name,japaneseName=@japaneseName,chineseName=@chineseName,birthDate=@birthDate,height=@height,bust=@bust,waist=@waist,hips=@hips,cup=@cup WHERE id=@id`)
      .run({
        id, name,
        japaneseName: String(data.japaneseName ?? '').trim().slice(0, 64), chineseName: String(data.chineseName ?? '').trim().slice(0, 64),
        birthDate: String(data.birthDate ?? '').trim().slice(0, 10),
        height: clampCount(data.height), bust: clampCount(data.bust), waist: clampCount(data.waist), hips: clampCount(data.hips),
        cup: String(data.cup ?? '').trim().slice(0, 4).toUpperCase()
      })
  }
  // 演员封面候选：关联的现存作品，有刮削封面者优先，按发行日期倒序。
  actressCoverOptions(id: string, limit: number) {
    return this.db.prepare(`SELECT e.id AS entryId,sm.code,sm.title,sm.releaseDate,(sm.coverFile!='') AS hasCover,e.favorite
      FROM entry_actors ea JOIN entries e ON e.id=ea.entryId JOIN roots r ON r.id=e.rootId LEFT JOIN scrape_metadata sm ON sm.entryId=e.id
      WHERE ea.actressId=? AND e.state='present' AND r.active=1
      ORDER BY (sm.coverFile!='') DESC,sm.releaseDate DESC,e.mtime DESC LIMIT ?`).all(id, limit) as Row[]
  }
  // 手动指定演员封面（取某部作品的封面作为头像）。
  actressSetCover(id: string, entryId: string) {
    if (!this.db.prepare('SELECT 1 FROM entry_actors WHERE actressId=? AND entryId=?').get(id, entryId)) throw Error('所选影片不属于该演员')
    if (!this.db.prepare("SELECT 1 FROM entries WHERE id=? AND state='present'").get(entryId)) throw Error('所选影片不可用')
    this.db.prepare('UPDATE actresses SET coverEntryId=? WHERE id=?').run(entryId, id)
  }
  // 电影列表：资源库中已刮削的视频，按数据源粒度排序分页。
  javMovieList(sort: string, offset: number, limit: number) {
    const where = "FROM scrape_metadata sm JOIN entries e ON e.id=sm.entryId JOIN roots r ON r.id=e.rootId WHERE e.state='present' AND r.active=1"
    const orders: Record<string, string> = {
      'recent-desc': 'e.mtime DESC, sm.code COLLATE NOCASE ASC',
      'code-asc': "sm.code COLLATE NOCASE ASC, e.mtime DESC",
      'release-desc': "sm.releaseDate DESC, e.mtime DESC",
      'duration-desc': 'sm.durationMin DESC, e.mtime DESC',
      'title-asc': 'sm.title COLLATE NOCASE ASC, e.mtime DESC'
    }
    const rows = this.db.prepare(`SELECT sm.entryId,sm.code,sm.title,sm.releaseDate,sm.durationMin,sm.actors,sm.tags,e.favorite,e.mtime ${where} ORDER BY ${orders[sort] ?? orders['recent-desc']!} LIMIT ? OFFSET ?`).all(limit, offset) as Row[]
    const total = this.db.prepare(`SELECT count(*) ${where}`).pluck().get() as number
    const items = rows.map(row => ({
      entryId: String(row.entryId), code: String(row.code ?? ''), title: String(row.title ?? ''),
      releaseDate: String(row.releaseDate ?? ''), durationMin: Number(row.durationMin) || 0,
      actors: parseStringArray(row.actors), tags: parseStringArray(row.tags),
      favorite: Number(row.favorite) || 0, mtime: Number(row.mtime) || 0
    }))
    return { total, items }
  }
  movieCount() {
    return this.db.prepare("SELECT count(*) FROM scrape_metadata sm JOIN entries e ON e.id=sm.entryId JOIN roots r ON r.id=e.rootId WHERE e.state='present' AND r.active=1").pluck().get() as number
  }
  actressMissingProfiles(limit: number) {
    const workCount = "(SELECT count(*) FROM entry_actors wea JOIN entries we ON we.id=wea.entryId JOIN roots wr ON wr.id=we.rootId WHERE wea.actressId=a.id AND we.state='present' AND we.kind='video' AND wr.active=1)"
    return this.db.prepare(`SELECT id,name FROM (SELECT a.id,a.name,a.profileAt,${workCount} AS workCount FROM actresses a) WHERE workCount>0 AND profileAt=0 LIMIT ?`).all(limit) as Row[]
  }
  // 取该女优一个已刮削到的番号，供按番号的资料补全源（JavDatabase）使用。
  actressSampleCode(id: string): string | null {
    const value = this.db.prepare("SELECT sm.code FROM entry_actors ea JOIN scrape_metadata sm ON sm.entryId=ea.entryId WHERE ea.actressId=? AND sm.code!='' ORDER BY sm.scrapedAt DESC LIMIT 1").pluck().get(id) as string | undefined
    return value ?? null
  }
  actressProfilePatch(id: string, data: Row) {
    this.db.prepare("UPDATE actresses SET japaneseName=@japaneseName,chineseName=CASE WHEN chineseName='' THEN @chineseName ELSE chineseName END,birthDate=@birthDate,height=@height,bust=@bust,waist=@waist,hips=@hips,cup=@cup,aliases=@aliases,profileSource=@profileSource,profileAt=@profileAt WHERE id=@id")
      .run({
        id, japaneseName: String(data.japaneseName ?? '').trim().slice(0, 64), chineseName: String(data.chineseName ?? '').trim().slice(0, 64), birthDate: String(data.birthDate ?? '').slice(0, 10),
        height: clampCount(data.height), bust: clampCount(data.bust), waist: clampCount(data.waist), hips: clampCount(data.hips),
        cup: String(data.cup ?? '').trim().slice(0, 4), aliases: JSON.stringify(parseStringArray(data.aliases).slice(0, 16)),
        profileSource: String(data.profileSource ?? '').slice(0, 40), profileAt: Math.round(Number(data.profileAt)) || Date.now()
      })
  }
  actressCount() {
    return this.db.prepare("SELECT count(*) FROM (SELECT ea.actressId FROM entry_actors ea JOIN entries e ON e.id=ea.entryId JOIN roots r ON r.id=e.rootId WHERE e.state='present' AND e.kind='video' AND r.active=1 GROUP BY ea.actressId)").pluck().get() as number
  }
  scrapeDelete(id: string) {
    this.db.transaction(() => {
      // 清除刮削时同步移除其写入 entry_tags 的标签，保持标签计数一致。
      const row = this.db.prepare('SELECT tags FROM scrape_metadata WHERE entryId=?').get(id) as Row | undefined
      if (row) for (const tag of parseStringArray(row.tags)) this.db.prepare('DELETE FROM entry_tags WHERE entryId=? AND tag=?').run(id, tag)
      this.db.prepare('DELETE FROM scrape_metadata WHERE entryId=?').run(id)
      this.db.prepare('DELETE FROM entry_actors WHERE entryId=?').run(id)
    })()
  }
  scrapeStats() {
    const videos=this.db.prepare("SELECT count(*) FROM entries WHERE kind='video' AND state='present'").pluck().get() as number
    const scraped=this.db.prepare("SELECT count(*) FROM scrape_metadata s JOIN entries e ON e.id=s.entryId WHERE e.state='present'").pluck().get() as number
    const covers=this.db.prepare("SELECT count(*) FROM scrape_metadata s JOIN entries e ON e.id=s.entryId WHERE e.state='present' AND s.coverFile!=''").pluck().get() as number
    return {videos,scraped,covers}
  }
  scrapeTargets(s: Selection, limit=5000): Entry[] {
    if('ids' in s){
      const get=this.db.prepare("SELECT e.*,r.state AS rootState FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.id=? AND e.kind='video' AND e.state='present'")
      const out: Entry[]=[]
      for(const id of [...new Set(s.ids)]){const row=get.get(id) as Row|undefined;if(row)out.push({...row,tags:[]} as unknown as Entry)}
      return out
    }
    const rows=this.db.prepare("SELECT e.*,r.state AS rootState FROM entries e JOIN roots r ON r.id=e.rootId JOIN selection_items si ON si.entryId=e.id WHERE si.snapshotId=? AND e.kind='video' AND e.state='present' ORDER BY si.ordinal LIMIT ?").all(s.snapshotId,limit) as Row[]
    return rows.map(r=>({...r,tags:[]} as unknown as Entry))
  }
}
