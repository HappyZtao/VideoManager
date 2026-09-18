import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { compileQuery, naturalKey, safeRelative } from '../domain'
import type { Entry, QuerySpec, QuerySession, Selection } from '../contracts'

export const schema = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roots(id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,entryId TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'online',identity TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS entries(
 id TEXT UNIQUE NOT NULL,rootId TEXT NOT NULL REFERENCES roots(id),parentId TEXT,kind TEXT NOT NULL,name TEXT NOT NULL,rel TEXT NOT NULL,pathKey TEXT NOT NULL,
 ext TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL DEFAULT 0,mtime REAL NOT NULL DEFAULT 0,identity TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,state TEXT NOT NULL DEFAULT 'present',
 sortKey TEXT NOT NULL,search TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,width INTEGER,height INTEGER,duration REAL,codec TEXT,probeError TEXT,
 coverMode TEXT,coverHash TEXT,coverRevision INTEGER NOT NULL DEFAULT 0,coverSource TEXT,coverPts TEXT,crop TEXT,coverOriginal TEXT,
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
`
type Row = Record<string, any>
const searchText = (rel: string, name: string) => `${name}\n${rel}`.normalize('NFKC').toLowerCase()
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
    if (version > 1) throw Error('数据库由更高版本创建，请升级应用')
    if (!readonly) {
      this.db.pragma('journal_mode=WAL'); this.db.pragma('synchronous=FULL')
      this.db.exec(schema); this.db.pragma('user_version=1')
      this.db.prepare("INSERT OR IGNORE INTO meta VALUES('libraryId',?)").run(randomUUID())
      this.db.prepare("UPDATE roots SET state='checking' WHERE active=1 AND path!=''").run()
    }
  }
  close() { this.db.close() }
  info() { return { libraryId: this.db.prepare("SELECT value FROM meta WHERE key='libraryId'").pluck().get(), roots: this.roots(), settings: this.settings(), tags: this.tags() } }
  roots() { return this.db.prepare('SELECT * FROM roots WHERE active=1').all() }
  root(id: string) { return this.db.prepare('SELECT * FROM roots WHERE id=?').get(id) as Row }
  allRoots() { return this.db.prepare('SELECT * FROM roots').all() }
  rootState(id: string, state: string) { this.db.prepare('UPDATE roots SET state=? WHERE id=?').run(state,id) }
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
  lookupBatch(rootId:string,items:{rel:string;identity:string}[]){const existing=this.db.prepare("SELECT id FROM entries WHERE rootId=? AND pathKey=? AND state='present'");const identity=this.db.prepare('SELECT e.id,e.rel,e.identity,r.path AS rootPath FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.identity=?');return items.map(item=>({rel:item.rel,known:!!existing.get(rootId,item.rel),matches:identity.all(item.identity)}))}
  ingest(items: Row[]) {
    return this.db.transaction(() => items.map(item => {
      let e = this.findPath(item.rootId,item.rel) as Row | undefined
      if (e && e.identity !== item.identity) { this.db.prepare("UPDATE entries SET state='replaced' WHERE id=?").run(e.id); e=undefined }
      if (!e && item.reuseId) e = this.db.prepare('SELECT * FROM entries WHERE id=? AND identity=?').get(item.reuseId,item.identity) as Row | undefined
      if (e) {
        const changed = e.size !== item.size || Math.abs(e.mtime-item.mtime)>1
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
  entry(id: string): Entry {
    const e=this.db.prepare('SELECT e.*,r.state AS rootState FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.id=?').get(id) as Row | undefined
    if (!e) throw Error('条目不存在')
    return {...e, tags:this.db.prepare('SELECT tag FROM entry_tags WHERE entryId=? ORDER BY tag').pluck().all(id)} as Entry
  }
  ancestors(id: string) { const result: Entry[]=[]; let e: Entry | null=this.entry(id); for(let i=0;e && i<256;i++){result.unshift(e);e=e.parentId?this.entry(e.parentId):null} return result }
  children(id: string) { return (this.db.prepare("SELECT id FROM entries WHERE parentId=? AND kind='folder' AND state='present' ORDER BY sortKey LIMIT 500").pluck().all(id) as string[]).map(v=>this.entry(v)) }
  tags() { return this.db.prepare("SELECT tag AS name,count(*) AS count FROM entry_tags t JOIN entries e ON e.id=t.entryId JOIN roots r ON r.id=e.rootId WHERE r.active=1 GROUP BY tag ORDER BY tag").all() }
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
      else this.db.prepare('DELETE FROM entry_tags WHERE entryId=? AND tag=?').run(e.id,value)
    }})()
  }
  metadata(id: string,rev: number,data: Row) { this.db.prepare('UPDATE entries SET width=?,height=?,duration=?,codec=?,probeError=? WHERE id=? AND revision=?').run(data.width??null,data.height??null,data.duration??null,data.codec??null,data.error??null,id,rev) }
  unprobed(rootId:string,limit=50){return (this.db.prepare("SELECT e.id FROM entries e JOIN roots r ON r.id=e.rootId WHERE e.rootId=? AND e.kind!='folder' AND e.state='present' AND e.width IS NULL AND e.probeError IS NULL AND r.state='online' LIMIT ?").pluck().all(rootId,limit) as string[]).map(id=>this.entry(id))}
  playback(id: string,position: number,revision:number) { this.db.prepare('UPDATE entries SET playback=? WHERE id=? AND revision=?').run(position,id,revision) }
  cover(id: string,revision: number,data: Row,automatic=false) {
    const result=this.db.prepare(`UPDATE entries SET coverMode=@mode,coverHash=@hash,coverOriginal=@original,coverSource=@source,coverPts=@pts,crop=@crop,coverRevision=coverRevision+1 WHERE id=@id AND coverRevision=@revision ${automatic?"AND (coverMode IS NULL OR coverMode='auto')":''}`).run({id,revision,mode:data.mode,hash:data.hash,original:data.original??null,source:data.source??null,pts:data.pts??null,crop:JSON.stringify(data.crop??{mode:'cover',x:.5,y:.5,zoom:1})})
    if(!result.changes&&!automatic)throw Error('封面已被其他操作修改，请重新打开编辑器')
    return result.changes
  }
  candidates(id: string) {
    const e=this.entry(id);if(e.kind!=='folder')return [e]
    return (this.db.prepare("SELECT e.id FROM entries e JOIN closure c ON c.descendant=e.parentId WHERE c.ancestor=? AND e.kind!='folder' AND e.state='present' ORDER BY c.depth,e.sortKey LIMIT 240").pluck().all(id) as string[]).map(id=>this.entry(id))
  }
  settings(patch?: Row) { if(patch)this.db.transaction(()=>{const put=this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)');for(const [k,v]of Object.entries(patch))put.run(k,JSON.stringify(v))})();return Object.fromEntries((this.db.prepare('SELECT * FROM settings').all() as Row[]).map(r=>[r.key,JSON.parse(r.value)])) }
  log(id: string,state: string,data: unknown) {this.db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?,?,?)').run(id,state,JSON.stringify(data),Date.now())}
  operations() {return (this.db.prepare('SELECT * FROM operations ORDER BY updated DESC LIMIT 500').all() as Row[]).map(r=>({...r,data:JSON.parse(r.data)}))}
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
  dump() {return Object.fromEntries(['roots','entries','entry_tags','settings'].map(t=>[t,this.db.prepare(`SELECT * FROM ${t}`).all()]))}
  importRecords(data: Record<string,Row[]>) {
    this.db.transaction(()=>{
      for(const r of data.roots??[]) this.db.prepare("INSERT INTO roots(id,name,path,entryId,state,identity,active) VALUES(?,?,'',?,'offline','',1)").run(r.id,r.name,r.entryId)
      const columns=(this.db.pragma('table_info(entries)') as Row[]).map(r=>r.name as string)
      const put=this.db.prepare(`INSERT INTO entries(${columns.join(',')}) VALUES(${columns.map(c=>'@'+c).join(',')})`)
      for(const e of data.entries??[]){if(!safeRelative(e.rel))throw Error('管理包包含非法相对路径');put.run(e)}
      for(const t of data.entry_tags??[])this.db.prepare('INSERT INTO entry_tags VALUES(?,?)').run(t.entryId,t.tag)
      for(const s of data.settings??[])this.db.prepare('INSERT INTO settings VALUES(?,?)').run(s.key,s.value)
      this.rebuildClosure();const check=this.db.pragma('foreign_key_check');if((check as unknown[]).length)throw Error('管理包关系校验失败')
    })()
  }
}
